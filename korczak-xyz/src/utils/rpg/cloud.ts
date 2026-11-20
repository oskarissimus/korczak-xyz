/*
 * The game's memory on the account (owner, Oct 2026: "games on the phone and the computer don't
 * sync within one account"), for whoever is signed in. This browser's localStorage stays what the
 * game reads and writes; this copies it to Firestore and back, one unit at a time (`sync.ts`):
 *
 *   users/{uid}/rpgWorlds/{worldId}  a world's bible, atlas and chronicle
 *   users/{uid}/rpgSaves/{worldId}   the quest in progress there, or `data: null` once it is over
 *   users/{uid}/rpgState/current     which world each language is playing
 *
 * LAST WRITER WINS, per unit, by the writing browser's clock (`updatedAt`). Two devices playing the
 * same world at the same moment keep whichever saved last; that is the price of not merging beats,
 * and nobody plays one quest on two screens at once. An ended quest is a `null` save rather than a
 * deleted document, so the end reaches the other device instead of the old save coming back.
 *
 * THE PAYLOADS ARE JSON STRINGS, not Firestore maps: a save holds arrays of arrays (`lastLines`),
 * which Firestore refuses, and `undefined`s, which it refuses too. A document stays under the 1 MiB
 * limit by dropping the save's transcript, which is only for the developer console, when it would
 * not (`SAVE_MAX`).
 *
 * A world whose atlas this browser has evicted (`worldSave.ts`) keeps its library entry and its
 * chronicle from a pull but not the atlas or the save; `fetchWorld` takes those when the player
 * picks it from the library.
 *
 * `getDb()` is read per call, as everywhere: a dead client is replaced rather than held.
 */

import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { getDb } from '../../lib/firebase';
import { isRecoverableClientError, runCloud } from '../../lib/firestoreHealth';
import { describeError, log } from '../../lib/logger';
import { chronicleTimes, loadChronicle, writeChronicle } from './chronicle';
import { classicWorld } from './genesis';
import { LANGUAGES } from './language';
import { profile, rpgKey, withProfile } from './profile';
import type { ChronicleEntry, Lang } from './quest';
import { allGames, dropGameFor, loadGameFor, writeGameFor, type SavedGame } from './save';
import { allStamps, forget, markPushed, onTouch, saveUnit, seed, setSyncing, stampOf, STATE_UNIT, tookCloud, worldUnit } from './sync';
import {
  atlasIds,
  currentIds,
  dropWorldHere,
  LOCAL_WORLDS,
  libraryEntry,
  libraryWorlds,
  rawAtlas,
  writeAtlas,
  writeCurrent,
  sweepToTrash,
  writeLibraryEntry,
  type Atlas,
  type LibraryEntry,
} from './worldSave';

/** Under Firestore's 1 MiB a document, with room for the other fields. */
export const SAVE_MAX = 900_000;
/** How long after a change the account is sent it: a burst of steps goes as one write. */
const PUSH_DELAY_MS = 2500;

const worlds = (uid: string) => collection(getDb()!, 'users', uid, 'rpgWorlds');
const saves = (uid: string) => collection(getDb()!, 'users', uid, 'rpgSaves');
const stateDoc = (uid: string) => doc(getDb()!, 'users', uid, 'rpgState', 'current');
/**
 * A clean slate asked for the whole account (owner, 1 Nov 2026: "my profile clean of worlds and
 * characters"): `{ at }`, and every browser that pulls it once sends everything played before `at` to
 * the trash (`sweepToTrash`). Written by hand, or by the trash's own button; the game only reads it.
 */
export const cleanSlateDoc = (uid: string) => doc(getDb()!, 'users', uid, 'rpgState', 'cleanSlate');
const SWEPT_KEY = () => rpgKey('rpg-clean-slate');

/** The clean slate this browser last swept, by its `at`. */
export function sweptAt(): number {
  try {
    return Number(localStorage.getItem(SWEPT_KEY())) || 0;
  } catch {
    return 0;
  }
}

function markSwept(at: number) {
  try {
    localStorage.setItem(SWEPT_KEY(), String(at));
  } catch {
    /* swept again on the next pull, which finds nothing left to sweep */
  }
}

/**
 * Everything to the trash now: here at once, and on the account's other devices at their next pull,
 * through the account's clean slate. Signed out, only here. Returns how much went.
 */
export async function cleanSlate(uid: string | null, now = Date.now()): Promise<number> {
  const n = sweepToTrash(now, now);
  markSwept(now);
  if (uid && getDb()) await runCloud('rpg.cleanSlate.write', () => setDoc(cleanSlateDoc(uid), { at: now }));
  return n;
}

/** The account's clean slate, or 0 when it has none. */
export async function cleanSlateAt(uid: string): Promise<number> {
  if (!getDb()) return 0;
  const snap = await runCloud('rpg.cleanSlate', () => getDoc(cleanSlateDoc(uid)));
  return snap.exists() ? Number((snap.data() as { at?: number }).at) || 0 : 0;
}

/** What the account says about a world's quest in progress, for the library of a world not kept here. */
export interface SaveInfo {
  title: string;
  at: number;
}

let remoteSaves: Record<string, SaveInfo> = {};

/** Every quest in progress the last pull saw on the account, by world id. */
export function accountSaves(): Record<string, SaveInfo> {
  return remoteSaves;
}

function parse<T>(text: unknown): T | null {
  if (typeof text !== 'string') return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** A save as a document's `data`: the transcript goes first when the whole would be too big. */
export function saveData(game: SavedGame | null): string | null {
  if (!game) return null;
  const whole = JSON.stringify(game);
  if (whole.length <= SAVE_MAX) return whole;
  const lean = JSON.stringify({ ...game, transcript: [] });
  return lean.length <= SAVE_MAX ? lean : null;
}

function saveTitle(game: SavedGame): string {
  return game.beats[game.beats.length - 1]?.title ?? '';
}

/** The worlds whose atlas and save this browser keeps, with the ones the account makes current. */
function liveIds(extra: string[] = []): Set<string> {
  return new Set([
    'pl',
    'en',
    ...Object.values(currentIds()),
    ...libraryWorlds()
      .slice(0, LOCAL_WORLDS)
      .map((e) => e.world.id),
    ...extra,
  ]);
}

interface WorldDoc {
  updatedAt: number;
  world?: string | null;
  atlas?: string | null;
  chronicle?: string | null;
}

/** Takes one world's document into this browser; the atlas only when it is kept here. */
function applyWorld(id: string, d: WorldDoc, keep: boolean): void {
  const entry = parse<LibraryEntry>(d.world);
  if (entry?.world) writeLibraryEntry(entry);
  const chronicle = parse<ChronicleEntry[]>(d.chronicle);
  if (Array.isArray(chronicle)) writeChronicle(id, chronicle);
  if (!keep) return;
  if (typeof d.atlas === 'string') writeAtlas(id, parse<Atlas>(d.atlas));
  tookCloud(worldUnit(id), d.updatedAt);
}

function applySave(id: string, d: { updatedAt: number; data?: string | null }): void {
  writeGameFor(id, parse<SavedGame>(d.data));
  tookCloud(saveUnit(id), d.updatedAt);
}

/**
 * Stamps what this browser kept before there was syncing with when it really changed: a world with
 * when it was last played, a chronicle with its last quest, a save with its own time, and the
 * current worlds with almost nothing, so another device's choice that already reached the account
 * wins over it.
 */
export function seedStamps(): void {
  const times = chronicleTimes();
  for (const e of libraryWorlds()) seed(worldUnit(e.world.id), Math.max(e.played, times[e.world.id] ?? 0));
  for (const id of new Set([...atlasIds(), ...Object.keys(times)])) seed(worldUnit(id), times[id] ?? 1);
  for (const [id, game] of Object.entries(allGames())) seed(saveUnit(id), game.at);
  seed(STATE_UNIT, 1);
}

/**
 * Brings the account's newer units into this browser and sends it the newer local ones. Returns
 * true when anything here changed, so the intro screen can be read again.
 */
export async function pull(uid: string): Promise<boolean> {
  if (!getDb()) return false;
  const [worldSnap, saveSnap, stateSnap] = await runCloud('rpg.pull', () =>
    Promise.all([getDocs(worlds(uid)), getDocs(saves(uid)), getDoc(stateDoc(uid))]),
  );
  // Read on its own and never fatal: inside the Promise.all above, a refused read of it (1 Nov 2026,
  // permission-denied) failed every pull on every device, so nothing came down from the account while
  // pushes still went up.
  const slate = await cleanSlateAt(uid).catch((e) => {
    log.warn('rpg.cleanSlate.unreadable', describeError(e));
    return 0;
  });
  // Signed out (or into another account) while the account was being read: what came down is not
  // the store's that is on screen now, and must not land in it (`profile.ts`).
  if (profile() !== uid) return false;
  let changed = false;

  const state = stateSnap.exists() ? (stateSnap.data() as { updatedAt?: number; current?: Record<Lang, string> }) : null;
  const stateNewer = Boolean(state && (state.updatedAt ?? 0) > stampOf(STATE_UNIT).local);
  const live = liveIds(stateNewer ? Object.values(state?.current ?? {}) : []);

  /** Each unit's time on the account. */
  const cloudAt = new Map<string, number>();
  for (const snap of worldSnap.docs) {
    const d = snap.data() as WorldDoc;
    cloudAt.set(worldUnit(snap.id), d.updatedAt ?? 0);
    if ((d.updatedAt ?? 0) <= stampOf(worldUnit(snap.id)).local) continue;
    applyWorld(snap.id, d, live.has(snap.id));
    changed = true;
  }

  const info: Record<string, SaveInfo> = {};
  for (const snap of saveSnap.docs) {
    const d = snap.data() as { updatedAt: number; data?: string | null };
    cloudAt.set(saveUnit(snap.id), d.updatedAt ?? 0);
    const game = parse<SavedGame>(d.data);
    if (game?.beats?.length) info[snap.id] = { title: saveTitle(game), at: game.at };
    if ((d.updatedAt ?? 0) <= stampOf(saveUnit(snap.id)).local || !live.has(snap.id)) continue;
    applySave(snap.id, d);
    changed = true;
  }
  remoteSaves = info;

  if (state && stateNewer) {
    // A world the account names before its own document has arrived waits for the next pull.
    if (writeCurrent(state.current ?? {}, classicWorld)) tookCloud(STATE_UNIT, state.updatedAt ?? 0);
    changed = true;
  }

  // After everything the account had is in, so the sweep reaches its worlds too.
  if (slate > sweptAt()) {
    const n = sweepToTrash(slate);
    markSwept(slate);
    log.info('rpg.cleanSlate.swept', { worlds: n });
    changed = true;
  }

  if (state) cloudAt.set(STATE_UNIT, state.updatedAt ?? 0);
  const released = releaseGuest(cloudAt);
  if (released) log.info('rpg.guest.released', { units: released });
  // What this browser has that the account has not: newer here than there, or not there at all.
  // Never the other way: a unit the account has newer is never pushed over, even one not taken here.
  for (const [unit, s] of Object.entries(allStamps())) {
    const there = cloudAt.get(unit);
    if (there === undefined || s.local > there) queue.add(unit);
  }
  return changed;
}

/** Takes one world's atlas and quest in progress from the account, before playing it here. */
export async function fetchWorld(uid: string, id: string): Promise<void> {
  if (!getDb()) return;
  const [w, s] = await runCloud('rpg.fetchWorld', () => Promise.all([getDoc(doc(worlds(uid), id)), getDoc(doc(saves(uid), id))]));
  if (profile() !== uid) return;
  if (w.exists() && (w.data().updatedAt ?? 0) > stampOf(worldUnit(id)).local) applyWorld(id, w.data() as WorldDoc, true);
  if (s.exists() && (s.data().updatedAt ?? 0) > stampOf(saveUnit(id)).local) {
    applySave(id, s.data() as { updatedAt: number; data?: string | null });
  }
}

/**
 * The guest's copies of what this account already holds leave the guest's store (`profile.ts`). Until
 * 20 Nov 2026 the guest and the account shared one store, which every sign-in synced both ways, so a
 * browser signed in once and then out kept showing the account's worlds to the guest. A unit goes only
 * when the guest's copy is provably on this account: pushed or taken from it (`pushed > 0`), not
 * changed since (`local <= pushed`), and the account holding that version or a later one. Anything the
 * guest played since, or that never reached an account, stays the guest's. The classic worlds stay
 * too: every account has one under the same id, so it proves nothing. Returns how many units went.
 */
export function releaseGuest(cloudAt: Map<string, number>): number {
  return withProfile(null, () => {
    const stamps = allStamps();
    const units = new Map<string, string[]>();
    const kept = new Set<string>();
    for (const [unit, s] of Object.entries(stamps)) {
      const m = /^(world|save):(.+)$/.exec(unit);
      if (!m) continue;
      const id = m[2];
      units.set(id, [...(units.get(id) ?? []), unit]);
      const there = cloudAt.get(unit);
      if (LANGUAGES.includes(id) || there === undefined || !s.pushed || s.local > s.pushed || there < s.pushed) kept.add(id);
    }
    // A world goes whole or not at all: a quest the guest went on with keeps its world here too.
    let n = 0;
    for (const [id, list] of units) {
      if (kept.has(id)) continue;
      dropWorldHere(id);
      writeChronicle(id, []);
      dropGameFor(id);
      for (const unit of list) forget(unit);
      n += list.length;
    }
    return n;
  });
}

async function push(uid: string, unit: string): Promise<void> {
  // Read from this account's store only: after a sign-out the unit waits, newer than the account's
  // copy, for the next sign-in's pull to queue it again.
  if (profile() !== uid) return;
  const at = stampOf(unit).local || Date.now();
  if (unit === STATE_UNIT) {
    await runCloud('rpg.push.state', () => setDoc(stateDoc(uid), { updatedAt: at, current: currentIds() }));
  } else if (unit.startsWith('world:')) {
    const id = unit.slice('world:'.length);
    const entry = libraryEntry(id);
    const atlas = rawAtlas(id);
    const body: Record<string, unknown> = { updatedAt: at, chronicle: JSON.stringify(loadChronicle(id)) };
    if (entry) body.world = JSON.stringify(entry);
    // An atlas this browser no longer has is left as the account has it, never blanked.
    if (atlas) body.atlas = JSON.stringify(atlas);
    await runCloud('rpg.push.world', () => setDoc(doc(worlds(uid), id), body, { merge: true }));
  } else if (unit.startsWith('save:')) {
    const id = unit.slice('save:'.length);
    const game = loadGameFor(id);
    const data = saveData(game);
    if (game && data === null) {
      log.warn('rpg.push.saveTooBig', { beats: game.beats.length });
      return;
    }
    await runCloud('rpg.push.save', () => setDoc(doc(saves(uid), id), { updatedAt: at, data }));
    if (profile() !== uid) {
      /* signed out meanwhile: the library on screen is the guest's */
    } else if (game) remoteSaves = { ...remoteSaves, [id]: { title: saveTitle(game), at: game.at } };
    else {
      const { [id]: _gone, ...rest } = remoteSaves;
      remoteSaves = rest;
    }
  } else return;
  // The store may have switched while the write was in flight; the stamp belongs to this account's.
  withProfile(uid, () => markPushed(unit, at));
}

const queue = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let syncingUid: string | null = null;
let flushing: Promise<void> | null = null;

async function flush(uid = syncingUid): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!uid || !getDb()) return;
  if (flushing) return flushing;
  flushing = (async () => {
    for (const unit of [...queue]) {
      queue.delete(unit);
      try {
        await push(uid, unit);
      } catch (e) {
        // Still newer here than on the account: the next change or pull queues it again.
        log.warn('rpg.push.failed', { unit: unit.split(':')[0], ...describeError(e) });
      }
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flush(), PUSH_DELAY_MS);
}

/** One round: the account's newer units in, this browser's newer ones out. */
export async function syncNow(uid: string): Promise<boolean> {
  seedStamps();
  const changed = await pull(uid);
  await flush(uid);
  return changed;
}

/**
 * Keeps this browser and the account in step while `uid` is signed in: a pull now and whenever the
 * page comes back to the front (the other device may have played meanwhile), a push a moment after
 * every change and at once when the page goes to the back. `pulled` is told when a pull changed
 * anything here; whether to show it now is the caller's call.
 */
export function startSync(uid: string, pulled: () => void): () => void {
  syncingUid = uid;
  setSyncing(true);
  const doPull = () =>
    syncNow(uid)
      .then((changed) => {
        if (changed) pulled();
      })
      .catch((e) => {
        // A stall is the client's to recover from (`runCloud`) and is retried on the next pull; anything
        // else means this browser is not getting the account's game at all, which used to be silent.
        if (isRecoverableClientError(e)) log.warn('rpg.pull.failed', describeError(e));
        else log.error('rpg.pull.failed', { ...describeError(e), stack: e instanceof Error ? e.stack?.slice(0, 1500) : undefined });
      });
  void doPull();
  const off = onTouch((unit) => {
    queue.add(unit);
    schedule();
  });
  const onVisible = () => {
    if (document.visibilityState === 'hidden') void flush();
    else void doPull();
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    off();
    document.removeEventListener('visibilitychange', onVisible);
    // The account's quests are not the next profile's; `push` skips anything the switch overtakes.
    remoteSaves = {};
    void flush().finally(() => {
      if (syncingUid !== uid) return;
      syncingUid = null;
      setSyncing(false);
    });
  };
}

/** The quests in progress here and on the account, for the library, by world id. */
export function questsInProgress(): Record<string, SaveInfo> {
  const here: Record<string, SaveInfo> = {};
  for (const [id, game] of Object.entries(allGames())) here[id] = { title: saveTitle(game), at: game.at };
  return { ...remoteSaves, ...here };
}
