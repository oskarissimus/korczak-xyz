/*
 * Asking a model for the script, and reading the answer before it is finished.
 *
 * Ported from sloper's `services/llm.ts`. Both providers speak OpenAI's chat-completions SSE, so
 * there is one stream reader and two thin callers over it.
 *
 * `parseSceneBuffer` is the interesting half and the reason the whole thing streams at all. The
 * model is asked for a JSON array of objects; waiting for the array to close means a blank screen
 * for the length of the generation, so instead the buffer is scanned for *complete* objects as
 * they land and each one becomes a scene card the moment it is whole. It cannot use `JSON.parse`
 * on the buffer, which is invalid until the final `]`, so it walks braces itself — tracking
 * strings and escapes, because an `image_description` containing `{` is not a nesting level.
 *
 * It is called on every chunk over the whole buffer, and re-parses what it has already parsed.
 * That is quadratic in the number of scenes and does not matter: the ceiling is 100 scenes of a
 * few hundred characters.
 */

import { LLM_PRICING } from './pricing';
import type { LlmProvider, TokenUsage } from './types';

export interface StreamChunk {
  content?: string;
  usage?: TokenUsage;
  done?: boolean;
}

export interface RawScene {
  script: string;
  image_description: string;
}

const ENDPOINTS: Record<LlmProvider, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/v1/chat/completions',
};

async function* readSseStream(response: Response): AsyncGenerator<StreamChunk> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `API request failed: ${response.status}`);
  }
  if (!response.body) throw new Error('The model returned no body to read.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      // The last element is whatever came after the final newline: an incomplete line, or ''.
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        if (data === '[DONE]') {
          yield { done: true };
          return;
        }

        let parsed: {
          choices?: { delta?: { content?: string } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        try {
          parsed = JSON.parse(data);
        } catch {
          // A keep-alive comment or a frame split across reads in a way the line split missed.
          continue;
        }

        const content = parsed.choices?.[0]?.delta?.content;
        if (content) yield { content };

        const usage = parsed.usage;
        if (usage) {
          yield {
            usage: {
              prompt: usage.prompt_tokens ?? 0,
              completion: usage.completion_tokens ?? 0,
            },
          };
        }
      }
    }
  } finally {
    // Aborting mid-generation is the normal case — the caller stops reading and we must not
    // leave the connection open behind it.
    await reader.cancel().catch(() => undefined);
  }
}

export async function* streamLLM(
  provider: LlmProvider,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  temperature: number,
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const response = await fetch(ENDPOINTS[provider], {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    signal,
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: true,
      // DeepSeek rejects the option outright; OpenAI needs it or `usage` never arrives.
      ...(provider === 'openai' ? { stream_options: { include_usage: true } } : {}),
      temperature,
    }),
  });

  yield* readSseStream(response);
}

/** The instruction the model is held to. The parser below depends on every word of the format. */
export function sceneSystemPrompt(numScenes: number, targetWords: number): string {
  return `You are a video script generator. Generate exactly ${numScenes} scenes for a short video.

Each scene should have:
- "script": The narration text (total across all scenes should be around ${targetWords} words)
- "image_description": A detailed visual description for image generation

Output ONLY a JSON array with no additional text: [{"script": "...", "image_description": "..."}, ...]

Make each scene's script flow naturally into the next. Image descriptions should be vivid and specific, suitable for AI image generation.`;
}

/** How many words of narration a target duration asks for. Matches pricing.ts's assumption. */
export function targetWords(targetDuration: number): number {
  return Math.round(targetDuration * 2.5);
}

/**
 * Every complete `{...}` in the buffer that looks like a scene, plus whatever is left over.
 *
 * Callers keep their own count of how many they have already turned into cards and take the
 * slice past it, so this returning the same first scene on every chunk is expected.
 */
export function parseSceneBuffer(buffer: string): { scenes: RawScene[]; remainder: string } {
  const scenes: RawScene[] = [];

  const arrayStart = buffer.indexOf('[');
  if (arrayStart === -1) return { scenes: [], remainder: buffer };

  let searchStart = arrayStart + 1;
  let lastParsedEnd = arrayStart;

  for (;;) {
    const objStart = buffer.indexOf('{', searchStart);
    if (objStart === -1) break;

    const objEnd = findObjectEnd(buffer, objStart);
    if (objEnd === -1) break; // Incomplete — wait for more of the stream.

    try {
      const obj = JSON.parse(buffer.slice(objStart, objEnd + 1));
      if (typeof obj?.script === 'string' && typeof obj?.image_description === 'string') {
        scenes.push({ script: obj.script, image_description: obj.image_description });
        lastParsedEnd = objEnd + 1;
      }
    } catch {
      // Balanced braces that are not valid JSON. Skip the object rather than the whole buffer.
    }

    searchStart = objEnd + 1;
  }

  return { scenes, remainder: buffer.slice(lastParsedEnd) };
}

/** Index of the `}` closing the object that opens at `start`, or -1 if it has not arrived. */
function findObjectEnd(buffer: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < buffer.length; i++) {
    const char = buffer[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

/** What the tokens the provider reported actually cost, at the scraped rates. */
export function calculateCost(model: string, usage: TokenUsage): number {
  const rates = LLM_PRICING[model] ?? LLM_PRICING['gpt-4o'] ?? { input: 2.5, output: 10 };
  return (usage.prompt / 1_000_000) * rates.input + (usage.completion / 1_000_000) * rates.output;
}
