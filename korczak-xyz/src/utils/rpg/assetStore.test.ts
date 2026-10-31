import { describe, expect, it } from 'vitest';

import {
  assetRoute,
  extensionOf,
  falMedia,
  fingerprintQuery,
  meshyRigBody,
  newAssetId,
  paramsOf,
  promptOf,
  requestFingerprint,
  rewriteUrls,
  rigAliasOf,
  stableStringify,
} from './assetStore';

const fal = (path: string, host = 'fal.run') => ({ provider: 'fal' as const, host, path });

describe('assetStore', () => {
  it('fingerprints a request by what it asks, not by how its keys were ordered', async () => {
    const a = await requestFingerprint('fal.run', '/fal-ai/flux/schnell', { prompt: 'x', image_size: { width: 512, height: 512 } });
    const b = await requestFingerprint('fal.run', '/fal-ai/flux/schnell', { image_size: { height: 512, width: 512 }, prompt: 'x' });
    const c = await requestFingerprint('fal.run', '/fal-ai/flux/schnell', { prompt: 'y', image_size: { width: 512, height: 512 } });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(stableStringify({ b: 1, a: undefined, c: [{ z: 1, y: 2 }] })).toBe('{"b":1,"c":[{"y":2,"z":1}]}');
  });

  it('counts only the query that changes the answer', () => {
    expect(fingerprintQuery('output_format=mp3_44100_128&key=leak&enable_logging=false')).toBe('output_format=mp3_44100_128');
  });

  it('knows which requests make something to keep, and which may be answered from the bucket', () => {
    expect(assetRoute(fal('/fal-ai/flux/schnell'), 'POST', {})).toEqual({ kind: 'image', reusable: true, shape: 'fal-json' });
    expect(assetRoute(fal('/fal-ai/trellis', 'queue.fal.run'), 'POST', {})).toMatchObject({ kind: 'model', shape: 'fal-submit' });
    expect(assetRoute(fal('/fal-ai/meshy/rigging', 'queue.fal.run'), 'POST', {})).toMatchObject({ kind: 'rig', reusable: true });
    expect(assetRoute(fal('/fal-ai/meshy/requests/abc', 'queue.fal.run'), 'GET', {})).toMatchObject({ shape: 'fal-result' });
    expect(assetRoute(fal('/fal-ai/meshy/requests/abc/status', 'queue.fal.run'), 'GET', {})).toBeNull();
    const google = { provider: 'google' as const, host: 'generativelanguage.googleapis.com', path: '/v1beta/models/m:generateContent' };
    expect(assetRoute(google, 'POST', { generationConfig: { responseModalities: ['IMAGE'] } })).toMatchObject({ kind: 'image', shape: 'google-image' });
    expect(assetRoute(google, 'POST', { contents: [] })).toBeNull();
    const el = (path: string) => ({ provider: 'elevenlabs' as const, host: 'api.elevenlabs.io', path });
    expect(assetRoute(el('/v1/text-to-speech/abc'), 'POST', {})).toMatchObject({ kind: 'voice-line', reusable: true });
    expect(assetRoute(el('/v1/music/stream'), 'POST', {})).toMatchObject({ kind: 'music', reusable: true });
    expect(assetRoute(el('/v1/text-to-voice/design'), 'POST', {})).toMatchObject({ kind: 'voice-design', reusable: false });
    expect(assetRoute(el('/v2/voices'), 'GET', {})).toBeNull();
  });

  it('finds every file fal answered with and swaps in the kept URLs', () => {
    const answer = { model_mesh: { url: 'https://v3.fal.media/a.glb', file_size: 3 }, thumbnail: { url: 'https://fal.media/t.png' }, seed: 4, input: { url: 'https://example.test/in.png' } };
    const media = falMedia(answer);
    expect(media.map((m) => m.role)).toEqual(['model_mesh', 'thumbnail']);
    const out = rewriteUrls(answer, new Map([['https://v3.fal.media/a.glb', 'https://kept/a.glb']]));
    expect(out.model_mesh).toEqual({ url: 'https://kept/a.glb', file_size: 3 });
    expect(out.thumbnail.url).toBe('https://fal.media/t.png');
  });

  it('keeps the prompt whichever field it is in, and the parameters without inline bytes', () => {
    expect(promptOf({ prompt: 'p' })).toBe('p');
    expect(promptOf({ contents: [{ parts: [{ text: 'a' }, { inlineData: {} }, { text: 'b' }] }] })).toBe('a\n\nb');
    expect(promptOf({ inputs: [{ text: 'one' }, { text: 'two' }] })).toBe('one\n\ntwo');
    expect(paramsOf({ data: 'x'.repeat(5000), n: 1 })).toEqual({ data: '[5000 characters]', n: 1 });
  });

  it('names a file by its URL where it says, else by its type', () => {
    expect(extensionOf('https://fal.media/x/model.GLB', null)).toBe('glb');
    expect(extensionOf(null, 'audio/mpeg')).toBe('mp3');
    expect(extensionOf('https://fal.media/x/noext', 'image/webp')).toBe('webp');
    expect(newAssetId(new Date(Date.UTC(2026, 9, 31, 14, 38, 29)), () => 0)).toBe('20261031-143829-aaaaaa');
  });

  it('counts a Meshy model made with its rig as that model’s rig', () => {
    const alias = rigAliasOf(
      'fal-ai/meshy/v6/image-to-3d',
      { enable_rigging: true, rigging_height_meters: 1.78 },
      { model_glb: { url: 'https://kept/bare.glb' }, rigged_character_glb: { url: 'https://kept/rigged.glb' } },
    );
    expect(alias?.body).toEqual(meshyRigBody('https://kept/bare.glb', 1.78));
    expect(rigAliasOf('fal-ai/meshy/v6/image-to-3d', { enable_rigging: false }, {})).toBeNull();
  });
});

describe('keepsAssets', () => {
  it('is the game and the model lab, in either language, and no other app', async () => {
    const { keepsAssets } = await import('./assetStore');
    expect(keepsAssets('/apps/rpg/')).toBe(true);
    expect(keepsAssets('/pl/apps/rpg-models/')).toBe(true);
    expect(keepsAssets('/apps/rpg')).toBe(true);
    expect(keepsAssets('/apps/sloper/')).toBe(false);
    expect(keepsAssets('/apps/rpgx/')).toBe(false);
  });
});
