/*
 * The interface table for any language (`utils/rpg/uiTranslate.ts`): English and Polish are the
 * hand-written ones; another language is English until the server's translation arrives, then the
 * translation, kept in localStorage `rpg-ui-<lang>` so the next visit opens in it at once. A kept
 * translation of older English is used while a fresh one is asked for.
 *
 * `ui(lang)` is what every component reads; `useUi(lang)` in `Rpg` asks for the translation and
 * renders again when it comes, which re-renders the components under it too.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { rpgDemoUrl } from '../../utils/rpg/demo';
import { asLang, handWritten, type Lang } from '../../utils/rpg/language';
import { sourceHash, uiSource, uiTable, type UiTable } from '../../utils/rpg/uiTranslate';
import { translations } from './translations';

const KEY = (lang: Lang) => `rpg-ui-${lang}`;

interface Kept {
  hash: string;
  strings: Record<string, string>;
}

const tables = new Map<Lang, UiTable>();
const asked = new Map<Lang, 'asking' | 'done' | 'failed'>();
const listeners = new Set<() => void>();
let version = 0;
let hash: string | null = null;

function currentHash(): string {
  hash ??= sourceHash(uiSource());
  return hash;
}

function changed() {
  version++;
  listeners.forEach((l) => l());
}

function readKept(lang: Lang): Kept | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(lang)) ?? 'null') as Partial<Kept> | null;
    return raw && typeof raw.strings === 'object' && raw.strings ? { hash: String(raw.hash ?? ''), strings: raw.strings } : null;
  } catch {
    return null;
  }
}

function keep(lang: Lang, kept: Kept) {
  try {
    localStorage.setItem(KEY(lang), JSON.stringify(kept));
  } catch {
    /* asked for again next visit */
  }
}

/** The interface in `lang`: hand-written, translated, or English while the translation is on its way. */
export function ui(lang: Lang): UiTable {
  if (lang === 'pl') return translations.pl;
  if (handWritten(lang) || !asLang(lang)) return translations.en;
  const table = tables.get(lang);
  if (table) return table;
  const kept = readKept(lang);
  if (kept && Object.keys(kept.strings).length) {
    const built = uiTable(kept.strings);
    tables.set(lang, built);
    return built;
  }
  return translations.en;
}

/** Whether the interface in `lang` is still being translated: the menu says so beside the language. */
export function uiPending(lang: Lang): boolean {
  return !handWritten(lang) && asked.get(lang) === 'asking';
}

/** Asks the server for `lang` unless this browser already holds it for the English it has now. */
export async function loadUi(lang: Lang): Promise<void> {
  if (handWritten(lang) || !asLang(lang) || asked.has(lang)) return;
  const kept = readKept(lang);
  if (kept && kept.hash === currentHash()) {
    asked.set(lang, 'done');
    return;
  }
  const url = rpgDemoUrl();
  if (!url) return;
  asked.set(lang, 'asking');
  changed();
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'ui', lang }),
    });
    if (!r.ok) throw new Error(`ui ${r.status}`);
    const answer = (await r.json()) as Partial<Kept>;
    const strings = answer.strings && typeof answer.strings === 'object' ? answer.strings : {};
    if (Object.keys(strings).length) {
      // An incomplete answer (no hash) is used and kept, but asked for again on the next visit.
      keep(lang, { hash: String(answer.hash ?? ''), strings });
      tables.set(lang, uiTable(strings));
    }
    asked.set(lang, 'done');
  } catch {
    asked.set(lang, 'failed');
  }
  changed();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** `ui(lang)`, asked for when it is missing and rendered again when it arrives. */
export function useUi(lang: Lang): UiTable {
  useSyncExternalStore(subscribe, () => version, () => version);
  useEffect(() => {
    void loadUi(lang);
  }, [lang]);
  return ui(lang);
}
