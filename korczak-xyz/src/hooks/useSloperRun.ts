/*
 * One sitting, from a topic to an MP4.
 *
 * sloper had four React contexts for this (`Scene`, `Asset`, `Workflow`, plus `Config`) and a
 * router deriving the stage from the URL. There is one hook here and no router, and the second
 * half of that is still forced even now that sittings are saved: a genuine navigation between
 * stages would tear down the island mid-generation, cancelling requests that have already been
 * paid for, and no amount of Firestore brings a half-drawn picture back. A stage is therefore a
 * value in this hook, the back links move it, and `/apps/sloper/` is one page.
 *
 * WHAT IS PERSISTED AND WHAT IS NOT. Everything with a cost is written down as soon as it exists:
 * a picture and a narration go to Cloud Storage the moment the provider hands them over, and the
 * scene list, the stage and one row per asset go to Firestore on a short debounce. What is not
 * persisted is anything a reload can rebuild for free — the abort controller, the in-flight flags,
 * the streaming buffer. So an interrupted run reopens where it got to with everything it bought,
 * and a run interrupted *mid-request* loses exactly the one request that was in the air.
 *
 * Saving is somebody else's job: `useSloperProject` owns the id, the address bar and the write.
 * This hook is handed `putAsset` and reports what it holds; it never learns what a document is.
 *
 * Everything that talks to a provider is cancellable through one `AbortController`, replaced at
 * the start of each run and fired by `reset`. Without it, pressing Start Over during a twelve-scene
 * generation leaves twelve image requests in flight, each of which lands, costs money, and writes
 * into state for a sitting that no longer exists.
 *
 * Assets are a `Map` keyed by asset id, as they were in sloper. The scene id is not the key
 * because a scene has two of them.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { describeError, log } from '../lib/logger';
import { assembleVideo } from '../utils/sloper/assemble';
import {
  deriveAspectRatio,
  generateGoogleImage,
  generateImage,
  imageLimiter,
  processImage,
} from '../utils/sloper/images';
import {
  calculateCost,
  parseSceneBuffer,
  sceneSystemPrompt,
  streamLLM,
  targetWords,
} from '../utils/sloper/llm';
import {
  jobIsLive,
  jobIsStale,
  jobNeedsStarting,
  type AssemblyJob,
  type AssemblyJobScene,
} from '../utils/sloper/job';
import { blobForAsset, hydrateAssets } from '../utils/sloper/projects';
import { createTtsLimiter, generateTtsAudio } from '../utils/sloper/tts';
import type {
  Asset,
  AssetStatus,
  AssetType,
  AudioTiming,
  Scene,
  SloperConfig,
  SloperProject,
  Stage,
  StoredAsset,
  StoredVideo,
  TokenUsage,
} from '../utils/sloper/types';
import type { SloperProjectApi } from './useSloperProject';

/**
 * `uploading` is the bytes going up; `encoding` is ffmpeg having the files. Before the answer was
 * streamed there was no way to tell those apart, so the screen said "sending 3.3 MB" for the whole
 * minute the encode took — a stalled upload and a working one looked identical, and the one that
 * was working was the one that looked broken.
 *
 * `queued` belongs to the background route and to nothing else: the job is written down in the
 * account and the assembler has not picked it up yet. It is a real state rather than a flicker,
 * because a cold instance is several seconds and because it is the state a project reopened after
 * a failed poke comes back in.
 */
export type AssemblyPhase =
  | 'idle'
  | 'preparing'
  | 'uploading'
  | 'queued'
  | 'encoding'
  | 'done'
  | 'error';

/** How often the wait screen asks the account how the assembly is going. */
const JOB_POLL_MS = 4000;

/**
 * How long a job may sit unclaimed before the page stops believing in it.
 *
 * Generous, because it is a cold start of a 2 GiB instance with ffmpeg in it and the cost of being
 * wrong is encoding the same video twice. What happens at the end of it is the fallback to the
 * in-page assembler, which is also what a page that shipped minutes before the function does —
 * an older `assembleVideo` has never heard of a job and answers the poke with a 400.
 */
const JOB_START_DEADLINE_MS = 30_000;

export interface SloperRun {
  stage: Stage;
  goTo: (stage: Stage) => void;

  /** The topic. Lifted out of ScenesStage so that it can be written down and read back. */
  prompt: string;
  setPrompt: (value: string) => void;

  scenes: Scene[];
  streaming: boolean;
  tokenUsage: TokenUsage | null;
  estimatedCost: number | null;
  generateScenes: (config: SloperConfig, prompt: string) => Promise<void>;
  stopStreaming: () => void;
  addScene: () => void;
  updateScene: (id: string, patch: Partial<Omit<Scene, 'id' | 'index'>>) => void;
  removeScene: (id: string) => void;
  clearScenes: () => void;

  assets: Map<string, Asset>;
  timings: Map<string, AudioTiming>;
  assetsFor: (sceneId: string) => { image?: Asset; audio?: Asset };
  generatingAssets: boolean;
  startAssets: (config: SloperConfig) => void;
  retryAsset: (config: SloperConfig, assetId: string) => Promise<void>;

  assembly: AssemblyPhase;
  /**
   * Whether the wait on screen is one the page may walk away from.
   *
   * True while the assembler is working from the job document in the account — the ordinary case
   * for a signed-in sitting. False when the encode is this page's own request, which is what a
   * sitting with nowhere to save its assets falls back to. The wait screen says a different thing
   * in each case, and so does the unload warning, because leaving costs nothing in one and an
   * encode in the other.
   */
  assemblyBackground: boolean;
  uploadMB: string | null;
  video: Blob | null;
  videoMeta: StoredVideo | null;
  startAssembly: (config: SloperConfig) => Promise<void>;

  /** True while a reopened project's video is being fetched back out of the bucket. */
  restoring: boolean;

  /** The sitting as rows, for the autosave effect in Sloper.tsx. */
  storedAssets: StoredAsset[];
  storedTimings: Record<string, number>;

  error: string | null;
  dismissError: () => void;
  reset: () => void;
  /** True whenever something irreversible-if-abandoned is in flight. Drives the unload warning. */
  busy: boolean;
}

const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}-${Date.now()}`;

function makeAsset(sceneId: string, type: AssetType): Asset {
  return {
    id: newId(),
    sceneId,
    type,
    status: 'pending',
    data: null,
    dataUrl: null,
    path: null,
    remoteUrl: null,
    duration: null,
    error: null,
  };
}

export function useSloperRun(project: SloperProjectApi, notSavedMessage: string): SloperRun {
  const [stage, setStage] = useState<Stage>('config');
  const [prompt, setPrompt] = useState('');

  const [scenes, setScenes] = useState<Scene[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [tokenUsage, setTokenUsage] = useState<TokenUsage | null>(null);
  const [estimatedCost, setEstimatedCost] = useState<number | null>(null);

  const [assets, setAssets] = useState<Map<string, Asset>>(() => new Map());
  const [timings, setTimings] = useState<Map<string, AudioTiming>>(() => new Map());
  const [generatingAssets, setGeneratingAssets] = useState(false);

  const [assembly, setAssembly] = useState<AssemblyPhase>('idle');
  const [assemblyBackground, setAssemblyBackground] = useState(false);
  const [uploadMB, setUploadMB] = useState<string | null>(null);
  const [video, setVideo] = useState<Blob | null>(null);
  const [videoMeta, setVideoMeta] = useState<StoredVideo | null>(null);
  const [restoring, setRestoring] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scenesRef = useRef<Scene[]>([]);
  const assetsRef = useRef<Map<string, Asset>>(new Map());

  /** True while the job document is being polled. The effect below is the whole of the watching. */
  const [watchingJob, setWatchingJob] = useState(false);
  /*
   * The same flag, readable synchronously.
   *
   * A tick already in flight when the watching stops is the one hazard in the poll: the fallback
   * deletes the job and starts an encode in this page, and a tick landing a moment later would
   * find no job at all and send the wizard back to the assets screen on top of it. State is not
   * visible until the next render; a ref is, so the ref is what a tick checks itself against.
   */
  const watchingRef = useRef(false);
  /** When to stop believing in a job nobody has claimed. See `JOB_START_DEADLINE_MS`. */
  const startDeadlineRef = useRef(0);
  /*
   * The settings the current assembly was asked for with.
   *
   * The poll runs on a timer rather than out of a callback, so when it decides to fall back to the
   * in-page assembler there is no `config` in scope — and taking the live one would assemble at
   * whatever the settings have since been changed to, which is the same fault opening an old
   * project used to have.
   */
  const assemblyConfigRef = useRef<SloperConfig | null>(null);

  const watchJob = useCallback((on: boolean) => {
    watchingRef.current = on;
    setWatchingJob(on);
  }, []);

  useEffect(() => {
    scenesRef.current = scenes;
  }, [scenes]);
  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  // A sitting is saved now, but an in-flight request is not: leaving must not leave twelve image
  // generations running against a page that has gone.
  useEffect(() => () => abortRef.current?.abort(), []);

  const freshSignal = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    return controller.signal;
  }, []);

  const goTo = useCallback((next: Stage) => {
    setStage(next);
    // The window scrolls because the stages are different lengths and stepping back from a
    // twelve-scene list to the settings otherwise lands halfway down a screen of inputs.
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const patchAsset = useCallback((assetId: string, patch: Partial<Asset>) => {
    setAssets((prev) => {
      const asset = prev.get(assetId);
      if (!asset) return prev;
      const next = new Map(prev);
      next.set(assetId, { ...asset, ...patch });
      return next;
    });
  }, []);

  /*
   * The project hook's own callbacks, taken once.
   *
   * Every one of these is a `useCallback` with no dependencies over there, so they are stable for
   * the life of the island where `project` itself is a fresh object on every render. Reaching
   * through the object would make each of the callbacks below churn with it — which costs nothing
   * for a click handler and a great deal for the two things here that live in effects: the poll
   * would restart on every keystroke, and the hydrate effect would re-run on every render.
   */
  const {
    dropAssembly,
    nudgeAssembly,
    putAsset,
    putVideo,
    queueAssembly,
    readAssembly,
  } = project;

  /** A finished video, fetched back out of the account and put on the output stage. */
  const showSavedVideo = useCallback(
    async (meta: StoredVideo) => {
      setVideoMeta(meta);
      setAssembly('done');
      setError(null);
      goTo('output');

      setRestoring(true);
      try {
        const response = await fetch(meta.url);
        if (response.ok) {
          setVideo(await response.blob());
          return;
        }
        // The row says there is a video and the bucket will not give it back. The output stage
        // renders nothing without a blob, so staying there would be a blank screen with no way
        // off it — the assets are all still there, and assembling again is the way out.
        log.warn('sloper.video.fetch.refused', { status: response.status });
      } catch (e) {
        log.warn('sloper.video.fetch.failed', describeError(e));
      } finally {
        setRestoring(false);
      }

      setAssembly('idle');
      goTo('assets');
    },
    [goTo],
  );

  /* --- coming back to one ------------------------------------------------------------------ */

  /**
   * A stored project, back into a sitting.
   *
   * Two things are deliberately not restored as written.
   *
   * The **assembly stage is not resumed into by the stored stage**, which used to be the whole
   * rule and is now half of it. A project saved while the video was going up has no video, and
   * landing there off the document alone would re-run the upload — tens of megabytes — before
   * anybody had asked. It lands on the assets screen instead, where the button to assemble is the
   * next thing on the page.
   *
   * What DOES land there is a project whose **job is still running**, and that is the opposite
   * case rather than an exception to this one: nothing is re-sent, nothing is paid for twice, and
   * the screen is a progress report on work that has been going on without this page. The stage
   * is reached from the job document, never from the stored stage — see below.
   *
   * The **video is fetched eagerly**, and only here. It is the finished article and the reason to
   * reopen a project at all; the pictures and narrations are not fetched, because a download URL
   * is all an `<img>` or an `<audio>` needs and the bytes are wanted only by the assembler.
   */
  const hydrate = useCallback(
    async (saved: SloperProject) => {
      abortRef.current?.abort();
      abortRef.current = null;

      const restored = hydrateAssets(saved.assets, notSavedMessage);

      setScenes(saved.scenes);
      setPrompt(saved.prompt);
      setAssets(restored);
      setTimings(
        new Map(
          Object.entries(saved.timings).map(([assetId, totalDuration]) => [
            assetId,
            { assetId, words: [], totalDuration },
          ]),
        ),
      );
      setTokenUsage(null);
      setEstimatedCost(null);
      setStreaming(false);
      setGeneratingAssets(false);
      setUploadMB(null);
      setError(null);
      setVideo(null);
      setVideoMeta(saved.video);
      watchJob(false);
      setAssemblyBackground(false);
      setAssembly(saved.video ? 'done' : 'idle');

      const landing: Stage =
        saved.video ? 'output' : saved.stage === 'assembly' || saved.stage === 'output' ? 'assets' : saved.stage;
      goTo(landing);

      if (saved.video) {
        await showSavedVideo(saved.video);
        return;
      }

      /*
       * NO VIDEO IN THE DOCUMENT IS NOT THE SAME AS NO VIDEO. An assembly started before this page
       * existed may have finished since, may still be running, or may have died holding the claim
       * — and all three are things this account knows and this document does not. So the job is
       * read once on the way in, and it is the answer for all of them.
       *
       * A finished job whose video never reached the project document is the ordinary case rather
       * than a repair: the assembler writes the video into both, and a browser autosave that was
       * in flight at that moment overwrites the project's copy with the null it was holding. The
       * job's copy is the one that cannot be raced, so it is the one read here — and adopting it
       * makes this page's next save put it back where the Open window looks for it.
       */
      const job = await readAssembly().catch((e) => {
        log.warn('sloper.job.load.failed', describeError(e));
        return null;
      });
      if (!job) return;

      const now = Date.now();

      if (job.status === 'done' && job.video) {
        await showSavedVideo(job.video);
        return;
      }

      if (jobIsLive(job, now)) {
        setAssemblyBackground(true);
        setAssembly(job.status === 'running' ? 'encoding' : 'queued');
        startDeadlineRef.current = now + JOB_START_DEADLINE_MS;
        // A job still sitting at `queued` means the poke never landed — the page that asked for
        // it was closed before the request went out, or the assembler was busy refusing it. This
        // is the recovery, and it is the only one there is: no queue, no sweeper, just the page
        // that has come back to look asking again.
        if (jobNeedsStarting(job, now)) nudgeAssembly();
        watchJob(true);
        goTo('assembly');
        return;
      }

      if (job.status === 'error' || jobIsStale(job, now)) {
        // Said on the assets screen rather than on the wait screen: what is wanted here is the
        // Assemble button with a sentence above it, not a spinner for an encode that is over.
        setError(job.error || 'The assembler did not finish this video. Try again.');
      }
    },
    [goTo, notSavedMessage, nudgeAssembly, readAssembly, showSavedVideo, watchJob],
  );

  // `useSloperProject` fetches, this consumes — once, which is what `takeOpened` marks.
  const opened = project.opened;
  const takeOpened = project.takeOpened;
  useEffect(() => {
    if (!opened) return;
    takeOpened();
    void hydrate(opened);
  }, [hydrate, opened, takeOpened]);

  /* --- the script -------------------------------------------------------------------------- */

  const generateScenes = useCallback(
    async (config: SloperConfig, topic: string) => {
      if (!topic.trim()) return;

      const signal = freshSignal();
      setScenes([]);
      setAssets(new Map());
      setTimings(new Map());
      setTokenUsage(null);
      setEstimatedCost(null);
      setError(null);
      setStreaming(true);

      const apiKey =
        (config.llm.provider === 'openai' ? config.apiKeys.openai : config.apiKeys.deepseek) ?? '';

      let buffer = '';
      let parsedCount = 0;

      // Everything the stream has produced so far, rebuilt on each chunk. `parseSceneBuffer`
      // re-reads the whole buffer, so only the tail past `parsedCount` is new.
      const takeNewScenes = () => {
        const { scenes: parsed } = parseSceneBuffer(buffer);
        if (parsed.length <= parsedCount) return;

        const added: Scene[] = parsed.slice(parsedCount).map((raw, i) => ({
          id: newId(),
          index: parsedCount + i,
          script: raw.script,
          imageDescription: raw.image_description,
          isEdited: false,
        }));
        parsedCount = parsed.length;
        setScenes((prev) => [...prev, ...added]);
      };

      try {
        const stream = streamLLM(
          config.llm.provider,
          apiKey,
          config.llm.model,
          sceneSystemPrompt(config.video.numScenes, targetWords(config.video.targetDuration)),
          topic,
          config.temperature,
          signal,
        );

        for await (const chunk of stream) {
          if (signal.aborted) break;

          if (chunk.content) {
            buffer += chunk.content;
            takeNewScenes();
          }
          if (chunk.usage) {
            setTokenUsage(chunk.usage);
            setEstimatedCost(calculateCost(config.llm.model, chunk.usage));
          }
          if (chunk.done) break;
        }

        // The last object often closes in the same chunk as `[DONE]`, or after the loop breaks.
        takeNewScenes();

        if (parsedCount === 0 && !signal.aborted) {
          setError(
            'The model answered, but not with the JSON array of scenes it was asked for. Try again, or lower the temperature.',
          );
        }
      } catch (e) {
        if (!signal.aborted) {
          log.warn('sloper.scenes.failed', describeError(e));
          setError(e instanceof Error ? e.message : 'Generating the scenes failed.');
        }
      } finally {
        setStreaming(false);
      }
    },
    [freshSignal],
  );

  /**
   * Stop reading the stream, keeping whatever it has already produced.
   *
   * Aborting the fetch is what ends it — the `for await` loop is blocked on the reader, so a flag
   * alone would not return until the next chunk arrived, which for a wedged connection is never.
   * The scenes parsed so far stay: they are complete objects and are usually the reason somebody
   * pressed Stop.
   */
  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  }, []);

  /** Re-number after an add or a remove: the index is shown, and it orders the assembly. */
  const reindex = (list: Scene[]): Scene[] => list.map((scene, index) => ({ ...scene, index }));

  const addScene = useCallback(() => {
    setScenes((prev) =>
      reindex([
        ...prev,
        {
          id: newId(),
          index: prev.length,
          script: '',
          imageDescription: '',
          isEdited: true,
        },
      ]),
    );
  }, []);

  const updateScene = useCallback(
    (id: string, patch: Partial<Omit<Scene, 'id' | 'index'>>) => {
      setScenes((prev) =>
        prev.map((scene) => (scene.id === id ? { ...scene, ...patch, isEdited: true } : scene)),
      );
    },
    [],
  );

  const removeScene = useCallback((id: string) => {
    setScenes((prev) => reindex(prev.filter((scene) => scene.id !== id)));
  }, []);

  const clearScenes = useCallback(() => {
    setScenes([]);
    setTokenUsage(null);
    setEstimatedCost(null);
  }, []);

  /* --- the assets -------------------------------------------------------------------------- */

  const assetsFor = useCallback(
    (sceneId: string) => {
      const found: { image?: Asset; audio?: Asset } = {};
      for (const asset of assets.values()) {
        if (asset.sceneId !== sceneId) continue;
        if (asset.type === 'image') found.image = asset;
        else found.audio = asset;
      }
      return found;
    },
    [assets],
  );

  /**
   * Hand one finished asset to the bucket.
   *
   * Awaited by its caller rather than fired off, so that the row Firestore is about to be given
   * already carries the path. Firing it off would save a row saying "complete, saved nowhere",
   * which reopens as a failure — technically recoverable, and a lie for however long the upload
   * took. It is never awaited *before* the asset is shown, so the screen is not waiting on it.
   */
  const keep = useCallback(
    async (assetId: string, type: AssetType, blob: Blob) => {
      const saved = await putAsset(assetId, type, blob);
      if (saved) patchAsset(assetId, { path: saved.path, remoteUrl: saved.url });
    },
    [patchAsset, putAsset],
  );

  /** One image request for one scene, including the canvas pass its result has to survive. */
  const runImage = useCallback(
    async (config: SloperConfig, scene: Scene, assetId: string, signal: AbortSignal) => {
      const { width, height } = config.video.resolution;

      const result =
        config.image.provider === 'google'
          ? await generateGoogleImage(
              config.apiKeys.google ?? '',
              {
                prompt: scene.imageDescription,
                model: config.image.model,
                aspectRatio: config.image.aspectRatio || deriveAspectRatio(width, height),
              },
              signal,
            )
          : await generateImage(
              config.apiKeys.openai ?? '',
              {
                prompt: scene.imageDescription,
                model: config.image.model,
                quality: config.image.quality,
                size: `${width}x${height}`,
              },
              signal,
            );

      const processed = await processImage(result.dataUrl, result.data);
      patchAsset(assetId, {
        status: 'complete',
        data: processed.data,
        dataUrl: processed.dataUrl,
        path: null,
        remoteUrl: null,
        error: null,
      });

      // The JPEG the canvas produced, not the PNG the provider sent: it is the one the assembler
      // will be given, so it is the one worth keeping.
      await keep(assetId, 'image', processed.data);
    },
    [keep, patchAsset],
  );

  /** One narration, with its neighbours' scripts for context. */
  const runAudio = useCallback(
    async (
      config: SloperConfig,
      scene: Scene,
      index: number,
      all: Scene[],
      assetId: string,
      signal: AbortSignal,
    ) => {
      const result = await generateTtsAudio(
        config.apiKeys.elevenLabs ?? '',
        {
          text: scene.script,
          voiceId: config.tts.voiceId,
          model: config.tts.model,
          speed: config.tts.speed,
          previousText: index > 0 ? all[index - 1].script : undefined,
          nextText: index < all.length - 1 ? all[index + 1].script : undefined,
        },
        signal,
      );

      patchAsset(assetId, {
        status: 'complete',
        data: result.data,
        dataUrl: result.dataUrl,
        path: null,
        remoteUrl: null,
        duration: result.duration,
        error: null,
      });

      if (result.timing) {
        setTimings((prev) => {
          const next = new Map(prev);
          next.set(assetId, {
            assetId,
            words: result.timing!.words,
            totalDuration: result.timing!.totalDuration,
          });
          return next;
        });
      }

      await keep(assetId, 'audio', result.data);
    },
    [keep, patchAsset],
  );

  const failAsset = useCallback(
    (assetId: string, e: unknown, fallback: string) => {
      patchAsset(assetId, {
        status: 'failed' as AssetStatus,
        error: e instanceof Error ? e.message : fallback,
      });
    },
    [patchAsset],
  );

  /**
   * Create one image and one audio asset per usable scene, then fill them.
   *
   * Images and audio run at the same time — two providers, two independent rate limits — and
   * within each the queue in concurrency.ts holds the width. A scene missing either field is
   * skipped rather than half-generated: the assembler pairs them by position and would refuse
   * the request anyway.
   */
  const startAssets = useCallback(
    (config: SloperConfig) => {
      const signal = freshSignal();
      const usable = scenesRef.current.filter(
        (s) => s.script.trim() && s.imageDescription.trim(),
      );

      const created = new Map<string, Asset>();
      const pairs = usable.map((scene) => {
        const image = makeAsset(scene.id, 'image');
        const audio = makeAsset(scene.id, 'audio');
        created.set(image.id, image);
        created.set(audio.id, audio);
        return { scene, imageId: image.id, audioId: audio.id };
      });

      setAssets(created);
      setTimings(new Map());
      setError(null);
      setGeneratingAssets(true);

      const ttsLimiter = createTtsLimiter(config.tts.concurrency);

      const images = pairs.map(({ scene, imageId }) =>
        imageLimiter.add(async () => {
          if (signal.aborted) return;
          patchAsset(imageId, { status: 'generating' });
          await runImage(config, scene, imageId, signal);
        }),
      );

      const audio = pairs.map(({ scene, audioId }, i) =>
        ttsLimiter.add(async () => {
          if (signal.aborted) return;
          patchAsset(audioId, { status: 'generating' });
          await runAudio(config, scene, i, usable, audioId, signal);
        }),
      );

      // `allSettled`, never `all`: one refused image must not abandon eleven paid-for narrations.
      // Each rejection is recorded against its own asset, which is what the Retry button reads.
      void Promise.allSettled([
        ...images.map((p, i) =>
          p.catch((e) => {
            if (!signal.aborted) failAsset(pairs[i].imageId, e, 'Image generation failed');
          }),
        ),
        ...audio.map((p, i) =>
          p.catch((e) => {
            if (!signal.aborted) failAsset(pairs[i].audioId, e, 'Narration failed');
          }),
        ),
      ]).finally(() => {
        if (!signal.aborted) setGeneratingAssets(false);
      });
    },
    [failAsset, freshSignal, patchAsset, runAudio, runImage],
  );

  const retryAsset = useCallback(
    async (config: SloperConfig, assetId: string) => {
      const asset = assetsRef.current.get(assetId);
      if (!asset) return;

      const all = scenesRef.current;
      const index = all.findIndex((s) => s.id === asset.sceneId);
      if (index === -1) return;

      // The run's own controller, so Start Over cancels a retry too. A retry on a REOPENED project
      // is the case that needs the `??`: nothing has started a run in this page's lifetime, so
      // there is no controller yet and a fresh one stands in.
      const signal = abortRef.current?.signal ?? new AbortController().signal;
      patchAsset(assetId, { status: 'generating', error: null });

      try {
        if (asset.type === 'image') await runImage(config, all[index], assetId, signal);
        else await runAudio(config, all[index], index, all, assetId, signal);
      } catch (e) {
        if (!signal.aborted) failAsset(assetId, e, 'Retry failed');
      }
    },
    [failAsset, patchAsset, runAudio, runImage],
  );

  /* --- the video --------------------------------------------------------------------------- */

  /**
   * How long this scene's still is held.
   *
   * The narration's own length, never a setting. The timing from ElevenLabs is the better number
   * where there is one; ten seconds is the last resort, and it is only ever reached when a decode
   * failed too.
   */
  const holdFor = useCallback(
    (audio: Asset) => timings.get(audio.id)?.totalDuration || audio.duration || 10,
    [timings],
  );

  /** The scenes with both halves finished, in the order the assembler pairs them by. */
  const readyScenes = useCallback((): { image: Asset; audio: Asset }[] => {
    const ready: { image: Asset; audio: Asset }[] = [];
    // Scene order is the contract with the assembler; the Map's iteration order is not.
    for (const scene of scenesRef.current) {
      const found = assetsFor(scene.id);
      if (found.image?.status !== 'complete' || found.audio?.status !== 'complete') continue;
      ready.push({ image: found.image, audio: found.audio });
    }
    return ready;
  }, [assetsFor]);

  /**
   * Make sure an asset's bytes are in the bucket, and say where.
   *
   * Usually a no-op: everything is uploaded the moment it exists. What this is for is the asset
   * whose upload failed at the time — the run carried on with it in memory, which was the right
   * call then and is exactly what stops a background assembly now, because the assembler reads
   * the bucket and nothing else. So it is offered one more chance here, where there is a reason
   * to insist.
   */
  const ensureSaved = useCallback(
    async (asset: Asset): Promise<string | null> => {
      if (asset.path) return asset.path;
      if (!asset.data) return null;

      const saved = await putAsset(asset.id, asset.type, asset.data);
      if (!saved) return null;
      patchAsset(asset.id, { path: saved.path, remoteUrl: saved.url });
      return saved.path;
    },
    [patchAsset, putAsset],
  );

  /**
   * The old way, and still the right one when there is nowhere to have saved the assets.
   *
   * Everything goes up in one request and the MP4 comes back down in the answer, which means the
   * page has to be here for the whole of it. That is the trade signed out, and it is also the
   * fallback when the background route cannot be taken — a picture that never reached the bucket,
   * or an assembler that has not been deployed yet.
   */
  const assembleHere = useCallback(
    async (config: SloperConfig) => {
      const signal = abortRef.current?.signal;
      setAssemblyBackground(false);
      setAssembly('preparing');
      setUploadMB(null);

      const images: Blob[] = [];
      const audioFiles: Blob[] = [];
      const sceneMeta: { index: number; imageDuration: number }[] = [];

      for (const { image, audio } of readyScenes()) {
        // In a live run this is the blob already in hand. On a project reopened from the account
        // it is a fetch out of the bucket — which is precisely what lets a sitting be finished on
        // a different machine from the one that paid for it.
        const [imageBlob, audioBlob] = await Promise.all([
          blobForAsset(image),
          blobForAsset(audio),
        ]);
        if (!imageBlob || !audioBlob) continue;

        images.push(imageBlob);
        audioFiles.push(audioBlob);
        sceneMeta.push({ index: sceneMeta.length, imageDuration: holdFor(audio) });
      }

      if (sceneMeta.length === 0) {
        throw new Error('No scene has both an image and a narration, so there is nothing to assemble.');
      }

      const bytes = [...images, ...audioFiles].reduce((sum, b) => sum + b.size, 0);
      setUploadMB((bytes / 1024 / 1024).toFixed(1));
      setAssembly('uploading');

      const result = await assembleVideo(
        {
          scenes: sceneMeta,
          resolution: config.video.resolution,
          frameRate: config.video.frameRate,
        },
        images,
        audioFiles,
        signal,
        () => setAssembly('encoding'),
      );

      setVideo(result.video);
      setAssembly('done');
      goTo('output');

      // After the stage has moved, never before: the video is on screen and playable while this
      // is still going up, and a bucket that refuses it costs the saved copy rather than the
      // thing somebody just waited two minutes for.
      const saved = await putVideo(result.video, result.duration);
      if (saved) setVideoMeta(saved);
    },
    [goTo, holdFor, putVideo, readyScenes],
  );

  /**
   * Give up on the assembler and do it here after all.
   *
   * The job is deleted first and that ordering is the whole of the safety: a `queued` job left
   * behind is a promise somebody else might keep, and the next opening of this project would poke
   * it into encoding a second copy of a video that is already finished.
   */
  const fallBackToPage = useCallback(
    async (config: SloperConfig) => {
      watchJob(false);
      log.warn('sloper.job.fallback', { reason: 'unclaimed' });
      await dropAssembly().catch(() => undefined);
      await assembleHere(config);
    },
    [assembleHere, dropAssembly, watchJob],
  );

  /**
   * Hand the whole thing to the assembler and stop being needed.
   *
   * Nothing is uploaded here — the pictures and the narrations have been in the bucket since the
   * moment each was paid for — so what goes up is a list of paths and a poke. From this point the
   * page is a spectator: it polls the job document while it happens to be open, and if it is
   * closed the video is finished, saved and waiting the next time anybody looks.
   */
  const assembleInAccount = useCallback(
    async (config: SloperConfig): Promise<boolean> => {
      if (!project.enabled || !project.id) return false;

      const rows: AssemblyJobScene[] = [];
      for (const { image, audio } of readyScenes()) {
        const [imagePath, audioPath] = await Promise.all([ensureSaved(image), ensureSaved(audio)]);
        // One asset the account never received is enough to disqualify the route: the assembler
        // would assemble the scenes around it and hand back a video with a gap in it, where the
        // in-page path still has those bytes in memory and can make the whole thing.
        if (!imagePath || !audioPath) return false;

        rows.push({ imagePath, audioPath, imageDuration: holdFor(audio) });
      }

      if (rows.length === 0) {
        throw new Error('No scene has both an image and a narration, so there is nothing to assemble.');
      }

      await queueAssembly(rows, config.video.resolution, config.video.frameRate);

      setAssemblyBackground(true);
      setUploadMB(null);
      setAssembly('queued');
      startDeadlineRef.current = Date.now() + JOB_START_DEADLINE_MS;
      watchJob(true);
      return true;
    },
    [ensureSaved, holdFor, project.enabled, project.id, queueAssembly, readyScenes, watchJob],
  );

  const startAssembly = useCallback(
    async (config: SloperConfig) => {
      setAssembly('preparing');
      setError(null);
      setUploadMB(null);
      assemblyConfigRef.current = config;

      try {
        if (await assembleInAccount(config)) return;
        await assembleHere(config);
      } catch (e) {
        log.warn('sloper.assemble.failed', describeError(e));
        watchJob(false);
        setAssembly('error');
        setError(e instanceof Error ? e.message : 'Assembling the video failed.');
      }
    },
    [assembleHere, assembleInAccount, watchJob],
  );

  /* --- watching one that is not this page's ---------------------------------------------- */

  /**
   * What the job document says, turned into what the screen shows.
   *
   * Split out of the effect below so that it is also what a reopened project runs once, on the
   * job it finds waiting for it. Both cases ask the same question — is there a video, is one
   * coming, or did it fail — and neither should answer it differently.
   */
  const applyJob = useCallback(
    async (job: AssemblyJob | null): Promise<void> => {
      // A tick that was already in the air when the watching stopped has nothing to say about a
      // screen somebody else has moved on. See `watchingRef`.
      if (!watchingRef.current) return;

      const config = assemblyConfigRef.current;
      const now = Date.now();

      if (!job) {
        // Nothing there at all. The document is written before the poke and deleted only by the
        // fallback, so this is a console delete or another tab starting over — either way there
        // is no assembly to wait for and the assets screen is where the buttons are.
        watchJob(false);
        setAssembly('idle');
        goTo('assets');
        return;
      }

      if (job.status === 'done' && job.video) {
        watchJob(false);
        await showSavedVideo(job.video);
        return;
      }

      if (job.status === 'error' || (job.status === 'done' && !job.video)) {
        watchJob(false);
        setAssembly('error');
        setError(job.error || 'Assembling the video failed.');
        return;
      }

      if (jobIsStale(job, now)) {
        // The claim is older than any encode can be, so whatever held it is gone. One more poke
        // if it has attempts left, and otherwise say so rather than spin on a dead job.
        if (jobNeedsStarting(job, now)) {
          nudgeAssembly();
          startDeadlineRef.current = now + JOB_START_DEADLINE_MS;
          setAssembly('queued');
          return;
        }
        watchJob(false);
        setAssembly('error');
        setError(job.error || 'The assembler did not finish this video. Try again.');
        return;
      }

      if (job.status === 'running') {
        setAssembly('encoding');
        return;
      }

      // Still queued. Either the poke has not landed yet, or it never will.
      setAssembly('queued');
      if (now <= startDeadlineRef.current) return;

      if (config) {
        await fallBackToPage(config);
        return;
      }

      /*
       * The deadline has passed on a job this page did not start — it was found waiting by a
       * reopening, and was poked again on the way in. There is nothing to fall back to, because
       * falling back means encoding here and the settings that video was asked for with belong to
       * the run that asked. So it says so and offers the button, which re-queues it with the
       * settings the project has just restored.
       */
      watchJob(false);
      setAssembly('error');
      setError('The assembler has not picked this video up. Try again.');
    },
    [fallBackToPage, goTo, nudgeAssembly, showSavedVideo, watchJob],
  );

  /*
   * The poll.
   *
   * A timer and a `getDoc` rather than an `onSnapshot`, which is the same call every other app on
   * this site makes: the Firestore client here is replaced wholesale when it dies (see
   * `firestoreHealth.ts`), and a listener registered against the dead one is a screen that stops
   * updating with nothing to say why. A read every four seconds against a document of a few
   * hundred bytes is cheap enough not to need the cleverer thing.
   *
   * IT DEPENDS ON THE FLAG AND NOTHING ELSE, which is why `applyJob` is reached through a ref.
   * That function closes over the sitting, so its identity changes on every render of the island;
   * in the dependency array it would tear the interval down and send a fresh read on each one —
   * several a second while somebody types. The ref is always the current one by the time a tick
   * runs, which is the only property this needs.
   */
  const applyJobRef = useRef(applyJob);
  useEffect(() => {
    applyJobRef.current = applyJob;
  });

  useEffect(() => {
    if (!watchingJob) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const job = await readAssembly();
        if (!cancelled) await applyJobRef.current(job);
      } catch (e) {
        // A failed read is a network blip, not an answer. The next tick asks again; nothing about
        // the assembly depends on this page being able to see it.
        log.debug('sloper.job.poll.failed', describeError(e));
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), JOB_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [readAssembly, watchingJob]);

  /* --- starting over ----------------------------------------------------------------------- */

  const dismissError = useCallback(() => setError(null), []);

  /**
   * Start Over, which now means "leave that project alone and begin another".
   *
   * `project.close()` drops the id out of the address bar without deleting anything: the sitting
   * that was open stays in the account exactly as it was last saved, and the Open window can
   * fetch it back. That is the whole difference this made — Start Over used to be the only
   * button on the site that destroyed an hour of paid-for work.
   */
  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setScenes([]);
    setPrompt('');
    setAssets(new Map());
    setTimings(new Map());
    setTokenUsage(null);
    setEstimatedCost(null);
    setStreaming(false);
    setGeneratingAssets(false);
    watchJob(false);
    setAssemblyBackground(false);
    setAssembly('idle');
    setUploadMB(null);
    setVideo(null);
    setVideoMeta(null);
    setError(null);
    project.close();
    goTo('config');
  }, [goTo, project, watchJob]);

  /*
   * What leaving would actually cost.
   *
   * `uploading` and `encoding` are here for the reason they always were — the request in the air
   * is the one already being paid for — but only while the encode is THIS PAGE's. An assembly the
   * account is doing survives the tab by construction, so warning about it would be a prompt that
   * is simply untrue, and a prompt people learn to dismiss without reading is worth less than the
   * one case it is right about. `preparing` stays busy either way: whichever route is taken, that
   * is the moment an asset that never reached the bucket is being pushed up.
   */
  const busy =
    streaming ||
    generatingAssets ||
    assembly === 'preparing' ||
    (!assemblyBackground && (assembly === 'uploading' || assembly === 'encoding'));

  /*
   * The rows the autosave effect writes. Derived on every render rather than kept in state, so
   * there is exactly one source of truth for an asset and no second copy to fall out of step —
   * `useSloperProject.save` compares what it is handed against what it last wrote, so producing
   * a fresh array here costs nothing but the allocation.
   */
  const storedAssets: StoredAsset[] = [...assets.values()].map((asset) => ({
    id: asset.id,
    sceneId: asset.sceneId,
    type: asset.type,
    status: asset.status,
    path: asset.path,
    url: asset.remoteUrl,
    duration: asset.duration,
    error: asset.error,
  }));

  const storedTimings: Record<string, number> = {};
  for (const timing of timings.values()) storedTimings[timing.assetId] = timing.totalDuration;

  return {
    stage,
    goTo,
    prompt,
    setPrompt,
    scenes,
    streaming,
    tokenUsage,
    estimatedCost,
    generateScenes,
    stopStreaming,
    addScene,
    updateScene,
    removeScene,
    clearScenes,
    assets,
    timings,
    assetsFor,
    generatingAssets,
    startAssets,
    retryAsset,
    assembly,
    assemblyBackground,
    uploadMB,
    video,
    videoMeta,
    startAssembly,
    restoring,
    storedAssets,
    storedTimings,
    error,
    dismissError,
    reset,
    busy,
  };
}
