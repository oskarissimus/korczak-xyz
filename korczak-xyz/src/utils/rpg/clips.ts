/**
 * The animation clips a character can play. A type of its own, apart from `components/Rpg/characters.ts`,
 * because `craft.ts` and `routine.ts` name clips and `quest.ts` brings them into the Cloud Functions
 * bundle, which has no three.js and no `?url` imports to resolve.
 */

/** The clips `scripts/rpg-characters.mjs` keeps. */
export type Clip =
  | 'Idle_Loop'
  | 'Idle_Talking_Loop'
  | 'Walk_Loop'
  | 'Jog_Fwd_Loop'
  | 'Sword_Idle'
  | 'Sword_Attack'
  | 'Punch_Jab'
  | 'Hit_Chest'
  | 'Death01'
  | 'Jump_Start'
  | 'Jump_Loop'
  | 'Jump_Land';
