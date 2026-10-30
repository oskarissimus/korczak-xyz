import { describe, expect, it } from 'vitest';
import { classicWorld, parseWorlds } from './genesis';
import { MUSIC_MS, musicCredits, musicId, musicPrompt, worldMusic } from './music';
import { NO_SPEND, addSpend, spendUsd, validSpend } from './devlog';

describe('the score', () => {
  it('asks for the world’s own music line, the tone and the loop rules', () => {
    const prompt = musicPrompt(classicWorld('pl'), 'comic');
    expect(prompt).toContain('hurdy-gurdy');
    expect(prompt).toContain('playful');
    expect(prompt).toMatch(/Instrumental only/);
    expect(prompt).toMatch(/seamless loop/i);
  });

  it('describes a world from before the music line from its look and bible', () => {
    const { music: _, ...old } = classicWorld('en');
    const line = worldMusic({ ...old, look: { ...old.look, weather: 'snow', time: 'night', flora: 'fungi' } });
    expect(line).toContain('wintry');
    expect(line).toContain('at night');
    expect(line).toContain('giant fungi');
    expect(line).toContain('medieval');
  });

  it('prices a track by its length, or by what ElevenLabs says it charged', () => {
    expect(musicCredits(MUSIC_MS, null)).toBe(1800);
    expect(musicCredits(60_000, '750')).toBe(750);
    expect(musicCredits(60_000, 'nope')).toBe(900);
  });

  it('keeps one track per world and tone', () => {
    expect(musicId('w1', 'grim')).not.toBe(musicId('w1', 'light'));
    expect(musicId('w1', null)).toBe('w1|any');
  });

  it('reads the genesis’s music line', () => {
    const raw = JSON.stringify({
      candidates: [{ name: 'A', typicality: 50, pitch: 'x' }],
      chosen: 1,
      world: {
        name: 'Saltreach',
        typicality: 50,
        pitch: 'Salt flats.',
        architecture: 'salt bricks',
        look: {},
        music: 'sparse desert blues, slide guitar and hand drums, 80 BPM',
        tone: 'dry',
        tech: 'bronze',
        climate: 'hot',
        people: 'salt miners',
        threats: 'dust wraiths',
        player: 'a courier',
        address: 'courier',
        hub: 'Brinewell',
        words: [],
      },
    });
    const [world] = parseWorlds(raw, { lang: 'en', seeds: [], pastWorlds: [] } as never, 1);
    expect(world?.music).toBe('sparse desert blues, slide guitar and hand drums, 80 BPM');
  });
});

describe('music in the spend', () => {
  it('adds to the total and survives a save from before it', () => {
    const s = addSpend(NO_SPEND, { ...NO_SPEND, musicSeconds: 120, musicCredits: 1800, musicCost: 0.132 });
    expect(spendUsd(s)).toBeCloseTo(0.132);
    const old = validSpend({ ...NO_SPEND, musicSeconds: undefined, musicCredits: undefined, musicCost: undefined });
    expect(old?.musicCredits).toBe(0);
  });
});
