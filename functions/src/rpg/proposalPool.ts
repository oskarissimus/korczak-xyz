/*
 * The menu's proposed worlds, made on the server (`korczak-xyz/src/utils/rpg/proposalPool.ts` has
 * the why and the file format). `rpgProposals` runs `growPool` once a day; rpgDemo's
 * `{kind:'proposals', lang}` runs `poolFor` when a language has no file yet.
 *
 * - **On the server's keys** (`readServerKeys`, the admin panel's): Google writes the proposals and
 *   translates them, fal.ai draws the covers. A day costs about three cents: two short answers and
 *   eight FLUX schnell pictures at $0.003.
 * - **Everything is a file in the game's bucket** under `proposals/`, with the fixed token the page
 *   builds its URL from. The covers are copied there too, so a cover outlives fal.ai's own URL.
 * - **A language costs one translation, ever**: the whole pool the first time somebody plays in it,
 *   then only each day's new items. The language must be on `LANGUAGES` — a browser cannot make
 *   this translate anything else, nor make more than one file per language.
 * - **A missing English pool is made on demand** too, once per instance, so a fresh project has
 *   proposals on its first visit rather than the next morning.
 */

import { randomUUID } from 'node:crypto';

import { getStorage } from 'firebase-admin/storage';

import { asLang, languageName, LANGUAGES } from '../../../korczak-xyz/src/utils/rpg/language';
import { FAL_IMAGE_MODEL } from '../../../korczak-xyz/src/utils/rpg/falPrompts';
import { drawWords } from '../../../korczak-xyz/src/utils/rpg/seedWords';
import { coverPrompt, IDEA_MAX, ideaPrompt, parseProposals, PROPOSAL_KINDS, proposalPrompt } from '../../../korczak-xyz/src/utils/rpg/proposalScript';
import {
  coverPath,
  fromTranslation,
  mergePool,
  POOL_DAILY,
  POOL_DIR,
  POOL_TOKEN,
  poolPath,
  poolTranslationPrompt,
  readPool,
  translationEntries,
  withTranslation,
  type Pool,
  type PoolItem,
} from '../../../korczak-xyz/src/utils/rpg/proposalPool';
import { downloadUrl } from '../../../korczak-xyz/src/utils/rpg/assetStore';
import { readServerKeys } from './admin';
import { RPG_BUCKET } from '../runtime';
import { reportError } from '../sentry';

/** Tried in order: a model that refuses or is gone hands the work to the next. */
const MODELS = ['gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3-flash-preview'];
const COVER_SIZE = { width: 768, height: 432 };
/** Items per translation request: ~40 short fields, well inside one answer. */
const TRANSLATE_SLICE = 15;

function bucket() {
  return getStorage().bucket(RPG_BUCKET);
}

async function readFile(lang: string): Promise<Pool | null> {
  try {
    const [bytes] = await bucket().file(poolPath(lang)).download();
    return readPool(JSON.parse(bytes.toString('utf8')));
  } catch (e) {
    if ((e as { code?: number }).code === 404) return null;
    throw e;
  }
}

async function writeFile(lang: string, items: PoolItem[]): Promise<Pool> {
  // The English cover prompt is the server's business; the page needs only what it shows.
  const pool: Pool = { lang, at: Date.now(), items: items.map((p) => ({ ...p, picture: null })) };
  await bucket()
    .file(poolPath(lang))
    .save(JSON.stringify(pool), {
      resumable: false,
      contentType: 'application/json',
      metadata: {
        // Five minutes: a day's new proposals reach a returning player soon enough, and a visit
        // within that window costs no request at all.
        cacheControl: 'public, max-age=300',
        metadata: { firebaseStorageDownloadTokens: POOL_TOKEN },
      },
    });
  return pool;
}

/** The English source, with the cover prompts (kept beside it, since the public file drops them). */
async function readSource(): Promise<PoolItem[]> {
  try {
    const [bytes] = await bucket().file(`${POOL_DIR}/source.json`).download();
    return readPool(JSON.parse(bytes.toString('utf8')))?.items ?? [];
  } catch (e) {
    if ((e as { code?: number }).code === 404) return (await readFile('en'))?.items ?? [];
    throw e;
  }
}

async function writeSource(items: PoolItem[]): Promise<void> {
  await bucket()
    .file(`${POOL_DIR}/source.json`)
    .save(JSON.stringify({ lang: 'en', at: Date.now(), items }), { resumable: false, contentType: 'application/json' });
}

async function gemini(key: string, prompt: string, opts: { temperature: number; json: boolean }): Promise<string> {
  let lastError: unknown = null;
  for (const model of MODELS) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: opts.temperature,
            ...(opts.json ? { responseMimeType: 'application/json' } : {}),
            thinkingConfig: { thinkingLevel: 'low' },
          },
        }),
      });
      if (!r.ok) {
        lastError = new Error(`${model}: ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`);
        continue;
      }
      const data = (await r.json()) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
      const text = (data.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('');
      if (text.trim()) return text;
      lastError = new Error(`${model}: an empty answer`);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError ?? new Error('no model answered');
}

/** One cover from fal.ai, copied into the bucket; null when either step fails (the card shows its colours). */
async function drawCover(fal: string, id: string, picture: string): Promise<string | null> {
  try {
    let response: Response | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      response = await fetch(`https://fal.run/${FAL_IMAGE_MODEL}`, {
        method: 'POST',
        headers: { Authorization: `Key ${fal}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: coverPrompt(picture), image_size: COVER_SIZE, num_inference_steps: 4, num_images: 1, enable_safety_checker: true }),
      });
      if (response.status !== 429) break;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
    if (!response?.ok) throw new Error(`fal ${response?.status} ${((await response?.text().catch(() => '')) ?? '').slice(0, 200)}`);
    const url = ((await response.json()) as { images?: { url?: string }[] }).images?.[0]?.url;
    if (!url) throw new Error('fal: no image in the answer');
    const image = await fetch(url);
    if (!image.ok) throw new Error(`fetching the cover: ${image.status}`);
    const bytes = Buffer.from(await image.arrayBuffer());
    const token = randomUUID();
    await bucket()
      .file(coverPath(id))
      .save(bytes, {
        resumable: false,
        contentType: image.headers.get('content-type') ?? 'image/jpeg',
        metadata: { cacheControl: 'public, max-age=31536000, immutable', metadata: { firebaseStorageDownloadTokens: token } },
      });
    return downloadUrl(RPG_BUCKET, coverPath(id), token);
  } catch (e) {
    reportError('rpgProposals.cover', e, { id });
    return null;
  }
}

/** `PROPOSAL_KINDS.length` new proposals in English, unlike the pool's newest; their covers drawn. */
async function writeBatch(google: string, fal: string | null, avoid: PoolItem[]): Promise<PoolItem[]> {
  const words = drawWords(PROPOSAL_KINDS.length * 2);
  const prompt = proposalPrompt({
    lang: 'en',
    seeds: PROPOSAL_KINDS.map((_, i) => words.slice(i * 2, i * 2 + 2)),
    avoid: avoid.map((p) => `${p.name}: ${p.pitch}`),
    avoidPool: true,
  });
  const text = await gemini(google, prompt, { temperature: 1.2, json: false });
  const at = Date.now();
  const items: PoolItem[] = parseProposals(text, true).map((p, kind) => ({
    ...p,
    id: `${new Date(at).toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID().slice(0, 8)}`,
    kind,
    at,
  }));
  if (!fal) return items;
  return Promise.all(items.map(async (p) => (p.picture ? { ...p, image: await drawCover(fal, p.id, p.picture) } : p)));
}

/** Some items in `lang`, translated a slice at a time; a slice that fails stays English this time. */
async function translate(google: string, lang: string, items: PoolItem[]): Promise<PoolItem[]> {
  const out: PoolItem[] = [];
  const slices: PoolItem[][] = [];
  for (let i = 0; i < items.length; i += TRANSLATE_SLICE) slices.push(items.slice(i, i + TRANSLATE_SLICE));
  const results = await Promise.allSettled(
    slices.map(async (part) => fromTranslation(part, JSON.parse(await gemini(google, poolTranslationPrompt(languageName(lang), translationEntries(part)), { temperature: 0.3, json: true })))),
  );
  for (const r of results) {
    if (r.status === 'fulfilled') out.push(...r.value);
    else reportError('rpgProposals.translate', r.reason, { lang });
  }
  return out;
}

/** `lang`'s file brought up to the English source: items it lacks translated, items gone dropped. */
async function syncLanguage(google: string, lang: string, source: PoolItem[], have: Pool | null): Promise<Pool> {
  // An item still in English (its slice failed last time) is not had: it is asked for again.
  const english = new Map(source.map((p) => [p.id, p]));
  // So is one without the idea its English has gained since (`withIdeas`).
  const kept = new Map(
    (have?.items ?? [])
      .filter((p) => english.has(p.id) && english.get(p.id)!.pitch !== p.pitch && (p.idea || !english.get(p.id)!.idea))
      .map((p) => [p.id, p]),
  );
  const missing = source.filter((p) => !kept.has(p.id));
  const fresh = missing.length ? await translate(google, lang, missing) : [];
  for (const p of fresh) kept.set(p.id, p);
  const items = withTranslation(source, [...kept.values()]);
  return writeFile(lang, items);
}

async function keys(): Promise<{ google: string | null; fal: string | null }> {
  const k = await readServerKeys();
  return { google: k.google, fal: k.fal };
}

/**
 * Items from before `idea` given theirs, in one request; whatever does not come back stays without
 * one (its card shows the name) and is asked again on the next run.
 */
async function withIdeas(google: string, items: PoolItem[]): Promise<PoolItem[]> {
  const missing = items.filter((p) => !p.idea);
  if (!missing.length) return items;
  try {
    const raw = JSON.parse(await gemini(google, ideaPrompt(missing), { temperature: 0.4, json: true })) as Record<string, unknown>;
    return items.map((p) => {
      const idea = !p.idea && typeof raw[p.id] === 'string' ? (raw[p.id] as string).trim().slice(0, IDEA_MAX) : '';
      return idea ? { ...p, idea } : p;
    });
  } catch (e) {
    reportError('rpgProposals.ideas', e, { missing: missing.length });
    return items;
  }
}

/** The day's run: new proposals in front of the pool, then every language's file brought up to it. */
export async function growPool(count = POOL_DAILY): Promise<{ added: number; size: number; langs: string[] }> {
  const { google, fal } = await keys();
  if (!google) throw new Error('rpgProposals: the server has no Google key (admin panel)');
  const source = await readSource();
  const batches = await Promise.allSettled(
    Array.from({ length: Math.ceil(count / PROPOSAL_KINDS.length) }, (_, i) => writeBatch(google, fal, i === 0 ? source.slice(0, 24) : source.slice(24, 48))),
  );
  const fresh: PoolItem[] = [];
  for (const b of batches) {
    if (b.status === 'fulfilled') fresh.push(...b.value);
    else reportError('rpgProposals.write', b.reason);
  }
  const items = await withIdeas(google, mergePool(source, fresh));
  await writeSource(items);
  await writeFile('en', items);
  const [files] = await bucket().getFiles({ prefix: `${POOL_DIR}/`, delimiter: '/' });
  const langs = new Set(['pl']);
  for (const f of files) {
    const m = /^proposals\/([a-z-]+)\.json$/i.exec(f.name);
    const lang = m && asLang(m[1]);
    if (lang && lang !== 'en') langs.add(lang);
  }
  for (const lang of langs) {
    try {
      await syncLanguage(google, lang, items, await readFile(lang));
    } catch (e) {
      reportError('rpgProposals.language', e, { lang });
    }
  }
  return { added: fresh.length, size: items.length, langs: [...langs] };
}

const building = new Map<string, Promise<Pool | null>>();

/**
 * `lang`'s pool for a page that found no file for it: English made when there is none at all,
 * another language translated from it. Null for a language not on the list.
 */
export function poolFor(rawLang: unknown): Promise<Pool | null> {
  const lang = asLang(rawLang);
  if (!lang || !LANGUAGES.includes(lang)) return Promise.resolve(null);
  const running = building.get(lang);
  if (running) return running;
  const job = (async () => {
    const have = await readFile(lang);
    if (have?.items.length) return have;
    let source = await readSource();
    if (!source.length) {
      await growPool();
      source = await readSource();
      if (lang === 'en') return readFile('en');
    }
    if (lang === 'en') return have;
    const { google } = await keys();
    if (!google) return null;
    return syncLanguage(google, lang, source, have);
  })();
  building.set(lang, job);
  // A failure is asked again on the next request; a success is not, for a minute.
  job.then(
    () => setTimeout(() => building.delete(lang), 60_000),
    () => building.delete(lang),
  );
  return job;
}
