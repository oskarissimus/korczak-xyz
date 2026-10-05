/*
 * Which app this island is: the annoying passenger at `/apps/backseat/`, or the roaster at
 * `/apps/roaster/`.
 *
 * The roaster is the passenger with the car taken out (Oct 2026, at the owner's request): point
 * the phone at anything and it roasts what it sees. Everything that is plumbing — the camera, the
 * frame, the two-step and Gemini Live engines, the voices, the iOS unlocks, the ride loop, the
 * keys — is the same code, because every lesson in `backseat.md` about it applies unchanged. What
 * differs is only what makes it a different app, and all of it is named here or keyed by `id`:
 *
 *  - the prompt (`remarks.ts`, `PROMPTS[id]`) — personas, angles, rules, the user line;
 *  - the strings that mention a road or a passenger (`translations.ts`, `forFlavour`);
 *  - where its settings live, so the two apps never overwrite each other's persona: its own
 *    localStorage key and its own `users/{uid}/{id}/config` document;
 *  - where its rounds are saved: `users/{uid}/{id}/rides/` in the same bucket, under the same
 *    `users/{uid}/**` storage rule, so no rules or Terraform changed.
 *
 * A third flavour is a third entry here, a third prompt pack and a third pair of pages.
 */

import type { BackseatPersona, Persona, RoasterPersona } from './types';

export type FlavourId = 'backseat' | 'roaster';

export interface Flavour {
  id: FlavourId;
  /** The localStorage key the settings are kept under. */
  configKey: string;
  /** The account's folder: `users/{uid}/{folder}/config` and `users/{uid}/{folder}/rides/`. */
  folder: string;
  personas: readonly Persona[];
  defaultPersona: Persona;
}

export const BACKSEAT_PERSONAS: readonly BackseatPersona[] = [
  'nervous',
  'instructor',
  'parent',
  'child',
  'codriver',
];

export const ROASTER_PERSONAS: readonly RoasterPersona[] = [
  'comedian',
  'critic',
  'grandma',
  'teen',
  'narrator',
];

export const FLAVOURS: Record<FlavourId, Flavour> = {
  backseat: {
    id: 'backseat',
    configKey: 'backseat-config',
    folder: 'backseat',
    personas: BACKSEAT_PERSONAS,
    defaultPersona: 'nervous',
  },
  roaster: {
    id: 'roaster',
    configKey: 'roaster-config',
    folder: 'roaster',
    personas: ROASTER_PERSONAS,
    defaultPersona: 'comedian',
  },
};

export const BACKSEAT = FLAVOURS.backseat;
export const ROASTER = FLAVOURS.roaster;
