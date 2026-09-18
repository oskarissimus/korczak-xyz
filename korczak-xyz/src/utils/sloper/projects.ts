/*
 * A sitting that outlives the tab.
 *
 * WHAT CHANGED, AND WHY THE OLD ANSWER WAS RIGHT AT THE TIME. Until now nothing here was saved:
 * `storage.ts` holds one small settings key and the rest of a run — twelve 1024×1536 pictures and
 * twelve narrations — lived in memory until the tab closed. That was not laziness, it was the
 * origin's ~5 MB localStorage budget, shared with the typing trainer's `typedHistory`. One sitting
 * would have evicted a book.
 *
 * Firestore and Cloud Storage are not that budget. The limit that ruled localStorage out does not
 * apply to either, so the objection is answered rather than overridden — and what it was
 * protecting (the *other* apps on this origin) is untouched, because none of this goes near
 * localStorage. The split between the two is the only judgement here:
 *
 *   Firestore   the scenes, the stage, one row per asset          kilobytes, queried, listed
 *   Storage     the JPEGs, the MP3s, the finished MP4             megabytes, fetched by URL
 *
 * A Firestore document may not exceed 1 MiB. A twelve-scene script is perhaps 8 kB and fits with
 * room to spare; one processed picture is a few hundred kB and would not, base64 making it a third
 * larger again. So the document holds a *path* per asset and the bucket holds the bytes, which is
 * also what makes reopening cheap: the list of projects is documents alone, and not one byte of
 * image is fetched until a project is actually opened.
 *
 * THE BUCKET. `korczak-xyz-501720-sloper`, declared in `terraform/storage.tf` and linked to
 * Firebase there too, because the Firebase Storage SDK cannot address a bucket the project has not
 * been told about. `storage.rules` at the repo root is the boundary and it says the same thing
 * `firestore.rules` says about `users/{uid}`: yours, and nobody else's.
 *
 * SIGNED OUT, NOTHING HERE RUNS. Every function returns null or no-ops without a `uid`, and the
 * wizard works exactly as it did before — one sitting, in memory, lost on reload. That is the
 * honest state rather than a degraded one: there is nowhere to put a project that belongs to
 * nobody.
 *
 * WHY UPLOADS DO NOT GO THROUGH `runCloud`. That wrapper exists for Firestore, whose client can
 * die in a way only replacement fixes, and its 25-second deadline is calibrated for a document
 * write. A 30 MB video upload over a phone's uplink is legitimately slower than that, and killing
 * it at 25 seconds would fail the one thing worth saving. Storage has no shared queue to poison,
 * so an upload that hangs costs one promise and not the client.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  setDoc,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';

import { getDb, getStorageClient } from '../../lib/firebase';
import { runCloud } from '../../lib/firestoreHealth';
import { normalizeConfig } from './defaults';
import { isProjectId } from './projectId';
import type {
  Asset,
  AssetStatus,
  AssetType,
  ProjectSettings,
  ProjectSummary,
  Scene,
  SloperConfig,
  SloperProject,
  Stage,
  StoredAsset,
  StoredVideo,
} from './types';

/** How many projects the Open window lists. Far more than anyone will have; a bound all the same. */
export const PROJECT_LIST_LIMIT = 50;

const STAGES: Stage[] = ['config', 'scenes', 'assets', 'assembly', 'output'];
const STATUSES: AssetStatus[] = ['pending', 'generating', 'complete', 'failed'];

function projectsCollection(uid: string) {
  return collection(getDb()!, 'users', uid, 'sloperProjects');
}

function projectDoc(uid: string, id: string) {
  return doc(getDb()!, 'users', uid, 'sloperProjects', id);
}

/**
 * Where an asset's bytes go.
 *
 * `users/{uid}/…` is the first segment for the same reason it is in Firestore: `storage.rules`
 * matches on it, so the path is the authorization. The extension is real rather than decorative —
 * Storage serves the object with a content type derived from the upload, and a browser asked to
 * play an `<audio>` from a URL ending in `.mp3` behaves better than one guessing.
 */
export function assetPath(uid: string, projectId: string, assetId: string, type: AssetType): string {
  return `users/${uid}/sloper/${projectId}/${assetId}.${type === 'image' ? 'jpg' : 'mp3'}`;
}

export function videoPath(uid: string, projectId: string): string {
  return `users/${uid}/sloper/${projectId}/video.mp4`;
}

/* --- writing ------------------------------------------------------------------------------ */

/**
 * Put one blob in the bucket and hand back where it went.
 *
 * Returns null rather than throwing when Storage is switched off or the upload fails, and the
 * caller carries on. THAT IS THE IMPORTANT PART: the asset is already in memory and already paid
 * for, so a failed upload must cost the saved copy and nothing else. What it does cost is honest —
 * `hydrateAssets` turns a complete asset with no path back into a failed one, so reopening the
 * project offers to regenerate it rather than showing a picture that is not there.
 */
export async function putBlob(path: string, blob: Blob): Promise<{ path: string; url: string } | null> {
  const storage = getStorageClient();
  if (!storage) return null;

  const target = ref(storage, path);
  await uploadBytes(target, blob, { cacheControl: 'private, max-age=31536000' });
  return { path, url: await getDownloadURL(target) };
}

/** Strip the keys off a config. The one transformation this module insists on — see types.ts. */
export function projectSettings(config: SloperConfig): ProjectSettings {
  const { apiKeys: _keys, ...rest } = config;
  return rest;
}

/**
 * Write a project down.
 *
 * A whole-document `setDoc`, not a merge. The document is one sitting's state and the browser
 * holding the sitting is the only writer there will ever be, so there is nothing to merge with:
 * a partial write would leave a scene list and an asset list that disagree about how many scenes
 * exist, which is the one inconsistency the assembly step cannot survive.
 */
export async function saveProject(uid: string, project: SloperProject): Promise<void> {
  if (!getDb()) return;
  await runCloud('sloper.project.save', () => setDoc(projectDoc(uid, project.id), project));
}

/* --- reading ------------------------------------------------------------------------------ */

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

function readScenes(raw: unknown): Scene[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object')
    .map((s, index) => ({
      id: str(s.id) || `scene-${index}`,
      index,
      script: str(s.script),
      imageDescription: str(s.imageDescription),
      isEdited: s.isEdited === true,
    }));
}

function readAssets(raw: unknown): StoredAsset[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === 'object')
    .map((a) => ({
      id: str(a.id),
      sceneId: str(a.sceneId),
      type: a.type === 'audio' ? ('audio' as const) : ('image' as const),
      status: STATUSES.includes(a.status as AssetStatus) ? (a.status as AssetStatus) : 'pending',
      path: typeof a.path === 'string' ? a.path : null,
      url: typeof a.url === 'string' ? a.url : null,
      duration: typeof a.duration === 'number' ? a.duration : null,
      error: typeof a.error === 'string' ? a.error : null,
    }))
    .filter((a) => a.id && a.sceneId);
}

function readTimings(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

function readVideo(raw: unknown): StoredVideo | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.path !== 'string' || typeof v.url !== 'string') return null;
  return { path: v.path, url: v.url, bytes: num(v.bytes), duration: num(v.duration) };
}

/**
 * A stored document, made safe to render.
 *
 * Every field is re-read defensively rather than cast, and the reason is the same one
 * `metadata.ts` gives in the function: these numbers become `ffmpeg` arguments by way of the
 * assembly step, and a document edited by hand in the Firestore console — the only other writer
 * this collection will ever have — is not obliged to be well-formed.
 */
export function readProject(id: string, raw: Record<string, unknown>): SloperProject {
  const settings = raw.settings && typeof raw.settings === 'object'
    ? projectSettings(normalizeConfig(raw.settings))
    : null;

  return {
    id,
    name: str(raw.name, id),
    createdAt: num(raw.createdAt),
    updatedAt: num(raw.updatedAt),
    stage: STAGES.includes(raw.stage as Stage) ? (raw.stage as Stage) : 'config',
    prompt: str(raw.prompt),
    scenes: readScenes(raw.scenes),
    assets: readAssets(raw.assets),
    timings: readTimings(raw.timings),
    video: readVideo(raw.video),
    settings,
  };
}

/** One project, or null when there is no such document (or no account, or no Firebase). */
export async function loadProject(uid: string, id: string): Promise<SloperProject | null> {
  if (!getDb() || !isProjectId(id)) return null;

  const snap = await runCloud('sloper.project.load', () => getDoc(projectDoc(uid, id)));
  if (!snap.exists()) return null;
  return readProject(id, snap.data() as Record<string, unknown>);
}

/**
 * What the Open window lists, newest first.
 *
 * Ordered on `updatedAt` rather than `createdAt`: the project you want back is the one you were
 * last working on, which is not always the one you started last. A single-field `orderBy` on a
 * collection needs no composite index, so nothing had to go into `firestore.indexes.json`.
 */
export async function listProjects(uid: string): Promise<ProjectSummary[]> {
  if (!getDb()) return [];

  const snap = await runCloud('sloper.project.list', () =>
    getDocs(query(projectsCollection(uid), orderBy('updatedAt', 'desc'), fsLimit(PROJECT_LIST_LIMIT))),
  );

  return snap.docs.map((d) => {
    const project = readProject(d.id, d.data() as Record<string, unknown>);
    return {
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      stage: project.stage,
      prompt: project.prompt,
      scenes: project.scenes.length,
      hasVideo: project.video !== null,
    };
  });
}

/* --- turning one back into a sitting -------------------------------------------------------- */

/**
 * Stored rows back into the run's assets.
 *
 * `data` stays null — the bytes are not fetched here, because the assets screen only needs
 * something an `<img>` and an `<audio>` can point at and a download URL is exactly that. The
 * blobs come back one at a time, and only when the assembler asks for them; see `blobForAsset`.
 *
 * A row that says "complete" with no path is demoted to "failed". It means the upload did not
 * land — the sitting had it, this reopening does not — and the honest state is the one where the
 * Retry button is on screen rather than an image element pointed at nothing.
 */
export function hydrateAssets(stored: StoredAsset[], notSavedMessage: string): Map<string, Asset> {
  const assets = new Map<string, Asset>();

  for (const row of stored) {
    const missing = row.status === 'complete' && !row.url;
    assets.set(row.id, {
      id: row.id,
      sceneId: row.sceneId,
      type: row.type,
      status: missing ? 'failed' : row.status,
      data: null,
      dataUrl: row.url,
      path: row.path,
      remoteUrl: row.url,
      duration: row.duration,
      error: missing ? notSavedMessage : row.error,
    });
  }

  return assets;
}

/**
 * The bytes behind an asset, wherever they happen to be.
 *
 * During a run `data` is already the blob the provider returned and this is a no-op. On a reopened
 * sitting it is null and `dataUrl` is a Storage download URL, so the blob is fetched back — which
 * is the whole reason the assembly step can finish a project started on another device.
 */
export async function blobForAsset(asset: Asset): Promise<Blob | null> {
  if (asset.data) return asset.data;
  if (!asset.dataUrl) return null;

  /*
   * A refusal and a failure are different answers and the caller wants them told apart.
   *
   * `!response.ok` is the bucket saying no to a request it heard — a deleted object, an expired
   * token — and null is right, because `startAssembly` skips that scene and carries on. A `fetch`
   * that *throws* never reached anybody: no network, or the browser refusing to let the page read
   * a response it did download. Returning null for that reports every scene as missing its
   * assets, and the assembly step then says there is nothing to assemble — which is a sentence
   * about the project rather than about the network, and sends the reader to look at the wrong
   * thing entirely.
   *
   * So it is rethrown, and it is rethrown wearing a sentence that says which of this app's two
   * halves failed. The bare message is worth keeping in front of: a cross-origin read the bucket
   * has not allowed reaches Safari as `TypeError: Load failed` and nothing else, which is how the
   * missing `cors` block in terraform/storage.tf (see the comment there) came to present as a
   * video that would not assemble with no clue anywhere as to why.
   */
  let response: Response;
  try {
    response = await fetch(asset.dataUrl);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read a saved ${asset.type} back out of your account (${reason}).`);
  }

  if (!response.ok) return null;
  return response.blob();
}
