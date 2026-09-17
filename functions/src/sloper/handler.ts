/*
 * The HTTPS half of `assembleVideo`: auth, CORS, multipart, temp files, cleanup.
 *
 * ONE TOKEN CHECK, DONE BY HAND. This is `onRequest`, not `onCall`, because the payload is tens
 * of megabytes of binary and `onCall` is JSON — base64 would put a third on top of a body that is
 * already at the platform's ceiling. `onCall`'s free `request.auth` goes with it, so the bearer
 * token is verified here. The function is `allUsers`-invokable (terraform/functions.tf) in the
 * same sense `sendTestPush` is: reachable, not unguarded.
 *
 * MULTIPART BY HAND TOO. Cloud Functions reads the whole body before the handler runs and hands
 * it over as `req.rawBody`; by then Express's own body parsers have had a go at it and anything
 * streaming the request is too late. Busboy over the buffer is the documented way through.
 *
 * THE 32 MiB, BOTH WAYS. It bounds the upload, and it also bounds the MP4 that comes back — a
 * response over it is truncated by the platform, which reaches the browser as a corrupt file
 * rather than an error. So the finished video is measured before it is sent, and an oversized one
 * is refused with a sentence that says what to change. The frontend keeps the same limit on the
 * way in (src/utils/sloper/assemble.ts) so that most of this is never reached.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Busboy from 'busboy';
import type { Response } from 'express';
import type { Request } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';

import { assemble } from './ffmpeg';
import { BadRequestError, checkCounts, corsOrigin, parseMetadata } from './metadata';

export const MAX_BYTES = 32 * 1024 * 1024;

interface UploadedFile {
  field: 'images' | 'audio';
  data: Buffer;
}

export interface ParsedForm {
  metadata?: string;
  files: UploadedFile[];
}

/**
 * Exported for `handler.test.ts`, which feeds it a body built by the platform's own `FormData` —
 * the same serializer the browser uses in `src/utils/sloper/assemble.ts`. That seam is the one
 * thing about this function neither side can check alone: the client names its parts and the
 * server reads them, in two runtimes, with no shared type between them.
 */
export function parseMultipart(req: Request): Promise<ParsedForm> {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({
      headers: req.headers,
      limits: { fileSize: MAX_BYTES, files: 256, fields: 8 },
    });

    const form: ParsedForm = { files: [] };
    let failed = false;

    const fail = (error: Error) => {
      if (failed) return;
      failed = true;
      reject(error);
    };

    busboy.on('field', (name, value) => {
      if (name === 'metadata') form.metadata = value;
    });

    busboy.on('file', (name, stream) => {
      if (name !== 'images' && name !== 'audio') {
        // Drain it: an unread stream stalls busboy rather than being skipped.
        stream.resume();
        return;
      }

      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('limit', () => fail(new BadRequestError('One of the uploaded files is too large')));
      stream.on('end', () => form.files.push({ field: name, data: Buffer.concat(chunks) }));
    });

    busboy.on('error', (error: unknown) =>
      fail(error instanceof Error ? error : new Error('Could not read the upload')),
    );
    busboy.on('finish', () => {
      if (!failed) resolve(form);
    });

    // `rawBody` is what Cloud Functions gives instead of a readable request.
    busboy.end(req.rawBody);
  });
}

/** Who is calling, from the `Authorization: Bearer <Firebase ID token>` header. */
async function verifyCaller(req: Request): Promise<string> {
  const header = req.headers.authorization ?? '';
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) throw new UnauthorizedError('Sign in first.');

  try {
    const decoded = await getAuth().verifyIdToken(match[1]);
    return decoded.uid;
  } catch {
    // Deliberately not echoing the SDK's reason: "token expired" and "token forged" are the same
    // instruction to the person reading it.
    throw new UnauthorizedError('That sign-in is not valid any more. Reload and try again.');
  }
}

class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

function applyCors(req: Request, res: Response): void {
  const origin = corsOrigin(req.headers.origin);
  if (origin) {
    res.set('Access-Control-Allow-Origin', origin);
    // The allowlist varies by request, so caches must not serve one origin's answer to another.
    res.set('Vary', 'Origin');
  }
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.set('Access-Control-Expose-Headers', 'X-Video-Duration, Content-Disposition');
  res.set('Access-Control-Max-Age', '3600');
}

export async function handleAssembleVideo(req: Request, res: Response): Promise<void> {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'METHOD_NOT_ALLOWED', message: 'POST a multipart form here.' });
    return;
  }

  const started = Date.now();
  let workDir: string | undefined;

  try {
    const uid = await verifyCaller(req);

    const form = await parseMultipart(req);
    const meta = parseMetadata(form.metadata);

    const images = form.files.filter((f) => f.field === 'images').map((f) => f.data);
    const audio = form.files.filter((f) => f.field === 'audio').map((f) => f.data);
    checkCounts(meta, images.length, audio.length);

    const uploadBytes = [...images, ...audio].reduce((sum, b) => sum + b.length, 0);
    if (uploadBytes > MAX_BYTES) {
      throw new BadRequestError(
        `The upload is ${(uploadBytes / 1024 / 1024).toFixed(1)} MB, over the ${MAX_BYTES / 1024 / 1024} MB limit.`,
      );
    }

    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sloper-'));

    const imagePaths: string[] = [];
    for (const [i, data] of images.entries()) {
      const p = path.join(workDir, `image_${i}.jpg`);
      await fs.writeFile(p, data);
      imagePaths.push(p);
    }

    const audioPaths: string[] = [];
    for (const [i, data] of audio.entries()) {
      const p = path.join(workDir, `audio_${i}.mp3`);
      await fs.writeFile(p, data);
      audioPaths.push(p);
    }

    const outputPath = path.join(workDir, 'output.mp4');
    const duration = await assemble({
      imagePaths,
      audioPaths,
      sceneDurations: meta.scenes.map((s) => s.imageDuration),
      resolution: meta.resolution,
      frameRate: meta.frameRate,
      workDir,
      outputPath,
    });

    const video = await fs.readFile(outputPath);

    if (video.length > MAX_BYTES) {
      throw new BadRequestError(
        `The finished video is ${(video.length / 1024 / 1024).toFixed(1)} MB, more than can be sent back in one response. Use a smaller resolution or fewer scenes.`,
      );
    }

    console.log(
      'assembleVideo',
      JSON.stringify({
        uid,
        scenes: meta.scenes.length,
        uploadMB: +(uploadBytes / 1024 / 1024).toFixed(2),
        outputMB: +(video.length / 1024 / 1024).toFixed(2),
        durationS: +duration.toFixed(1),
        elapsedMs: Date.now() - started,
      }),
    );

    const filename = `slop-video-${new Date().toISOString().slice(0, 10)}.mp4`;
    res.set('Content-Type', 'video/mp4');
    res.set('Content-Length', String(video.length));
    res.set('X-Video-Duration', String(duration));
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(video);
  } catch (error) {
    respondWithError(res, error, Date.now() - started);
  } finally {
    // The instance is reused between requests, so a temp directory left behind is a leak that
    // eventually fills /tmp — which on Cloud Run is memory.
    if (workDir) {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function respondWithError(res: Response, error: unknown, elapsedMs: number): void {
  if (error instanceof UnauthorizedError) {
    res.status(401).json({ error: 'UNAUTHENTICATED', message: error.message });
    return;
  }
  if (error instanceof BadRequestError) {
    res.status(400).json({ error: 'INVALID_REQUEST', message: error.message });
    return;
  }

  const message = error instanceof Error ? error.message : 'Video assembly failed';
  console.error('assembleVideo.failed', JSON.stringify({ message, elapsedMs }));
  res.status(500).json({ error: 'ASSEMBLY_FAILED', message });
}
