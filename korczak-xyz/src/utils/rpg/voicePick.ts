/*
 * A voice for every character, from ElevenLabs' Voice Library (owner, Oct 2026: "they have far
 * more ready voices; pick one by its characteristics or tags, or at random"). The model says each
 * character's gender and age; the library is searched for voices of that gender and age that are
 * verified in the game's language, and the character's name picks one, so the same character is
 * the same voice every time they speak, in every quest.
 *
 * Compiled into the demo function too, which picks with the owner's key exactly as the browser
 * picks with the reader's. No DOM, no imports outside this directory.
 *
 * Only voices at the ordinary rate are taken (`rate` 1, no `fiat_rate`): a library voice can be
 * priced above it, and the cost console and the demo's reservations assume it is not.
 */

import type { Lang } from './quest';

export const VOICE_AGES = ['young', 'middle_aged', 'old'] as const;
export type VoiceAge = (typeof VOICE_AGES)[number];

/** Who is speaking, as much as picks their voice. */
export interface VoiceWho {
  name: string;
  gender: 'male' | 'female';
  age?: VoiceAge;
  /** The model's description of their voice, for a designed one (`voiceDesign.ts`). */
  voice?: string;
  /** Their first lines, which the design is made speaking. */
  sample?: string;
}

/** The fields of a `/v1/shared-voices` entry that the pick reads. */
export interface SharedVoice {
  voice_id: string;
  rate?: number | null;
  fiat_rate?: number | null;
  verified_languages?: { language?: string; model_id?: string }[] | null;
}

/** Enough to choose from; the most used first, which are the ones that have been listened to. */
const PAGE = 30;

export function sharedVoicesUrl(lang: Lang, gender: VoiceWho['gender'], age?: VoiceAge): string {
  const query = new URLSearchParams({
    page_size: String(PAGE),
    sort: 'usage_character_count_1y',
    language: lang,
    gender,
  });
  if (age) query.set('age', age);
  return `https://api.elevenlabs.io/v1/shared-voices?${query}`;
}

export function asAge(value: unknown): VoiceAge | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (v === 'middle' || v === 'adult') return 'middle_aged';
  if (v === 'elderly' || v === 'aged') return 'old';
  return (VOICE_AGES as readonly string[]).includes(v) ? (v as VoiceAge) : undefined;
}

/** At the ordinary rate, and spoken in `lang` by the game's model where the library says. */
export function usableVoice(v: SharedVoice, lang: Lang, model: string): boolean {
  if (!v || typeof v.voice_id !== 'string' || !/^[A-Za-z0-9]{8,40}$/.test(v.voice_id)) return false;
  if ((v.rate ?? 1) !== 1 || (v.fiat_rate ?? null) !== null) return false;
  const verified = v.verified_languages ?? [];
  return verified.length === 0 || verified.some((l) => l.language === lang && (!l.model_id || l.model_id === model));
}

function hash(text: string): number {
  let h = 2166136261;
  for (const ch of text.toLowerCase()) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

/** The character's voice among `list`, by their name; null when none is usable. */
export function pickVoice(list: readonly SharedVoice[], who: VoiceWho, lang: Lang, model: string, avoid: readonly string[] = []): string | null {
  const usable = list.filter((v) => usableVoice(v, lang, model) && !avoid.includes(v.voice_id));
  if (usable.length === 0) return null;
  return usable[hash(who.name) % usable.length].voice_id;
}

/**
 * Searches by gender and age, then by gender alone when the age has nothing usable (the Polish
 * library is far smaller than the English one). `list` fetches a search URL; the caller caches it.
 */
export async function findVoice(
  who: VoiceWho,
  lang: Lang,
  model: string,
  list: (url: string) => Promise<SharedVoice[]>,
  avoid: readonly string[] = [],
): Promise<string | null> {
  if (who.age) {
    const picked = pickVoice(await list(sharedVoicesUrl(lang, who.gender, who.age)), who, lang, model, avoid);
    if (picked) return picked;
  }
  return pickVoice(await list(sharedVoicesUrl(lang, who.gender)), who, lang, model, avoid);
}

/**
 * Every search a character can need in `lang`: each gender with each age, and each gender alone.
 * The library answers a filtered search in 8 to 14 seconds (measured Oct 2026, against about one
 * second for the clip itself), which made a character's first line wait that long. So the demo
 * function asks all of them at once, keeps the answers in Firestore for a week, and hands them to
 * the game when a quest starts (`{kind: 'voices'}`); a line never waits for a search again.
 */
export function voiceQueries(lang: Lang): string[] {
  const genders = ['male', 'female'] as const;
  return genders.flatMap((g) => [...VOICE_AGES.map((a) => sharedVoicesUrl(lang, g, a)), sharedVoicesUrl(lang, g)]);
}

/** The searches' answers, by search URL, cut to the usable voices' ids. */
export type VoiceLists = Record<string, SharedVoice[]>;

export function usableIds(list: readonly SharedVoice[], lang: Lang, model: string): SharedVoice[] {
  return list.filter((v) => usableVoice(v, lang, model)).map((v) => ({ voice_id: v.voice_id }));
}

/** A `VoiceLists` from a stranger's JSON: only search URLs of `lang`, only well-formed ids. */
export function voiceListsOf(raw: unknown, lang: Lang): VoiceLists {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: VoiceLists = {};
  for (const url of voiceQueries(lang)) {
    const list = r[url];
    if (Array.isArray(list)) out[url] = list.filter((v) => usableVoice(v as SharedVoice, lang, '')).map((v) => ({ voice_id: (v as SharedVoice).voice_id }));
  }
  return out;
}

/** The voices in a `/v1/shared-voices` answer, whatever else it holds. */
export function sharedVoicesOf(body: unknown): SharedVoice[] {
  const voices = (body as { voices?: unknown } | null)?.voices;
  return Array.isArray(voices) ? (voices as SharedVoice[]) : [];
}
