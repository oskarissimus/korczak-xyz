import { describe, expect, it } from 'vitest';

import {
  MAX_REMARK_CHARS,
  RECENT_WINDOW,
  isRepeat,
  recentTexts,
  sanitizeRemark,
  systemPrompt,
} from './remarks';
import type { Remark } from './types';

/*
 * Everything stripped here has actually come back from a provider. A speech synthesiser reads all
 * of it aloud — "asterisk gasps asterisk", "quote oh slow down quote" — so this is not tidying:
 * it is the difference between a voice and a dictation of a transcript.
 */
describe('sanitizeRemark', () => {
  it('keeps an answer that already arrived in the right shape', () => {
    expect(sanitizeRemark('Oh, slow down, would you?')).toBe('Oh, slow down, would you?');
  });

  it('drops a speaker label the model added for itself', () => {
    expect(sanitizeRemark('Passenger: Mind that lorry!')).toBe('Mind that lorry!');
    expect(sanitizeRemark('Nervous passenger: Too close.')).toBe('Too close.');
  });

  it('unwraps an answer the model put in quotation marks', () => {
    expect(sanitizeRemark('"Are we there yet?"')).toBe('Are we there yet?');
    expect(sanitizeRemark('„Już dojeżdżamy?”')).toBe('Już dojeżdżamy?');
  });

  it('strips stage directions and markdown while keeping the words inside them', () => {
    expect(sanitizeRemark('*gasps* That was close!')).toBe('gasps That was close!');
    expect(sanitizeRemark('That **was** close')).toBe('That was close');
  });

  it('takes the first line only, so an explanation after it is never spoken', () => {
    expect(sanitizeRemark('Mind the bus.\n\nI said this because a bus is visible.')).toBe(
      'Mind the bus.',
    );
    expect(sanitizeRemark('Mind the bus.\nAnother thought.')).toBe('Mind the bus.');
  });

  it('removes emoji, which a synthesiser either names or skips unevenly', () => {
    expect(sanitizeRemark('Watch out! 🚚😱')).toBe('Watch out!');
  });

  it('is null when there is nothing speakable left', () => {
    expect(sanitizeRemark('')).toBeNull();
    expect(sanitizeRemark('   ')).toBeNull();
    expect(sanitizeRemark('**')).toBeNull();
    expect(sanitizeRemark(null as unknown as string)).toBeNull();
  });

  /*
   * The cap is not about tokens. A long line takes longer to speak than the gap to the next
   * snapshot, so the passenger ends up permanently one junction behind.
   */
  it('caps a long answer at a sentence end rather than mid-word', () => {
    const long =
      'You are far too close to that lorry and I really do think you should think about ' +
      'slowing down before the roundabout. Also I never liked this car.';
    const result = sanitizeRemark(long);

    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(MAX_REMARK_CHARS);
    expect(result!.endsWith('.')).toBe(true);
  });

  it('ellipsises when there is no sentence end to cut at', () => {
    const result = sanitizeRemark('word '.repeat(60));
    expect(result!.length).toBeLessThanOrEqual(MAX_REMARK_CHARS + 1);
    expect(result!.endsWith('…')).toBe(true);
  });
});

/*
 * The same sentence twice in a row is the one thing that makes the app read as broken rather than
 * annoying, and a model looking at the same stretch of motorway lands on it readily.
 */
describe('isRepeat', () => {
  it('catches the same line back again, whatever the punctuation and case', () => {
    expect(isRepeat('Slow down!', ['slow down'])).toBe(true);
    expect(isRepeat('Slow  down…', ['Slow down.'])).toBe(true);
  });

  it('lets a genuinely different line through', () => {
    expect(isRepeat('Mind the cyclist.', ['Slow down!', 'Are we there yet?'])).toBe(false);
  });

  it('treats a line of punctuation as a repeat, since it is not a remark at all', () => {
    expect(isRepeat('!!!', [])).toBe(true);
  });

  it('only looks back over the window it promises', () => {
    const older = Array.from({ length: RECENT_WINDOW + 3 }, (_, i) => `line ${i}`);
    // The oldest entries have fallen out of the window, so saying one of them again is allowed.
    expect(isRepeat('line 0', older)).toBe(false);
    expect(isRepeat(older[older.length - 1], older)).toBe(true);
  });
});

describe('recentTexts', () => {
  const remark = (id: string, text: string, error: string | null = null): Remark => ({
    id,
    text,
    at: 0,
    error,
  });

  it('is oldest first, which is the order the prompt reads them in', () => {
    expect(recentTexts([remark('1', 'first'), remark('2', 'second')])).toEqual(['first', 'second']);
  });

  /* A line that was never spoken was never heard, so it is not something to avoid repeating. */
  it('leaves out anything that failed to be spoken', () => {
    expect(recentTexts([remark('1', 'said'), remark('2', 'unsaid', 'Speech failed')])).toEqual([
      'said',
    ]);
  });
});

/*
 * The prompt is the app. These assertions are the four clauses that have each been a bug: a
 * missing length limit produces a paragraph, a missing format rule produces `Passenger: "…"`, a
 * missing recent list produces one sentence on a loop, and a missing safety clause produces a
 * model that thinks it is a navigator.
 */
describe('systemPrompt', () => {
  const base = { persona: 'nervous' as const, intensity: 'normal' as const, lang: 'en', recent: [] };

  it('names the language the remark is to be spoken in', () => {
    expect(systemPrompt(base)).toContain('English');
    expect(systemPrompt({ ...base, lang: 'pl' })).toContain('Polish');
    // An unknown locale must still name a language rather than leaving the clause dangling.
    expect(systemPrompt({ ...base, lang: 'de' })).toContain('English');
  });

  it('asks for one short sentence and nothing around it', () => {
    const prompt = systemPrompt(base);
    expect(prompt).toContain('ONE spoken sentence');
    expect(prompt).toMatch(/at most \d+ words/);
    expect(prompt).toContain('No speaker name');
  });

  it('forbids anything that could be mistaken for driving advice', () => {
    // The one way this app could do harm is by being believed. If this assertion is ever deleted,
    // read .claude/rules/backseat.md before deciding it was pedantry.
    expect(systemPrompt(base)).toContain('Never give a real driving instruction');
  });

  it('insists on saying something even when the road is dull', () => {
    expect(systemPrompt(base)).toContain('Always say something');
  });

  it('shows the model what it has already said, capped at the window', () => {
    const recent = Array.from({ length: RECENT_WINDOW + 4 }, (_, i) => `remark ${i}`);
    const prompt = systemPrompt({ ...base, recent });

    expect(prompt).toContain('Say something different');
    expect(prompt).toContain(`- ${recent[recent.length - 1]}`);
    // Trimmed from the front: the oldest are the least worth spending tokens on.
    expect(prompt).not.toContain('- remark 0');
  });

  it('leaves the whole section out when nothing has been said yet', () => {
    expect(systemPrompt(base)).not.toContain('Say something different');
  });

  it('describes a different passenger for each persona', () => {
    const nervous = systemPrompt(base);
    const codriver = systemPrompt({ ...base, persona: 'codriver' });
    expect(nervous).not.toBe(codriver);
    expect(codriver).toContain('co-driver');
  });
});
