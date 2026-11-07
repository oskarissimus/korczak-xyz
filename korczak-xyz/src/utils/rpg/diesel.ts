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

export const LITRES_PER_USD = 100;

/** Below this the generator is out: not even a step on the cheapest paid model fits (~$0.04). */
export const EMPTY_LITRES = 4;

export function litres(usd: number): number {
  return Math.max(0, usd) * LITRES_PER_USD;
}

/** "312 L", "4,5 L" — whole litres from 10 up, one decimal below, the locale's comma. */
export function formatLitres(l: number, lang: 'en' | 'pl'): string {
  const shown = l >= 10 ? Math.round(l) : Math.round(l * 10) / 10;
  return `${shown.toLocaleString(lang === 'pl' ? 'pl-PL' : 'en-GB')} L`;
}

/** A typical step: the prompt is ~5k tokens and the answer, thinking included, ~1.5k. */
const TYPICAL_BEAT = { input: 5_000, output: 1_000, thoughts: 500 };
/** A typical spoken line, in characters. */
const TYPICAL_LINE = 150;

/** About what one step of the story costs on `model`, in litres; null for a model with no price. */
export function beatLitres(model: string): number | null {
  const usd = tokenCost(priceAs(model), TYPICAL_BEAT);
  return usd === null ? null : litres(usd);
}

/** A new world on the demo is two requests: the world itself and its quest's opening. */
export function worldLitres(model: string): number | null {
  const beat = beatLitres(model);
  return beat === null ? null : beat * 2;
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
