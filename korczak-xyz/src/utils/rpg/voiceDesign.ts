/*
 * A voice made for each character (owner, Oct 2026: "the randomly picked voices aren't good enough;
 * try voices generated to fit each character… each npc should have a character and a voice of their
 * own"). The model describes the voice beside the character (`Character.voice`, in English, in the
 * shape ElevenLabs' guide asks for: language, gender, age, persona, emotion, then timbre and pace),
 * and ElevenLabs' Voice Design makes it: `/v1/text-to-voice/design` turns the description into
 * previews, `/v1/text-to-voice` saves the first one as a voice of the account.
 *
 * THE ACCOUNT IS THE REGISTRY. A voice is saved under `rpg · <world> · <name>`, so the same
 * character in the same world finds it again by name from any browser, and nothing else needs to
 * remember it; this browser only caches the id. A character of the same name in another world is
 * someone else, and gets a voice of their own.
 *
 * SLOTS ROTATE. An account holds a fixed number of voices (30 on Creator; owner: "rotate the oldest,
 * or track them, whatever"). Before saving, the game's own voices beyond `KEEP` are deleted oldest
 * first, and a save refused for the limit deletes one more and tries again. Nothing that is not the
 * game's own (`rpg · `) is ever touched.
 *
 * WHAT IT COSTS: a design is charged for its preview text, which is the character's own first lines
 * (100 to 400 characters, about what speaking them once costs); saving is free but is one of the
 * account's monthly voice operations (95 on Creator). Anything refused — a plan without Voice
 * Design, the month's operations spent, a network failure — falls back to a library voice
 * (`voicePick.ts`) for that character, for this session.
 *
 * STUDIO QUALITY, ALWAYS (owner, Oct 2026: "they sometimes sound as if over a phone… only the
 * hero's voice has studio quality"). The hero is a premade voice recorded in a studio; a designed
 * voice is as clean as its description asks for. ElevenLabs' guide: without a quality phrase the
 * result varies, "Studio quality" / "perfect audio quality" pushes it clean, and words like phone,
 * radio, tape, echo or reverb degrade it (they are how you ask for lo-fi on purpose). So every
 * description ends with the quality phrase, and any clause about how the voice is recorded or
 * carried is cut, whatever the model wrote. Voices designed before this were saved under the old
 * name, so they are not found again and get designed anew; the old ones rotate out with `KEEP`.
 *
 * No DOM: `fetch` is passed in.
 */

import { spokenText } from './audioTags';
import type { Lang } from './quest';

export const DESIGN_MODEL = 'eleven_multilingual_ttv_v2';
const PREFIX = 'rpg · ';
/** The game's own voices kept on the account; the rest of the slots stay free for the owner. */
export const KEEP = 24;

export interface DesignWho {
  name: string;
  gender: 'male' | 'female';
  voice: string;
  /** What they say first, for the preview: the design is made speaking it. */
  sample?: string;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const API = 'https://api.elevenlabs.io';

/** A refusal that will not change by asking again this session (the plan, the key, the month). */
export class DesignRefused extends Error {}

/** ` · hq` marks a voice designed with the quality phrase; one without it is designed again. */
export function voiceName(world: string, name: string): string {
  return `${PREFIX}${world.slice(0, 40)} · ${name.slice(0, 50)} · hq`;
}

const QUALITY = 'Studio-quality recording, perfect audio quality.';

/** Words about the medium rather than the voice: phone, radio, tape, echo — lo-fi on request. */
const MEDIUM =
  '(?:(?:tele)?phones?|radio|tape|recording|recorded|microphone|mic|reverb\\w*|echo\\w*|muffled|distant|static|crackl\\w*|lo-?fi|low[- ]fidelity|voicemail|megaphone|walkie[- ]talkie|vintage|gramophone|vinyl|quality)';
/** "…voice, like a crackling old radio" loses the simile and keeps the voice. */
const SIMILE = new RegExp(`\\s+(?:with|like|as if|as though|through|over|on)\\b[^.,;!?]*\\b${MEDIUM}\\b[^.,;!?]*`, 'gi');
/** Any other clause naming one goes whole. */
const CLAUSE = new RegExp(`[^.,;!?]*\\b${MEDIUM}\\b[^.,;!?]*`, 'gi');

function withoutEffects(d: string): string {
  return d
    .replace(SIMILE, '')
    .replace(CLAUSE, '')
    .replace(/\s*,\s*(?=[,.;!?]|$)/g, '')
    .replace(/([.;!?])\s*[,.;]+/g, '$1')
    .replace(/^[\s,.;]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** The description as ElevenLabs' guide asks it to begin: the language first. */
export function description(who: DesignWho, lang: Lang): string {
  const native = lang === 'pl' ? 'Native Polish.' : 'Native English.';
  let d = withoutEffects(who.voice.trim().replace(/\s+/g, ' '));
  if (!/^native\b/i.test(d)) d = `${native} ${d}`;
  if (!/[.!?]$/.test(d)) d = `${d}.`;
  if (d.length < 40) d = `${d} ${who.gender === 'female' ? 'Female' : 'Male'} voice.`;
  return `${d.slice(0, 1000 - QUALITY.length - 1)} ${QUALITY}`;
}

/** 100 to 1000 characters of the character's own words, as the design endpoint requires. */
export function previewText(who: DesignWho, lang: Lang): string {
  // Their own words without the tags and asides (`audioTags.ts`): the design model would read them out.
  let t = spokenText(who.sample ?? '', false);
  const filler =
    lang === 'pl'
      ? 'Słuchaj uważnie, bo nie będę powtarzać. Różne rzeczy się tu dzieją, a ja widziałem już dość, żeby wiedzieć, kiedy milczeć.'
      : 'Listen carefully, because I will not say it twice. Strange things happen here, and I have seen enough to know when to keep quiet.';
  while (t.length < 100) t = t ? `${t} ${filler}` : filler;
  return t.slice(0, 400);
}

async function json(r: Response): Promise<Record<string, unknown>> {
  return ((await r.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
}

function refusal(status: number, body: Record<string, unknown>): Error {
  const detail = body.detail as { status?: string; message?: string } | string | undefined;
  const message = typeof detail === 'string' ? detail : (detail?.message ?? detail?.status ?? `ElevenLabs ${status}`);
  const code = typeof detail === 'object' ? (detail?.status ?? '') : '';
  if (status === 401 || status === 402 || status === 403 || /quota|limit_reached|operations/i.test(`${code} ${message}`)) {
    return new DesignRefused(message);
  }
  return new Error(message);
}

interface OwnVoice {
  voice_id: string;
  name: string;
  created_at_unix?: number | null;
}

/** The game's voices on the account, oldest first. */
async function ownVoices(fetch: Fetch, key: string, search: string): Promise<OwnVoice[]> {
  const q = new URLSearchParams({ search, category: 'generated', page_size: '100', sort: 'created_at_unix', sort_direction: 'asc' });
  const r = await fetch(`${API}/v2/voices?${q}`, { headers: { 'xi-api-key': key } });
  if (!r.ok) throw refusal(r.status, await json(r));
  const voices = ((await json(r)).voices ?? []) as OwnVoice[];
  return voices.filter((v) => typeof v?.voice_id === 'string' && typeof v.name === 'string' && v.name.startsWith(PREFIX));
}

async function remove(fetch: Fetch, key: string, id: string): Promise<void> {
  await fetch(`${API}/v1/voices/${id}`, { method: 'DELETE', headers: { 'xi-api-key': key } });
}

/** The saved voice of this character in this world, or null. */
export async function findDesigned(fetch: Fetch, key: string, world: string, name: string): Promise<string | null> {
  const want = voiceName(world, name);
  const found = (await ownVoices(fetch, key, name)).find((v) => v.name === want);
  return found?.voice_id ?? null;
}

/** Makes room, designs, saves; the new voice's id. */
export async function designVoice(fetch: Fetch, key: string, world: string, who: DesignWho, lang: Lang): Promise<string> {
  const voice_description = description(who, lang);
  const designed = await fetch(`${API}/v1/text-to-voice/design`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice_description, model_id: DESIGN_MODEL, text: previewText(who, lang) }),
  });
  const body = await json(designed);
  if (!designed.ok) throw refusal(designed.status, body);
  const preview = (body.previews as { generated_voice_id?: string }[] | undefined)?.[0]?.generated_voice_id;
  if (!preview) throw new Error('ElevenLabs: no preview');

  const mine = await ownVoices(fetch, key, PREFIX.trim());
  for (const old of mine.slice(0, Math.max(0, mine.length - KEEP + 1))) await remove(fetch, key, old.voice_id);

  const save = () =>
    fetch(`${API}/v1/text-to-voice`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ voice_name: voiceName(world, who.name), voice_description, generated_voice_id: preview }),
    });
  let saved = await save();
  if (!saved.ok && saved.status === 400) {
    // The account's slots are full of the owner's own voices: one more of ours goes, once.
    const left = mine.slice(Math.max(0, mine.length - KEEP + 1));
    if (left[0]) {
      await remove(fetch, key, left[0].voice_id);
      saved = await save();
    }
  }
  const out = await json(saved);
  if (!saved.ok) throw refusal(saved.status, out);
  if (typeof out.voice_id !== 'string') throw new Error('ElevenLabs: no voice id');
  return out.voice_id;
}
