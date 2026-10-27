/*
 * The ground under an invented world, painted by fal.ai (owner, 27 Oct 2026: "the ground texture
 * should be generated too; now it seems to be always grass"). The one Poly Haven scan recoloured
 * in the world's ground colour read as grass in every world — dyed grass in a desert, in snow, on
 * a scrapyard — so each world gets a picture of its own ground instead.
 *
 * ONE PICTURE, THE CHEAPEST THERE IS: FLUX.1 [schnell] at 992×992, just under the megapixel fal
 * bills as one, so **$0.003 a world** — the same as a 512² hub picture, at four times the pixels.
 * Seen from directly above, of genesis's `terrain` line (in English, like the landmark), or for a
 * world from before it, of what its look and climate say.
 *
 * TILEABLE IN THE BROWSER, NOT BY THE MODEL. FLUX asked for "seamless" draws something nearly so:
 * cracks and pebbles that stop dead at the edge, a grid of seams across the map. The scene blends
 * each edge with the picture's own middle (`seamless` in `components/Rpg/surfaces.ts`), which
 * leaves no seam at the cost of a faint double image along the band, and `breakTiling` hides the
 * repeat as it does the scan's.
 *
 * GENERATED ONCE PER WORLD, like the hub: kept on the bible (`groundTexture`, `setWorldGround`), so
 * it syncs and no device asks again; fal is asked to keep the file (the URL is the cache), and the
 * bytes are in the Cache API with the hub's GLBs (`loadLandmarkBytes`). In the developer console as
 * kind `fal` labelled `ground`, in the fal.ai total with everything else fal makes.
 */

import { recordMeasurement } from '../../lib/sentry';
import type { GroundTexture, WorldBible } from './genesis';
import { drawImage, imageCost, type FalOptions } from './landmark3d';

export type { GroundTexture };

/** Square, and the largest that fal still bills as one megapixel. */
export const GROUND_SIZE = 992;

type PromptWorld = Pick<WorldBible, 'terrain' | 'climate' | 'look'>;

/** What the ground is, for a world genesis gave no `terrain`: what falls on it and what grows. */
function fallbackTerrain(world: PromptWorld): string {
  const { look } = world;
  const lying =
    look.weather === 'snow'
      ? 'fresh snow over frozen earth'
      : look.weather === 'ash'
        ? 'grey volcanic ash over dark cracked earth'
        : look.growth === 'lush'
          ? 'thick short grass and moss over soft earth'
          : look.growth === 'sparse'
            ? 'bare packed earth with patches of short grass'
            : 'bare dry earth, gravel and small stones';
  const wet = look.water === 'pools' || look.weather === 'rain' ? ', damp, with small puddles' : '';
  return `${lying}${wet}, in a land whose climate is: ${world.climate}; mostly the colour ${look.ground}`;
}

export function groundPrompt(world: PromptWorld): string {
  const subject = world.terrain?.trim() || fallbackTerrain(world);
  return [
    `Seamless tileable texture of the ground seen from directly above: ${subject.replace(/[.\s]+$/, '')}.`,
    'Flat top-down view of about four metres of ground, evenly lit, no shadows, no horizon, no sky,',
    'no objects, no buildings, no people, no text, the same detail all over the image, stylised hand-painted game texture.',
  ].join(' ');
}

const made = new Set<string>();
const failed = new Set<string>();
const inFlight = new Set<string>();

/**
 * Paints the world's ground if it has none and none is being painted, and calls `onTexture` once
 * it has. A world that failed is not asked again this session. Returns whether it asked.
 */
export function ensureGroundTexture(
  key: string,
  world: WorldBible,
  onTexture: (texture: GroundTexture) => void,
  onError: (err: unknown) => void = () => {},
  o: FalOptions = {},
): boolean {
  if (world.groundTexture || made.has(world.id) || failed.has(world.id) || inFlight.has(world.id)) return false;
  inFlight.add(world.id);
  const started = Date.now();
  const prompt = groundPrompt(world);
  drawImage(key, prompt, 'ground', o, GROUND_SIZE)
    .then(
      (image) => {
        const costUsd = imageCost(GROUND_SIZE, GROUND_SIZE);
        const texture: GroundTexture = { image, prompt, costUsd, ms: Date.now() - started, at: Date.now() };
        made.add(world.id);
        recordMeasurement('rpg.landmark', { outcome: 'generated', piece: 'ground', ms: texture.ms, costUsd, lang: world.lang });
        onTexture(texture);
      },
      (err) => {
        failed.add(world.id);
        recordMeasurement('rpg.landmark', {
          outcome: 'failed',
          piece: 'ground',
          ms: Date.now() - started,
          costUsd: 0,
          lang: world.lang,
          error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
        });
        onError(err);
      },
    )
    .finally(() => inFlight.delete(world.id));
  return true;
}
