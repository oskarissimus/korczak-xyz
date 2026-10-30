/*
 * A character's craft: the workplace and the tool the game builds for them (owner, 30 Oct 2026:
 * "some NPCs should have their own assets and actions, like the blacksmith with an anvil, beating it
 * with a hammer. Not every NPC — for some walking about is enough — but let the model say so when
 * it makes places and characters, and the engine support it").
 *
 * The model chooses one word from a closed list, the way it chooses a place's blocks; the engine
 * builds the station from primitives beside where the character stands (`components/Rpg/crafts.ts`),
 * puts the tool in their right hand while they work, and plays the motion. Most people have none:
 * they walk about by the trade their description implies (`routine.ts`).
 *
 * Plain data, no Three.js, so the parser and the routine can be tested.
 */

import type { Clip } from '../../components/Rpg/characters';
import type { Trade } from './routine';

export const CRAFTS = ['smith', 'carpenter', 'woodcutter', 'miner', 'farmer', 'cook', 'alchemist', 'trader', 'priest', 'guard', 'scribe'] as const;
export type Craft = (typeof CRAFTS)[number];

export type Tool = 'hammer' | 'axe' | 'pickaxe' | 'hoe' | 'ladle' | 'pestle' | 'spear' | 'quill';

export interface CraftSpec {
  /** For the prompt: what it means, a few words. */
  means: string;
  /** How they spend the time they are not at the station (`routine.ts`). */
  trade: Trade;
  tool: Tool | null;
  /** The loop at the station, and the stroke over it every few seconds. */
  loop: Clip;
  stroke?: { clip: Clip; seconds: number; every: [number, number] };
  /** How far out the station blocks walking, metres. */
  r: number;
}

export const CRAFT_SPECS: Record<Craft, CraftSpec> = {
  smith: { means: 'an anvil and a glowing forge, beaten with a hammer', trade: 'smith', tool: 'hammer', loop: 'Idle_Loop', stroke: { clip: 'Sword_Attack', seconds: 0.9, every: [1.1, 1.6] }, r: 0.9 },
  carpenter: { means: 'a sawhorse with a plank and a stack of boards, a hammer', trade: 'smith', tool: 'hammer', loop: 'Idle_Loop', stroke: { clip: 'Sword_Attack', seconds: 1, every: [1.4, 2.2] }, r: 1 },
  woodcutter: { means: 'a chopping block and a pile of logs, an axe', trade: 'woodcutter', tool: 'axe', loop: 'Idle_Loop', stroke: { clip: 'Sword_Attack', seconds: 1.2, every: [1.8, 2.6] }, r: 0.8 },
  miner: { means: 'a heap of ore and rubble, a pickaxe (miners, stonecutters, quarrymen)', trade: 'smith', tool: 'pickaxe', loop: 'Idle_Loop', stroke: { clip: 'Sword_Attack', seconds: 1.2, every: [1.7, 2.5] }, r: 1.1 },
  farmer: { means: 'a patch of crops and a hay bale, a hoe', trade: 'gatherer', tool: 'hoe', loop: 'Idle_Loop', stroke: { clip: 'Sword_Attack', seconds: 1.4, every: [2, 3] }, r: 1.3 },
  cook: { means: 'a cauldron over a fire, stirred with a ladle (cooks, brewers, innkeepers)', trade: 'trader', tool: 'ladle', loop: 'Idle_Loop', stroke: { clip: 'Punch_Jab', seconds: 1.6, every: [1.8, 2.6] }, r: 0.8 },
  alchemist: { means: 'a table of glowing flasks and a mortar (alchemists, herbalists, healers)', trade: 'gatherer', tool: 'pestle', loop: 'Idle_Loop', stroke: { clip: 'Punch_Jab', seconds: 1.4, every: [2, 3.2] }, r: 0.9 },
  trader: { means: 'a market stall with an awning and goods, no tool', trade: 'trader', tool: null, loop: 'Idle_Talking_Loop', r: 1.2 },
  priest: { means: 'a small shrine with candles, prayed before (priests, monks, witches, mystics)', trade: 'holy', tool: null, loop: 'Idle_Loop', r: 0.8 },
  guard: { means: 'a brazier at a guard post, a spear, a round walked about it', trade: 'guard', tool: 'spear', loop: 'Sword_Idle', stroke: { clip: 'Sword_Attack', seconds: 1.2, every: [5, 9] }, r: 0.6 },
  scribe: { means: 'a lectern with an open book, written in with a quill (scribes, scholars, clerks)', trade: 'holy', tool: 'quill', loop: 'Idle_Loop', stroke: { clip: 'Punch_Jab', seconds: 1.8, every: [3, 5] }, r: 0.7 },
};

export function asCraft(value: unknown): Craft | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return (CRAFTS as readonly string[]).includes(v) ? (v as Craft) : null;
}

/** The choice as the prompt offers it, one craft a line. */
export function craftLines(): string {
  return CRAFTS.map((c) => `"${c}" (${CRAFT_SPECS[c].means})`).join(', ');
}
