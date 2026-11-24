/*
 * The scene rebuilt where no picture was taken (owner, 24 Nov 2026, over a session from before the
 * pictures: "can't it be reconstructed? we have the assets and the player's activity"). The game's own
 * `RpgScene`, only looked at: the world's look, its hub, forest, ground and cover from the models kept
 * on the bible, the places and people from the account's atlas, and the hero stood where the replay's
 * `pos` events put them, facing the way they were going, the camera behind as in play.
 *
 * What it cannot be: the atlas is the world as it stands now, not as it stood then, so places and
 * people a later step of this same session brought in are hidden until that step (`hiddenAt` in
 * `AdminReplay.tsx`), while anything from after the session is there; the camera is the play camera's
 * resting angle, not where the player was looking; enemies, clues and things to gather are not drawn.
 * Loaded only when asked for, so the admin page does not carry three.js otherwise.
 */

import { HUB_SLOTS, hubModel, type HubSlot } from '../../utils/rpg/landmark3d';
import { FOREST_SLOTS, heroLook } from '../../utils/rpg/falPrompts';
import { classicWorld, type WorldBible } from '../../utils/rpg/genesis';
import { hubLayout } from '../../utils/rpg/hubLayout';
import { isDead, type Lang } from '../../utils/rpg/quest';
import { weaponLength } from '../../utils/rpg/weapon';
import { cleanAtlas, type Atlas } from '../../utils/rpg/worldSave';
import { RpgScene } from './RpgScene';

const noop = () => {};

export interface Stage {
  /** The hero at a spot, facing along (dx, dz). */
  pose(x: number, z: number, dx: number, dz: number): void;
  /** Leaves out the places and people not met yet at this moment, by name. */
  hide(places: ReadonlySet<string>, people: ReadonlySet<string>): void;
  resize(width: number, height: number): void;
  /** What was put in: for the panel's line. */
  counts: { models: number; places: number; people: number };
  dispose(): void;
}

/** The world a replay played, from the account (`adminReplayWorld`), or the classic one by its language. */
export function stageWorld(raw: unknown, worldId: string): WorldBible | null {
  const w = raw as WorldBible | null;
  if (w && typeof w.id === 'string' && typeof w.name === 'string' && w.look) return w;
  if (worldId === 'pl' || worldId === 'en') return classicWorld(worldId as Lang);
  return null;
}

export function makeStage(canvas: HTMLCanvasElement, world: WorldBible, rawAtlas: unknown): Stage {
  const scene = new RpgScene(
    canvas,
    {
      onPrompt: noop,
      onTalk: noop,
      onExamine: noop,
      onProgress: noop,
      onHealth: noop,
      onDeath: noop,
      onCompass: noop,
      onLockChange: noop,
      onArrive: noop,
      onSenses: noop,
    },
    { viewer: true },
  );
  // Our quick rig, in the browser: nothing to wake, nothing to pay for.
  scene.setRigger('fit', null);
  scene.setPaused(true);
  const box = canvas.parentElement;
  scene.resize(box?.clientWidth || 640, box?.clientHeight || 360);
  scene.start();

  scene.applyWorld(world.look, world.id);
  const invented = world.createdAt > 0;
  const urls: Partial<Record<HubSlot, string>> = {};
  if (invented) for (const slot of HUB_SLOTS) {
    const glb = hubModel(world, slot)?.glb;
    if (glb) urls[slot] = glb;
  }
  const models = Object.keys(urls).length;
  scene.setLayout(invented && models ? hubLayout(world.id, world.sizes) : null);
  void scene.setHubModels(urls, world.sizes);
  void scene.setForest(
    FOREST_SLOTS.flatMap((slot) => (urls[slot] ? [urls[slot]!] : [])),
    world.sizes?.tree,
  );
  void scene.setGroundTexture(invented ? (world.groundTexture?.image ?? null) : null);
  void scene.setGroundCover(invented ? (world.coverSprites ?? []).map((s) => s.image) : []);
  void scene.setHero({ url: invented ? world.heroModel?.glb : undefined, picture: invented ? world.heroModel?.image : undefined }, heroLook(world)).catch(noop);
  void scene.setWeapon({ url: invented ? world.weaponModel?.glb : undefined }, weaponLength(world)).catch(noop);

  const atlas: Atlas = cleanAtlas((rawAtlas ?? undefined) as Atlas | undefined);
  const people = atlas.people.filter((p) => !isDead(p.character.name, atlas.dead));

  let shownKey = '';
  const build = (hidePlaces: ReadonlySet<string>, hidePeople: ReadonlySet<string>) => {
    scene.clearPlaces();
    scene.clearNpcs();
    const standing = atlas.places.filter((p) => !hidePlaces.has(p.name));
    for (const place of standing) {
      scene.addPlace(place);
      if (!invented) continue;
      (place.assets ?? []).forEach((asset, i) => {
        if (asset.model?.glb) void scene.setPlaceModel(place.name, i, asset.model.glb, asset.size).catch(noop);
      });
    }
    const crowd = new Map<string, number>();
    for (const { character: c, at } of people) {
      if (hidePeople.has(c.name)) continue;
      const where = at && standing.some((p) => p.name === at) ? at : null;
      if (at && !where && hidePlaces.has(at)) continue;
      const nth = where ? (crowd.get(where) ?? 2) : 0;
      if (where) crowd.set(where, nth + 1);
      const body = invented && c.model?.glb ? { url: c.model.glb, picture: c.model.image } : {};
      scene.placeNpc(c.name, c.color, where, nth, c.gender, body, `${c.appearance ?? ''}\n${c.voice ?? ''}`, c.craft ?? null);
    }
  };

  return {
    pose: (x, z, dx, dz) => scene.poseHero(x, z, dx, dz),
    hide(places, folk) {
      const key = `${[...places].sort().join('|')}#${[...folk].sort().join('|')}`;
      if (key === shownKey) return;
      shownKey = key;
      build(places, folk);
    },
    resize: (w, h) => scene.resize(w, h),
    counts: { models, places: atlas.places.length, people: people.length },
    dispose: () => scene.dispose(),
  };
}
