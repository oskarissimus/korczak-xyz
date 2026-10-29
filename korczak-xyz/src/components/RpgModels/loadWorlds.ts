/*
 * The worlds whose people the model lab shows: this browser's library, and for a signed-in reader
 * the account's too (`users/{uid}/rpgWorlds`, `rpgSaves`), read only — the game's sync (`cloud.ts`)
 * is the one thing that writes those, and the lab must never stamp or push a unit.
 */

import { collection, getDocs } from 'firebase/firestore';

import { getDb } from '../../lib/firebase';
import { runCloud } from '../../lib/firestoreHealth';
import type { LabWorld } from '../../utils/rpg/labSources';
import { loadGameFor, type SavedGame } from '../../utils/rpg/save';
import { libraryWorlds, loadAtlas, type Atlas, type LibraryEntry } from '../../utils/rpg/worldSave';

function parse<T>(text: unknown): T | null {
  if (typeof text !== 'string') return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function localWorlds(): LabWorld[] {
  return libraryWorlds().map((e) => ({ world: e.world, atlas: loadAtlas(e.world.id), game: loadGameFor(e.world.id), played: e.played }));
}

/** The account's worlds over this browser's, by id. */
export async function accountWorlds(uid: string): Promise<LabWorld[]> {
  const db = getDb();
  if (!db) return [];
  const [worlds, saves] = await runCloud('rpgModels.read', () =>
    Promise.all([getDocs(collection(db, 'users', uid, 'rpgWorlds')), getDocs(collection(db, 'users', uid, 'rpgSaves'))]),
  );
  const games = new Map<string, SavedGame | null>();
  for (const s of saves.docs) games.set(s.id, parse<SavedGame>((s.data() as { data?: string | null }).data));
  const out: LabWorld[] = [];
  for (const d of worlds.docs) {
    const data = d.data() as { world?: string | null; atlas?: string | null };
    const entry = parse<LibraryEntry>(data.world);
    if (!entry?.world) continue;
    out.push({ world: entry.world, atlas: parse<Atlas>(data.atlas), game: games.get(d.id) ?? null, played: entry.played ?? 0 });
  }
  return out;
}

export function mergeWorlds(local: LabWorld[], account: LabWorld[]): LabWorld[] {
  const byId = new Map(local.map((w) => [w.world.id, w]));
  for (const w of account) {
    const here = byId.get(w.world.id);
    byId.set(w.world.id, {
      world: w.world.heroModel || !here ? w.world : here.world,
      atlas: (w.atlas?.people?.length ?? 0) >= (here?.atlas?.people?.length ?? 0) ? w.atlas : (here?.atlas ?? null),
      game: w.game ?? here?.game ?? null,
      played: Math.max(w.played, here?.played ?? 0),
    });
  }
  return [...byId.values()];
}
