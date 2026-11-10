import { describe, expect, it } from 'vitest';
import { fallbackColors, parseProposals, PROPOSAL_COUNT, proposalPrompt, proposalWish, validProposal } from './proposalScript';

const ANSWER = [
  'N: Kraina Mgieł',
  'S: łowcy świetlików na bagnach',
  'P: Bagna pod wieczną mgłą, gdzie łowcy polują na świetliki wielkie jak psy.',
  'G: mroczne fantasy',
  'C: #223344 #88AA66',
  'I: misty swamp village on stilts at dusk, giant glowing fireflies',
  '**N:** Solne Wybrzeże',
  '2. P: Archipelag kupców soli i piratów.',
  'G: piraci',
  'C: #ffffff',
  'I: salt flats harbour with tall ships',
].join('\n');

describe('parseProposals', () => {
  it('reads blocks of lines into proposals, forgiving decorations', () => {
    const out = parseProposals(ANSWER, true);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ name: 'Kraina Mgieł', genre: 'mroczne fantasy', colors: ['#223344', '#88aa66'] });
    expect(out[0].picture).toContain('fireflies');
    expect(out[1].name).toBe('Solne Wybrzeże');
    expect(out[1].pitch).toBe('Archipelag kupców soli i piratów.');
    expect(out[1].colors[0]).toBe('#ffffff');
  });

  it('reads the idea, and leaves it empty when a block has none', () => {
    const out = parseProposals(ANSWER, true);
    expect(out[0].idea).toBe('łowcy świetlików na bagnach');
    expect(out[1].idea).toBe('');
  });

  it('counts only whole lines while streaming', () => {
    const half = 'N: Kraina\nP: Bagna pod';
    expect(parseProposals(half)).toHaveLength(0);
    expect(parseProposals(half + ' mgłą.\n')).toHaveLength(1);
    // The cover line is not used before it ends.
    expect(parseProposals('N: A\nP: b.\nI: half a pic')[0].picture).toBeNull();
  });

  it('stops at the count', () => {
    const many = Array.from({ length: 6 }, (_, i) => `N: W${i}\nP: p${i}.`).join('\n');
    expect(parseProposals(many, true)).toHaveLength(PROPOSAL_COUNT);
  });
});

describe('proposalPrompt', () => {
  it('names the language, the seeds and the worlds to avoid', () => {
    const prompt = proposalPrompt({ lang: 'pl', seeds: [['salt', 'bell'], ['moth', 'tide'], [], []], avoid: ['Old: a world'] });
    expect(prompt).toContain('In Polish');
    expect(prompt).toContain('salt, bell');
    expect(prompt).toContain('- Old: a world');
    expect(prompt).toContain('N: <name>');
  });
});

describe('proposalWish', () => {
  it('keeps the name and the pitch, within the wish limit', () => {
    const w = proposalWish({ name: 'Kraina', pitch: 'Bagna.', genre: 'fantasy' }, 'pl');
    expect(w).toBe('Świat nazywa się „Kraina” (fantasy). Bagna.');
    expect(proposalWish({ name: 'X', pitch: 'y'.repeat(900), genre: '' }, 'en').length).toBe(600);
  });
});

describe('validProposal', () => {
  it('reads a kept proposal back and refuses junk', () => {
    expect(validProposal({ name: 'A', pitch: 'b', colors: ['#000000', '#ffffff'], image: 'https://x/y.png' })).toMatchObject({ image: 'https://x/y.png' });
    expect(validProposal({ name: 'A', pitch: 'b', image: 'javascript:alert(1)' })?.image).toBeNull();
    expect(validProposal({ name: 'A' })).toBeNull();
    expect(validProposal(null)).toBeNull();
  });

  it('gives a name the same two colours every time', () => {
    expect(fallbackColors('Kraina')).toEqual(fallbackColors('Kraina'));
    expect(fallbackColors('Kraina')[0]).toMatch(/^#[0-9a-f]{6}$/);
  });
});
