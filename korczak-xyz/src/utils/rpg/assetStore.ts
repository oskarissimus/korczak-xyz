/*
 * Every asset the RPG pays a provider for, kept (owner, 31 Oct 2026: "every generated asset should
 * be saved in the bucket together with the prompt that made it — the ElevenLabs lines, sounds,
 * music, whatever comes from fal.ai and Google's models"). The half both runtimes share: the server
 * (`functions/src/rpg/assets.ts`) keeps and reuses, the page (`accountAssets.ts`) asks whether
 * something is kept already.
 *
 * WHERE IT GOES. The bytes go to the bucket `korczak-xyz-501720-rpg` (terraform/storage.tf), under
 * `users/{uid}/rpg/{assetId}/`, one object per file the provider answered plus `meta.json`. What
 * made them goes to Firestore, `rpgAssets/{uid}/items/{assetId}`: the prompt, the model, the
 * request's parameters, the cost, when, the world and the quest, and each file's path and URL.
 *
 * WHY THE PROMPT IS IN FIRESTORE AND NOT ONLY IN THE BUCKET. The bucket can only be listed and read
 * one object at a time, its own metadata is capped at 8 KiB and cannot be queried; Firestore can be
 * asked "every Meshy rig of this model" or "everything this quest cost" in one read, which is what
 * the lab and the game need. `meta.json` beside the files is the same record written once more, so
 * the bucket alone still says what each file is if the documents are ever lost.
 *
 * REUSE. Each request that makes an asset has a fingerprint: SHA-256 of its host, path and body
 * with the keys sorted (`requestFingerprint`). `rpgAssets/{uid}/requests/{fingerprint}` points at
 * the asset it made, and the gateway answers the same request again from the bucket for $0 rather
 * than paying for it twice — on any device, the lab and the game alike, which is what the Cache API
 * could never do (it is one browser's). A request that wants a new result for the same words (a
 * retry after a bad model, the console's remake) says so with `x-rpg-fresh` (`FRESH_HEADER`), and
 * what it makes becomes the one the fingerprint points at.
 *
 * WHAT IS NOT AN ASSET: a beat, a world, any model's text. Those are already the game's saves
 * (`rpgSaves`, `rpgWorlds`), and the same words asked again must not give the same story.
 */

import type { GatewayTarget } from './gatewayRoutes';

/** The bucket (terraform/storage.tf). */
export const ASSET_BUCKET = 'korczak-xyz-501720-rpg';
/** `rpgAssets/{uid}/items/{id}` and `rpgAssets/{uid}/requests/{fingerprint}`. Top level, read by the owner, written by the server only. */
export const ASSET_ROOT = 'rpgAssets';

/**
 * Says a request is the RPG's (the game or the model lab), whose assets are kept: the gateway is
 * every app's since 31 Oct 2026, and the video wizard's or the passenger's pictures and lines are
 * not the game's to keep or to reuse. Set by `apiFetch` on the RPG's pages (`keepsAssets`).
 */
export const KEEP_HEADER = 'x-rpg-keep';

/** The RPG's pages: the game and the model lab, in either language. */
export function keepsAssets(pathname: string): boolean {
  return /^\/(?:pl\/)?apps\/rpg(?:-models)?(?:\/|$)/.test(pathname);
}

/** Asks for a new result even when the same request made one before. */
export const FRESH_HEADER = 'x-rpg-fresh';
/** The kept asset an answer came from or went into. */
export const ASSET_HEADER = 'x-rpg-asset';
/** Set on an answer served from the bucket rather than the provider: the asset's id. */
export const REUSED_HEADER = 'x-rpg-reused';
/** A fal.ai queue request id the gateway made up for an answer it already holds. */
export const REUSED_REQUEST_PREFIX = 'rpgasset-';

export type AssetKind = 'image' | 'model' | 'rig' | 'voice-line' | 'music' | 'voice-design' | 'self-rig';

export interface AssetRoute {
  kind: AssetKind;
  /** Answered from the bucket when the same request was kept before. */
  reusable: boolean;
  /** How the answer comes: fal's JSON with URLs in it, Google's JSON with the bytes in it, audio, or a queue submit to follow. */
  shape: 'fal-json' | 'fal-submit' | 'fal-result' | 'google-image' | 'audio' | 'voice-design';
}

/** A fal.ai model's kind by its id. */
export function falKind(model: string): AssetKind {
  if (/meshy\/rigging/.test(model)) return 'rig';
  if (/trellis|tripo|hunyuan|meshy|3d/.test(model)) return 'model';
  return 'image';
}

/** A fal.ai queue path's request id when it asks for a result (not its status, not a cancel). */
export function falResultId(path: string): string | null {
  const m = /\/requests\/([\w-]+)$/.exec(path);
  return m ? m[1] : null;
}

/** A fal.ai queue path's request id when it asks for its status. */
export function falStatusId(path: string): string | null {
  const m = /\/requests\/([\w-]+)\/status$/.exec(path);
  return m ? m[1] : null;
}

/** Whether, and how, a gateway request makes something to keep. Null for text, searches, polls, lists. */
export function assetRoute(target: GatewayTarget, method: string, body: Record<string, unknown>): AssetRoute | null {
  const { host, path } = target;
  const m = method.toUpperCase();
  if (host === 'fal.run' && m === 'POST') return { kind: falKind(path.slice(1)), reusable: true, shape: 'fal-json' };
  if (host === 'queue.fal.run') {
    if (m === 'POST' && !/\/requests\//.test(path)) return { kind: falKind(path.slice(1)), reusable: true, shape: 'fal-submit' };
    if (m === 'GET' && falResultId(path)) return { kind: 'model', reusable: false, shape: 'fal-result' };
    return null;
  }
  if (host === 'generativelanguage.googleapis.com' && m === 'POST' && /:generateContent$/.test(path)) {
    const config = body.generationConfig as { responseModalities?: unknown } | undefined;
    const modalities = Array.isArray(config?.responseModalities) ? config.responseModalities : [];
    return modalities.includes('IMAGE') ? { kind: 'image', reusable: true, shape: 'google-image' } : null;
  }
  if (host === 'api.elevenlabs.io' && m === 'POST') {
    if (path.startsWith('/v1/text-to-speech/') || path === '/v1/text-to-dialogue') return { kind: 'voice-line', reusable: true, shape: 'audio' };
    if (path.startsWith('/v1/music')) return { kind: 'music', reusable: true, shape: 'audio' };
    // Designed voices: the previews are kept, never reused — each design is meant to be a new voice.
    if (path === '/v1/text-to-voice/design') return { kind: 'voice-design', reusable: false, shape: 'voice-design' };
  }
  return null;
}

/** JSON with every object's keys in order, so the same request is the same string whoever built it. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(',')}}`;
}

/** The request's fingerprint: SHA-256 (hex) of host, path, query and body. The same in the browser and in Node. */
export async function requestFingerprint(host: string, path: string, body: Record<string, unknown>, query = ''): Promise<string> {
  const text = `${host}${path}${query ? `?${query}` : ''}\n${stableStringify(body)}`;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The query a fingerprint counts: only what changes the answer (ElevenLabs' format), never a key. */
export function fingerprintQuery(query: string): string {
  const params = new URLSearchParams(query);
  const kept = new URLSearchParams();
  for (const k of ['output_format']) {
    const v = params.get(k);
    if (v !== null) kept.set(k, v);
  }
  return kept.toString();
}

/** The words an asset was asked with, whichever field the provider calls them. */
export function promptOf(body: Record<string, unknown>): string {
  const parts: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) parts.push(v);
  };
  add(body.prompt);
  add(body.text);
  add(body.voice_description);
  if (Array.isArray(body.inputs)) for (const i of body.inputs) add((i as { text?: unknown })?.text);
  if (Array.isArray(body.contents)) {
    for (const c of body.contents) {
      const ps = (c as { parts?: unknown })?.parts;
      if (Array.isArray(ps)) for (const p of ps) add((p as { text?: unknown })?.text);
    }
  }
  return parts.join('\n\n');
}

/** The request as kept: every parameter, but a string longer than `max` (an inline picture's base64) cut to its length. */
export function paramsOf(value: unknown, max = 4000): unknown {
  if (typeof value === 'string') return value.length > max ? `[${value.length} characters]` : value;
  if (Array.isArray(value)) return value.map((v) => paramsOf(v, max));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = paramsOf(v, max);
    return out;
  }
  return value;
}

/** Hosts fal.ai serves its outputs from. */
export function isFalMedia(url: string): boolean {
  try {
    const { protocol, host, pathname } = new URL(url);
    if (protocol !== 'https:') return false;
    return /(^|\.)fal\.(media|ai|run)$/.test(host) || (host === 'storage.googleapis.com' && pathname.startsWith('/fal'));
  } catch {
    return false;
  }
}

export interface MediaRef {
  /** Where in the answer: `model_mesh`, `images.0`, `rigged_character_glb`. Names the file in the bucket. */
  role: string;
  url: string;
  contentType: string | null;
}

/** Every file fal.ai answered with, by where it sits in the answer. At most `limit`. */
export function falMedia(answer: unknown, limit = 12): MediaRef[] {
  const out: MediaRef[] = [];
  const walk = (v: unknown, at: string[]) => {
    if (out.length >= limit || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, [...at, String(i)]));
      return;
    }
    const o = v as Record<string, unknown>;
    if (typeof o.url === 'string' && isFalMedia(o.url)) {
      out.push({ role: at.join('.') || 'file', url: o.url, contentType: typeof o.content_type === 'string' ? o.content_type : null });
      return;
    }
    for (const [k, x] of Object.entries(o)) walk(x, [...at, k]);
  };
  walk(answer, []);
  return out;
}

/** The answer with each fal.ai URL replaced by the kept file's (`urls`, old → new). */
export function rewriteUrls<T>(answer: T, urls: Map<string, string>): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = k === 'url' && typeof x === 'string' && urls.has(x) ? urls.get(x) : walk(x);
      return out;
    }
    return v;
  };
  return walk(answer) as T;
}

/** A file's extension, from its URL where it says, else from its type. */
export function extensionOf(url: string | null, contentType: string | null): string {
  const fromUrl = url ? /\.([a-z0-9]{2,5})(?:$|[?#])/i.exec(new URL(url, 'https://x').pathname)?.[1] : undefined;
  if (fromUrl) return fromUrl.toLowerCase();
  const t = (contentType ?? '').split(';')[0].trim();
  const known: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'model/gltf-binary': 'glb',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/opus': 'opus',
    'application/json': 'json',
  };
  return known[t] ?? 'bin';
}

/** A file name a bucket and a URL both take: letters, digits, dots, dashes. */
export function fileRole(role: string): string {
  return role.replace(/[^\w.-]/g, '_').slice(0, 80) || 'file';
}

/** `users/{uid}/rpg/{assetId}/{name}` in the bucket. */
export function assetPath(uid: string, assetId: string, name: string): string {
  return `users/${uid}/rpg/${assetId}/${name}`;
}

/** A Firebase download URL: readable by anyone holding it (fal.ai fetching a model to rig, an `<img>`), by nobody without the token. */
export function downloadUrl(bucket: string, path: string, token: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

/** An asset id that sorts by time in a bucket listing: `20261031-143829-k3x9qa`. */
export function newAssetId(now = new Date(), random: () => number = Math.random): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
  let tail = '';
  for (let i = 0; i < 6; i++) tail += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(random() * 36)];
  return `${stamp}-${tail}`;
}

/** Meshy's rig, as the game and the lab ask it (`rigWithMeshy`): one body, so one fingerprint. */
export const MESHY_RIG_MODEL = 'fal-ai/meshy/rigging';
export function meshyRigBody(glb: string, height: number): Record<string, unknown> {
  return { model_url: glb, height_meters: height, enable_animation: false };
}

/**
 * A Meshy 6 model made with its rig in one request (the lab's *in one go*, text-to-3D) answers the
 * same rigged GLB that rigging the bare model would: the rig request that is then already paid for,
 * so asking Meshy to rig that model later is answered from the bucket too.
 */
export function rigAliasOf(model: string, body: Record<string, unknown>, answer: Record<string, unknown>): { body: Record<string, unknown>; answer: Record<string, unknown> } | null {
  if (!/^fal-ai\/meshy\/v6\//.test(model) || body.enable_rigging !== true) return null;
  const bare = (answer.model_glb as { url?: unknown } | undefined)?.url;
  const rigged = answer.rigged_character_glb as { url?: unknown } | undefined;
  const height = body.rigging_height_meters;
  if (typeof bare !== 'string' || typeof rigged?.url !== 'string' || typeof height !== 'number') return null;
  return { body: meshyRigBody(bare, height), answer: { rigged_character_glb: rigged } };
}

/** A self-rig's place in the account's store: the browser's own cache key, hashed (`people.ts`). */
export async function selfRigId(cacheKey: string): Promise<string> {
  return (await requestFingerprint('self-rig', '', { key: cacheKey })).slice(0, 40);
}
