/*
 * The game's interface in a language nobody wrote it in (`korczak-xyz/src/utils/rpg/uiTranslate.ts`):
 * `{kind:'ui', lang}` on rpgDemo answers `{ lang, hash, strings }`, the English table translated by
 * Gemini on the server's keys.
 *
 * - **Once per language, for everybody**: kept in `rpgUi/{lang}` (Admin SDK only, no rule, like
 *   `rpgVoices`) with the English each string was made from, and in this instance's memory. A deploy
 *   that changes some English strings translates only those; the rest is reused.
 * - **Nothing a browser sends is translated**: the request names a language on `LANGUAGES` and
 *   nothing else, and the text is the server's own copy of the table. So the most this can ever
 *   cost is one translation of ~16k characters per language on the list, which is why it is not
 *   counted against the demo's budget.
 * - **A failed slice is not fatal**: its keys stay English, are not stored, and are asked for again
 *   on the next request.
 */

import { asLang, languageName } from '../../../korczak-xyz/src/utils/rpg/language';
import {
  cleanTranslation,
  slices,
  sourceHash,
  translationPrompt,
  uiSource,
} from '../../../korczak-xyz/src/utils/rpg/uiTranslate';
import { db } from '../runtime';
import { reportError } from '../sentry';

/** Tried in order: a model that refuses or is gone hands the slice to the next. */
const MODELS = ['gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3-flash-preview'];

export interface UiAnswer {
  lang: string;
  hash: string;
  strings: Record<string, string>;
}

interface Stored {
  hash: string;
  /** The translation, by key. */
  strings: Record<string, string>;
  /** The English each translation was made from, by key: a changed one is translated again. */
  sources: Record<string, string>;
}

const memory = new Map<string, Promise<UiAnswer>>();

async function translateSlice(key: string, lang: string, entries: Record<string, string>): Promise<Record<string, string>> {
  const prompt = translationPrompt(languageName(lang), entries);
  let lastError: unknown = null;
  for (const model of MODELS) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'low' } },
        }),
      });
      if (!r.ok) {
        lastError = new Error(`${model}: ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`);
        continue;
      }
      const data = (await r.json()) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
      const text = (data.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('');
      return cleanTranslation(entries, JSON.parse(text));
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError ?? new Error('no model answered');
}

async function build(lang: string, googleKey: () => Promise<string | null>): Promise<UiAnswer> {
  const source = uiSource();
  const hash = sourceHash(source);
  const doc = db.collection('rpgUi').doc(lang);
  const snap = await doc.get();
  const stored = (snap.exists ? snap.data() : null) as Partial<Stored> | null;
  const strings: Record<string, string> = {};
  const sources: Record<string, string> = {};
  for (const [k, english] of Object.entries(source)) {
    const kept = stored?.strings?.[k];
    if (kept !== undefined && stored?.sources?.[k] === english) {
      strings[k] = kept;
      sources[k] = english;
    }
  }
  const missing = Object.fromEntries(Object.entries(source).filter(([k]) => strings[k] === undefined));
  if (Object.keys(missing).length === 0) {
    if (stored?.hash !== hash) await doc.set({ hash, strings, sources, at: Date.now() });
    return { lang, hash, strings };
  }
  const key = await googleKey();
  if (!key) return { lang, hash: '', strings };
  const results = await Promise.allSettled(slices(missing).map((part) => translateSlice(key, lang, part)));
  let complete = true;
  for (const r of results) {
    if (r.status === 'rejected') {
      complete = false;
      reportError('rpgDemo.ui', r.reason);
      continue;
    }
    for (const [k, text] of Object.entries(r.value)) {
      strings[k] = text;
      sources[k] = source[k];
    }
  }
  await doc.set({ hash: complete ? hash : '', strings, sources, at: Date.now() });
  // An incomplete answer says so with an empty hash, and the browser asks again on its next visit.
  return { lang, hash: complete ? hash : '', strings };
}

/** The interface in `rawLang`, translated once and kept; English and Polish are the browser's own. */
export async function uiStrings(rawLang: unknown, googleKey: () => Promise<string | null>): Promise<UiAnswer | null> {
  const lang = asLang(rawLang);
  if (!lang || lang === 'en' || lang === 'pl') return null;
  const hash = sourceHash(uiSource());
  const cached = memory.get(lang);
  if (cached) {
    const answer = await cached.catch(() => null);
    if (answer && answer.hash === hash) return answer;
  }
  const fresh = build(lang, googleKey);
  memory.set(lang, fresh);
  fresh.catch(() => memory.delete(lang));
  const answer = await fresh;
  if (!answer.hash) memory.delete(lang);
  return answer;
}
