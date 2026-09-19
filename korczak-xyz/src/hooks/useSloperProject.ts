/*
 * The open project: which one it is, where its id lives, and when it gets written down.
 *
 * This is the half of autosave that is not the wizard. `useSloperRun` knows what a sitting
 * currently *is*; this knows where to put it and how often. Keeping them apart is what stops the
 * run hook growing a Firestore dependency in every callback — it is handed `putAsset` and `save`
 * and never learns what a document is.
 *
 * THE ID IS IN THE ADDRESS BAR, AND THAT IS THE FEATURE. `?p=Kx3_pQ2mTaV` is what makes a sitting
 * a thing you can come back to: close the tab, reopen the bookmark, and the same project loads. It
 * is written with `replaceState` rather than `pushState` on purpose — minting a project is not a
 * navigation, and a Back button that steps between stages of the same wizard is exactly the
 * behaviour the single-island design exists to prevent. `.claude/rules/sloper.md` has the full
 * argument; the short version is that a real navigation here used to throw the run away, and while
 * that is no longer true for a signed-in account it is still true signed out.
 *
 * WHEN A PROJECT IS MINTED. On leaving the settings step, not on load. A project minted on load
 * would put a row in the list for every idle visit to the page, and the list is meant to be the
 * things you made rather than the times you looked.
 *
 * SAVING IS DEBOUNCED AND DEDUPED, IN THAT ORDER. Editing a scene's script is a keystroke at a
 * time and a write per keystroke is both a bill and a rate limit; 1.2 seconds of quiet is a pause
 * between words. The dedupe matters more than the delay though: the save effect that calls this
 * runs on every render of the island, and without comparing the serialized snapshot every
 * re-render would re-arm the timer and a fast typist would never reach quiet.
 *
 * WHAT A PENDING WRITE COSTS IF THE TAB CLOSES. One debounce window. `pagehide` flushes, which
 * covers the ordinary close, the navigation away and the iOS app switch; a crash loses up to
 * 1.2 seconds of typing and nothing else, because every expensive thing — a picture, a narration,
 * the video — is written the moment it exists rather than on the timer.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { describeError, log } from '../lib/logger';
import { getStorageClient } from '../lib/firebase';
import { startAssemblyJob } from '../utils/sloper/assemble';
import {
  assetObjectPath,
  buildAssemblyJob,
  videoObjectPath,
  type AssemblyJob,
  type AssemblyJobScene,
} from '../utils/sloper/job';
import { newProjectId, newProjectName, PROJECT_PARAM, isProjectId } from '../utils/sloper/projectId';
import {
  deleteJob,
  listProjects,
  loadJob,
  loadProject,
  putBlob,
  saveJob,
  saveProject,
} from '../utils/sloper/projects';
import type {
  AssetType,
  ProjectSettings,
  ProjectSummary,
  Scene,
  SloperProject,
  Stage,
  StoredAsset,
  StoredVideo,
} from '../utils/sloper/types';
import type { AuthUser } from './useAuth';

/** How long the wizard has to go quiet before a write is sent. */
const SAVE_DEBOUNCE_MS = 1200;

/** Everything about a sitting that is small enough to be a document. */
export interface ProjectSnapshot {
  stage: Stage;
  prompt: string;
  scenes: Scene[];
  assets: StoredAsset[];
  timings: Record<string, number>;
  video: StoredVideo | null;
  settings: ProjectSettings | null;
}

export type ProjectState = 'off' | 'idle' | 'loading' | 'saving' | 'saved' | 'error';

export interface SloperProjectApi {
  /** True when there is an account and a bucket — i.e. when any of this can happen at all. */
  enabled: boolean;
  id: string | null;
  name: string | null;
  createdAt: number;
  state: ProjectState;
  /**
   * The project named by `?p=`, once it has been fetched. The run hook consumes it exactly once;
   * `takeOpened` is how it says so.
   */
  opened: SloperProject | null;
  takeOpened: () => void;
  /** Whether `?p=` named something that is not there (deleted, or another account's). */
  missing: boolean;

  begin: () => void;
  open: (id: string) => void;
  close: () => void;
  save: (snapshot: ProjectSnapshot) => void;
  putAsset: (assetId: string, type: AssetType, blob: Blob) => Promise<{ path: string; url: string } | null>;
  putVideo: (blob: Blob, duration: number) => Promise<StoredVideo | null>;
  list: () => Promise<ProjectSummary[]>;

  /*
   * The assembly, once it stopped being something this page has to sit through.
   *
   * `queueAssembly` writes the job down and pokes the assembler; `readAssembly` is how the wizard
   * finds out how it is going, on a timer while the page is open and once more whenever a project
   * is opened; `nudgeAssembly` is the poke on its own, for a job found queued or abandoned on a
   * reopening. `dropAssembly` is the undo — it is what the fallback to the in-page assembler uses
   * so that a job nobody is going to run cannot be picked up tomorrow and encode a second copy.
   */
  queueAssembly: (
    scenes: AssemblyJobScene[],
    resolution: { width: number; height: number },
    frameRate: number,
  ) => Promise<AssemblyJob>;
  readAssembly: () => Promise<AssemblyJob | null>;
  nudgeAssembly: () => void;
  dropAssembly: () => Promise<void>;
}

/** The id in the address bar right now, if it is one of ours. */
function idFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const value = new URL(window.location.href).searchParams.get(PROJECT_PARAM);
  return isProjectId(value) ? value : null;
}

/**
 * Put the id in the address bar, or take it out.
 *
 * `replaceState` throws on a `file:` origin and in a few embedded webviews, and the app is
 * perfectly usable without a shareable URL — so a failure here is swallowed rather than allowed to
 * take down the save that prompted it.
 */
function writeUrl(id: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set(PROJECT_PARAM, id);
    else url.searchParams.delete(PROJECT_PARAM);
    window.history.replaceState(window.history.state, '', url.toString());
  } catch {
    // An address bar that cannot be written is cosmetic. Everything else still works.
  }
}

export function useSloperProject(user: AuthUser | null): SloperProjectApi {
  const uid = user?.uid ?? null;
  const enabled = Boolean(uid) && getStorageClient() !== null;

  const [id, setId] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState(0);
  const [state, setState] = useState<ProjectState>('off');
  const [opened, setOpened] = useState<SloperProject | null>(null);
  const [missing, setMissing] = useState(false);

  // Read from callbacks that must not be re-created on every save.
  const idRef = useRef<string | null>(null);
  const nameRef = useRef<string | null>(null);
  const createdAtRef = useRef(0);
  const uidRef = useRef<string | null>(null);
  const lastSerializedRef = useRef<string | null>(null);
  /*
   * The pending write is kept as JSON rather than as the snapshot object, and that is load-bearing
   * twice over. It is the same string the dedupe compares, so what is written is exactly what was
   * judged to have changed — and `JSON.stringify` drops `undefined` on the way through, which
   * Firestore refuses outright. `config.image.aspectRatio` is genuinely `undefined` whenever the
   * "from the video size" option is picked, so without this every save on a Google-image project
   * throws.
   */
  const pendingRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  uidRef.current = uid;

  const setProject = useCallback((next: string | null, label: string | null, born: number) => {
    idRef.current = next;
    nameRef.current = label;
    createdAtRef.current = born;
    setId(next);
    setName(label);
    setCreatedAt(born);
    lastSerializedRef.current = null;
    writeUrl(next);
  }, []);

  /* --- the one write ---------------------------------------------------------------------- */

  const flush = useCallback(async () => {
    const serialized = pendingRef.current;
    const projectId = idRef.current;
    const owner = uidRef.current;
    pendingRef.current = null;
    if (!serialized || !projectId || !owner) return;

    const snapshot = JSON.parse(serialized) as ProjectSnapshot;

    const now = Date.now();
    setState('saving');
    try {
      await saveProject(owner, {
        id: projectId,
        name: nameRef.current ?? projectId,
        createdAt: createdAtRef.current || now,
        updatedAt: now,
        ...snapshot,
      });
      setState('saved');
    } catch (e) {
      // Not fatal and deliberately not surfaced as a run error: the sitting is intact in memory
      // and every provider call still works. The badge says the account did not get this one, and
      // the next edit tries again.
      log.warn('sloper.project.save.failed', describeError(e));
      lastSerializedRef.current = null;
      setState('error');
    }
  }, []);

  const save = useCallback(
    (snapshot: ProjectSnapshot) => {
      if (!idRef.current || !uidRef.current) return;

      const serialized = JSON.stringify(snapshot);
      if (serialized === lastSerializedRef.current) return;
      lastSerializedRef.current = serialized;

      pendingRef.current = serialized;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  // A close, a navigation away, or the iOS app switcher. `pagehide` rather than `beforeunload`:
  // it is the one that fires on mobile Safari, where a page is frozen rather than unloaded.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const leave = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      void flush();
    };
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('pagehide', leave);
      leave();
    };
  }, [flush]);

  /* --- opening ---------------------------------------------------------------------------- */

  const fetchProject = useCallback(
    async (owner: string, projectId: string) => {
      setState('loading');
      setMissing(false);
      try {
        const project = await loadProject(owner, projectId);
        if (!project) {
          // The id in the URL names nothing this account can see. Say so and drop it, rather than
          // leaving an address bar that promises a project which will never arrive.
          setMissing(true);
          setProject(null, null, 0);
          setState('idle');
          return;
        }
        idRef.current = project.id;
        nameRef.current = project.name;
        createdAtRef.current = project.createdAt;
        setId(project.id);
        setName(project.name);
        setCreatedAt(project.createdAt);
        lastSerializedRef.current = null;
        writeUrl(project.id);
        setOpened(project);
        setState('saved');
      } catch (e) {
        log.warn('sloper.project.load.failed', describeError(e));
        setState('error');
      }
    },
    [setProject],
  );

  // On sign-in, pick up whatever the address bar was pointing at. Signed out there is nowhere to
  // read from, so the id is left in the URL untouched — signing in then opens it.
  useEffect(() => {
    if (!enabled || !uid) {
      setState('off');
      return;
    }
    if (idRef.current) {
      setState('saved');
      return;
    }
    const fromUrl = idFromUrl();
    if (!fromUrl) {
      setState('idle');
      return;
    }
    void fetchProject(uid, fromUrl);
  }, [enabled, fetchProject, uid]);

  const begin = useCallback(() => {
    if (!enabled || idRef.current) return;
    setProject(newProjectId(), newProjectName(), Date.now());
    setState('idle');
  }, [enabled, setProject]);

  const open = useCallback(
    (next: string) => {
      const owner = uidRef.current;
      if (!owner || !isProjectId(next)) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      pendingRef.current = null;
      setProject(null, null, 0);
      void fetchProject(owner, next);
    },
    [fetchProject, setProject],
  );

  const close = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    pendingRef.current = null;
    setOpened(null);
    setMissing(false);
    setProject(null, null, 0);
    setState(enabled ? 'idle' : 'off');
  }, [enabled, setProject]);

  const takeOpened = useCallback(() => setOpened(null), []);

  /* --- the bytes -------------------------------------------------------------------------- */

  /*
   * Uploads are fire-and-forget from the caller's point of view: a rejection is logged and null
   * comes back, and the run carries on with the asset it already has in memory. The reason is in
   * projects.ts — the asset is paid for, so a bucket that will not take it must cost the saved
   * copy and nothing more.
   */
  const putAsset = useCallback(async (assetId: string, type: AssetType, blob: Blob) => {
    const owner = uidRef.current;
    const projectId = idRef.current;
    if (!owner || !projectId) return null;

    try {
      return await putBlob(assetObjectPath(owner, projectId, assetId, type), blob);
    } catch (e) {
      log.warn('sloper.asset.upload.failed', { ...describeError(e), type });
      return null;
    }
  }, []);

  const putVideo = useCallback(async (blob: Blob, duration: number) => {
    const owner = uidRef.current;
    const projectId = idRef.current;
    if (!owner || !projectId) return null;

    try {
      const saved = await putBlob(videoObjectPath(owner, projectId), blob);
      if (!saved) return null;
      return { ...saved, bytes: blob.size, duration };
    } catch (e) {
      log.warn('sloper.video.upload.failed', describeError(e));
      return null;
    }
  }, []);

  const list = useCallback(async () => {
    const owner = uidRef.current;
    if (!owner) return [];
    return listProjects(owner);
  }, []);

  /* --- the assembly ----------------------------------------------------------------------- */

  /**
   * Poke the assembler about the open project.
   *
   * Deliberately not awaited and deliberately not surfaced. The request settles when the encode
   * finishes — minutes — so awaiting it here would be exactly the wait this whole feature exists
   * to remove; and a rejection means the poke did not land, which the job document says better,
   * from anywhere, at any later time. Whether the assembly actually started is read off that
   * document and nothing else.
   */
  const poke = useCallback((projectId: string) => {
    void startAssemblyJob(projectId).catch((e) => {
      log.warn('sloper.job.poke.failed', describeError(e));
    });
  }, []);

  const queueAssembly = useCallback(
    async (
      scenes: AssemblyJobScene[],
      resolution: { width: number; height: number },
      frameRate: number,
    ) => {
      const owner = uidRef.current;
      const projectId = idRef.current;
      if (!owner || !projectId) throw new Error('There is no open project to assemble.');

      /*
       * The pending write goes first, and it is not tidiness. The assembler is about to put a
       * video beside this document, and everything else on the sitting — the scene list the video
       * was built from, where the wizard had got to — is sitting in a 1.2-second debounce. A page
       * closed a moment after pressing Assemble would otherwise come back to a finished video
       * beside a project one edit out of date.
       */
      if (timerRef.current) clearTimeout(timerRef.current);
      await flush();

      const job = buildAssemblyJob({ projectId, scenes, resolution, frameRate, now: Date.now() });
      await saveJob(owner, job);
      poke(projectId);
      return job;
    },
    [flush, poke],
  );

  const readAssembly = useCallback(async () => {
    const owner = uidRef.current;
    const projectId = idRef.current;
    if (!owner || !projectId) return null;
    return loadJob(owner, projectId);
  }, []);

  const nudgeAssembly = useCallback(() => {
    const projectId = idRef.current;
    if (projectId) poke(projectId);
  }, [poke]);

  const dropAssembly = useCallback(async () => {
    const owner = uidRef.current;
    const projectId = idRef.current;
    if (!owner || !projectId) return;
    await deleteJob(owner, projectId);
  }, []);

  return {
    enabled,
    id,
    name,
    createdAt,
    state,
    opened,
    takeOpened,
    missing,
    begin,
    open,
    close,
    save,
    putAsset,
    putVideo,
    list,
    queueAssembly,
    readAssembly,
    nudgeAssembly,
    dropAssembly,
  };
}
