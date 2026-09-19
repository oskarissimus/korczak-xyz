/*
 * The one call in this app that does not go to a third party.
 *
 * FFmpeg cannot run in the page, so the images and the audio go to `assembleVideo` — a gen-2
 * HTTPS function in `functions/src/sloper/`, deployed by the same pipeline as the two collectors.
 * Everything else sloper does, the browser does itself.
 *
 * THE 32 MiB. Both directions of a gen-2 function are capped there, and the cap is the reason
 * `processImage` re-encodes every frame as JPEG. It is checked here as well as in the function,
 * because failing before a two-minute upload with a sentence about scene count is a better
 * answer than a 413 after it.
 *
 * WHY IT NEEDS A SIGN-IN. The function transcodes video on a machine we pay for, so it is not
 * open to the internet: it wants a Firebase ID token and rejects anything without one. That is
 * also why the wizard checks for a signed-in account before it starts, rather than at the last
 * step where the work is already spent.
 *
 * WHY THE ANSWER IS READ AS A STREAM. Encoding runs at roughly real time — ten scenes, 54 s of
 * video, 63.8 s on the instance — and WebKit abandons a request that has gone 60 s without a
 * byte arriving. It reports that abandonment as `TypeError: Load failed` and nothing else, which
 * is the same four words a cross-origin refusal produces, so the first reading of it was that the
 * bucket's CORS had broken again. It had not: the function answered 200 with the finished video
 * at 65.1 s, to a phone that had already given up at 60 and shown "The video could not be
 * assembled. Load failed." Every test this was built with was one scene and four seconds, which
 * is why it shipped.
 *
 * So the function now sends its head immediately and a heartbeat every 10 s while ffmpeg runs,
 * and `readAssemblyStream` below reads the frames. A byte arriving is what resets WebKit's clock,
 * so the ceiling is the function's own 540 s rather than the browser's minute.
 *
 * The `stream` field is the handshake and it is deliberately a form field, not a header: a header
 * would need naming in the deployed function's `Access-Control-Allow-Headers`, and the page and
 * the function do not deploy at the same instant. An old function ignores the field and answers
 * with a plain MP4, which is what the content-type check below falls back to; a new function
 * sends frames only to a client that asked for them. Both branches can go once a deploy of the
 * two halves has settled.
 */

import { getIdToken } from 'firebase/auth';

import { auth } from '../../lib/firebase';

export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

export interface SceneMetadata {
  index: number;
  /** Seconds this scene's image is held. Comes from the scene's audio, not from a setting. */
  imageDuration: number;
}

export interface AssemblyMetadata {
  scenes: SceneMetadata[];
  resolution: { width: number; height: number };
  frameRate: number;
}

export interface AssemblyResult {
  video: Blob;
  duration: number;
}

/**
 * Where the function lives.
 *
 * Built from the Firebase project id rather than configured, so there is one fewer environment
 * variable to get wrong — a gen-2 function is reachable at the same `cloudfunctions.net` host as
 * a gen-1 one. `PUBLIC_SLOPER_ASSEMBLE_URL` overrides it for the emulator.
 */
export function assembleUrl(): string {
  const override = import.meta.env.PUBLIC_SLOPER_ASSEMBLE_URL as string | undefined;
  if (override) return override;

  const project = import.meta.env.PUBLIC_FIREBASE_PROJECT_ID as string | undefined;
  if (!project) throw new Error('No Firebase project is configured, so the video cannot be assembled.');

  return `https://europe-central2-${project}.cloudfunctions.net/assembleVideo`;
}

/** The framed answer's content type. The protocol itself is documented in `functions/src/sloper/handler.ts`. */
export const STREAM_CONTENT_TYPE = 'application/vnd.sloper.assembly+octet-stream';

export function totalBytes(blobs: Blob[]): number {
  return blobs.reduce((sum, blob) => sum + blob.size, 0);
}

/**
 * Ask the assembler to make a video that is already written down in the account.
 *
 * THIS IS THE CALL THAT LETS THE BROWSER LEAVE. Nothing is uploaded — the pictures and the
 * narrations went into the bucket as they were made, and the job document says which of them to
 * use and for how long — so all that goes up is a project id, and the answer is written back into
 * the account rather than into this response. A page that closes a second after this is sent still
 * gets its video: Cloud Run does not abandon a request because the client hung up, and everything
 * the function needs it reads for itself.
 *
 * THE PROMISE IS NOT THE POINT, AND MUST NOT BE AWAITED BEFORE CARRYING ON. It settles when the
 * encode finishes, which is minutes — the same wait as the multipart path, just with nobody
 * obliged to sit through it. The caller fires it, ignores it, and watches the job document, which
 * is the only place either half of this can agree on what happened. What a rejection is still
 * worth is a fast one: a 401 or a 400 arrives in a second and says the assembler never started,
 * which is what the wizard falls back on.
 */
export async function startAssemblyJob(projectId: string, signal?: AbortSignal): Promise<void> {
  const user = auth?.currentUser;
  if (!user) throw new Error('Sign in before assembling — the assembler is not open to the internet.');
  const token = await getIdToken(user);

  const response = await fetch(assembleUrl(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ projectId }),
  });

  if (!response.ok) throw new Error(await readError(response));
}

export async function assembleVideo(
  metadata: AssemblyMetadata,
  images: Blob[],
  audioFiles: Blob[],
  signal?: AbortSignal,
  /** Called once the upload has landed and ffmpeg has started, so the screen can stop saying "sending". */
  onEncoding?: () => void,
): Promise<AssemblyResult> {
  const bytes = totalBytes([...images, ...audioFiles]);
  if (bytes > MAX_UPLOAD_BYTES) {
    const mb = (bytes / 1024 / 1024).toFixed(1);
    const limit = (MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0);
    throw new Error(
      `The images and audio come to ${mb} MB, over the ${limit} MB the assembler accepts. Use fewer scenes, or a smaller resolution.`,
    );
  }

  const user = auth?.currentUser;
  if (!user) throw new Error('Sign in before assembling — the assembler is not open to the internet.');
  const token = await getIdToken(user);

  const form = new FormData();
  form.append('metadata', JSON.stringify(metadata));
  // "I can read the framed answer." See the note at the top of this file for why it is a field.
  form.append('stream', '1');
  // Order is the contract: the function pairs images[i] with audio[i] with scenes[i].
  images.forEach((img, i) => form.append('images', img, `image_${i}.jpg`));
  audioFiles.forEach((audio, i) => form.append('audio', audio, `audio_${i}.mp3`));

  const response = await fetch(assembleUrl(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    signal,
    body: form,
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  if ((response.headers.get('Content-Type') || '').startsWith(STREAM_CONTENT_TYPE)) {
    return readAssemblyStream(response, onEncoding);
  }

  // An older function, or anything in between that rewrote the body: a plain MP4, as it was.
  return {
    video: await response.blob(),
    duration: Number.parseFloat(response.headers.get('X-Video-Duration') || '0'),
  };
}

interface DoneFrame {
  status: 'done';
  duration: number;
  bytes: number;
}

/**
 * Read the framed answer: JSON lines, then the MP4.
 *
 * The frames are `{"status":"working"}` while ffmpeg runs, and then either `{"status":"error"}`
 * and nothing, or `{"status":"done", bytes, duration}` followed by exactly `bytes` of MP4. The
 * byte count is checked rather than trusted: a connection cut at nine tenths of the way through
 * otherwise becomes a video that plays until it stops, saved to the account as if it were whole,
 * which is worse than the failure it came from.
 */
export async function readAssemblyStream(
  response: Response,
  onEncoding?: () => void,
): Promise<AssemblyResult> {
  const body = response.body;
  if (!body) throw new Error('The assembler answered with nothing to read.');

  const reader = body.getReader();
  const decoder = new TextDecoder();

  /** Bytes read but not yet resolved into a whole line. Only ever holds frames, never video. */
  let pending = new Uint8Array(0);
  let header: DoneFrame | null = null;
  const videoChunks: Uint8Array[] = [];
  let videoBytes = 0;
  let announced = false;

  for (;;) {
    const { done, value } = await reader.read();

    if (value && value.length > 0) {
      if (header) {
        videoChunks.push(value);
        videoBytes += value.length;
      } else {
        pending = concat(pending, value);

        // Whole lines only: a frame split across two chunks is not a frame yet, and decoding half
        // of one would also cut a multi-byte character in half.
        for (;;) {
          const newline = pending.indexOf(10);
          if (newline === -1) break;

          const line = decoder.decode(pending.subarray(0, newline)).trim();
          pending = pending.subarray(newline + 1);
          if (!line) continue;

          const frame = parseFrame(line);
          if (frame.status === 'error') {
            throw new Error(frame.message || 'Video assembly failed.');
          }
          if (frame.status === 'done') {
            header = frame;
            // Whatever came in behind the frame on the same chunk is already video.
            if (pending.length > 0) {
              videoChunks.push(pending);
              videoBytes += pending.length;
              pending = new Uint8Array(0);
            }
            break;
          }
          if (!announced) {
            // The first heartbeat is the upload having landed: ffmpeg has the files.
            announced = true;
            onEncoding?.();
          }
        }
      }
    }

    if (done) break;
  }

  if (!header) {
    throw new Error('The assembler stopped answering before the video was ready.');
  }
  if (videoBytes !== header.bytes) {
    throw new Error(
      `The video arrived incomplete — ${videoBytes} bytes of the ${header.bytes} it should have been.`,
    );
  }

  return {
    video: new Blob(videoChunks as BlobPart[], { type: 'video/mp4' }),
    duration: header.duration,
  };
}

type Frame =
  | { status: 'working' }
  | { status: 'error'; message?: string }
  | DoneFrame;

function parseFrame(line: string): Frame {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error('The assembler answered with something this page cannot read.');
  }

  const frame = parsed as Partial<DoneFrame> & { status?: string; message?: string };
  if (frame.status === 'error') return { status: 'error', message: frame.message };
  if (frame.status === 'done') {
    if (typeof frame.bytes !== 'number' || typeof frame.duration !== 'number') {
      throw new Error('The assembler said the video was ready without saying how big it is.');
    }
    return { status: 'done', bytes: frame.bytes, duration: frame.duration };
  }
  return { status: 'working' };
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.length === 0) return right;
  const joined = new Uint8Array(left.length + right.length);
  joined.set(left, 0);
  joined.set(right, left.length);
  return joined;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    const message = body?.message || body?.error;
    if (typeof message === 'string' && message) return message;
  } catch {
    // Not JSON — a proxy, or the platform's own 413 page.
  }
  if (response.status === 413) {
    return 'The assembler refused the upload as too large. Use fewer scenes, or a smaller resolution.';
  }
  return `Video assembly failed (${response.status} ${response.statusText || 'error'}).`;
}
