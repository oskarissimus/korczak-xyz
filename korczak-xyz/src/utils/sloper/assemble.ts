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

export function totalBytes(blobs: Blob[]): number {
  return blobs.reduce((sum, blob) => sum + blob.size, 0);
}

export async function assembleVideo(
  metadata: AssemblyMetadata,
  images: Blob[],
  audioFiles: Blob[],
  signal?: AbortSignal,
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

  return {
    video: await response.blob(),
    duration: Number.parseFloat(response.headers.get('X-Video-Duration') || '0'),
  };
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
