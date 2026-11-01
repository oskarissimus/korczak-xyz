import { describe, expect, it } from 'vitest';

import { classicWorld, type LandmarkModel, type WorldBible } from './genesis';
import { personPrompt, isTPose, tPose, widePose } from './falPrompts';
import { labSources, type LabWorld } from './labSources';
import type { Character } from './quest';
import type { SavedGame } from './save';

const model = (glb: string): LandmarkModel => ({ glb, image: `${glb}.jpg`, prompt: 'p', costUsd: 0.023, ms: 1, at: 1 });
const world = (over: Partial<WorldBible> = {}): WorldBible => ({ ...classicWorld('en'), id: 'w1', createdAt: 1, ...over });
const person = (name: string, glb?: string, gender: 'male' | 'female' = 'male') => ({ name, gender, model: glb ? model(glb) : undefined }) as Character;

describe('labSources', () => {
  it('lists the hero, the atlas and the quest’s people once each, newest world first, and no one unmade', () => {
    const game = {
      beats: [
        { npc: person('Jagna', 'b.glb', 'female'), witness: { npc: person('Stach', 'c.glb') }, job: { kind: 'slay', targetName: 'bandit', look: { shape: 'humanoid' }, model: model('d.glb') } },
        { npc: person('Jagna', 'b.glb', 'female'), witness: null, job: { kind: 'slay', targetName: 'wolf', look: { shape: 'beast' }, model: model('e.glb') } },
      ],
    } as unknown as SavedGame;
    const worlds: LabWorld[] = [
      { world: world({ id: 'old', name: 'Old', heroModel: model('z.glb') }), atlas: null, game: null, played: 1 },
      {
        world: world({ hero: 'A tall woman in a red cloak, scar', heroModel: model('a.glb') }),
        atlas: { places: [], people: [{ character: person('Jagna', 'b.glb', 'female'), at: null, line: '' }, { character: person('Nobody'), at: null, line: '' }] },
        game,
        played: 5,
      },
    ];
    const got = labSources(worlds).map((s) => [s.name, s.role, s.body, s.id]);
    expect(got).toEqual([
      ['A tall woman in a red cloak', 'hero', 'female', 'a.glb'],
      ['Jagna', 'person', 'female', 'b.glb'],
      ['Stach', 'person', 'male', 'c.glb'],
      ['bandit', 'enemy', 'male', 'd.glb'],
      ['hero', 'hero', 'male', 'z.glb'],
    ]);
  });

  it('widens the pose in a person’s prompt and leaves the rest of it', () => {
    const p = personPrompt('a blacksmith in a leather apron', { gender: 'male' });
    const w = widePose(p);
    expect(w).toContain('a blacksmith in a leather apron');
    expect(w).toContain('a clear gap between each arm and the body');
    expect(w).not.toContain('arms held a little away');
    expect(widePose('a knight')).toContain('a clear gap between each arm and the body');
  });

  it('draws the T-pose with the palms down, and nothing else changed', () => {
    const p = personPrompt('a blacksmith', { gender: 'male' });
    const t = tPose(p);
    expect(t).toContain('a blacksmith');
    expect(t).toContain('T-pose');
    expect(t).toContain('palms facing down');
    expect(t).not.toContain('arms held a little away');
    expect(isTPose(t)).toBe(true);
    expect(isTPose(p)).toBe(false);
  });

  it('moves a prompt already in one pose into another, rather than adding the second after the first', () => {
    const game = tPose(personPrompt('a smith', { gender: 'male' }));
    expect(game.match(/T-pose/g)).toHaveLength(1);
    expect(tPose(game)).toBe(game);
    const wide = widePose(game);
    expect(wide).toContain('precise A-pose');
    expect(isTPose(wide)).toBe(false);
    expect(tPose(wide)).toBe(game);
  });

  it('still converts a prompt stored in the old strict T-pose, either palms', () => {
    const old = (palms: string) =>
      `A smith. Standing in a strict T-pose for rigging: both arms stretched straight out to the sides, exactly horizontal at shoulder height, in one straight line from fingertip to fingertip, elbows and wrists straight, ${palms}, fingers straight and together, a clear gap between each arm and the body all the way to the armpit; both hands completely empty, holding nothing at all, no weapon, tool, staff, shield, lantern, bag, book or any other object in or near the hands (anything they carry is worn on the back or at the belt); legs straight and slightly apart with a clear gap between them, feet flat on the ground, clothes close to the body, nothing hanging from the arms or between the legs, facing the viewer.`;
    for (const palms of ['palms open and facing forward toward the viewer with the thumbs pointing up', 'palms facing down']) {
      expect(isTPose(old(palms))).toBe(true);
      expect(tPose(old(palms))).not.toContain('strict');
      expect(tPose(old(palms))).toContain('facing the viewer.');
    }
  });
});
