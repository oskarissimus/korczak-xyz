/*
 * The price list the admin panel shows (owner, 10 Nov 2026: "a section with the price list, every
 * endpoint / model of every provider and the price we charge — a place with the price verbatim from
 * the provider's page, a place with the normalised price for a whole request, and beside it how much
 * diesel we charge for it").
 *
 * Three columns, three different things, kept apart on purpose:
 * - **verbatim** — the provider's own words, copied from its pricing page on `CHECKED` and not
 *   paraphrased. A number here is what the provider says, not what this code does.
 * - **normalised** — what the gateway charges for one typical request, worked out by **the same
 *   functions that price a real one** (`tokenCost`, `clipCost`, `falCost`, `geminiImageCost`), never
 *   a second copy of the rates. If the two columns disagree, the code is what is billed — and the
 *   disagreement is exactly what this page is for.
 * - **litres** — the normalised price in diesel (`LITRES_PER_USD`).
 *
 * Every provider here prices in US dollars **excluding tax** (ElevenLabs: "Prices exclude all taxes,
 * levies and duties"; Google and OpenAI quote list prices with VAT added on the invoice), so the
 * normalised figure is net. `grossUsd` adds Polish VAT for the column the owner asked for; diesel is
 * charged at the net list price, as it always was.
 */

import { PER_MILLION, PRICE_CHANGES, tokenCost, USD_PER_VOICE_CREDIT, MUSIC_CREDITS_PER_MINUTE } from './cost';
import { clipCost } from './demoLimits';
import { LITRES_PER_USD, TYPICAL_BEAT, TYPICAL_LINE } from './diesel';
import { falCost, geminiImageCost, GEMINI_IMAGE_RATES } from './gatewayRoutes';

/** The score's length (`MUSIC_MS` in `music.ts`, which this pure file cannot import; a test holds them equal). */
export const SCORE_MS = 120_000;

/** The day the verbatim texts were read off the providers' pages. */
export const CHECKED = '2026-11-10';

/** Polish VAT, for the gross column. */
export const VAT_PL = 0.23;

export type PriceProvider = 'google' | 'openai' | 'elevenlabs' | 'fal';

export interface PriceRow {
  provider: PriceProvider;
  /** The endpoint the game calls, as the gateway sees it. */
  endpoint: string;
  model: string;
  /** The provider's words, one line per quoted price. */
  verbatim: string[];
  source: string;
  /** How the gateway prices one request of this kind, as a formula. */
  method: string;
  /** What "one typical request" means for the normalised column. */
  typical: Text;
  /** Dollars, net, for the typical request; null where the gateway has no price for it. */
  usd: number | null;
  /** Something the owner should know: a difference between the verbatim and the code, a price change ahead. */
  note?: Text;
}

/** A sentence in both of the site's languages. */
export interface Text {
  en: string;
  pl: string;
}
const L = (en: string, pl: string): Text => ({ en, pl });

const GOOGLE_SRC = 'https://ai.google.dev/gemini-api/docs/pricing';
const OPENAI_SRC = 'https://developers.openai.com/api/docs/models/';
const ELEVEN_API_SRC = 'https://elevenlabs.io/pricing/api';
const ELEVEN_PLAN_SRC = 'https://elevenlabs.io/pricing';
const FAL_SRC = 'https://fal.ai/models/';

/** Google's words for each text model (Standard tab, "Paid Tier, per 1M tokens in USD"). */
const GOOGLE_VERBATIM: Record<string, [input: string, output: string]> = {
  'gemini-3.1-pro': ['$2.00, prompts <= 200k tokens', '$12.00, prompts <= 200k tokens'],
  'gemini-4-argon': [
    '$2.00 through November 30, 2026. $4.00 starting December 1, 2026.',
    '$10.00 through November 30, 2026. $20.00 starting December 1, 2026.',
  ],
  'gemini-3.8-flash': [
    '$0.75 through December 31, 2026. $1.50 starting January 1, 2027.',
    '$3.75 through December 31, 2026. $7.50 starting January 1, 2027.',
  ],
  'gemini-3.6-flash': [
    '$0.75 through December 31, 2026. $1.50 starting January 1, 2027.',
    '$3.75 through December 31, 2026. $7.50 starting January 1, 2027.',
  ],
  'gemini-3.5-flash-lite': ['$0.30 (text / image / video / audio)', '$2.50'],
  'gemini-3.1-flash-lite': ['$0.25 (text / image / video) $0.50 (audio)', '$1.50'],
  'gemini-3-flash': ['$0.50 (text / image / video) $1.00 (audio)', '$3.00'],
  'gemini-2.5-pro': ['$1.25, prompts <= 200k tokens', '$10.00, prompts <= 200k tokens'],
  'gemini-2.5-flash-lite': ['$0.10 (text / image / video) $0.30 (audio)', '$0.40'],
  'gemini-2.5-flash': ['$0.30 (text / image / video) $1.00 (audio)', '$2.50'],
  'gemma-': ['Free of charge (Free Tier) · Not available (Paid Tier)', 'Free of charge (Free Tier) · Not available (Paid Tier)'],
};

const OPENAI_VERBATIM: Record<string, string> = {
  'gpt-4.1-mini': 'Price $0.4 • $1.6 Input • Output',
  'gpt-4.1': 'Price $2 • $8 Input • Output',
};

const TYPICAL_TOKENS = L(
  `${TYPICAL_BEAT.input} in, ${TYPICAL_BEAT.output} out, ${TYPICAL_BEAT.thoughts} thinking tokens (a late beat)`,
  `${TYPICAL_BEAT.input} na wejściu, ${TYPICAL_BEAT.output} na wyjściu, ${TYPICAL_BEAT.thoughts} myślenia (późny krok questa)`,
);

function textRows(at: number): PriceRow[] {
  return PER_MILLION.map(([prefix, input, output]) => {
    const openai = prefix.startsWith('gpt-');
    const changes = PRICE_CHANGES.filter((c) => c.prefix === prefix);
    const model = prefix === 'gemma-' ? 'gemma-*' : prefix;
    const verbatim = openai
      ? [OPENAI_VERBATIM[prefix] ?? '—']
      : GOOGLE_VERBATIM[prefix]
        ? [`Input price: ${GOOGLE_VERBATIM[prefix][0]}`, `Output price (including thinking tokens): ${GOOGLE_VERBATIM[prefix][1]}`]
        : ['—'];
    return {
      provider: openai ? 'openai' : 'google',
      endpoint: openai ? 'POST /v1/chat/completions' : 'POST /v1beta/models/{model}:streamGenerateContent',
      model,
      verbatim,
      source: openai ? `${OPENAI_SRC}${prefix}` : GOOGLE_SRC,
      method: `input × $${input}/1M + (output + thinking) × $${output}/1M, tokens from the answer's usage`,
      typical: TYPICAL_TOKENS,
      usd: tokenCost(prefix === 'gemma-' ? 'gemma-4' : prefix, TYPICAL_BEAT, at),
      note: changes.length
        ? L(
            changes.map((c) => `From ${c.from}: $${c.input} / $${c.output} per 1M — applied automatically on that day.`).join(' '),
            changes.map((c) => `Od ${c.from}: $${c.input} / $${c.output} za 1M — liczone automatycznie od tego dnia.`).join(' '),
          )
        : undefined,
    } satisfies PriceRow;
  });
}

const IMAGE_VERBATIM: Record<string, string[]> = {
  'gemini-3.1-flash-lite-image': [
    'Input price: $0.25 (text/image/video)',
    'Output price: $1.50 (text and thinking) $30.00 (images) Equivalent to $0.0336 per 1K resolution image',
  ],
  'gemini-nano-banana-2.1': [
    'Input price: $1.50 (text/image/video)',
    'Output price: $7.50 (text and thinking) $30.00 (images) Equivalent to $0.0336 per 1K image',
  ],
};

function imageRows(): PriceRow[] {
  // A 1K picture is 1,120 image tokens ($0.0336 / $30 per 1M), asked with a ~300-token prompt.
  const usage = { promptTokenCount: 300, candidatesTokenCount: 1120, candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1120 }] };
  return Object.entries(GEMINI_IMAGE_RATES).map(([model, r]) => ({
    provider: 'google' as const,
    endpoint: 'POST /v1beta/models/{model}:generateContent',
    model,
    verbatim: IMAGE_VERBATIM[model] ?? ['—'],
    source: GOOGLE_SRC,
    method: `prompt × $${r.input}/1M + image tokens × $${r.image}/1M + other output × $${r.text}/1M`,
    typical: L('one 1K picture (1,120 image tokens) from a 300-token prompt', 'jeden obrazek 1K (1120 tokenów obrazu) z promptu na 300 tokenów'),
    usd: geminiImageCost(model, usage),
  }));
}

function elevenRows(): PriceRow[] {
  const perCredit = `$${(USD_PER_VOICE_CREDIT * 1000).toFixed(4)} per 1k credits (Creator, $22 / 300k credits)`;
  const planLine = 'Creator $22 (121,000 credits, $11 for the first month)';
  const planNote = L(
    `The code prices a credit at $22 / 300,000 (the Creator plan as it was in Oct 2026). Today's page says ${planLine} — ` +
      'if the account is on today’s Creator, every ElevenLabs price here is ~2.5× too low.',
    `Kod liczy kredyt jako $22 / 300 000 (plan Creator z października 2026). Dziś strona mówi ${planLine} — ` +
      'jeśli konto jest na dzisiejszym Creatorze, każda cena ElevenLabs tutaj jest ok. 2,5× za niska.',
  );
  const musicMinutes = SCORE_MS / 60_000;
  return [
    {
      provider: 'elevenlabs',
      endpoint: 'POST /v1/text-to-speech/{voice}',
      model: 'eleven_flash_v2_5',
      verbatim: [
        'Flash / Turbo Text to Speech $0.04 Price per 1K characters',
        'For V2 Flash/Turbo English and V2.5 Flash/Turbo Multilingual models, discounted pricing applies for API usage, costing between 0.5 and 1 credit per character.',
        `Prices exclude all taxes, levies and duties. · ${planLine}`,
      ],
      source: ELEVEN_API_SRC,
      method: `characters × 0.5 credit × ${perCredit}; ElevenLabs' own character-cost header wins when it is sent`,
      typical: L(`one line of ${TYPICAL_LINE} characters`, `jedna kwestia, ${TYPICAL_LINE} znaków`),
      usd: clipCost(TYPICAL_LINE, 'eleven_flash_v2_5'),
      note: planNote,
    },
    {
      provider: 'elevenlabs',
      endpoint: 'POST /v1/text-to-speech/{voice}, /v1/text-to-dialogue',
      model: 'eleven_v4 (lines with audio tags)',
      verbatim: ['v4 Text to Speech New $0.08 Price per 1K characters', 'Prices exclude all taxes, levies and duties.'],
      source: ELEVEN_API_SRC,
      method: `characters × 1 credit × ${perCredit}`,
      typical: L(`one line of ${TYPICAL_LINE} characters`, `jedna kwestia, ${TYPICAL_LINE} znaków`),
      usd: clipCost(TYPICAL_LINE, 'eleven_v4'),
      note: planNote,
    },
    {
      provider: 'elevenlabs',
      endpoint: 'POST /v1/music',
      model: 'music_v2_5',
      verbatim: [
        'Music Generation $0.15 Price per minute',
        'Eleven Music 900 credits per minute',
        'Prices exclude all taxes, levies and duties.',
      ],
      source: ELEVEN_API_SRC,
      method: `music_length_ms / 60,000 × ${MUSIC_CREDITS_PER_MINUTE} credits × ${perCredit}`,
      typical: L(`one ${musicMinutes}-minute score`, `jeden utwór, ${musicMinutes} min`),
      usd: musicMinutes * MUSIC_CREDITS_PER_MINUTE * USD_PER_VOICE_CREDIT,
      note: L(
        `Pay-as-you-go would be $${(0.15 * musicMinutes).toFixed(2)} for this; on the plan it is credits. ${planNote.en}`,
        `Pay-as-you-go to byłoby $${(0.15 * musicMinutes).toFixed(2)}; w abonamencie płacimy kredytami. ${planNote.pl}`,
      ),
    },
    {
      provider: 'elevenlabs',
      endpoint: 'POST /v1/text-to-voice/design, /v1/text-to-voice',
      model: 'eleven_multilingual_ttv_v2',
      verbatim: ['Not listed on the pricing pages.'],
      source: ELEVEN_PLAN_SRC,
      method: 'no price: logged as unknown; diesel reserves $0.25 and keeps it',
      typical: L('one designed voice', 'jeden zaprojektowany głos'),
      usd: null,
    },
  ];
}

interface FalSpec {
  model: string;
  verbatim: string;
  method: string;
  typical: Text;
  body?: Record<string, unknown>;
  note?: Text;
}

const PICTURE = L('one picture', 'jeden obrazek');
const PICTURE_512 = L('one 512×512 picture', 'jeden obrazek 512×512');
const MODEL_3D = L('one 3D model', 'jeden model 3D');

const FAL_SPECS: FalSpec[] = [
  {
    model: 'fal-ai/flux/schnell',
    verbatim: 'Your request will cost $ 0.003 per megapixel . Images are billed by rounding up to the nearest megapixel.',
    method: '⌈width × height / 1M⌉ × $0.003',
    typical: PICTURE_512,
  },
  {
    model: 'fal-ai/flux/dev',
    verbatim: 'Your request will cost $ 0.025 per megapixel . Images are billed by rounding up to the nearest megapixel.',
    method: '⌈width × height / 1M⌉ × $0.025',
    typical: PICTURE_512,
  },
  {
    model: 'fal-ai/flux-2',
    verbatim: 'Your request will cost $ 0.012 per megapixel .',
    method: '$0.012 flat',
    typical: L('one picture up to 1 MP', 'jeden obrazek do 1 MP'),
    note: L('The code charges a flat $0.012; a picture above 1 MP would cost more.', 'Kod liczy stałe $0.012; obrazek powyżej 1 MP kosztowałby więcej.'),
  },
  { model: 'fal-ai/nano-banana', verbatim: 'Each image costs $0.0398 . For $1.00 , you can generate 25 images.', method: '$0.0398 flat', typical: PICTURE },
  {
    model: 'fal-ai/nano-banana-2',
    verbatim:
      'Your request will cost $0.08 per image. … 2K and 4K outputs will be charged at 1.5 times and 2 times the standard rate, respectively. 0.5K (512px) resolution outputs will be charged at 0.75 times the standard rate.',
    method: '$0.08 flat',
    typical: L('one 1K picture', 'jeden obrazek 1K'),
  },
  {
    model: 'fal-ai/nano-banana-2.1',
    verbatim: '(the model page answers 404 today)',
    method: '$0.04 flat',
    typical: PICTURE,
    note: L('fal.ai no longer lists this model; the price is from Oct 2026.', 'fal.ai już nie pokazuje tego modelu; cena z października 2026.'),
  },
  {
    model: 'fal-ai/nano-banana-lite',
    verbatim: 'Your request will cost $ 1 per unit .',
    method: '$0.042 flat',
    typical: PICTURE,
    note: L('fal.ai says "$1 per unit" without saying what a unit is; the code assumes $0.042 a picture.', 'fal.ai pisze "$1 per unit" bez wyjaśnienia, czym jest unit; kod zakłada $0.042 za obrazek.'),
  },
  { model: 'fal-ai/trellis', verbatim: 'Your request will cost $ 0.02 per generation .', method: '$0.02 flat', typical: MODEL_3D },
  {
    model: 'fal-ai/trellis-2',
    verbatim: 'Your request will cost $0.25 for 512p resolution, $0.30 for 1024p resolution and $0.35 for 1536p resolution.',
    method: '$0.25 flat',
    typical: L('one 3D model at 512p', 'jeden model 3D w 512p'),
  },
  {
    model: 'tripo3d/tripo/v2.5/image-to-3d',
    verbatim:
      'Your request will cost $0.20 (without textures), $0.30 (with standard textures), or $0.40 (with HD textures), plus an additional $0.05 each for Style and quad options if selected.',
    method: '$0.30 flat',
    typical: L('one textured 3D model', 'jeden model 3D z teksturą'),
  },
  {
    model: 'fal-ai/hunyuan3d/v2',
    verbatim: 'Your request will cost $ 0.16 per generation .',
    method: '$0.48 flat',
    typical: MODEL_3D,
    note: L('The code charges $0.48, three times fal.ai’s $0.16.', 'Kod liczy $0.48, trzy razy więcej niż $0.16 z fal.ai.'),
  },
  {
    model: 'fal-ai/meshy/rigging',
    verbatim: '$0.20 per request. + $0.12 when enable_animation=true ( $0.32 total).',
    method: '$0.20 flat',
    typical: L('one rig', 'jeden rig'),
  },
  {
    model: 'fal-ai/meshy/v6/image-to-3d',
    verbatim: 'Your request will cost $ 0.8 per generation .',
    method: '$0.80, + $0.20 when enable_rigging',
    typical: L('one 3D model with its rig', 'jeden model 3D z rigiem'),
    body: { enable_rigging: true },
  },
  {
    model: 'fal-ai/meshy/v6/text-to-3d',
    verbatim: 'Your request will cost $ 0.8 per generation .',
    method: '$0.80 + $0.20 (rig)',
    typical: MODEL_3D,
    note: L('The code adds a rig ($0.20) to every text-to-3D request.', 'Kod dolicza rig ($0.20) do każdego text-to-3D.'),
  },
];

function falRows(): PriceRow[] {
  return FAL_SPECS.map((s) => ({
    provider: 'fal' as const,
    endpoint: `POST queue.fal.run / fal.run`,
    model: s.model,
    verbatim: [s.verbatim],
    source: `${FAL_SRC}${s.model}`,
    method: s.method,
    typical: s.typical,
    usd: falCost(s.model, s.body ?? {}),
    note: s.note,
  }));
}

/** Every row, priced at `at` (ms). */
export function priceRows(at: number = Date.now()): PriceRow[] {
  return [...textRows(at), ...imageRows(), ...elevenRows(), ...falRows()];
}

/** The fal.ai models the list covers — a test holds it equal to what `falCost` prices. */
export const FAL_LISTED = FAL_SPECS.map((s) => s.model);

export function litresOf(usd: number): number {
  return usd * LITRES_PER_USD;
}

export function grossUsd(netUsd: number): number {
  return netUsd * (1 + VAT_PL);
}
