/*
 * What grows on an invented world's ground, painted by fal.ai (owner, 27 Oct 2026: "the locations
 * still use grass and plants read from the assets rather than generated, and they don't
 * necessarily fit the location or the world"). The ~2,500 tufts across the map were the kit's
 * meadow — grass, ferns, bushes and flowers from a stylised European forest — tinted the world's
 * foliage colour, so a station's plates and a salt flat both had ferns on them.
 *
 * THREE PICTURES, NOT THREE MODELS: a tuft is a cut-out on two crossed quads, four triangles, as
 * games have always drawn grass. A TRELLIS model would be $0.02 and a minute each, and thousands of
 * them a frame. So FLUX.1 [schnell] draws each of three kinds of clump alone on white at 512² —
 * a low wide one, a taller one, and one that stands out — **$0.009 a world**, ~1 s, all three at
 * once, from genesis's `cover` line (in English, like the terrain), or for a world from before it,
 * from its look. The scene keys the white out and crops each to its clump (`cutOut` in
 * `components/Rpg/surfaces.ts`).
 *
 * `none`, or a barren or flooded look, asks for nothing: the ground stays bare. GENERATED ONCE PER
 * WORLD, like the ground: kept on the bible (`coverSprites`, `setWorldCover`), the bytes in the
 * Cache API with the hub's GLBs. In the developer console as kind `fal` labelled `cover`, counted
 * as textures beside the ground.
 */

import { recordMeasurement } from '../../lib/sentry';
import type { GroundTexture, WorldBible } from './genesis';
import { drawImage, imageCost, type FalOptions } from './landmark3d';

/** Square: the clump is cropped out of it in the browser. Below a megapixel, so the cheapest picture. */
export const COVER_SIZE = 512;

/** The kinds of clump, in the order the scene plants them: the most of the first, the fewest of the last. */
export const COVER_KINDS = [
  'one low, wide clump of the commonest of it',
  'one taller, narrow tuft of the tallest of it',
  'one small cluster of the most colourful or striking of it',
] as const;

type PromptWorld = Pick<WorldBible, 'cover' | 'terrain' | 'climate' | 'look'>;

/** Whether the world's ground has anything on it to paint. */
export function hasCover(world: PromptWorld): boolean {
  const { look } = world;
  if (look.growth === 'barren' || look.water === 'flooded') return false;
  return !/^\s*none\b/i.test(world.cover ?? '');
}

/** What grows, for a world genesis gave no `cover`: how much does, in what weather, and its colour. */
function fallbackCover(world: PromptWorld): string {
  const { look } = world;
  const what =
    look.weather === 'snow'
      ? 'frost-bitten grass tufts poking through snow'
      : look.weather === 'ash'
        ? 'withered grey grass and dry thorny weeds'
        : look.growth === 'lush'
          ? 'thick wild grass, weeds and small wildflowers'
          : 'dry sparse grass tufts and small hardy weeds';
  return `${what}, in a land whose climate is: ${world.climate}; growing on ${world.terrain ?? 'the ground'}; mostly the colour ${look.foliage}`;
}

export function coverPrompt(world: PromptWorld, kind: (typeof COVER_KINDS)[number]): string {
  const subject = world.cover?.trim() || fallbackCover(world);
  return [
    `Game foliage sprite on a plain pure white background: ${kind}. What grows here: ${subject.replace(/[.\s]+$/, '')}.`,
    'Side view at eye level, centred, cut out, nothing under it: no ground, no soil, no shadow, no sky, no scenery, no text.',
    'Stylised hand-painted game art.',
  ].join(' ');
}

const made = new Set<string>();
const failed = new Set<string>();
const inFlight = new Set<string>();

/** Where the world's cover is this session, as `groundState` says of its ground. */
export function coverState(worldId: string): 'pending' | 'failed' | null {
  return inFlight.has(worldId) ? 'pending' : failed.has(worldId) ? 'failed' : null;
}

/**
 * Paints the world's ground cover if it has none and none is being painted, and calls `onSprites`
 * once with every picture that came (the kinds that failed left out). A world whose every picture
 * failed is not asked again this session. Returns whether it asked.
 */
export function ensureGroundCover(
  key: string,
  world: WorldBible,
  onSprites: (sprites: GroundTexture[]) => void,
  onError: (err: unknown) => void = () => {},
  o: FalOptions = {},
): boolean {
  if (world.coverSprites || !hasCover(world)) return false;
  if (made.has(world.id) || failed.has(world.id) || inFlight.has(world.id)) return false;
  inFlight.add(world.id);
  const started = Date.now();
  Promise.allSettled(
    COVER_KINDS.map(async (kind) => {
      const prompt = coverPrompt(world, kind);
      const image = await drawImage(key, prompt, 'cover', o, COVER_SIZE);
      return { image, prompt, costUsd: imageCost(COVER_SIZE, COVER_SIZE), ms: Date.now() - started, at: Date.now() } satisfies GroundTexture;
    }),
  )
    .then((results) => {
      const sprites = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
      const costUsd = sprites.reduce((sum, s) => sum + s.costUsd, 0);
      const ms = Date.now() - started;
      if (!sprites.length) {
        failed.add(world.id);
        const err = (results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined)?.reason;
        recordMeasurement('rpg.landmark', {
          outcome: 'failed',
          piece: 'cover',
          ms,
          costUsd: 0,
          lang: world.lang,
          error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
        });
        onError(err);
        return;
      }
      made.add(world.id);
      recordMeasurement('rpg.landmark', { outcome: 'generated', piece: 'cover', ms, costUsd, lang: world.lang });
      onSprites(sprites);
    })
    .finally(() => inFlight.delete(world.id));
  return true;
}
