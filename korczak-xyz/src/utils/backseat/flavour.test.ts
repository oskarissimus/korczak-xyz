import { describe, expect, it } from 'vitest';

import { defaultConfigFor, normalizeConfig } from './defaults';
import { BACKSEAT, ROASTER } from './flavour';
import { ROAST_ANGLES, ROAST_USER_PROMPT, anglesFor, pickAngle, systemPrompt, userPromptFor } from './remarks';
import { roundPath } from './rideLog';

/*
 * The roaster is the passenger's island with the car taken out. These pin the parts that make it
 * a different app — and, as much, the parts that must not leak from one into the other.
 */
describe('the roaster', () => {
  const base = { flavour: 'roaster' as const, persona: 'comedian' as const, intensity: 'normal' as const, lang: 'en', recent: [] };

  it('is told to roast, with no road and no car in it', () => {
    const prompt = systemPrompt(base);
    expect(prompt).toContain('Roast it');
    expect(prompt).not.toMatch(/windscreen|driv|road|passenger/i);
  });

  it('keeps the rules that are not about driving', () => {
    const prompt = systemPrompt({ ...base, recent: ['That shelf has given up.'] });
    expect(prompt).toContain('ONE spoken sentence');
    expect(prompt).toContain('really in the picture');
    expect(prompt).toContain('Always say something');
    expect(prompt).toContain('- That shelf has given up.');
  });

  // The one thing this app can get wrong is the person in front of the camera.
  it('aims at what people chose, never at who they are', () => {
    const prompt = systemPrompt(base);
    expect(prompt).toContain('roast only what they chose');
    expect(prompt).toContain('Never their body');
    expect(prompt).toContain('never guess who they are');
  });

  it('speaks the language it is given', () => {
    expect(systemPrompt({ ...base, lang: 'pl' })).toContain('in Polish');
  });

  it('draws its own angles and sends its own line with the frame', () => {
    expect(anglesFor('roaster')).toBe(ROAST_ANGLES);
    expect(userPromptFor('roaster')).toBe(ROAST_USER_PROMPT);
    for (const previous of ROAST_ANGLES) {
      const next = pickAngle(previous, () => 0.5, ROAST_ANGLES);
      expect(next).not.toBe(previous);
      expect(ROAST_ANGLES).toContain(next);
    }
  });

  it('keeps the passenger prompt as it was when no flavour is named', () => {
    const passenger = systemPrompt({ persona: 'nervous', intensity: 'normal', lang: 'en', recent: [] });
    expect(passenger).toContain('Never give a real driving instruction');
  });

  it('has its own personas, and a passenger persona is not one of them', () => {
    expect(defaultConfigFor(ROASTER).remarks.persona).toBe('comedian');
    expect(normalizeConfig({ remarks: { persona: 'critic' } }, ROASTER).remarks.persona).toBe('critic');
    expect(normalizeConfig({ remarks: { persona: 'nervous' } }, ROASTER).remarks.persona).toBe('comedian');
    expect(normalizeConfig({ remarks: { persona: 'critic' } }).remarks.persona).toBe('nervous');
  });

  it('keeps its settings and its rounds apart from the passenger', () => {
    expect(ROASTER.configKey).not.toBe(BACKSEAT.configKey);
    expect(roundPath('u1', { rideId: 'r', n: 1, at: 5 }, ROASTER)).toBe('users/u1/roaster/rides/r/0001-5');
    expect(roundPath('u1', { rideId: 'r', n: 1, at: 5 })).toBe('users/u1/backseat/rides/r/0001-5');
  });
});
