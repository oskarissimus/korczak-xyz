/*
 * Asks a model for a quest, with the reader's own key from the account store (see
 * `.claude/rules/account-keys.md`), straight from the browser like every other app here.
 *
 * Google first, because it is the key this site's apps lean on since the OpenAI account ran dry,
 * and Gemma because it is free on AI Studio's tier. Gemma takes no `systemInstruction` (see
 * `utils/backseat/vision.ts`, `isGemma`), so the whole prompt is the user turn. OpenAI is used only
 * when there is no Google key. Any failure answers null and the game plays the hand-written quest.
 */

import { parseQuest, questPrompt, SEEDS, type Lang, type Quest } from './quest';

export const GOOGLE_MODEL = 'gemma-3-27b-it';
export const OPENAI_MODEL = 'gpt-4o-mini';
const TIMEOUT_MS = 25_000;

export interface StoryKeys {
  google: string | null;
  openai: string | null;
}

export type QuestSource = 'google' | 'openai' | 'static';

async function askGoogle(key: string, prompt: string, signal: AbortSignal): Promise<string> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GOOGLE_MODEL}` +
    `:generateContent?key=${encodeURIComponent(key)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 1, maxOutputTokens: 1500 },
    }),
  });
  if (!response.ok) throw new Error(`google ${response.status}`);
  const data = await response.json();
  const parts = data?.candidates?.[0]?.content?.parts;
  return Array.isArray(parts) ? parts.map((p: { text?: string }) => p?.text ?? '').join('') : '';
}

async function askOpenAi(key: string, prompt: string, signal: AbortSignal): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    signal,
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 1,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!response.ok) throw new Error(`openai ${response.status}`);
  const data = await response.json();
  return data?.choices?.[0]?.message?.content ?? '';
}

export async function generateQuest(
  keys: StoryKeys,
  lang: Lang,
): Promise<{ quest: Quest; source: QuestSource } | null> {
  const provider = keys.google ? 'google' : keys.openai ? 'openai' : null;
  if (!provider) return null;
  const seed = SEEDS[Math.floor(Math.random() * SEEDS.length)];
  const prompt = questPrompt(lang, seed);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const reply =
      provider === 'google'
        ? await askGoogle(keys.google!, prompt, controller.signal)
        : await askOpenAi(keys.openai!, prompt, controller.signal);
    const quest = parseQuest(reply, lang);
    return quest ? { quest, source: provider } : null;
  } finally {
    clearTimeout(timer);
  }
}
