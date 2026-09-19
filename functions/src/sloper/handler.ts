/*
 * The HTTPS half of `assembleVideo`: auth, CORS, multipart, temp files, cleanup.
 *
 * TWO REQUEST SHAPES, ONE ENDPOINT. A multipart body is the original conversation — the browser
 * sends the pictures and the narrations, waits through the encode on a streamed heartbeat, and
 * catches the MP4 on the way back. A JSON body naming a project is the background mode: the
 * assets are already in the account, the job is already written down there, and this call is the
 * poke that gets it done (`job.ts`). The second is what the page uses whenever there is an account
 * to save to, because it is the one that survives the tab being closed; the first is what is left
 * when there is nowhere to have saved the assets in the first place.
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
 *
 * THE ANSWER IS STREAMED, AND THAT IS NOT AN OPTIMISATION — IT IS THE ONLY REASON A REAL PROJECT
 * FINISHES. Encoding is roughly real time: ten scenes measured at 63.8 s on the deployed
 * instance, for 54 s of video. WebKit gives up on a request that has gone 60 s without a single
 * byte arriving, and it reports that as `TypeError: Load failed` — the same four words a
 * cross-origin refusal produces, which is what made this look like the bucket's CORS all over
 * again. It is not. The function had already finished: a 200 with the finished MP4 went out at
 * 65.1 s, to a phone that had hung up at 60 and thrown the video away. Anything under a minute —
 * every one-scene test this was built with — never saw it.
 *
 * So `AssemblyStream` sends the response head the moment the upload has been read and validated,
 * and a heartbeat line every 10 s while ffmpeg runs. A byte arriving is what resets WebKit's
 * clock, so the wait can now be as long as the platform's own 540 s and no longer than that.
 * The frames are documented on `AssemblyStream` and read by `readAssemblyStream` in
 * `src/utils/sloper/assemble.ts` — one protocol written twice, like `parseMultipart` above it.
 *
 * ONCE THE HEAD IS OUT THERE IS NO STATUS CODE LEFT TO SEND. Everything that can be refused with
 * one — a bad token, a malformed metadata field, an upload over the cap — is checked *before*
 * the stream opens, and keeps its 401 or its 400. Only ffmpeg itself can fail after that, and it
 * fails as an `error` frame inside a 200.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Busboy from 'busboy';
import type { Response } from 'express';
import type { Request } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';

import { AssemblyJobError } from '../../../korczak-xyz/src/utils/sloper/job';
import { assemble } from './ffmpeg';
import { runAssemblyJob } from './job';
import { BadRequestError, checkCounts, corsOrigin, parseMetadata } from './metadata';
import { flushSentry, reportError } from '../sentry';

export const MAX_BYTES = 32 * 1024 * 1024;

/**
 * What a project id may look like, as a doc id and as a path segment.
 *
 * `projectId.ts` in the browser mints eleven characters of base64URL and this could insist on
 * exactly that — it deliberately does not, because the only thing the shape has to buy here is
 * that the string cannot climb out of a Firestore collection or a bucket folder. Anything that
 * survives this is still checked against the account's own folder before a byte is read.
 */
const PROJECT_ID = /^[A-Za-z0-9_-]{1,64}$/;

interface UploadedFile {
  field: 'images' | 'audio';
  data: Buffer;
}

export interface ParsedForm {
  metadata?: string;
  /**
   * `"1"` from a client that can read the streamed answer.
   *
   * It is a form field rather than a request header because a header would have to be named in
   * `Access-Control-Allow-Headers`, and the function that is already deployed does not name it —
   * so a new page would fail its preflight against the old function for the minutes the two
   * deploys are out of step. An unknown field is ignored by the old parser, in both directions.
   * Once a deploy of both halves has settled this can go, and the stream become the only answer.
   */
  stream?: string;
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
      if (name === 'stream') form.stream = value;
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

/**
 * `application/vnd.sloper.assembly+octet-stream` — the streamed answer, and the whole protocol.
 *
 * One JSON object per line, UTF-8, each closed by `\n`:
 *
 *   {"status":"working","elapsedMs":10000}   zero or more, one every 10 s while ffmpeg runs
 *   {"status":"error","message":"…"}         the stream ends here, nothing follows
 *   {"status":"done","duration":54.1,"bytes":2548123,"filename":"…"}
 *
 * A `done` frame is followed immediately by exactly `bytes` bytes of MP4 and nothing else, which
 * is why the length is in the frame: the reader has no other way to know it got all of it, and a
 * connection dropped at 90% would otherwise become a video file that plays until it does not.
 *
 * The content type is the whole handshake. A reader that does not recognise it treats the body as
 * a plain MP4, which is what the previous version of this function sent and what a proxy that
 * rewrites bodies would leave behind — so an unframed answer is never parsed as a framed one.
 */
export const STREAM_CONTENT_TYPE = 'application/vnd.sloper.assembly+octet-stream';

/**
 * Well inside WebKit's 60 s and generous about a slow link — the heartbeat's only job is to be a
 * byte, so sending it more often than this buys nothing and writes a line per beat to no reader.
 */
const HEARTBEAT_MS = 10_000;

/** Exported for `handler.test.ts`, which reads the frames back the way the browser does. */
export class AssemblyStream {
  private timer: NodeJS.Timeout | undefined;
  private opened = false;

  constructor(
    private readonly res: Response,
    private readonly started: number,
  ) {}

  get isOpen(): boolean {
    return this.opened;
  }

  /** Sends the head and the first heartbeat, and starts the clock that sends the rest. */
  begin(): void {
    this.res.status(200);
    this.res.set('Content-Type', STREAM_CONTENT_TYPE);
    // Nothing in front of this may hold a chunk back waiting for more: holding it back is exactly
    // the 60 s of silence the frames exist to break.
    this.res.set('Cache-Control', 'no-store');
    this.res.set('X-Accel-Buffering', 'no');
    this.res.flushHeaders();
    this.opened = true;

    // A phone that walked out of coverage mid-encode leaves ffmpeg running and this socket dead.
    // Writing a heartbeat to it throws from inside a timer, where there is no caller to catch it
    // and an uncaught throw takes the instance down with every other request on it.
    this.res.on('close', () => this.stop());
    // EPIPE arrives as an event rather than a throw, and an unhandled one on a stream is fatal to
    // the process — which is the same instance every other assembly in flight is running on.
    this.res.on('error', () => this.stop());

    this.beat();
    this.timer = setInterval(() => this.beat(), HEARTBEAT_MS);
  }

  done(video: Buffer, duration: number, filename: string): void {
    this.stop();
    this.frame({ status: 'done', duration, bytes: video.length, filename });
    this.end(video);
  }

  failed(message: string): void {
    this.stop();
    this.frame({ status: 'error', message });
    this.end();
  }

  private end(body?: Buffer): void {
    if (this.res.writableEnded || this.res.destroyed) return;
    try {
      if (body) this.res.end(body);
      else this.res.end();
    } catch {
      // Same as `frame`: the reader hung up, and the request is over either way.
    }
  }

  private beat(): void {
    this.frame({ status: 'working', elapsedMs: Date.now() - this.started });
  }

  private frame(value: Record<string, unknown>): void {
    if (this.res.writableEnded || this.res.destroyed) return;
    try {
      this.res.write(`${JSON.stringify(value)}\n`);
    } catch {
      // The reader is gone. The encode it was waiting for finishes anyway and is thrown away;
      // there is nobody left to tell, and the alternative is killing the instance to say so.
      this.stop();
    }
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

/** The name the browser saves it under, and the only thing in the answer that reads a clock. */
function videoFilename(): string {
  return `slop-video-${new Date().toISOString().slice(0, 10)}.mp4`;
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
  let stream: AssemblyStream | undefined;

  try {
    const uid = await verifyCaller(req);

    /*
     * THE BACKGROUND MODE, AND WHY IT IS A SECOND SHAPE ON THE SAME ENDPOINT.
     *
     * A JSON body naming a project means "the job is already written down in the account; go and
     * do it". Nothing else is sent, nothing is expected back, and the caller may hang up the
     * instant after asking — which is the whole point, and is what lets somebody press Assemble
     * and close the browser.
     *
     * It is this function rather than a new one for a reason worth knowing before splitting it:
     * `assemblevideo` already carries the public invoker binding in terraform/functions.tf, and a
     * new function would be a new binding on a service that does not exist yet — the two-pass
     * landing that file describes. A second request shape needs neither. The preflight is already
     * answered and `Content-Type` is already in `Access-Control-Allow-Headers`, so nothing about
     * CORS moves either.
     *
     * It is checked before the multipart parse because busboy would otherwise be handed a JSON
     * body and fail with a sentence about a form.
     */
    if ((req.headers['content-type'] || '').includes('application/json')) {
      const projectId = String((req.body as { projectId?: unknown })?.projectId ?? '');
      if (!PROJECT_ID.test(projectId)) {
        throw new BadRequestError('No project was named for the assembler to work on.');
      }

      const outcome = await runAssemblyJob(uid, projectId, started);
      res.status(200).json({ ok: true, ...outcome });
      return;
    }

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

    /*
     * Last point at which a status code is still possible, so it is where the stream opens.
     * Everything above this line can be refused with a 401 or a 400; everything below it is
     * ffmpeg, which takes a minute and would otherwise take it in silence.
     */
    if (form.stream === '1') {
      stream = new AssemblyStream(res, started);
      stream.begin();
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

    const filename = videoFilename();

    if (stream) {
      stream.done(video, duration, filename);
    } else {
      res.set('Content-Type', 'video/mp4');
      res.set('Content-Length', String(video.length));
      res.set('X-Video-Duration', String(duration));
      res.set('Content-Disposition', `attachment; filename="${filename}"`);
      res.status(200).send(video);
    }
  } catch (error) {
    if (stream?.isOpen) {
      streamTheError(stream, error, Date.now() - started);
    } else {
      respondWithError(res, error, Date.now() - started);
    }
  } finally {
    // The instance is reused between requests, so a temp directory left behind is a leak that
    // eventually fills /tmp — which on Cloud Run is memory.
    if (workDir) {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
    // Anything reported above has to leave before the platform freezes the instance. Bounded and
    // non-throwing, so it cannot turn a delivered video into a failed request.
    await flushSentry();
  }
}

/**
 * The same refusal, once the head has gone out and a status code is no longer on the table.
 *
 * Only ffmpeg and the finished file's own size can get this far — auth and the metadata are
 * settled before the stream opens — so this is a 500's worth of message inside a 200, and it is
 * logged as one.
 */
function streamTheError(stream: AssemblyStream, error: unknown, elapsedMs: number): void {
  const message = error instanceof Error ? error.message : 'Video assembly failed';
  console.error('assembleVideo.failed', JSON.stringify({ message, elapsedMs, streamed: true }));
  // Reported for the same reason it is logged: by this point the caller has paid for every image
  // and every second of narration in the video, and a 200 carrying a failure is the easiest kind
  // of error to lose track of.
  reportError('assembleVideo', error, { elapsedMs, streamed: true });
  stream.failed(message);
}

function respondWithError(res: Response, error: unknown, elapsedMs: number): void {
  if (error instanceof UnauthorizedError) {
    res.status(401).json({ error: 'UNAUTHENTICATED', message: error.message });
    return;
  }
  // `AssemblyJobError` is the job document refusing to be read — a malformed scene list, a
  // duration that is not a number. It is the same class of answer as a bad metadata field.
  if (error instanceof BadRequestError || error instanceof AssemblyJobError) {
    res.status(400).json({ error: 'INVALID_REQUEST', message: error.message });
    return;
  }

  const message = error instanceof Error ? error.message : 'Video assembly failed';
  console.error('assembleVideo.failed', JSON.stringify({ message, elapsedMs }));
  // Only this branch. The 401 and 400 above are the handler answering a bad request correctly,
  // and reporting those would turn an expired token into a Sentry issue.
  reportError('assembleVideo', error, { elapsedMs, streamed: false });
  res.status(500).json({ error: 'ASSEMBLY_FAILED', message });
}
