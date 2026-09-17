/*
 * One sitting, from a topic to an MP4.
 *
 * sloper had four React contexts for this (`Scene`, `Asset`, `Workflow`, plus `Config`) and a
 * router deriving the stage from the URL. There is one hook here and no router, and both changes
 * are forced by what the state actually is: the assets are `Blob`s held in memory and nothing
 * persists them, so a real navigation between stages throws the video away. A stage is therefore
 * a value in this hook, the back links move it, and `/apps/sloper/` is one page.
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
import { createTtsLimiter, generateTtsAudio } from '../utils/sloper/tts';
import type {
  Asset,
  AssetStatus,
  AssetType,
  AudioTiming,
  Scene,
  SloperConfig,
  Stage,
  TokenUsage,
} from '../utils/sloper/types';

export type AssemblyPhase = 'idle' | 'preparing' | 'uploading' | 'done' | 'error';

export interface SloperRun {
  stage: Stage;
  goTo: (stage: Stage) => void;

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
  uploadMB: string | null;
  video: Blob | null;
  startAssembly: (config: SloperConfig) => Promise<void>;

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
    duration: null,
    error: null,
  };
}

export function useSloperRun(): SloperRun {
  const [stage, setStage] = useState<Stage>('config');

  const [scenes, setScenes] = useState<Scene[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [tokenUsage, setTokenUsage] = useState<TokenUsage | null>(null);
  const [estimatedCost, setEstimatedCost] = useState<number | null>(null);

  const [assets, setAssets] = useState<Map<string, Asset>>(() => new Map());
  const [timings, setTimings] = useState<Map<string, AudioTiming>>(() => new Map());
  const [generatingAssets, setGeneratingAssets] = useState(false);

  const [assembly, setAssembly] = useState<AssemblyPhase>('idle');
  const [uploadMB, setUploadMB] = useState<string | null>(null);
  const [video, setVideo] = useState<Blob | null>(null);

  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scenesRef = useRef<Scene[]>([]);
  const assetsRef = useRef<Map<string, Asset>>(new Map());

  useEffect(() => {
    scenesRef.current = scenes;
  }, [scenes]);
  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  // Nothing in a sitting outlives the page, so leaving it must not leave requests behind.
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

  // --- the script -------------------------------------------------------------------------

  const generateScenes = useCallback(
    async (config: SloperConfig, prompt: string) => {
      if (!prompt.trim()) return;

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
          prompt,
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

  // --- the assets -------------------------------------------------------------------------

  const patchAsset = useCallback((assetId: string, patch: Partial<Asset>) => {
    setAssets((prev) => {
      const asset = prev.get(assetId);
      if (!asset) return prev;
      const next = new Map(prev);
      next.set(assetId, { ...asset, ...patch });
      return next;
    });
  }, []);

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
        error: null,
      });
    },
    [patchAsset],
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
    },
    [patchAsset],
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

      // The run's own controller, so Start Over cancels a retry too.
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

  // --- the video --------------------------------------------------------------------------

  const startAssembly = useCallback(
    async (config: SloperConfig) => {
      const signal = abortRef.current?.signal;
      setAssembly('preparing');
      setError(null);
      setUploadMB(null);

      try {
        const images: Blob[] = [];
        const audioFiles: Blob[] = [];
        const sceneMeta: { index: number; imageDuration: number }[] = [];

        // Scene order is the contract with the assembler; the Map's iteration order is not.
        for (const scene of scenesRef.current) {
          const found = assetsFor(scene.id);
          if (!found.image?.data || !found.audio?.data) continue;

          images.push(found.image.data);
          audioFiles.push(found.audio.data);

          // The narration's own length decides how long its still is held. The timing from
          // ElevenLabs is the better number where there is one; ten seconds is the last resort,
          // and it is only ever reached when a decode failed too.
          const timing = timings.get(found.audio.id);
          sceneMeta.push({
            index: sceneMeta.length,
            imageDuration: timing?.totalDuration || found.audio.duration || 10,
          });
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
        );

        setVideo(result.video);
        setAssembly('done');
        goTo('output');
      } catch (e) {
        log.warn('sloper.assemble.failed', describeError(e));
        setAssembly('error');
        setError(e instanceof Error ? e.message : 'Assembling the video failed.');
      }
    },
    [assetsFor, goTo, timings],
  );

  // --- starting over ----------------------------------------------------------------------

  const dismissError = useCallback(() => setError(null), []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setScenes([]);
    setAssets(new Map());
    setTimings(new Map());
    setTokenUsage(null);
    setEstimatedCost(null);
    setStreaming(false);
    setGeneratingAssets(false);
    setAssembly('idle');
    setUploadMB(null);
    setVideo(null);
    setError(null);
    goTo('config');
  }, [goTo]);

  const busy = streaming || generatingAssets || assembly === 'preparing' || assembly === 'uploading';

  return {
    stage,
    goTo,
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
    uploadMB,
    video,
    startAssembly,
    error,
    dismissError,
    reset,
    busy,
  };
}
