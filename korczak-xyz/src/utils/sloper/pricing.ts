/*
 * What a sitting is about to cost, before it is spent.
 *
 * Ported from sloper unchanged in substance. Everything here is arithmetic over
 * `pricing.json`, which is a scrape with a date on it — so every number this module produces is
 * shown beside that date and never presented as a bill.
 *
 * The estimate is over the *target*, not the result: 2.5 words a second of narration, five
 * characters a word. It is deliberately not the same calculation as `calculateCost` in llm.ts,
 * which runs afterwards over the token counts the provider actually reported.
 *
 * Three things about the table are choices rather than transcription, and a refresh has to keep
 * making them:
 *
 *   DeepSeek       bills peak and off-peak, off-peak being half. The table carries the *peak*
 *                  rate, so the estimate is the one that cannot be beaten by the clock.
 *   ElevenLabs     stopped varying the per-character rate by plan — $0.05 per 1k characters for
 *                  Flash/Turbo and $0.10 for the multilingual models, whoever you are. The plan
 *                  column is kept because the config field and the saved documents are, and
 *                  because `free` is still not a dollar figure: nothing is billed inside the
 *                  allowance, which is the `costFreePlan` line rather than a price.
 *   Gemini images  are priced per output resolution now. The table takes the 1k rate, which is
 *                  what images.ts asks for.
 *
 * OpenAI's image models moved to token billing, but the per-image numbers below still come out
 * of it exactly: an image is 272/1056/4160 output tokens at low/medium/high square, 408/1584/6240
 * portrait, so gpt-image-1 at $40 per 1M is the $0.011/$0.042/$0.167 the table lists.
 */

import pricingData from './pricing.json';
import type { ImageProvider, ImageQuality, TtsPlan } from './types';

export interface LlmPricing {
  input: number;
  cachedInput: number | null;
  output: number;
}

export interface LlmCostEstimate {
  promptTokens: number;
  completionTokens: number;
  totalCost: number;
  /** False when the model was not in the scrape and gpt-4o's rates stood in for it. */
  modelFound: boolean;
}

export interface ImageCostEstimate {
  perImage: number | null;
  total: number | null;
  isGemini: boolean;
  modelFound: boolean;
}

export interface TtsCostEstimate {
  totalChars: number;
  perKChars: number | null;
  totalCost: number | null;
  modelFound: boolean;
}

export const SCRAPED_AT = pricingData.scrapedAt;

const llmPricing = pricingData.llm as Record<string, LlmPricing>;
const imagePricing = pricingData.image as Record<string, Record<string, Record<string, number>>>;
const geminiImagePricing = pricingData.geminiImage as Record<string, number>;
const ttsPricing = pricingData.tts as Record<string, Record<string, number | null>>;

const DEFAULT_LLM_MODEL = 'gpt-4o';
const AVG_CHARS_PER_WORD = 5;
const WORDS_PER_SECOND = 2.5;

export { llmPricing as LLM_PRICING };

// --- the script ---------------------------------------------------------------------------

export function estimateLlmCost(
  model: string,
  targetDuration: number,
  numScenes: number,
): LlmCostEstimate {
  const targetWords = targetDuration * WORDS_PER_SECOND;
  const promptTokens = 200;
  const completionTokens = Math.ceil(targetWords * 1.3 + numScenes * 100);

  const pricing = llmPricing[model];
  const rates = pricing ?? llmPricing[DEFAULT_LLM_MODEL];

  return {
    promptTokens,
    completionTokens,
    totalCost:
      (promptTokens / 1_000_000) * rates.input + (completionTokens / 1_000_000) * rates.output,
    modelFound: Boolean(pricing),
  };
}

// --- the images ---------------------------------------------------------------------------

/**
 * Map the video's resolution onto a size the price table actually lists.
 *
 * Mirrors `normalizeImageSize` in images.ts — deliberately, because an estimate quoted for
 * 1024x1024 against a request that will be sent as 1024x1792 is worse than no estimate.
 */
function normalizeSizeForPricing(width: number, height: number, model: string): string {
  const requested = `${width}x${height}`;
  const effectiveModel = model === 'gpt-image-1' ? 'dall-e-3' : model;

  const modelPricing = imagePricing[model];
  if (!modelPricing) return '1024x1024';

  const firstQuality = Object.values(modelPricing)[0];
  if (!firstQuality) return '1024x1024';

  const availableSizes = Object.keys(firstQuality);
  if (availableSizes.includes(requested)) return requested;

  const ratio = width / height;
  if (effectiveModel === 'dall-e-2') return '1024x1024';

  if (availableSizes.some((s) => s.includes('1792'))) {
    if (ratio < 0.75) return '1024x1792';
    if (ratio > 1.33) return '1792x1024';
    return '1024x1024';
  }

  if (ratio < 0.75) return '1024x1536';
  if (ratio > 1.33) return '1536x1024';
  return '1024x1024';
}

/** The config says low/medium/high; DALL-E 3's table says standard/hd. */
function normalizeQualityForPricing(quality: ImageQuality, model: string): string {
  const modelPricing = imagePricing[model];
  if (!modelPricing) return quality;

  const available = Object.keys(modelPricing);
  if (available.includes(quality)) return quality;
  if (available.includes('standard')) return quality === 'high' ? 'hd' : 'standard';
  return available[0] ?? quality;
}

/** Gemini model ids carry a date suffix, so an exact miss falls back to the longest prefix. */
function lookupGeminiImagePrice(model: string): number | null {
  if (model in geminiImagePricing) return geminiImagePricing[model];

  let best: { key: string; price: number } | null = null;
  for (const [key, price] of Object.entries(geminiImagePricing)) {
    if (model.startsWith(key) && (!best || key.length > best.key.length)) best = { key, price };
  }
  return best?.price ?? null;
}

export function estimateImageCost(
  provider: ImageProvider,
  model: string,
  quality: ImageQuality,
  resolution: { width: number; height: number },
  numScenes: number,
): ImageCostEstimate {
  if (provider === 'google') {
    const perImage = lookupGeminiImagePrice(model);
    return {
      perImage,
      total: perImage !== null ? perImage * numScenes : null,
      isGemini: true,
      modelFound: perImage !== null,
    };
  }

  const modelPricing = imagePricing[model];
  if (!modelPricing) {
    return { perImage: null, total: null, isGemini: false, modelFound: false };
  }

  const qualityKey = normalizeQualityForPricing(quality, model);
  const sizeKey = normalizeSizeForPricing(resolution.width, resolution.height, model);
  const perImage = modelPricing[qualityKey]?.[sizeKey] ?? null;

  return {
    perImage,
    total: perImage !== null ? perImage * numScenes : null,
    isGemini: false,
    modelFound: true,
  };
}

// --- the narration ---------------------------------------------------------------------------

function ttsPricingCategory(modelId: string): string {
  return modelId.includes('turbo') || modelId.includes('flash')
    ? 'flash_turbo'
    : 'multilingual_v2_v3';
}

export function estimateTtsCost(
  ttsModel: string,
  plan: TtsPlan,
  targetDuration: number,
): TtsCostEstimate {
  const totalChars = Math.round(targetDuration * WORDS_PER_SECOND * AVG_CHARS_PER_WORD);

  const categoryPricing = ttsPricing[ttsPricingCategory(ttsModel)];
  const perKChars = categoryPricing?.[plan] ?? null;

  return {
    totalChars,
    perKChars,
    totalCost: perKChars !== null ? (totalChars / 1000) * perKChars : null,
    modelFound: Boolean(categoryPricing),
  };
}

// --- the bill ---------------------------------------------------------------------------

/**
 * Null only when *both* unknown halves are unknown — an LLM estimate always exists, because an
 * unlisted model falls back to gpt-4o's rates rather than to nothing.
 */
export function estimateTotalCost(
  llm: LlmCostEstimate,
  image: ImageCostEstimate,
  tts: TtsCostEstimate,
): number | null {
  if (image.total === null && tts.totalCost === null) return llm.totalCost;
  return llm.totalCost + (image.total ?? 0) + (tts.totalCost ?? 0);
}

/** Dollars, with enough places to be worth reading at slop-video scale. */
export function formatUsd(amount: number): string {
  return `$${amount < 0.01 ? amount.toFixed(4) : amount.toFixed(2)}`;
}
