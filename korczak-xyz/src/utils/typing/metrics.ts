// Typing metrics derived from an event log.
import type { TypingEvent } from './types';

// Standard "word" = 5 characters.
const CHARS_PER_WORD = 5;

export function charEvents(events: TypingEvent[]): TypingEvent[] {
  return events.filter((e) => e.kind === 'char');
}

// Accuracy over all typed characters, as a percentage (0-100).
export function computeAccuracy(events: TypingEvent[]): number {
  const chars = charEvents(events);
  if (chars.length === 0) return 100;
  const correct = chars.filter((e) => e.correct).length;
  return (correct / chars.length) * 100;
}

// Net words-per-minute: correct characters / 5 over the elapsed typing time.
// Events are appended chronologically, so the span is last - first char time.
export function computeWpm(events: TypingEvent[]): number {
  const chars = charEvents(events);
  if (chars.length < 2) return 0;
  const span = chars[chars.length - 1].t - chars[0].t;
  if (span <= 0) return 0;
  const minutes = span / 60000;
  const correct = chars.filter((e) => e.correct).length;
  return correct / CHARS_PER_WORD / minutes;
}
