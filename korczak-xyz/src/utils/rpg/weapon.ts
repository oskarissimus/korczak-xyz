/*
 * The hero's weapon (owner, 3 Nov 2026: "the hero always runs about with a sword however the world is
 * generated; the hand weapon should be a generated asset too"). One per world, like the hero: genesis
 * writes what it is in English (`WorldBible.weapon`) and how long (`weaponLength`), fal.ai makes it
 * once (`ensureWeaponModel`, a picture then TRELLIS), it is kept beside the world (`weaponModel`)
 * and the scene puts it in the right hand where the kit's bronze sword used to go.
 *
 * The picture is drawn upright, grip at the bottom, by Nano Banana Lite (`WEAPON_PAINTER`): FLUX
 * schnell drew a sword point down whatever the prompt said, and the shape alone cannot say which end
 * is the hilt (a sword's guard and pommel outweigh its blade, an axe's head its haft). From Nano
 * Banana's four of four upright pictures TRELLIS kept the picture's top as +Y every time, so the
 * scene stands the model on the bottom of its box and closes the fist a little above it
 * (`weaponGrip`). A model that came back lying down anyway is stood up along its longest axis, +X
 * or +Z end up, which is a guess. About $0.054 a weapon with a Gemini key, $0.062 through fal.
 */

import type { WorldBible } from './genesis';
import { paletteLine } from './falPrompts';

/** How long a weapon is when the world does not say, and the range a world may say. */
export const WEAPON_LENGTH = { fallback: 1.0, min: 0.3, max: 2.2 } as const;

/** The length genesis gave, clamped to something a hand can hold; the fallback when it gave none. */
export function weaponLength(world: Pick<WorldBible, 'weaponLength'> | null | undefined): number {
  const n = Number(world?.weaponLength);
  if (!Number.isFinite(n) || n <= 0) return WEAPON_LENGTH.fallback;
  return Math.min(WEAPON_LENGTH.max, Math.max(WEAPON_LENGTH.min, n));
}

/**
 * What the hero holds, for the picture: the world's `weapon` line, or for a world from before it,
 * a weapon guessed from who the player is and how far technology goes there.
 */
export function weaponLook(world: Pick<WorldBible, 'weapon' | 'player' | 'tech'>): string {
  const own = world.weapon?.trim();
  if (own) return own;
  return `a sturdy one-handed melee weapon that fits ${world.player || 'a wandering adventurer'}${world.tech ? `, in a world where ${world.tech}` : ''}`.slice(0, 300);
}

/**
 * The picture TRELLIS makes the weapon from: one weapon, upright, its grip at the bottom, side on so
 * its whole outline shows, thick enough that the mesh keeps it (a thin blade at TRELLIS's
 * simplification comes back with holes, as the hub's slender lamp posts did).
 */
export function weaponPrompt(what: string, look?: Pick<WorldBible['look'], 'accent' | 'light'>): string {
  return [
    `A single stylised low-poly game asset, one hand-held weapon only: ${what.trim().replace(/[.\s]+$/, '')}.`,
    look ? `A touch of ${look.accent} somewhere on it.` : '',
    paletteLine(look?.light),
    'Standing perfectly upright and vertical, its grip or handle at the bottom and its blade, head or tip pointing straight up,',
    'seen from the side so its whole outline shows, centred, the whole weapon in view.',
    'Chunky, thick proportions: a thick blade or shaft, nothing thin, spindly or wispy, no chains, no strings, no sheath,',
    'small in the frame with a wide empty white margin on every side, nothing cut off,',
    'isolated on a plain white background, no hand, no people, no ground, no shadow, no text, soft even light.',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * How far above the bottom of the weapon the fist closes, in metres: a hand's width over the pommel
 * for anything up to a two-handed sword, and a third of the way up a staff or a spear.
 */
export function weaponGrip(length: number): number {
  if (length > 1.6) return length * 0.33;
  return Math.min(0.12, length * 0.25);
}

/**
 * Which axis of the model's box is its length (0 x, 1 y, 2 z): Y unless another is clearly longer,
 * since the picture asked for upright and a stubby axe head can be nearly as wide as its haft is long.
 */
export function weaponAxis(size: { x: number; y: number; z: number }): 0 | 1 | 2 {
  const longest = Math.max(size.x, size.z);
  if (size.y >= longest * 0.8) return 1;
  return size.x >= size.z ? 0 : 2;
}
