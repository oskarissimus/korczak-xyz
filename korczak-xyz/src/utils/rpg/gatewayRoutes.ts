/*
 * The RPG's gateway, the half both runtimes share (`functions/src/rpg/gateway.ts` serves it,
 * `gateway.ts` beside this file is the browser's side): which provider requests may pass through it,
 * how the key is put on them, and what each one costs.
 *
 * Owner, 31 Oct 2026: "every request to fal, Google and the rest goes through the server". The game
 * used to ask Google, OpenAI, ElevenLabs and fal.ai from the page with the reader's key in the
 * request, which is the one thing a paid tier cannot have: a key the page holds is a key the page
 * can spend outside any budget, and a cost the page computes is a cost the page can lie about. So
 * every such request now goes to `rpgApi` as `/{host}/{path}`, the server puts the key on it and
 * prices it, and the answer comes back byte for byte — the event streams included, so the `~`
 * console reads the tokens as they come exactly as it did.
 *
 * Only what the game sends passes (`ROUTES`). Anything else is a 404 from the gateway, not a request
 * to the provider: this is a key-holding proxy, and it must not be a general one.
 *
 * Prices are the same list prices the console shows (`cost.ts`, `falPrompts.ts`), so the server's
 * number and the console's agree; the server's is the one written to the ledger, which is where
 * prepaid credits will be taken from.
 */

import {
  MUSIC_CREDITS_PER_MINUTE,
  tokenCost,
  USD_PER_VOICE_CREDIT,
  voiceCreditsPerChar,
  type Usage,
} from './cost';
import { FAL_PRICES, imageCost } from './falPrompts';

export type GatewayProvider = 'google' | 'openai' | 'elevenlabs' | 'fal';

/** The account's key for each provider (`users/{uid}/keys/config`, `accountKeys/keys.ts`). */
export const GATEWAY_KEY_NAME = {
  google: 'google',
  openai: 'openai',
  elevenlabs: 'elevenLabs',
  fal: 'fal',
} as const satisfies Record<GatewayProvider, string>;

export const GATEWAY_HOSTS: Record<string, GatewayProvider> = {
  'generativelanguage.googleapis.com': 'google',
  'api.openai.com': 'openai',
  'api.elevenlabs.io': 'elevenlabs',
  'fal.run': 'fal',
  'queue.fal.run': 'fal',
  'rest.alpha.fal.ai': 'fal',
};

/** The header the page sends its own key in when the key is only in this browser (signed out). */
export const BYOK_HEADER = 'x-rpg-key';
/** The world and the quest a request is for, so the ledger can say what each one cost. */
export const WORLD_HEADER = 'x-rpg-world';
export const QUEST_HEADER = 'x-rpg-quest';

/** A world's or quest's id as a ledger document id: no slashes, nothing Firestore reserves, bounded. */
export function ledgerId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const id = raw.replace(/[^\w.:-]/g, '_').slice(0, 120);
  return id && !/^_+$/.test(id) && !/^__.*__$/.test(id) && id !== '.' && id !== '..' ? id : null;
}

/** What a request cost, in dollars, as the server priced it. */
export const COST_HEADER = 'x-rpg-cost-usd';
/** The last line of a priced event stream: an SSE comment, which every event reader skips. */
export const COST_EVENT = ': rpg-cost ';
/**
 * What the gateway says when nobody pays: no key of the reader's own and (later) no credits. In the
 * error's words so `funds.ts` reads it as an empty balance and puts up the banner.
 */
export const NO_CREDITS = 'rpg-credits: insufficient credits';

interface Route {
  host: string;
  methods: readonly string[];
  path: RegExp;
}

const MODEL = '[\\w.-]+';
const FAL_APP = '[\\w-]+/[\\w.\\-/]+';

const ROUTES: readonly Route[] = [
  // A beat, a world, a picture of a person.
  { host: 'generativelanguage.googleapis.com', methods: ['POST'], path: new RegExp(`^/v1beta/models/${MODEL}:(?:streamGenerateContent|generateContent)$`) },
  { host: 'api.openai.com', methods: ['POST'], path: /^\/v1\/chat\/completions$/ },
  // A line, a tagged line, the score, the library search, the voices the game designs and keeps.
  { host: 'api.elevenlabs.io', methods: ['POST'], path: /^\/v1\/text-to-speech\/\w+$/ },
  { host: 'api.elevenlabs.io', methods: ['POST'], path: /^\/v1\/text-to-dialogue$/ },
  { host: 'api.elevenlabs.io', methods: ['POST'], path: /^\/v1\/music(?:\/stream)?$/ },
  { host: 'api.elevenlabs.io', methods: ['GET'], path: /^\/v1\/shared-voices$/ },
  { host: 'api.elevenlabs.io', methods: ['GET'], path: /^\/v2\/voices$/ },
  { host: 'api.elevenlabs.io', methods: ['DELETE'], path: /^\/v1\/voices\/\w+$/ },
  { host: 'api.elevenlabs.io', methods: ['POST'], path: /^\/v1\/text-to-voice(?:\/design)?$/ },
  // fal.ai: a picture at once, a model through the queue (submit, status, result, cancel), an upload.
  { host: 'fal.run', methods: ['POST'], path: new RegExp(`^/${FAL_APP}$`) },
  { host: 'queue.fal.run', methods: ['POST', 'GET', 'PUT'], path: new RegExp(`^/${FAL_APP}$`) },
  { host: 'rest.alpha.fal.ai', methods: ['POST'], path: /^\/storage\/upload\/initiate$/ },
];

export interface GatewayTarget {
  provider: GatewayProvider;
  host: string;
  /** The provider's path, from its first slash. */
  path: string;
}

/** `/{host}/{path}` on the gateway → what it stands for, or null when it is not a request the game makes. */
export function gatewayTarget(gatewayPath: string, method: string): GatewayTarget | null {
  const m = /^\/([a-z0-9.-]+)(\/.*)$/.exec(gatewayPath);
  if (!m) return null;
  const [, host, path] = m;
  const provider = GATEWAY_HOSTS[host];
  if (!provider || path.includes('..') || path.includes('//')) return null;
  const ok = ROUTES.some((r) => r.host === host && r.methods.includes(method.toUpperCase()) && r.path.test(path));
  return ok ? { provider, host, path } : null;
}

/** The key, the way each provider wants it. */
export function credentialHeaders(provider: GatewayProvider, key: string): Record<string, string> {
  switch (provider) {
    case 'google':
      return { 'x-goog-api-key': key };
    case 'openai':
      return { Authorization: `Bearer ${key}` };
    case 'elevenlabs':
      return { 'xi-api-key': key };
    case 'fal':
      return { Authorization: `Key ${key}` };
  }
}

/** A fal.ai queue path that follows a request already made (status, result, cancel), not a new one. */
export function isFalFollowUp(path: string): boolean {
  return /\/requests\/[\w-]+(?:\/(?:status|cancel))?$/.test(path);
}

/**
 * What fal.ai bills for one request to `model`, list prices Oct 2026 — the same as the console's
 * (`PERSON_PAINTERS`, `PERSON_MESHERS`, `FAL_PRICES` in `landmark3d.ts`/`falPrompts.ts`). Null for a
 * model not listed: priced as unknown rather than as free.
 */
export function falCost(model: string, body: Record<string, unknown>): number | null {
  const size = body.image_size as { width?: number; height?: number } | undefined;
  const w = typeof size?.width === 'number' ? size.width : 512;
  const h = typeof size?.height === 'number' ? size.height : 512;
  switch (model) {
    case 'fal-ai/flux/schnell':
      return imageCost(w, h);
    case 'fal-ai/flux/dev':
      return Math.ceil((w * h) / 1_000_000) * 0.025;
    case 'fal-ai/flux-2':
      return 0.012;
    case 'fal-ai/nano-banana':
      return 0.0398;
    case 'fal-ai/nano-banana-2':
      return 0.08;
    case 'fal-ai/nano-banana-2.1':
      return 0.04;
    case 'fal-ai/nano-banana-lite':
      return 0.042;
    case 'fal-ai/trellis':
      return FAL_PRICES.mesh;
    case 'fal-ai/trellis-2':
      return 0.25;
    case 'tripo3d/tripo/v2.5/image-to-3d':
      return 0.3;
    case 'fal-ai/hunyuan3d/v2':
      return 0.48;
    case 'fal-ai/meshy/rigging':
      return FAL_PRICES.rig;
    case 'fal-ai/meshy/v6/image-to-3d':
      return FAL_PRICES.meshyMesh + (body.enable_rigging === true ? FAL_PRICES.rig : 0);
    case 'fal-ai/meshy/v6/text-to-3d':
      return FAL_PRICES.meshyMesh + FAL_PRICES.rig;
    default:
      return null;
  }
}

/** Gemini's list prices for its image models, US dollars per million tokens, Oct 2026 (ai.google.dev/gemini-api/docs/pricing). */
export const GEMINI_IMAGE_RATES: Record<string, { input: number; text: number; image: number }> = {
  'gemini-3.1-flash-lite-image': { input: 0.25, text: 1.5, image: 30 },
  'gemini-nano-banana-2.1': { input: 1.5, text: 7.5, image: 30 },
};

export interface GeminiImageUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  candidatesTokensDetails?: { modality?: string; tokenCount?: number }[];
}

/** What a picture cost, from the answer's token counts: the picture's own tokens at the image rate, the rest of the answer and the thinking at the text rate. */
export function geminiImageCost(model: string, u: GeminiImageUsage): number {
  const rate = GEMINI_IMAGE_RATES[model];
  if (!rate) return 0;
  const image = (u.candidatesTokensDetails ?? []).filter((d) => d.modality === 'IMAGE').reduce((n, d) => n + (d.tokenCount ?? 0), 0);
  const text = (u.candidatesTokenCount ?? 0) - image + (u.thoughtsTokenCount ?? 0);
  return ((u.promptTokenCount ?? 0) * rate.input + text * rate.text + image * rate.image) / 1_000_000;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * What a request costs that can be priced before the answer: a clip by its characters, the score by
 * its length, a fal.ai job by its model. Null for one priced by its answer (the models' tokens) or
 * that costs nothing (a status poll, a library search, a deleted voice).
 */
export function costUpfront(target: GatewayTarget, body: Record<string, unknown>): number | null {
  const { provider, path } = target;
  if (provider === 'elevenlabs') {
    const model = typeof body.model_id === 'string' ? body.model_id : 'eleven_flash_v2_5';
    if (path.startsWith('/v1/text-to-speech/')) {
      const chars = typeof body.text === 'string' ? body.text.length : 0;
      return chars * voiceCreditsPerChar(model) * USD_PER_VOICE_CREDIT;
    }
    if (path === '/v1/text-to-dialogue') {
      const inputs = Array.isArray(body.inputs) ? body.inputs : [];
      const chars = inputs.reduce((n: number, i) => n + (typeof i?.text === 'string' ? i.text.length : 0), 0);
      return chars * voiceCreditsPerChar(model) * USD_PER_VOICE_CREDIT;
    }
    if (path.startsWith('/v1/music')) {
      return (num(body.music_length_ms) / 60_000) * MUSIC_CREDITS_PER_MINUTE * USD_PER_VOICE_CREDIT;
    }
    return null;
  }
  if (provider === 'fal') {
    if (target.host === 'rest.alpha.fal.ai' || isFalFollowUp(path)) return null;
    return falCost(path.slice(1), body);
  }
  return null;
}

/** ElevenLabs' own count of what a clip took, where it says (`character-cost`), in dollars. */
export function voiceCostFromHeader(header: string | null): number | null {
  const credits = header === null ? NaN : Number(header);
  return Number.isFinite(credits) ? credits * USD_PER_VOICE_CREDIT : null;
}

/**
 * Reads a model's answer as it passes — each event of a stream, or the one JSON body — and prices it
 * from the usage the provider reports, by the model that answered (`modelVersion`, `model`).
 */
export class UsageMeter {
  model: string;
  usage: Usage | null = null;
  private image: GeminiImageUsage | null = null;

  constructor(
    private readonly provider: GatewayProvider,
    private readonly askedModel: string,
  ) {
    this.model = askedModel;
  }

  /** The model named in a Google path (`/v1beta/models/{model}:…`), or OpenAI's from the body. */
  static asked(target: GatewayTarget, body: Record<string, unknown>): string {
    const m = /^\/v1beta\/models\/([^:]+):/.exec(target.path);
    if (m) return m[1];
    return typeof body.model === 'string' ? body.model : '';
  }

  feed(data: any): void {
    if (!data || typeof data !== 'object') return;
    if (this.provider === 'google') {
      if (typeof data.modelVersion === 'string' && data.modelVersion) this.model = data.modelVersion;
      const u = data.usageMetadata;
      if (u) {
        this.usage = { input: num(u.promptTokenCount), output: num(u.candidatesTokenCount), thoughts: num(u.thoughtsTokenCount) };
        if (Array.isArray(u.candidatesTokensDetails) && u.candidatesTokensDetails.some((d: any) => d?.modality === 'IMAGE')) this.image = u;
      }
    } else if (this.provider === 'openai') {
      if (typeof data.model === 'string' && data.model) this.model = data.model;
      const u = data.usage;
      if (u) this.usage = { input: num(u.prompt_tokens), output: num(u.completion_tokens), thoughts: 0 };
    }
  }

  /** Feeds every complete `data:` line of a chunk of an event stream; the remainder is returned. */
  feedEvents(buffer: string): string {
    const lines = buffer.split('\n');
    const rest = lines.pop() ?? '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      try {
        this.feed(JSON.parse(t.slice(5)));
      } catch {
        /* `[DONE]`, a keep-alive */
      }
    }
    return rest;
  }

  /** Dollars, or null when nothing was reported or the model has no price. */
  cost(): number | null {
    if (this.image) return geminiImageCost(this.model, this.image) || geminiImageCost(this.askedModel, this.image);
    if (!this.usage) return null;
    return tokenCost(this.model, this.usage);
  }
}

/** The cost line a priced stream ends on, read back: dollars, or null for any other line. */
export function readCostEvent(line: string): number | null {
  const t = line.trim();
  if (!t.startsWith(COST_EVENT.trim())) return null;
  try {
    const usd = JSON.parse(t.slice(COST_EVENT.trim().length)).usd;
    return typeof usd === 'number' && Number.isFinite(usd) ? usd : null;
  } catch {
    return null;
  }
}
