import { describe, expect, it } from 'vitest';

import { classicWorld, type LandmarkModel, type WorldBible } from './genesis';
import { personPrompt, tPose, widePose } from './falPrompts';
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

  it('draws the T-pose with the palms forward, or down for the lab’s second variant, and nothing else changed', () => {
    const p = personPrompt('a blacksmith', { gender: 'male' });
    const forward = tPose(p);
    const down = tPose(p, 'down');
    expect(forward).toContain('thumbs pointing up');
    expect(down).toContain('palms facing down');
    expect(down).not.toContain('thumbs');
    expect(down.replace('palms facing down', 'X')).toBe(forward.replace('palms open and facing forward toward the viewer with the thumbs pointing up', 'X'));
  });

  it('moves a prompt already in one pose into another, rather than adding the second after the first', () => {
    const game = tPose(personPrompt('a smith', { gender: 'male' }));
    const down = tPose(game, 'down');
    expect(down).toContain('palms facing down');
    expect(down).not.toContain('thumbs');
    expect(down.match(/strict T-pose/g)).toHaveLength(1);
    expect(tPose(down)).toBe(game);
    const wide = widePose(game);
    expect(wide).toContain('precise A-pose');
    expect(wide).not.toContain('T-pose for rigging');
  });
});
