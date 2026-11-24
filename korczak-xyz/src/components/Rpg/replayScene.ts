/*
 * When a generated asset stands in front of the player (owner, 24 Nov 2026: "when each asset was
 * made and shown to the player, so I see the delay and what it does to the game"). The scene's
 * setters that stand a model up — the hub, a place, a person, the hero, a clue, the ground — are
 * wrapped once, after the scene is made: a call with a new model URL records `show`, and its
 * promise settling records `shown` (`replayRecorder.ts`). Calls that change nothing (the same URL
 * again, `wait`, the kit) record nothing, so the many re-renders that hand the scene what it already
 * has stay out of the recording.
 *
 * Wrapping rather than writing into `RpgScene.ts`: the scene stays the scene, and this list is the
 * whole of what the replay knows about it.
 */

import type { PersonBody, RpgScene } from './RpgScene';
import { recShow } from '../../utils/rpg/replayRecorder';

type AnyFn = (...args: never[]) => Promise<void>;

/** For each setter: the assets one call hands the scene, as `[what, name, url]`. */
const READERS: Record<string, (args: unknown[]) => [string, string, string | null][]> = {
  setGroundTexture: (a) => [['ground', 'ground', (a[0] as string | null) ?? null]],
  setForest: (a) => [['forest', 'forest', ((a[0] as string[]) ?? []).join(' ') || null]],
  setGroundCover: (a) => [['cover', 'cover', ((a[0] as string[]) ?? []).join(' ') || null]],
  setHubModels: (a) => Object.entries((a[0] as Record<string, string | undefined>) ?? {}).map(([slot, url]) => [slot, slot, url ?? null]),
  setPlaceModel: (a) => [['place', `${String(a[0])} #${String(a[1])}`, (a[2] as string) ?? null]],
  setNpcBody: (a) => [['person', String(a[0]), (a[1] as PersonBody | undefined)?.url ?? null]],
  setHero: (a) => [['hero', 'hero', (a[0] as PersonBody | undefined)?.url ?? null]],
  setWeapon: (a) => [['weapon', 'weapon', (a[0] as { url?: string } | undefined)?.url ?? null]],
  setClueModel: (a) => [['clue', String(a[0]), (a[1] as string) ?? null]],
  setEnemyBody: (a) => [['creature', 'creature', (a[0] as PersonBody | undefined)?.url ?? null]],
  setItemModel: (a) => [['item', 'item', (a[0] as string | null) ?? null]],
};

export function trackScene(scene: RpgScene): void {
  const target = scene as unknown as Record<string, AnyFn>;
  const last = new Map<string, string>();
  for (const [method, read] of Object.entries(READERS)) {
    const original = target[method];
    if (typeof original !== 'function') continue;
    target[method] = function (this: unknown, ...args: never[]) {
      const ends: ((ok: boolean) => void)[] = [];
      try {
        for (const [what, name, url] of read(args)) {
          const slot = `${method}:${name}`;
          if (!url || last.get(slot) === url) continue;
          last.set(slot, url);
          ends.push(recShow(what, name));
        }
      } catch {
        /* a recording; never the scene's problem */
      }
      const done = original.apply(scene, args);
      if (ends.length) {
        void Promise.resolve(done).then(
          () => ends.forEach((end) => end(true)),
          () => ends.forEach((end) => end(false)),
        );
      }
      return done;
    } as AnyFn;
  }
}
