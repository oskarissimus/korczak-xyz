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
 * The canisters are the packs the payment comparison proposed (10/20/49 zł). Nothing sells them yet:
 * there is no payment provider behind the button, and the panel says so.
 */

import { tokenCost } from './cost';
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
/** The lines spoken in a quest, in dollars: ~$0.27 measured (v4 lines cost more than Flash's). */
const QUEST_VOICE_USD = 0.27;
/** The score composed for a quest (`music.ts`): a two-minute track, ElevenLabs' list price. */
const QUEST_MUSIC_USD = 0.132;
/** The people and places a quest adds, made on fal.ai: ~$0.05 a quest beyond the village. */
const QUEST_FAL_USD = 0.05;
/** A world's own pieces on fal.ai — the hub's models, the ground, the cover, the hero: ~$0.2. */
const WORLD_FAL_USD = 0.2;

/** What is on for this reader: a demo speaks but composes nothing and makes no models. */
export interface PriceParts {
  voice: boolean;
  music: boolean;
  fal: boolean;
}

/** About what one step of the story costs on `model`, in litres; null for a model with no price. */
export function beatLitres(model: string): number | null {
  const usd = tokenCost(priceAs(model), TYPICAL_BEAT);
  return usd === null ? null : litres(usd);
}

/** About what a whole quest costs: its steps, its lines, its score and its new people and places. */
export function questLitres(model: string, parts: PriceParts): number | null {
  const beat = beatLitres(model);
  if (beat === null) return null;
  return (
    beat * QUEST_BEATS +
    litres((parts.voice ? QUEST_VOICE_USD : 0) + (parts.music ? QUEST_MUSIC_USD : 0) + (parts.fal ? QUEST_FAL_USD : 0))
  );
}

/** A new world: the world itself (one request), its village's pieces, and the first quest played in it. */
export function worldLitres(model: string, parts: PriceParts): number | null {
  const beat = beatLitres(model);
  const quest = questLitres(model, parts);
  if (beat === null || quest === null) return null;
  return beat + litres(parts.fal ? WORLD_FAL_USD : 0) + quest;
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
  { id: 'can', litres: 200, pln: 10 },
  { id: 'barrel', litres: 450, pln: 20 },
  { id: 'tank', litres: 1200, pln: 49 },
];

export type PlantState = 'running' | 'stopped';

export function plantState(l: number): PlantState {
  return l < EMPTY_LITRES ? 'stopped' : 'running';
}
