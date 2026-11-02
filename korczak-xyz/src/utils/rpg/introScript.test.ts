import { describe, expect, it } from 'vitest';
import { INTRO_FRAMES, introPrompt, parseIntro, picturePrompt, prologue, readingMs } from './introScript';
import { sketchWorld } from './genesis';
import { gatewayTarget } from './gatewayRoutes';

describe('parseIntro', () => {
  it('reads whole lines only while streaming, the last one too at the end', () => {
    const text = 'N: Witaj na Solnym Wybrzeżu.\nI: A white salt flat\nN: Karawany wołów';
    expect(parseIntro(text)).toEqual([{ text: 'Witaj na Solnym Wybrzeżu.', picture: 'A white salt flat' }]);
    expect(parseIntro(text, true)).toEqual([
      { text: 'Witaj na Solnym Wybrzeżu.', picture: 'A white salt flat' },
      { text: 'Karawany wołów', picture: null },
    ]);
  });

  it('forgives bold, numbers and stray lines, and stops at the frame limit', () => {
    const lines = ['Here you go:', '**N:** "One."', '1. I: pic one', '- N: Two.', 'I: pic two', 'I: a second picture is ignored'];
    for (let i = 3; i <= INTRO_FRAMES + 2; i++) lines.push(`N: Frame ${i}.`, `I: pic ${i}`);
    const frames = parseIntro(lines.join('\n') + '\n');
    expect(frames).toHaveLength(INTRO_FRAMES);
    expect(frames[0]).toEqual({ text: 'One.', picture: 'pic one' });
    expect(frames[1]).toEqual({ text: 'Two.', picture: 'pic two' });
  });

  it('ignores a picture before any narration', () => {
    expect(parseIntro('I: pic\nN: Hello.\n')).toEqual([{ text: 'Hello.', picture: null }]);
  });
});

describe('introPrompt', () => {
  it('names the world, the language and the format, and fences the wish', () => {
    const p = introPrompt({ lang: 'pl', sketch: { name: 'Solne Wybrzeże', pitch: 'Białe równiny soli.' }, wish: 'western' });
    expect(p).toContain('THE WORLD: Solne Wybrzeże — Białe równiny soli.');
    expect(p).toContain('in Polish');
    expect(p).toContain('N: <frame 1 narration>');
    expect(p).toContain('---\nwestern\n---');
  });
});

describe('the rest', () => {
  it('has a prologue per language, a styled picture and a reading time with bounds', () => {
    expect(prologue('pl')).toMatch(/wędrowcze/);
    expect(prologue('en')).toMatch(/traveller/);
    expect(picturePrompt('A salt flat.')).toMatch(/^A salt flat\. painterly/);
    expect(readingMs('x')).toBe(3500);
    expect(readingMs('x'.repeat(1000))).toBe(12_000);
  });
});

describe('sketchWorld', () => {
  const candidates = '{"candidates": [{"name": "A", "typicality": 10, "pitch": "First."}, {"name": "B", "typicality": 40, "pitch": "Second."}], "chosen": 2, ';
  it('is null before the chosen candidate is known', () => {
    expect(sketchWorld('{"candidates": [{"name": "A", "typicality": 10, "pitch": "First."}')).toBeNull();
  });
  it('reads the chosen candidate first, the world itself once written', () => {
    expect(sketchWorld(candidates + '"world": {"name": "Bee')).toEqual({ name: 'B', pitch: 'Second.' });
    expect(sketchWorld(candidates + '"world": {"name": "Beeland", "typicality": 40, "pitch": "Hives everywhere.", "architecture": "wax')).toEqual({
      name: 'Beeland',
      pitch: 'Hives everywhere.',
    });
  });
});

describe('the gateway', () => {
  it('passes the streamed speech endpoint', () => {
    expect(gatewayTarget('/api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb/stream', 'POST')?.provider).toBe('elevenlabs');
    expect(gatewayTarget('/api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb/other', 'POST')).toBeNull();
  });
});
