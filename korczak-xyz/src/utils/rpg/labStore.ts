/*
 * What the model lab has made, in this browser: for each picture's person, the models made from it
 * by each method, and the people described in the lab itself rather than met in the game. Kept so a
 * comparison paid for once can be looked at again; nothing here reaches the game or the account.
 */

import type { PersonMesher, PersonPainter } from './landmark3d';
import type { LabSource } from './labSources';
import { rpgSet } from './storage';

/**
 * Which picture a model was made from: the game's own, the game's prompt drawn again by another
 * painter (`redraw`), or redrawn in the wide pose (`widePose`) or the T-pose (`tPose`). Pictures stored as `tposeDown` (the
 * palms-down T-pose, when there were two, before 1 Nov 2026) are listed as `tpose`.
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
  /** In the lab's trash since then: hidden, not deleted (`restoreLabVariant`). */
  deleted?: number;
}

interface Stored {
  variants?: Record<string, LabVariant[]>;
  /** Redrawn pictures, by source and pose, so a pose is paid for once. */
  pictures?: Record<string, { image: string; prompt: string }>;
  /** People described in the lab. */
  own?: LabSource[];
  /** People in the lab's trash, by source id, with when they went: the lab's own and the game's alike. */
  trashed?: Record<string, number>;
  /** The account's clean slate this browser has swept (`sweepLab`). */
  swept?: number;
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
    rpgSet(KEY, JSON.stringify(stored));
  } catch {
    /* forgotten on reload */
  }
}

export function labVariants(sourceId: string): LabVariant[] {
  const list = read().variants?.[sourceId];
  return Array.isArray(list) ? list.filter((v) => !v.deleted) : [];
}

export function addLabVariant(sourceId: string, variant: LabVariant): void {
  const stored = read();
  const variants = { ...(stored.variants ?? {}) };
  variants[sourceId] = [...(variants[sourceId] ?? []), variant];
  write({ ...stored, variants });
}

/** A model to the lab's trash: hidden from the person, kept with everything it cost. */
export function removeLabVariant(sourceId: string, id: string, now = Date.now()): void {
  setVariantDeleted(sourceId, id, now);
}

export function restoreLabVariant(sourceId: string, id: string): void {
  setVariantDeleted(sourceId, id, undefined);
}

function setVariantDeleted(sourceId: string, id: string, deleted: number | undefined) {
  const stored = read();
  const variants = { ...(stored.variants ?? {}) };
  variants[sourceId] = (variants[sourceId] ?? []).map((v) => (v.id === id ? { ...v, deleted } : v));
  write({ ...stored, variants });
}

/*
 * THE LAB'S TRASH (owner, 1 Nov 2026: "the lab wants a clean slate too, with its history"): people
 * and models put away rather than deleted, each back with Restore. A person from the game also leaves
 * with their world (`worldSave.ts`'s trash); this is for one person, or one of the lab's own.
 */

export function trashedSources(): Record<string, number> {
  return { ...(read().trashed ?? {}) };
}

export function trashSource(sourceId: string, now = Date.now()): void {
  const stored = read();
  write({ ...stored, trashed: { ...(stored.trashed ?? {}), [sourceId]: now } });
}

export function restoreSource(sourceId: string): void {
  const stored = read();
  const { [sourceId]: _gone, ...trashed } = stored.trashed ?? {};
  write({ ...stored, trashed });
}

/** Every model in the trash, with whose it is, the most recently thrown away first. */
export function trashedVariants(): { sourceId: string; variant: LabVariant }[] {
  const out: { sourceId: string; variant: LabVariant }[] = [];
  for (const [sourceId, list] of Object.entries(read().variants ?? {})) for (const v of list) if (v.deleted) out.push({ sourceId, variant: v });
  return out.sort((a, b) => (b.variant.deleted ?? 0) - (a.variant.deleted ?? 0));
}

/**
 * The account's clean slate, in the lab: every person described here and every model made before
 * `before` goes to the trash, once per browser (the lab is kept in this browser only). The redrawn
 * pictures stay as they are, a cache that keeps a pose from being paid for twice.
 */
export function sweepLab(before: number, now = Date.now()): number {
  const stored = read();
  if ((stored.swept ?? 0) >= before) return 0;
  let n = 0;
  const trashed = { ...(stored.trashed ?? {}) };
  for (const s of stored.own ?? []) {
    if (trashed[s.id]) continue;
    trashed[s.id] = now;
    n += 1;
  }
  const variants: Record<string, LabVariant[]> = {};
  for (const [id, list] of Object.entries(stored.variants ?? {})) {
    variants[id] = list.map((v) => {
      if (v.deleted || v.at > before) return v;
      n += 1;
      return { ...v, deleted: now };
    });
  }
  write({ ...stored, trashed, variants, swept: before });
  return n;
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
    const [id, stored, painter = 'schnell'] = k.split('|');
    const pose = stored === 'tposeDown' ? 'tpose' : stored;
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

/** Everything the lab has spent here, in dollars, on what is not in the trash. */
export function labSpent(): number {
  const stored = read();
  let sum = 0;
  // What is in the trash is left out, so a clean slate starts the count from nothing too.
  for (const list of Object.values(stored.variants ?? {})) for (const v of list) if (!v.deleted) sum += v.costUsd;
  // The people described here: their picture, or their whole model made from the words.
  for (const s of stored.own ?? []) if (!stored.trashed?.[s.id]) sum += s.model.costUsd ?? 0;
  return sum;
}
