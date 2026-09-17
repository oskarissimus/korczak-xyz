/*
 * Getting a picture for each scene, and making it fit to be a video frame.
 *
 * Two providers with three endpoints between them — OpenAI's `/images/generations`, Gemini's
 * `:generateContent` and Imagen's `:predict` — and then a canvas pass every image goes through
 * whatever produced it. That pass is not decoration; each step of it fixes something that made a
 * video unwatchable or unsendable:
 *
 *   transparency  A PNG with alpha becomes BLACK when FFmpeg lays it on yuv420p, so a logo on a
 *                 transparent background arrives as a black rectangle. Flattened onto white.
 *   brightness    Slop image models love a near-black frame. Below mean luminance 50 it is lifted
 *                 rather than shipped, because the scene after it will not be and the cut reads
 *                 as a fault.
 *   JPEG          The one that decides whether the video can be made at all: the assembly
 *                 endpoint takes 32 MiB of upload, and twelve 1024x1536 PNGs do not fit in it.
 *
 * All four steps go through a `<canvas>`, so this module only works in a browser. The queue it
 * uses lives in concurrency.ts precisely so the queue can be tested and this cannot.
 */

import { ConcurrencyLimiter } from './concurrency';
import type { ImageQuality } from './types';

export interface ImageResult {
  data: Blob;
  dataUrl: string;
}

/** Mean luminance below which an image is lifted rather than used as it came. */
const BRIGHTNESS_THRESHOLD = 50;
const BRIGHTNESS_BOOST = 1.5;
const CONTRAST_BOOST = 1.2;
const JPEG_QUALITY = 0.85;

/** Twelve at a time has never been what hit a DALL-E rate limit; a scene per request has. */
export const imageLimiter = new ConcurrencyLimiter(12);

// --- OpenAI ---------------------------------------------------------------------------------

/**
 * DALL-E 3 serves three sizes and DALL-E 2 serves three others, neither list containing the
 * 1024x1536 the video settings default to. Asking for an unlisted size is a 400, so the closest
 * aspect ratio is chosen here and the difference is padded out by FFmpeg at assembly.
 */
function normalizeImageSize(requestedSize: string, model: string): string {
  const dalle3Sizes = ['1024x1024', '1024x1792', '1792x1024'];
  const dalle2Sizes = ['256x256', '512x512', '1024x1024'];
  const supported = model === 'dall-e-3' ? dalle3Sizes : dalle2Sizes;

  if (supported.includes(requestedSize)) return requestedSize;

  const [width, height] = requestedSize.split('x').map(Number);
  if (!width || !height) return '1024x1024';

  if (model !== 'dall-e-3') return '1024x1024';

  const ratio = width / height;
  if (ratio < 0.75) return '1024x1792';
  if (ratio > 1.33) return '1792x1024';
  return '1024x1024';
}

export interface ImageGenerationOptions {
  prompt: string;
  model: string;
  quality: ImageQuality;
  /** `${width}x${height}` from the video settings, before normalization. */
  size: string;
}

export async function generateImage(
  apiKey: string,
  options: ImageGenerationOptions,
  signal?: AbortSignal,
): Promise<ImageResult> {
  // `gpt-image-1` is the name the config carries; DALL-E 3 is what answers to it.
  const model = options.model === 'gpt-image-1' ? 'dall-e-3' : options.model;
  const size = normalizeImageSize(options.size, model);

  const body: Record<string, unknown> = { model, prompt: options.prompt, n: 1, size };
  if (model === 'dall-e-3') body.quality = options.quality === 'high' ? 'hd' : 'standard';
  if (model === 'dall-e-3' || model === 'dall-e-2') body.response_format = 'b64_json';

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `Image generation failed: ${response.status}`);
  }

  const result = await response.json();
  const first = result.data?.[0];

  if (first?.b64_json) return base64ToImageResult(first.b64_json, 'image/png');

  if (first?.url) {
    // Only DALL-E 2 without `response_format` lands here. The URL is short-lived and
    // cross-origin, so it is fetched now rather than handed to an <img> later.
    const imageResponse = await fetch(first.url, { signal });
    const blob = await imageResponse.blob();
    return { data: blob, dataUrl: await blobToDataUrl(blob) };
  }

  throw new Error('No image data in the response');
}

// --- Google ---------------------------------------------------------------------------------

export interface GoogleImageGenerationOptions {
  prompt: string;
  model: string;
  aspectRatio: string;
}

/** Gemini takes a ratio, not a size. Pick the listed one nearest the video's. */
export function deriveAspectRatio(width: number, height: number): string {
  const ratio = width / height;
  const supported = [
    { label: '16:9', value: 16 / 9 },
    { label: '9:16', value: 9 / 16 },
    { label: '4:3', value: 4 / 3 },
    { label: '3:4', value: 3 / 4 },
    { label: '1:1', value: 1 },
  ];

  let closest = supported[0];
  let minDiff = Math.abs(ratio - closest.value);
  for (const s of supported) {
    const diff = Math.abs(ratio - s.value);
    if (diff < minDiff) {
      minDiff = diff;
      closest = s;
    }
  }
  return closest.label;
}

const isImagenModel = (model: string) => model.startsWith('imagen-');

export function generateGoogleImage(
  apiKey: string,
  options: GoogleImageGenerationOptions,
  signal?: AbortSignal,
): Promise<ImageResult> {
  return isImagenModel(options.model)
    ? generateImagenImage(apiKey, options, signal)
    : generateGeminiImage(apiKey, options, signal);
}

async function generateImagenImage(
  apiKey: string,
  options: GoogleImageGenerationOptions,
  signal?: AbortSignal,
): Promise<ImageResult> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${options.model}:predict`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal,
      body: JSON.stringify({
        instances: [{ prompt: options.prompt }],
        parameters: { sampleCount: 1, aspectRatio: options.aspectRatio },
      }),
    },
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `Imagen image generation failed: ${response.status}`);
  }

  const prediction = (await response.json()).predictions?.[0];
  if (!prediction?.bytesBase64Encoded) throw new Error('No image data in the Imagen response');

  return base64ToImageResult(prediction.bytesBase64Encoded, prediction.mimeType || 'image/png');
}

async function generateGeminiImage(
  apiKey: string,
  options: GoogleImageGenerationOptions,
  signal?: AbortSignal,
): Promise<ImageResult> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${options.model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: options.prompt }] }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: { aspectRatio: options.aspectRatio },
        },
      }),
    },
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `Google image generation failed: ${response.status}`);
  }

  const parts = (await response.json()).candidates?.[0]?.content?.parts as
    | { text?: string; inlineData?: { mimeType: string; data: string } }[]
    | undefined;
  if (!parts) throw new Error('No parts in the Google image response');

  const imagePart = parts.find((p) => p.inlineData?.mimeType?.startsWith('image/'));
  if (!imagePart?.inlineData) {
    // A refusal comes back as prose in the text part, and saying which is far more use than
    // "no image": it is usually the image description the model would not draw.
    const reason = parts.find((p) => p.text)?.text || 'Unknown reason';
    throw new Error(`Google refused to generate the image: ${reason}`);
  }

  return base64ToImageResult(imagePart.inlineData.data, imagePart.inlineData.mimeType);
}

// --- bytes ----------------------------------------------------------------------------------

function base64ToImageResult(base64: string, mimeType: string): ImageResult {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return {
    data: new Blob([bytes], { type: mimeType }),
    dataUrl: `data:${mimeType};base64,${base64}`,
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read the image'));
    reader.readAsDataURL(blob);
  });
}

// --- the canvas pass ------------------------------------------------------------------------

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode the generated image'));
    img.src = dataUrl;
  });
}

function canvasFor(img: HTMLImageElement): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser gave no 2D canvas context');
  return { canvas, ctx };
}

function canvasToResult(
  canvas: HTMLCanvasElement,
  type: 'image/png' | 'image/jpeg',
  quality?: number,
): Promise<ImageResult> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Could not encode the processed image'));
          return;
        }
        resolve({ data: blob, dataUrl: canvas.toDataURL(type, quality) });
      },
      type,
      quality,
    );
  });
}

/** Mean perceived luminance, 0 (black) to 255 (white). */
export async function calculateBrightness(imageDataUrl: string): Promise<number> {
  const img = await loadImage(imageDataUrl);
  const { canvas, ctx } = canvasFor(img);
  ctx.drawImage(img, 0, 0);

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    total += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return total / (data.length / 4);
}

export async function hasTransparency(imageDataUrl: string): Promise<boolean> {
  const img = await loadImage(imageDataUrl);
  const { canvas, ctx } = canvasFor(img);
  ctx.drawImage(img, 0, 0);

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

export async function correctBrightness(imageDataUrl: string): Promise<ImageResult> {
  const img = await loadImage(imageDataUrl);
  const { canvas, ctx } = canvasFor(img);
  ctx.filter = `brightness(${BRIGHTNESS_BOOST}) contrast(${CONTRAST_BOOST})`;
  ctx.drawImage(img, 0, 0);
  return canvasToResult(canvas, 'image/png');
}

export async function flattenTransparency(imageDataUrl: string): Promise<ImageResult> {
  const img = await loadImage(imageDataUrl);
  const { canvas, ctx } = canvasFor(img);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  return canvasToResult(canvas, 'image/png');
}

export async function convertToJpeg(imageDataUrl: string): Promise<ImageResult> {
  const img = await loadImage(imageDataUrl);
  const { canvas, ctx } = canvasFor(img);
  // JPEG has no alpha: without this, anything transparent encodes as black.
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  return canvasToResult(canvas, 'image/jpeg', JPEG_QUALITY);
}

/**
 * The whole pass, in the order the steps depend on each other: flatten first so the brightness
 * reading is of pixels the video will actually show, then lift, then encode as JPEG last so the
 * size saving is not thrown away by a re-encode after it.
 */
export async function processImage(imageDataUrl: string, imageBlob: Blob): Promise<ImageResult> {
  let result: ImageResult = { data: imageBlob, dataUrl: imageDataUrl };

  if (await hasTransparency(result.dataUrl)) {
    result = await flattenTransparency(result.dataUrl);
  }

  if ((await calculateBrightness(result.dataUrl)) < BRIGHTNESS_THRESHOLD) {
    result = await correctBrightness(result.dataUrl);
  }

  return convertToJpeg(result.dataUrl);
}
