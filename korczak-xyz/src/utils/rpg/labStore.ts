/*
 * What the model lab has made, in this browser: for each picture's person, the models made from it
 * by each method, and the people described in the lab itself rather than met in the game. Kept so a
 * comparison paid for once can be looked at again; nothing here reaches the game or the account.
 */

import type { PersonMesher, PersonPainter } from './landmark3d';
import type { LabSource } from './labSources';

/**
 * Which picture a model was made from: the game's own, the game's prompt drawn again by another
 * painter (`redraw`), or redrawn in the wide pose (`widePose`) or a strict T-pose (`tPose`).
 */
export type LabPose = 'game' | 'redraw' | 'wide' | 'tpose';

export interface LabPicture {
  image: string;
  prompt: string;
  pose: LabPose;
  painter: PersonPainter;
}

export interface LabVariant {
  id: string;
  method: PersonMesher;
  pose: LabPose;
  /** Who drew the picture; absent on the game's own and on models from before the picker. */
  painter?: PersonPainter;
  image: string;
  prompt: string;
  glb: string;
  costUsd: number;
  ms: number;
  bytes: number | null;
  at: number;
}

interface Stored {
  variants?: Record<string, LabVariant[]>;
  /** Redrawn pictures, by source and pose, so a pose is paid for once. */
  pictures?: Record<string, { image: string; prompt: string }>;
  /** People described in the lab. */
  own?: LabSource[];
}

const KEY = 'rpg-model-lab';

function read(): Stored {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function write(stored: Stored) {
  try {
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    /* forgotten on reload */
  }
}

export function labVariants(sourceId: string): LabVariant[] {
  const list = read().variants?.[sourceId];
  return Array.isArray(list) ? list : [];
}

export function addLabVariant(sourceId: string, variant: LabVariant): void {
  const stored = read();
  const variants = { ...(stored.variants ?? {}) };
  variants[sourceId] = [...(variants[sourceId] ?? []), variant];
  write({ ...stored, variants });
}

export function removeLabVariant(sourceId: string, id: string): void {
  const stored = read();
  const variants = { ...(stored.variants ?? {}) };
  variants[sourceId] = (variants[sourceId] ?? []).filter((v) => v.id !== id);
  write({ ...stored, variants });
}

/** The pictures `painter` drew; the wide pose before the picker was FLUX schnell's, under `id|wide`. */
const pictureKey = (sourceId: string, pose: LabPose, painter: PersonPainter) =>
  pose === 'wide' && painter === 'schnell' ? `${sourceId}|wide` : `${sourceId}|${pose}|${painter}`;

export function labPicture(sourceId: string, pose: LabPose, painter: PersonPainter): { image: string; prompt: string } | null {
  return read().pictures?.[pictureKey(sourceId, pose, painter)] ?? null;
}

export function setLabPicture(sourceId: string, pose: LabPose, painter: PersonPainter, picture: { image: string; prompt: string }): void {
  const stored = read();
  write({ ...stored, pictures: { ...(stored.pictures ?? {}), [pictureKey(sourceId, pose, painter)]: picture } });
}

/** Every picture redrawn for a person, oldest first. */
export function labPictures(sourceId: string): LabPicture[] {
  const out: LabPicture[] = [];
  for (const [k, v] of Object.entries(read().pictures ?? {})) {
    const [id, pose, painter = 'schnell'] = k.split('|');
    if (id === sourceId && (pose === 'wide' || pose === 'redraw' || pose === 'tpose')) out.push({ ...v, pose, painter: painter as PersonPainter });
  }
  return out;
}

export function ownSources(): LabSource[] {
  const own = read().own;
  return Array.isArray(own) ? own : [];
}

export function addOwnSource(source: LabSource): void {
  const stored = read();
  write({ ...stored, own: [source, ...(stored.own ?? []).filter((s) => s.id !== source.id)] });
}

/** Everything the lab has spent here, in dollars. */
export function labSpent(): number {
  const stored = read();
  let sum = 0;
  for (const list of Object.values(stored.variants ?? {})) for (const v of list) sum += v.costUsd;
  return sum;
}
