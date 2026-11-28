/*
 * Diesel: what the game calls the money a reader spends on the models (owner, Nov 2026: "many data
 * centres run on gas turbines; my variation — the currency is called diesel, and a data centre runs
 * on a smoking diesel generator. When the credits run out the lights go out and the generator
 * stops, new canisters of diesel are shown to buy, and when somebody buys, a little man pours it in
 * and the light comes back on the cable").
 *
 * One litre is one US cent of what the models cost at list price (`cost.ts`). Nothing is stored in
 * litres: the demo's budget stays dollars (`demoLimits.ts`), and this file only says them in litres,
 * so the two can never disagree. The tags (a world, a step, a spoken line) are estimates from a
 * typical request, said as "about" on screen; the console keeps the real bill.
 *
 * The canisters are the packs sold through Paddle (`paddle.ts`; owner, 14 Nov 2026): 20 zł for 250 L,
 * 40 zł for 550 L, 99 zł for 1400 L, VAT included. The first 10/20/49 zł packs lost money once the
 * 23% VAT and Paddle's 5% + $0.50 came off; these keep about 30% over what the litres cost at list
 * price. `pln` is only what the button says — the price charged is the Paddle price's own.
 */

import { musicUsd, tokenCost, voiceCost } from './cost';
import { geminiModelOf, isGemini, type VoiceEngine } from './geminiVoice';
import { clipCost, priceAs } from './demoLimits';
import { localeOf } from './language';

export const LITRES_PER_USD = 100;

/** Below this the generator is out: not even a step on the cheapest paid model fits (~$0.04). */
export const EMPTY_LITRES = 4;

export function litres(usd: number): number {
  return Math.max(0, usd) * LITRES_PER_USD;
}

/** "312 L", "4,5 L" — whole litres from 10 up, one decimal below, the locale's comma. */
export function formatLitres(l: number, lang: string): string {
  const shown = l >= 10 ? Math.round(l) : Math.round(l * 10) / 10;
  return `${shown.toLocaleString(localeOf(lang))} L`;
}

/**
 * A typical step: a late beat's prompt is ~8k tokens (the chronicle and the story so far) and the
 * answer ~1.2k with ~0.8k of thinking — $0.014 on 3.8 Flash, what the console measured (Oct 2026).
 */
export const TYPICAL_BEAT = { input: 8_000, output: 1_200, thoughts: 800 };
/** A typical spoken line, in characters. */
export const TYPICAL_LINE = 150;

/*
 * WHAT A QUEST AND A WORLD REALLY COST, beyond the model's words (owner, 9 Nov 2026: "quest and world
 * creation are massively underpriced" — the tags said ~1.9 L for a world and ~0.9 L for a quest,
 * which was only the model's text). Measured on the ledger (`rpgLedger/{uid}/quests` and `/worlds`,
 * 1–4 Nov 2026, seven worlds each played through their first quest): $0.41–0.72 for a world and its
 * first quest, of which ElevenLabs ~$0.26–0.45 (the lines, and the score at $0.132), fal.ai
 * ~$0.15–0.31 (the village's models and pictures, the people met), the story's model ~$0.01–0.1.
 */
/** A quest is about six steps. */
const QUEST_BEATS = 6;
/**
 * The lines spoken in a quest, in ElevenLabs credits, priced at the day's rate (`voiceCost`, `VOICE_PRICES`):
 * four whole quests on the owner's ledger, 11–25 Nov 2026, took 4,170–5,940 (6–8k characters, ~40% of
 * them tagged lines on v4 at a credit each, the rest Flash at half). ~$0.91 on the legacy Creator
 * credits, ~$0.40 on the API pricing from 17 Dec 2026.
 */
const QUEST_VOICE_CREDITS = 5_000;
/**
 * The same quest on Gemini's TTS (`geminiVoice.ts`; Flash-Lite the default since 28 Nov 2026): ~7,000
 * characters, ~0.37 text and ~1.67 audio tokens a character (one 150-character Polish line measured on
 * 27 Nov: 55 in, 250 out), priced at the day's rate by the model chosen: ~$0.07 on Flash-Lite and ~$0.11
 * on Flash until 31 Dec 2026, twice that after.
 */
const QUEST_VOICE_CHARS = 7_000;
const GEMINI_VOICE_TOKENS = {
  input: Math.round(QUEST_VOICE_CHARS * 0.37),
  output: Math.round(QUEST_VOICE_CHARS * 1.67),
  thoughts: 0,
};
/**
 * The world's score (`music.ts`): one 90-second track a world since 27 Nov 2026 (~1,350 credits, ~$0.25 on the legacy
 * credits, $0.225 on the API pricing), and nothing at all when the library has one good enough — priced as composed, the
 * worst case. Until then a two-minute track was priced into every quest ($0.132).
 */
const WORLD_MUSIC_SECONDS = 90;
/** The people and places a quest adds, made on fal.ai: ~$0.05 a quest beyond the village. */
const QUEST_FAL_USD = 0.05;
/** A world's own pieces on fal.ai — the hub's models, the ground, the cover, the hero: ~$0.2. */
const WORLD_FAL_USD = 0.2;

/** What is on for this reader: a demo speaks but composes nothing and makes no models. */
export interface PriceParts {
  voice: boolean;
  music: boolean;
  fal: boolean;
  /** Who speaks; absent is ElevenLabs, as before there was a choice. */
  voiceEngine?: VoiceEngine;
}

/** A quest's lines in dollars on the engine that speaks them. */
function questVoiceUsd(parts: PriceParts): number {
  if (!parts.voice) return 0;
  if (parts.voiceEngine && isGemini(parts.voiceEngine)) return tokenCost(geminiModelOf(parts.voiceEngine), GEMINI_VOICE_TOKENS) ?? 0;
  return voiceCost(QUEST_VOICE_CREDITS);
}

/** About what one step of the story costs on `model`, in litres; null for a model with no price. */
export function beatLitres(model: string): number | null {
  const usd = tokenCost(priceAs(model), TYPICAL_BEAT);
  return usd === null ? null : litres(usd);
}

/** About what a whole quest costs: its steps, its lines and its new people and places (the score is the world's). */
export function questLitres(model: string, parts: PriceParts): number | null {
  const beat = beatLitres(model);
  if (beat === null) return null;
  return (
    beat * QUEST_BEATS +
    litres(questVoiceUsd(parts) + (parts.fal ? QUEST_FAL_USD : 0))
  );
}

/** A new world: the world itself (one request), its village's pieces, its score, and the first quest played in it. */
export function worldLitres(model: string, parts: PriceParts): number | null {
  const beat = beatLitres(model);
  const quest = questLitres(model, parts);
  if (beat === null || quest === null) return null;
  return beat + litres((parts.fal ? WORLD_FAL_USD : 0) + (parts.music ? musicUsd(WORLD_MUSIC_SECONDS) : 0)) + quest;
}

export function lineLitres(): number {
  return litres(clipCost(TYPICAL_LINE));
}

export interface Canister {
  id: 'can' | 'barrel' | 'tank';
  litres: number;
  pln: number;
}

export const CANISTERS: readonly Canister[] = [
  { id: 'can', litres: 250, pln: 20 },
  { id: 'barrel', litres: 550, pln: 40 },
  { id: 'tank', litres: 1400, pln: 99 },
];

/**
 * The monthly delivery (owner, 14 Nov 2026: "one subscription, 39 PLN, and diesel does not carry over
 * to the next month"): 600 L each billing period, spent before bought litres, and whatever is left
 * of it when the period renews or the subscription ends is gone. Bought canisters never expire.
 */
export const SUBSCRIPTION = { id: 'monthly' as const, litres: 600, pln: 39 };

export type PlantState = 'running' | 'stopped';

export function plantState(l: number): PlantState {
  return l < EMPTY_LITRES ? 'stopped' : 'running';
}
