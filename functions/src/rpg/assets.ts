/*
 * The RPG's assets, kept and reused by the gateway (`gateway.ts`) and the job runner (`jobs.ts`).
 * What is kept, where, and why the prompt is in Firestore: the top of
 * `korczak-xyz/src/utils/rpg/assetStore.ts`.
 *
 * Only for a signed-in reader paying with the account's key: a signed-out reader's request carries
 * no account to keep anything under. Keeping never fails a request — the answer is the reader's
 * whether or not the bucket took it, and a miss is a Sentry event, not a broken game.
 *
 * The files go in before the answer goes out: on Cloud Run the instance is only sure of its CPU
 * while a request is open, so work after `res.end()` can be frozen half done. A rigged GLB is ~2 MB
 * and is copied in a second or two, against Meshy's minute and a half.
 */

import { randomUUID } from 'node:crypto';

import type { Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

import {
  ASSET_BUCKET,
  ASSET_HEADER,
  ASSET_ROOT,
  assetPath,
  assetRoute,
  downloadUrl,
  extensionOf,
  falKind,
  falMedia,
  falResultId,
  falStatusId,
  fileRole,
  fingerprintQuery,
  KEEP_HEADER,
  newAssetId,
  paramsOf,
  promptOf,
  REUSED_HEADER,
  REUSED_REQUEST_PREFIX,
  requestFingerprint,
  rewriteUrls,
  rigAliasOf,
  type AssetKind,
  type AssetRoute,
} from '../../../korczak-xyz/src/utils/rpg/assetStore';
import { COST_HEADER, type GatewayTarget } from '../../../korczak-xyz/src/utils/rpg/gatewayRoutes';
import { db } from '../runtime';
import { reportError } from '../sentry';

/** Larger than anything a provider answers the game with; a bound, not a budget. */
const MAX_FILE_BYTES = 64 * 1024 * 1024;
/** A kept answer is a string on a document; a document holds 1 MiB. */
const MAX_ANSWER_CHARS = 600_000;

export interface KeptFile {
  role: string;
  path: string;
  url: string;
  contentType: string;
  bytes: number;
  /** Where the provider had it, for an answer that named a URL. */
  sourceUrl: string | null;
}

/** What an asset is recorded as, besides its files. */
export interface AssetRecord {
  kind: AssetKind;
  provider: string;
  model: string;
  route: string;
  prompt: string;
  params: unknown;
  usd: number | null;
  world: string | null;
  quest: string | null;
  payer: string | null;
  fingerprint: string | null;
  falRequestId?: string | null;
}

/** One request on its way through the gateway, as far as keeping it goes. */
export interface AssetContext {
  uid: string;
  target: GatewayTarget;
  route: AssetRoute;
  json: Record<string, unknown>;
  fingerprint: string | null;
  fresh: boolean;
  world: string | null;
  quest: string | null;
  payer: string;
}

const bucket = () => getStorage().bucket(ASSET_BUCKET);

/** One file into the bucket, with a download token, so the game and fal.ai can read it by URL. */
export async function putFile(uid: string, assetId: string, role: string, bytes: Buffer, contentType: string, sourceUrl: string | null, model: string): Promise<KeptFile> {
  const name = `${fileRole(role)}.${extensionOf(sourceUrl, contentType)}`;
  const path = assetPath(uid, assetId, name);
  const token = randomUUID();
  await bucket()
    .file(path)
    .save(bytes, {
      resumable: false,
      contentType,
      metadata: { cacheControl: 'private, max-age=31536000, immutable', metadata: { firebaseStorageDownloadTokens: token, assetId, model: model.slice(0, 200) } },
    });
  return { role, path, url: downloadUrl(ASSET_BUCKET, path, token), contentType, bytes: bytes.length, sourceUrl };
}

/** A file fal.ai answered with, fetched and put in the bucket. */
async function copyFile(uid: string, assetId: string, role: string, url: string, contentType: string | null, model: string): Promise<KeptFile | null> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${role}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_FILE_BYTES) return null;
  const type = contentType ?? res.headers.get('content-type') ?? 'application/octet-stream';
  return putFile(uid, assetId, role, bytes, type, url, model);
}

/** The record: its document, and `meta.json` beside the files so the bucket says what they are on its own. */
async function writeRecord(uid: string, assetId: string, record: AssetRecord, files: KeptFile[], answer: string | null): Promise<void> {
  const at = Date.now();
  const doc = { ...record, assetId, files, at, createdAt: FieldValue.serverTimestamp(), ...(answer && answer.length <= MAX_ANSWER_CHARS ? { answer } : {}) };
  const meta = Buffer.from(JSON.stringify({ ...record, assetId, files, at: new Date(at).toISOString() }, null, 2));
  await Promise.all([
    db.doc(`${ASSET_ROOT}/${uid}/items/${assetId}`).set(doc),
    bucket().file(assetPath(uid, assetId, 'meta.json')).save(meta, { resumable: false, contentType: 'application/json' }),
  ]);
}

/** The fingerprint now answers with this asset. */
async function pointAt(uid: string, fingerprint: string, assetId: string, record: Pick<AssetRecord, 'kind' | 'model'>, shape: AssetRoute['shape'], files: KeptFile[], answer: string | null): Promise<void> {
  if (answer && answer.length > MAX_ANSWER_CHARS) return;
  await db.doc(`${ASSET_ROOT}/${uid}/requests/${fingerprint}`).set({ assetId, kind: record.kind, model: record.model, shape, files, answer, at: Date.now() });
}

/** Keeps files that are bytes already (Google's picture, a clip, a self-rig) or URLs fal.ai answered. */
export async function keepAsset(
  uid: string,
  record: AssetRecord,
  sources: { role: string; bytes?: Buffer; url?: string; contentType: string | null }[],
  answer?: unknown,
  shape?: AssetRoute['shape'],
): Promise<{ assetId: string; files: KeptFile[]; answer: unknown }> {
  const assetId = newAssetId();
  const kept = await Promise.all(
    sources.map(async (s) => {
      try {
        if (s.bytes) return await putFile(uid, assetId, s.role, s.bytes, s.contentType ?? 'application/octet-stream', s.url ?? null, record.model);
        if (s.url) return await copyFile(uid, assetId, s.role, s.url, s.contentType, record.model);
      } catch (e) {
        reportError('rpgAssets.file', e, { model: record.model, role: s.role });
      }
      return null;
    }),
  );
  const files = kept.filter((f): f is KeptFile => f !== null);
  const urls = new Map(files.filter((f) => f.sourceUrl).map((f) => [f.sourceUrl as string, f.url]));
  const rewritten = answer === undefined ? undefined : rewriteUrls(answer, urls);
  const answerText = rewritten === undefined ? null : JSON.stringify(rewritten);
  if (files.length === 0) return { assetId, files, answer: answer };
  await writeRecord(uid, assetId, record, files, answerText);
  if (record.fingerprint && shape) await pointAt(uid, record.fingerprint, assetId, record, shape, files, answerText);
  return { assetId, files, answer: rewritten };
}

/** What a gateway request is, as far as keeping goes; null when it makes nothing to keep. */
export async function assetContext(
  uid: string | null,
  target: GatewayTarget,
  method: string,
  json: Record<string, unknown>,
  query: string,
  header: (name: string) => string | null,
  payer: string,
): Promise<AssetContext | null> {
  if (!uid || header(KEEP_HEADER) !== '1') return null;
  const route = assetRoute(target, method, json);
  if (!route) return null;
  const fingerprint = route.reusable ? await requestFingerprint(target.host, target.path, json, fingerprintQuery(query)) : null;
  return {
    uid,
    target,
    route,
    json,
    fingerprint,
    fresh: header('x-rpg-fresh') === '1',
    world: header('x-rpg-world'),
    quest: header('x-rpg-quest'),
    payer,
  };
}

function recordFor(ctx: AssetContext, usd: number | null, model?: string): AssetRecord {
  const provider = ctx.target.host === 'api.elevenlabs.io' ? 'elevenlabs' : ctx.target.host.includes('googleapis') ? 'google' : 'fal';
  const asked = model ?? (provider === 'fal' ? ctx.target.path.slice(1) : provider === 'google' ? (/models\/([^:]+):/.exec(ctx.target.path)?.[1] ?? '') : typeof ctx.json.model_id === 'string' ? ctx.json.model_id : ctx.target.path);
  return {
    kind: ctx.route.kind,
    provider,
    model: asked,
    route: `${ctx.target.host}${ctx.target.path}`,
    prompt: promptOf(ctx.json),
    params: paramsOf(ctx.json),
    usd,
    world: ctx.world,
    quest: ctx.quest,
    payer: ctx.payer,
    fingerprint: ctx.fingerprint,
  };
}

function reusedHeaders(res: Response, assetId: string): void {
  res.set(REUSED_HEADER, assetId);
  res.set(ASSET_HEADER, assetId);
  res.set(COST_HEADER, (0).toFixed(6));
  // ElevenLabs' own count, which the console prefers to a list price: nothing was spent.
  res.set('character-cost', '0');
}

async function readFile(path: string): Promise<Buffer> {
  const [bytes] = await bucket().file(path).download();
  return bytes;
}

interface Pointer {
  assetId: string;
  shape: AssetRoute['shape'];
  files: KeptFile[];
  answer: string | null;
}

/**
 * The same request kept before, answered from the bucket for nothing: true when it was. A fal.ai
 * queue submit is answered with a request of the gateway's own (`rpgasset-…`), already complete,
 * which `serveReusedQueue` then answers for status and result.
 */
export async function serveReused(ctx: AssetContext, res: Response): Promise<boolean> {
  if (!ctx.fingerprint || ctx.fresh) return false;
  try {
    const snap = await db.doc(`${ASSET_ROOT}/${ctx.uid}/requests/${ctx.fingerprint}`).get();
    const p = snap.data() as Pointer | undefined;
    if (!p?.assetId || !Array.isArray(p.files) || p.files.length === 0) return false;
    const { target } = ctx;
    switch (ctx.route.shape) {
      case 'fal-json': {
        if (!p.answer) return false;
        reusedHeaders(res, p.assetId);
        res.status(200).type('application/json').send(p.answer);
        return true;
      }
      case 'fal-submit': {
        if (!p.answer) return false;
        const id = `${REUSED_REQUEST_PREFIX}${p.assetId}`;
        const base = `https://queue.fal.run${target.path}/requests/${id}`;
        reusedHeaders(res, p.assetId);
        res.status(200).json({ request_id: id, status: 'COMPLETED', status_url: `${base}/status`, response_url: base, cancel_url: `${base}/cancel` });
        return true;
      }
      case 'google-image': {
        const file = p.files[0];
        const bytes = await readFile(file.path);
        reusedHeaders(res, p.assetId);
        res.status(200).json({
          candidates: [{ content: { parts: [{ inlineData: { mimeType: file.contentType, data: bytes.toString('base64') } }] }, finishReason: 'STOP' }],
          usageMetadata: {},
          rpgAsset: { id: p.assetId, url: file.url },
        });
        return true;
      }
      case 'audio': {
        const file = p.files[0];
        const bytes = await readFile(file.path);
        reusedHeaders(res, p.assetId);
        res.status(200).type(file.contentType).send(bytes);
        return true;
      }
      default:
        return false;
    }
  } catch (e) {
    // A kept answer that cannot be read is only a request paid for again.
    reportError('rpgAssets.reuse', e, { route: ctx.target.path });
    return false;
  }
}

/** Status and result of a queue request `serveReused` made up: complete, and the kept answer. True when it was one. */
export async function serveReusedQueue(uid: string | null, target: GatewayTarget, method: string, res: Response): Promise<boolean> {
  if (target.host !== 'queue.fal.run') return false;
  const id = falStatusId(target.path) ?? falResultId(target.path) ?? /\/requests\/([\w-]+)\/cancel$/.exec(target.path)?.[1] ?? null;
  if (!id?.startsWith(REUSED_REQUEST_PREFIX)) return false;
  const assetId = id.slice(REUSED_REQUEST_PREFIX.length);
  if (!uid) {
    res.status(401).json({ reason: 'auth', error: { message: 'rpg gateway: a kept asset is the account\'s; sign in again' } });
    return true;
  }
  if (falStatusId(target.path) || method.toUpperCase() === 'PUT') {
    res.status(200).json({ status: 'COMPLETED', request_id: id });
    return true;
  }
  const snap = await db.doc(`${ASSET_ROOT}/${uid}/items/${assetId}`).get();
  const answer = (snap.data() as { answer?: string } | undefined)?.answer;
  if (!answer) {
    res.status(404).json({ detail: 'rpg gateway: the kept asset is gone' });
    return true;
  }
  reusedHeaders(res, assetId);
  res.status(200).type('application/json').send(answer);
  return true;
}

/** A fal.ai queue submit: what was asked, kept until its result is fetched. */
async function noteSubmit(ctx: AssetContext, answer: Record<string, unknown>, usd: number | null): Promise<void> {
  const id = typeof answer.request_id === 'string' ? answer.request_id : null;
  if (!id) return;
  const record = recordFor(ctx, usd);
  await db.doc(`${ASSET_ROOT}/${ctx.uid}/pending/${id}`).set({
    ...record,
    params: JSON.stringify(record.params),
    body: JSON.stringify(ctx.json),
    at: Date.now(),
  });
}

/** A fal.ai queue result: the files, under what the submit asked; the answer with the kept URLs. */
async function keepResult(ctx: AssetContext, answer: Record<string, unknown>): Promise<{ answer: unknown; assetId: string } | null> {
  const id = falResultId(ctx.target.path);
  if (!id) return null;
  const ref = db.doc(`${ASSET_ROOT}/${ctx.uid}/pending/${id}`);
  const pending = (await ref.get()).data() as (Omit<AssetRecord, 'params'> & { params: string; body: string }) | undefined;
  // Asked before assets were kept, or by another account: passed on as it is.
  if (!pending) return null;
  const body = JSON.parse(pending.body) as Record<string, unknown>;
  const record: AssetRecord = { ...pending, params: JSON.parse(pending.params), falRequestId: id };
  delete (record as Partial<{ body: string }>).body;
  const media = falMedia(answer);
  const kept = await keepAsset(ctx.uid, record, media.map((m) => ({ role: m.role, url: m.url, contentType: m.contentType })), answer, 'fal-submit');
  await ref.delete().catch(() => undefined);
  const alias = rigAliasOf(record.model, body, kept.answer as Record<string, unknown>);
  if (alias) {
    const fp = await requestFingerprint('queue.fal.run', '/fal-ai/meshy/rigging', alias.body);
    const files = kept.files.filter((f) => f.role.startsWith('rigged_character_glb'));
    if (files.length) await pointAt(ctx.uid, fp, kept.assetId, { kind: 'rig', model: record.model }, 'fal-submit', files, JSON.stringify(alias.answer));
  }
  return kept.files.length ? { answer: kept.answer, assetId: kept.assetId } : null;
}

/**
 * A JSON answer from a provider, kept where it made something: fal.ai's files copied and its URLs
 * replaced by the bucket's, Google's picture put in the bucket and named in `rpgAsset`, a designed
 * voice's previews kept. Answers the bytes to send, and the asset's id when one was kept.
 */
export async function keepJson(ctx: AssetContext, bytes: Buffer, usd: number | null): Promise<{ bytes: Buffer; assetId: string | null }> {
  try {
    const answer = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
    switch (ctx.route.shape) {
      case 'fal-json': {
        const media = falMedia(answer);
        if (media.length === 0) return { bytes, assetId: null };
        const kept = await keepAsset(ctx.uid, recordFor(ctx, usd), media.map((m) => ({ role: m.role, url: m.url, contentType: m.contentType })), answer, 'fal-json');
        return kept.files.length ? { bytes: Buffer.from(JSON.stringify(kept.answer)), assetId: kept.assetId } : { bytes, assetId: null };
      }
      case 'fal-submit':
        await noteSubmit(ctx, answer, usd);
        return { bytes, assetId: null };
      case 'fal-result': {
        const kept = await keepResult(ctx, answer);
        return kept ? { bytes: Buffer.from(JSON.stringify(kept.answer)), assetId: kept.assetId } : { bytes, assetId: null };
      }
      case 'google-image': {
        type Part = { inlineData?: { mimeType?: string; data?: string } };
        const candidates = (answer.candidates ?? []) as { content?: { parts?: Part[] } }[];
        const picture = candidates[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
        if (!picture?.data) return { bytes, assetId: null };
        const model = typeof answer.modelVersion === 'string' ? answer.modelVersion : undefined;
        const kept = await keepAsset(ctx.uid, recordFor(ctx, usd, model), [{ role: 'image', bytes: Buffer.from(picture.data, 'base64'), contentType: picture.mimeType ?? 'image/png' }], undefined, 'google-image');
        if (!kept.files.length) return { bytes, assetId: null };
        return { bytes: Buffer.from(JSON.stringify({ ...answer, rpgAsset: { id: kept.assetId, url: kept.files[0].url } })), assetId: kept.assetId };
      }
      case 'voice-design': {
        type Preview = { audio_base_64?: string; generated_voice_id?: string; media_type?: string };
        const previews = (Array.isArray(answer.previews) ? answer.previews : []) as Preview[];
        const sources = previews
          .filter((p) => p.audio_base_64)
          .map((p, i) => ({ role: `preview-${i}-${p.generated_voice_id ?? ''}`, bytes: Buffer.from(p.audio_base_64 as string, 'base64'), contentType: p.media_type ?? 'audio/mpeg' }));
        if (!sources.length) return { bytes, assetId: null };
        const kept = await keepAsset(ctx.uid, recordFor(ctx, usd), sources);
        return { bytes, assetId: kept.files.length ? kept.assetId : null };
      }
      default:
        return { bytes, assetId: null };
    }
  } catch (e) {
    reportError('rpgAssets.keep', e, { route: ctx.target.path });
    return { bytes, assetId: null };
  }
}

/** Audio a provider streamed (a line, the score), kept once the last byte has passed. */
export async function keepAudio(ctx: AssetContext, bytes: Buffer, contentType: string, usd: number | null): Promise<string | null> {
  if (ctx.route.shape !== 'audio' || bytes.length === 0) return null;
  try {
    const kept = await keepAsset(ctx.uid, recordFor(ctx, usd), [{ role: ctx.route.kind, bytes, contentType: contentType.split(';')[0] || 'audio/mpeg' }], undefined, 'audio');
    return kept.files.length ? kept.assetId : null;
  } catch (e) {
    reportError('rpgAssets.keep', e, { route: ctx.target.path });
    return null;
  }
}

/** A piece the job runner made (`jobs.ts`): kept like the gateway's, its URL the bucket's after. Never throws. */
export async function keepJobFile(
  uid: string,
  record: Omit<AssetRecord, 'kind' | 'provider' | 'route' | 'payer' | 'fingerprint' | 'params'> & { params: Record<string, unknown> },
  source: { role: string; url: string; bytes?: Buffer; contentType: string | null },
): Promise<string> {
  try {
    const kept = await keepAsset(
      uid,
      { ...record, kind: falKind(record.model), provider: 'fal', route: `fal/${record.model}`, payer: 'account', fingerprint: null, params: paramsOf(record.params) },
      [source],
    );
    return kept.files[0]?.url ?? source.url;
  } catch (e) {
    reportError('rpgAssets.job', e, { model: record.model });
    return source.url;
  }
}

/** The bytes of a rig the browser worked out itself (`people.ts`), kept by its cache key's hash. */
export async function handleSelfRig(uid: string, id: string, method: string, body: Buffer | undefined, meta: string | null, res: Response): Promise<void> {
  if (!/^[0-9a-f]{40}$/.test(id)) {
    res.status(400).json({ reason: 'id', error: { message: 'rpg assets: not a rig id' } });
    return;
  }
  const ref = db.doc(`${ASSET_ROOT}/${uid}/requests/${id}`);
  if (method === 'GET') {
    const p = (await ref.get()).data() as Pointer | undefined;
    if (!p?.files?.length) {
      res.status(404).json({ reason: 'missing' });
      return;
    }
    res.set(REUSED_HEADER, p.assetId);
    res.status(200).type('application/octet-stream').send(await readFile(p.files[0].path));
    return;
  }
  if (method !== 'PUT' || !body?.length || body.length > 16 * 1024 * 1024) {
    res.status(400).json({ reason: 'body', error: { message: 'rpg assets: a rig is PUT as its bytes' } });
    return;
  }
  let params: Record<string, unknown> = {};
  try {
    params = meta ? (JSON.parse(meta) as Record<string, unknown>) : {};
  } catch {
    /* kept without */
  }
  const record: AssetRecord = {
    kind: 'self-rig',
    provider: 'browser',
    model: typeof params.weights === 'string' ? `self-rig/${params.weights}` : 'self-rig',
    route: 'self-rig',
    prompt: '',
    params: paramsOf(params),
    usd: 0,
    world: null,
    quest: null,
    payer: null,
    fingerprint: id,
  };
  const kept = await keepAsset(uid, record, [{ role: 'rig', bytes: body, contentType: 'application/octet-stream' }], undefined, 'audio');
  res.status(200).json({ assetId: kept.assetId });
}
