/*
 * The game's interface in any language (`language.ts`): English and Polish are written by hand in
 * `translations.ts`; every other language is the English table translated by a model on the
 * server, once per language for everybody (`{kind:'ui'}` on rpgDemo, cached in `rpgUi/{lang}`),
 * never per player and never from text a browser sends — the server translates its own copy of the
 * table, so the endpoint cannot be used to translate anything else on the owner's keys.
 *
 * The table holds strings, small records of strings, and functions. `uiSource` flattens it to one
 * `key → English` map: a string as it is, a record's entries as `key.sub`, and a function as the
 * template it gives when every argument is a placeholder (`{0}`, `{1}`…). `uiTable` builds the table
 * back from a translation of that map:
 *
 * - a string or a record entry is its translation, the English where there is none;
 * - a function fills its translated template with the real arguments when the English template,
 *   filled the same way, says what the function says — or differs only where an argument picked a
 *   word (a plural: "1 worlds" becomes the translation's plural for one, which is the price of not
 *   asking the model for every form);
 * - any other function is called with the translated table as `this`, so one that reads its words
 *   off the table (`aiQuest`, `demoClosed`, `fundsWhat`, `exoticBand`) speaks the translation, and
 *   one that does not stays English rather than show a template it does not fit.
 */

import { translations } from '../../components/Rpg/translations';

export type UiTable = typeof translations.en;

/** An argument that prints as its placeholder and is no number, so a template shows where it went. */
class Hole {
  constructor(private readonly i: number) {}
  toString() {
    return `{${this.i}}`;
  }
  valueOf() {
    return NaN;
  }
}

type Fn = (this: unknown, ...args: unknown[]) => unknown;

/** The template `fn` gives with a placeholder for every argument, or null when it gives none worth translating. */
export function templateOf(fn: Fn, self: unknown): string | null {
  try {
    const out = fn.apply(self, Array.from({ length: fn.length }, (_, i) => new Hole(i)));
    if (typeof out !== 'string' || /NaN|undefined|\[object /.test(out)) return null;
    return out;
  } catch {
    return null;
  }
}

/** `template` with `{i}` replaced by the i-th argument. */
export function fill(template: string, args: readonly unknown[]): string {
  return template.replace(/\{(\d+)\}/g, (whole, i: string) => (Number(i) < args.length ? String(args[Number(i)]) : whole));
}

/** The placeholders a string holds, sorted: what a translation must keep. */
export function holes(text: string): string {
  return [...new Set(text.match(/\{\d+\}/g) ?? [])].sort().join('');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Every English string of the interface, by key (`key`, `key.sub` for a record's entry). */
export function uiSource(table: UiTable = translations.en): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(table)) {
    if (typeof value === 'string') out[key] = value;
    else if (typeof value === 'function') {
      const template = templateOf(value as Fn, table);
      // A function whose words do not hold an argument picks them off the table: nothing of its own to translate.
      if (template && ((value as Fn).length === 0 || /\{\d+\}/.test(template))) out[key] = template;
    } else if (isRecord(value)) {
      for (const [sub, text] of Object.entries(value)) if (typeof text === 'string') out[`${key}.${sub}`] = text;
    }
  }
  return out;
}

/** A short, stable fingerprint of the English strings: a translation made from other strings is stale. */
export function sourceHash(source: Record<string, string>): string {
  const text = JSON.stringify(Object.keys(source).sort().map((k) => [k, source[k]]));
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

/**
 * The translations a model gave that can be used: a string for a key the source has, holding the
 * same placeholders. Anything else is dropped and that key stays English.
 */
export function cleanTranslation(source: Record<string, string>, raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isRecord(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    const english = source[key];
    if (english === undefined || typeof value !== 'string') continue;
    const text = value.trim();
    if (!text || text.length > english.length * 4 + 40) continue;
    if (holes(text) !== holes(english)) continue;
    out[key] = text;
  }
  return out;
}

/** The English table with `strings` (a translation of `uiSource`) in place of its words. */
export function uiTable(strings: Record<string, string>, en: UiTable = translations.en): UiTable {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(en)) {
    if (typeof value === 'string') out[key] = strings[key] ?? value;
    else if (typeof value === 'function') {
      const fn = value as Fn;
      const template = templateOf(fn, en);
      const translated = strings[key];
      const arity = fn.length;
      const complete = template !== null && Array.from({ length: arity }, (_, i) => template.includes(`{${i}}`)).every(Boolean);
      out[key] = function (this: unknown, ...args: unknown[]) {
        if (template !== null && translated !== undefined) {
          if (complete || fill(template, args) === fn.apply(en, args)) return fill(translated, args);
        }
        return fn.apply(out, args);
      };
    } else if (isRecord(value)) {
      const record: Record<string, unknown> = { ...value };
      for (const sub of Object.keys(value)) {
        const t = strings[`${key}.${sub}`];
        if (t !== undefined) record[sub] = t;
      }
      out[key] = record;
    } else out[key] = value;
  }
  return out as UiTable;
}

/** How the model is asked, for `entries` of the source (a slice of it, so a reply stays short). */
export function translationPrompt(languageName: string, entries: Record<string, string>): string {
  return [
    `Translate the interface of a 3D role-playing video game called "Every RPG" from English into ${languageName}.`,
    `The input is a JSON object; answer with a JSON object with exactly the same keys and each value translated into natural, idiomatic ${languageName} as a native game localiser would write it.`,
    'Rules:',
    '- Keep every placeholder such as {0}, {1} exactly as it is; move it to where the grammar needs it.',
    '- Keep emoji, symbols (↵ ⇧ ⚔ 👁 ~ · …), numbers, prices, units and key names (Space, Esc) as they are.',
    '- Keep proper and product names untranslated: Every RPG, Google, Gemini, Gemma, OpenAI, ElevenLabs, fal.ai, FLUX, TRELLIS, Meshy, Nano Banana, SkinTokens, MBTI, Warsaw.',
    '- "Diesel" is the game\'s currency that runs a generator powering a data centre; translate it as the fuel.',
    '- Keep the tone: short, plain, a little wry; the player is addressed informally.',
    '- A value that is a single word may be a button or a label; translate it as one.',
    '',
    JSON.stringify(entries),
  ].join('\n');
}

/** The source split into slices of at most `size` keys, each translated by its own request. */
export function slices(source: Record<string, string>, size = 120): Record<string, string>[] {
  const keys = Object.keys(source);
  const out: Record<string, string>[] = [];
  for (let i = 0; i < keys.length; i += size) out.push(Object.fromEntries(keys.slice(i, i + size).map((k) => [k, source[k]])));
  return out;
}
