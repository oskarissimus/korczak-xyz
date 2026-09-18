/*
 * The two things about saved projects that are worth a gate.
 *
 * The id, because it is the one value here that must never repeat: two sittings sharing one would
 * overwrite each other's scenes in Firestore, silently and for ever. Length, alphabet and
 * uniformity are what stand between that and a run of `Math.random()`.
 *
 * `readProject`, because it is the boundary. Everything it returns is rendered or handed to the
 * assembler, and its input is a document that may have been written by an older build, edited in
 * the Firestore console, or half-written by a save that was interrupted. The same argument
 * `metadata.ts` makes in the function: these values become ffmpeg arguments eventually, so a
 * `NaN` or a missing array has to die here rather than there.
 *
 * Nothing in this file touches Firestore or Storage. Both are wrapped by one function each in
 * `projects.ts` and neither has any logic in it worth testing without a network.
 */

import { describe, expect, it } from 'vitest';

import { isProjectId, newProjectId, newProjectName, PROJECT_ID_LENGTH } from './projectId';
import { hydrateAssets, readProject } from './projects';

describe('project ids', () => {
  it('are eleven characters of base64URL', () => {
    for (let i = 0; i < 200; i += 1) {
      const id = newProjectId();
      expect(id).toHaveLength(PROJECT_ID_LENGTH);
      expect(id).toMatch(/^[A-Za-z0-9_-]{11}$/);
    }
  });

  it('do not repeat', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i += 1) seen.add(newProjectId());
    expect(seen.size).toBe(5000);
  });

  /*
   * The alphabet is 64 symbols and a byte is 256 values, so `& 63` is uniform with nothing to
   * reject. This is the assertion that would catch somebody "simplifying" it to `% 62` for a
   * base62 id: the last two symbols would then never appear.
   */
  it('reach every symbol of the alphabet', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 4000; i += 1) for (const ch of newProjectId()) seen.add(ch);
    expect(seen.size).toBe(64);
  });

  it('accepts its own ids and refuses anything else', () => {
    expect(isProjectId(newProjectId())).toBe(true);
    expect(isProjectId('')).toBe(false);
    expect(isProjectId('too-short')).toBe(false);
    expect(isProjectId('twelvecharss')).toBe(false);
    // The one that matters: an id goes straight into a Firestore document path, and a slash in a
    // path segment addresses a different collection entirely.
    expect(isProjectId('abc/def/ghi')).toBe(false);
    expect(isProjectId('abcdefghi.j')).toBe(false);
    expect(isProjectId(null)).toBe(false);
    expect(isProjectId(42)).toBe(false);
  });
});

describe('project names', () => {
  it('are two words', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(newProjectName()).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    }
  });
});

describe('readProject', () => {
  it('reads a whole document back', () => {
    const project = readProject('Kx3_pQ2mTaV', {
      name: 'Brisk Lantern',
      createdAt: 1000,
      updatedAt: 2000,
      stage: 'assets',
      prompt: 'the history of coffee',
      scenes: [{ id: 's1', index: 0, script: 'one', imageDescription: 'a bean', isEdited: true }],
      assets: [
        {
          id: 'a1',
          sceneId: 's1',
          type: 'image',
          status: 'complete',
          path: 'users/u/sloper/p/a1.jpg',
          url: 'https://example.test/a1.jpg',
          duration: null,
          error: null,
        },
      ],
      timings: { a2: 4.5 },
      video: { path: 'users/u/sloper/p/video.mp4', url: 'https://example.test/v', bytes: 10, duration: 9 },
    });

    expect(project.id).toBe('Kx3_pQ2mTaV');
    expect(project.name).toBe('Brisk Lantern');
    expect(project.stage).toBe('assets');
    expect(project.scenes).toHaveLength(1);
    expect(project.assets[0].path).toBe('users/u/sloper/p/a1.jpg');
    expect(project.timings).toEqual({ a2: 4.5 });
    expect(project.video?.bytes).toBe(10);
  });

  it('survives a document with nothing in it', () => {
    const project = readProject('Kx3_pQ2mTaV', {});

    expect(project.name).toBe('Kx3_pQ2mTaV');
    expect(project.stage).toBe('config');
    expect(project.scenes).toEqual([]);
    expect(project.assets).toEqual([]);
    expect(project.timings).toEqual({});
    expect(project.video).toBeNull();
    expect(project.settings).toBeNull();
  });

  it('refuses values that would reach ffmpeg as nonsense', () => {
    const project = readProject('Kx3_pQ2mTaV', {
      stage: 'somewhere-else',
      createdAt: 'yesterday',
      scenes: 'not an array',
      timings: { a1: Number.NaN, a2: 'long', a3: 3 },
      // A half-written video row: no url, so there is nothing to fetch and it must not claim
      // there is.
      video: { path: 'users/u/sloper/p/video.mp4' },
    });

    expect(project.stage).toBe('config');
    expect(project.createdAt).toBe(0);
    expect(project.scenes).toEqual([]);
    expect(project.timings).toEqual({ a3: 3 });
    expect(project.video).toBeNull();
  });

  it('renumbers scenes by position rather than trusting the stored index', () => {
    const project = readProject('Kx3_pQ2mTaV', {
      scenes: [
        { id: 's1', index: 7, script: 'one', imageDescription: 'a' },
        { id: 's2', index: 7, script: 'two', imageDescription: 'b' },
      ],
    });

    expect(project.scenes.map((s) => s.index)).toEqual([0, 1]);
  });

  it('drops asset rows with no id to hang them off', () => {
    const project = readProject('Kx3_pQ2mTaV', {
      assets: [
        { id: 'a1', sceneId: 's1', type: 'audio', status: 'complete' },
        { sceneId: 's1', type: 'image', status: 'complete' },
        { id: 'a3', type: 'image', status: 'complete' },
      ],
    });

    expect(project.assets.map((a) => a.id)).toEqual(['a1']);
  });

  it('keeps the settings and never the keys', () => {
    const project = readProject('Kx3_pQ2mTaV', {
      settings: {
        apiKeys: { openai: 'sk-do-not-keep-this', deepseek: null, google: null, elevenLabs: null },
        video: { resolution: { width: 1080, height: 1920 }, frameRate: 30, numScenes: 6, targetDuration: 60 },
      },
    });

    expect(project.settings).not.toBeNull();
    expect(project.settings).not.toHaveProperty('apiKeys');
    expect(JSON.stringify(project.settings)).not.toContain('sk-do-not-keep-this');
    expect(project.settings?.video.resolution.width).toBe(1080);
  });
});

describe('hydrateAssets', () => {
  it('points the element at the stored URL and leaves the bytes unfetched', () => {
    const assets = hydrateAssets(
      [
        {
          id: 'a1',
          sceneId: 's1',
          type: 'image',
          status: 'complete',
          path: 'users/u/sloper/p/a1.jpg',
          url: 'https://example.test/a1.jpg',
          duration: null,
          error: null,
        },
      ],
      'not saved',
    );

    const asset = assets.get('a1')!;
    expect(asset.status).toBe('complete');
    expect(asset.dataUrl).toBe('https://example.test/a1.jpg');
    // The whole point of the split: reopening a project fetches documents, not megabytes.
    expect(asset.data).toBeNull();
  });

  /*
   * The case this function exists for. A complete asset whose upload never landed has nothing
   * behind it, and showing it as complete would draw an `<img>` at nothing and offer no Retry —
   * a picture that is silently missing, on the one screen where every picture cost money.
   */
  it('demotes a complete asset that was never uploaded', () => {
    const assets = hydrateAssets(
      [
        {
          id: 'a1',
          sceneId: 's1',
          type: 'audio',
          status: 'complete',
          path: null,
          url: null,
          duration: 3,
          error: null,
        },
      ],
      'not saved',
    );

    const asset = assets.get('a1')!;
    expect(asset.status).toBe('failed');
    expect(asset.error).toBe('not saved');
  });

  it('leaves a genuinely failed asset alone', () => {
    const assets = hydrateAssets(
      [
        {
          id: 'a1',
          sceneId: 's1',
          type: 'image',
          status: 'failed',
          path: null,
          url: null,
          duration: null,
          error: 'Your request was rejected as a result of our safety system.',
        },
      ],
      'not saved',
    );

    expect(assets.get('a1')!.error).toContain('safety system');
  });
});
