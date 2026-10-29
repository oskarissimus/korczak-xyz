/*
 * The people the RPG has had made, for the model lab (`components/RpgModels/`, owner, 29 Oct 2026:
 * "after some in-game generations I would like to inspect them individually — rotate, zoom, move and
 * switch between animations — to assess what is the best bang for buck"). Read from what the game
 * keeps and never written back: each world's hero (`heroModel`), everyone in its atlas, and from the
 * quest in progress the givers, the witnesses and a humanoid slay target. One person met twice is one
 * entry, by model.
 */

import type { LandmarkModel, WorldBible } from './genesis';
import type { Character, Lang } from './quest';
import type { SavedGame } from './save';
import type { Atlas } from './worldSave';

export type LabRole = 'hero' | 'person' | 'enemy';

export interface LabSource {
  /** The model's GLB, which names it for good. */
  id: string;
  worldId: string;
  world: string;
  lang: Lang;
  name: string;
  role: LabRole;
  body: 'male' | 'female';
  model: LandmarkModel;
}

export interface LabWorld {
  world: WorldBible;
  atlas: Atlas | null;
  game: SavedGame | null;
  /** When it was last played, for the order. */
  played: number;
}

const HERO_WOMAN = /\b(woman|female|girl|lady|she|her|heroine|priestess|witch|queen)\b/i;

/** Every made person in `worlds`, newest world first, each model once. */
export function labSources(worlds: readonly LabWorld[]): LabSource[] {
  const out: LabSource[] = [];
  const seen = new Set<string>();
  const add = (w: WorldBible, name: string, role: LabRole, body: 'male' | 'female', model: LandmarkModel | undefined) => {
    if (!model?.glb || !model.image || seen.has(model.glb)) return;
    seen.add(model.glb);
    out.push({ id: model.glb, worldId: w.id, world: w.name, lang: w.lang, name, role, body, model });
  };
  const person = (w: WorldBible, c: Character | undefined) => {
    if (c) add(w, c.name, 'person', c.gender === 'female' ? 'female' : 'male', c.model);
  };
  for (const { world: w, atlas, game } of [...worlds].sort((a, b) => b.played - a.played)) {
    add(w, w.hero ? w.hero.split(/[,.]/)[0].slice(0, 60) : 'hero', 'hero', HERO_WOMAN.test(w.hero ?? '') ? 'female' : 'male', w.heroModel);
    for (const p of atlas?.people ?? []) person(w, p.character);
    for (const beat of game?.beats ?? []) {
      person(w, beat.npc);
      person(w, beat.witness?.npc);
      const job = beat.job;
      if (job?.kind === 'slay' && job.look.shape === 'humanoid') add(w, job.targetName, 'enemy', 'male', job.model);
    }
  }
  return out;
}
