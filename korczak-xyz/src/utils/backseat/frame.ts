/*
 * Taking the snapshot.
 *
 * A `<video>` element playing a camera stream, a canvas, and a JPEG out the other end. The whole
 * file is four lines of drawing and a great deal of arithmetic about size, because size is the
 * only decision here that costs money.
 *
 * WHY 512, AND WHY IT IS NOT A SETTING. OpenAI's `detail: 'low'` reads an image as a single
 * 512×512 tile however large it arrives, so anything above that is uploaded, paid for in mobile
 * data, and then thrown away by the provider. Google's pricing is per tile on the same order.
 * A frame every fifteen seconds for an hour is 240 uploads; at a phone camera's native 1920×1080
 * that is around 50 MB of somebody's data allowance for pictures no human will ever look at.
 * So the long side is capped, the aspect ratio is kept, and the result is JPEG rather than PNG:
 * a windscreen is a photograph, and PNG of a photograph is several times the bytes for detail a
 * joke does not need.
 *
 * Nothing here is React and nothing here is a hook, so the numbers can be tested without a canvas
 * — `frame.test.ts` covers `fitWithin` and the data-URL split, which are the two parts that have
 * ever been wrong.
 */

import type { Frame } from './types';

/** The long side of an uploaded frame, in pixels. Not a setting — see the note above. */
export const FRAME_LONG_SIDE = 512;

/** JPEG quality. Low enough to halve the bytes, high enough that road signs survive. */
export const FRAME_QUALITY = 0.6;

export const FRAME_MIME = 'image/jpeg';

/**
 * The size to draw at: the source scaled so its longest side is `longSide`, and never scaled up.
 *
 * Never up is the part worth stating. A front camera on a cheap phone may hand back 320×240, and
 * enlarging it to 512 uploads four times the bytes for exactly the same information.
 */
export function fitWithin(
  width: number,
  height: number,
  longSide = FRAME_LONG_SIDE,
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 0, height: 0 };
  }

  const scale = Math.min(1, longSide / Math.max(width, height));
  return {
    // Rounded, and floored at 1: a 512×1 source scaled by a small factor rounds to zero, and a
    // canvas of zero width throws rather than producing an empty image.
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * The base64 payload of a data URL, without the `data:<mime>;base64,` prefix.
 *
 * Google rejects the whole request if the prefix is left on, and the error it answers with talks
 * about the image rather than about the encoding — which is a long afternoon. Returns '' for
 * anything that is not a base64 data URL rather than throwing: the caller's next step is a network
 * call it should not make with an empty payload, and it checks.
 */
export function base64Payload(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  if (comma === -1 || !dataUrl.slice(0, comma).includes(';base64')) return '';
  return dataUrl.slice(comma + 1);
}

/**
 * One frame out of a playing `<video>`.
 *
 * Returns null rather than throwing when the video has no picture yet. That is the ordinary state
 * for the first second or two after `getUserMedia` resolves — and, on iOS, every time the app
 * comes back from the background, because the stream is suspended and `videoWidth` reads 0 until
 * it resumes. A caller that treated that as an error would stop the ride every time the phone was
 * unlocked.
 */
export function captureFrame(video: HTMLVideoElement): Frame | null {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (!sourceWidth || !sourceHeight) return null;

  const { width, height } = fitWithin(sourceWidth, sourceHeight);
  if (!width || !height) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) return null;

  context.drawImage(video, 0, 0, width, height);

  const dataUrl = canvas.toDataURL(FRAME_MIME, FRAME_QUALITY);
  const base64 = base64Payload(dataUrl);
  if (!base64) return null;

  return { dataUrl, base64, mimeType: FRAME_MIME, width, height };
}

/**
 * The camera, asked for politely.
 *
 * `facingMode` is a *preference* and not a constraint (`ideal`, not `exact`), which is the one
 * detail that matters: a laptop has no rear camera, and `exact: 'environment'` on one fails with
 * `OverconstrainedError` rather than falling back to the camera it does have. The app would then
 * refuse to start on the machine it is developed on.
 *
 * The resolution asked for is modest for the same reason the frame is small — it is what the
 * preview needs, and a 4K stream on a phone is battery spent on pixels that are downscaled to 512
 * before anybody sees them.
 */
export function cameraConstraints(facing: 'environment' | 'user'): MediaStreamConstraints {
  return {
    audio: false,
    video: {
      facingMode: { ideal: facing },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  };
}

/** Which of the browser's several refusals this was, in a form the UI can translate. */
export type CameraFailure = 'denied' | 'missing' | 'busy' | 'unsupported' | 'unknown';

export function classifyCameraError(err: unknown): CameraFailure {
  if (typeof err !== 'object' || err === null) return 'unknown';
  const name = (err as { name?: string }).name;

  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'missing';
    // Windows in particular hands the camera to one application at a time.
    case 'NotReadableError':
    case 'AbortError':
      return 'busy';
    default:
      return 'unknown';
  }
}

/**
 * Whether the browser can do this at all.
 *
 * `navigator.mediaDevices` is undefined — not throwing, undefined — on an insecure origin, which
 * is the shape this takes when somebody opens the dev server over a LAN address on their phone.
 * Saying "your browser cannot" there would be wrong; the UI says what is actually true.
 */
export function cameraSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

/** True on an origin where `getUserMedia` is allowed to exist at all. */
export function secureContext(): boolean {
  return typeof window === 'undefined' || window.isSecureContext;
}
