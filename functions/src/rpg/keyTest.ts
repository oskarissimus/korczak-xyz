/*
 * The admin panel's "test the keys": every server key tried with the cheapest request that proves it
 * can actually spend — not just that it exists. A key whose account has no money left answers a
 * model list as happily as a funded one, so each test is a real, tiny paid request:
 *
 * - Google: one generateContent on Flash-Lite, a few tokens (a hundredth of a cent).
 * - ElevenLabs: the subscription (what is left, where the key may read it), then a three-letter
 *   line on Flash v2.5 (3 credits).
 * - fal.ai: one FLUX schnell picture, 256×256, one step ($0.003).
 * - OpenAI: one chat completion on gpt-4.1-mini, one token out.
 *
 * The answer never carries a key: a status, a few words, and what the test cost.
 */

import {
  SERVER_KEY_NAMES,
  type KeyTest,
  type ServerKeyName,
} from '../../../korczak-xyz/src/utils/rpg/adminConfig';
import { readServerKeys } from './admin';

const TIMEOUT_MS = 25_000;

async function call(url: string, init: RequestInit): Promise<{ status: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { ...init, signal: controller.signal });
    return { status: r.status, text: await r.text() };
  } catch (e) {
    return { status: 0, text: (e as Error)?.name === 'AbortError' ? 'timed out' : String((e as Error)?.message ?? e) };
  } finally {
    clearTimeout(timer);
  }
}

/** The provider's own words from an error body, short, with anything key-shaped cut out. */
function said(text: string): string {
  let out = text;
  try {
    const j = JSON.parse(text);
    out = j?.error?.message ?? j?.detail?.message ?? j?.detail?.status ?? (typeof j?.detail === 'string' ? j.detail : null) ?? j?.message ?? text;
  } catch {
    /* not JSON */
  }
  return String(out).replace(/[A-Za-z0-9_-]{24,}/g, '…').slice(0, 160);
}

async function google(key: string): Promise<KeyTest> {
  const model = 'gemini-flash-lite-latest';
  const r = await call(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with the word ok.' }] }], generationConfig: { maxOutputTokens: 16 } }),
  });
  if (r.status !== 200) return { ok: false, status: r.status, note: said(r.text), usd: 0 };
  const j = JSON.parse(r.text);
  return { ok: true, status: 200, note: `${j?.modelVersion ?? model} answered`, usd: 0.0001 };
}

async function elevenLabs(key: string): Promise<KeyTest> {
  const sub = await call('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': key } });
  let left = '';
  if (sub.status === 200) {
    const j = JSON.parse(sub.text);
    if (typeof j?.character_limit === 'number') left = `, ${Math.max(0, j.character_limit - (j.character_count ?? 0)).toLocaleString('en-GB')} of ${j.character_limit.toLocaleString('en-GB')} credits left (${j.tier ?? 'plan'})`;
  }
  const r = await call('https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb?output_format=mp3_22050_32', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'xi-api-key': key },
    body: JSON.stringify({ text: 'Ok.', model_id: 'eleven_flash_v2_5' }),
  });
  if (r.status !== 200) return { ok: false, status: r.status, note: said(r.text) + left, usd: 0 };
  return { ok: true, status: 200, note: `a 3-letter line spoken${left}`, usd: 0.0003 };
}

async function fal(key: string): Promise<KeyTest> {
  const r = await call('https://fal.run/fal-ai/flux/schnell', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Key ${key}` },
    body: JSON.stringify({ prompt: 'a small red circle on white', image_size: { width: 256, height: 256 }, num_inference_steps: 1, num_images: 1 }),
  });
  if (r.status !== 200) return { ok: false, status: r.status, note: said(r.text), usd: 0 };
  return { ok: true, status: 200, note: 'a 256×256 FLUX schnell picture made', usd: 0.003 };
}

async function openai(key: string): Promise<KeyTest> {
  const r = await call('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: 'gpt-4.1-mini', max_tokens: 1, messages: [{ role: 'user', content: 'ok' }] }),
  });
  if (r.status !== 200) return { ok: false, status: r.status, note: said(r.text), usd: 0 };
  const j = JSON.parse(r.text);
  return { ok: true, status: 200, note: `${j?.model ?? 'gpt-4.1-mini'} answered`, usd: 0.00002 };
}

const TESTS: Record<ServerKeyName, (key: string) => Promise<KeyTest>> = { google, elevenLabs, fal, openai };

export async function testServerKeys(): Promise<Record<ServerKeyName, KeyTest>> {
  const keys = await readServerKeys();
  const results = await Promise.all(
    SERVER_KEY_NAMES.map(async (name): Promise<[ServerKeyName, KeyTest]> => {
      const key = keys[name];
      if (!key) return [name, { ok: false, status: 0, note: 'no key set', usd: 0 }];
      try {
        return [name, await TESTS[name](key)];
      } catch (e) {
        return [name, { ok: false, status: 0, note: said(String((e as Error)?.message ?? e)), usd: 0 }];
      }
    }),
  );
  return Object.fromEntries(results) as Record<ServerKeyName, KeyTest>;
}
