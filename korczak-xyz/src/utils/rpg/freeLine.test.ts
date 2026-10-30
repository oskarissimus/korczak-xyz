import { describe, expect, it } from 'vitest';

import { freeDecision, freePrompt, ownLeads, parseFree, routes, type FreeContext } from './freeLine';
import { beatPrompt, heardAside, staticBeat, type Beat, type BeatContext } from './quest';

const beat: Beat = {
  ...staticBeat('en', 0),
  decisions: [
    { label: 'I will kill them.', reply: 'Thank you, sir.', consequence: 'The hunter went to the lake.', next: { kind: 'slay', count: 3 } },
    { label: 'Find someone else.', reply: 'Then we are lost.', consequence: 'The hunter refused.', next: null },
    { label: 'I will ask the smith’s wife.', reply: 'She is by the forge.', consequence: 'The hunter went to the smith’s wife.', next: { kind: 'talk', count: 0 } },
  ],
};

const ctx = (said: string, b: Beat = beat): FreeContext => ({
  lang: 'en',
  title: b.title,
  history: [],
  beat: b,
  heard: '',
  seen: [],
  characters: [b.npc],
  dead: ['Old Wit'],
  said,
});

describe('freePrompt', () => {
  it('holds what was said, what was typed and where each offered decision leads', () => {
    const p = freePrompt(ctx('How much do you pay?'));
    expect(p).toContain('THE HERO NOW SAYS: "How much do you pay?"');
    expect(p).toContain(beat.story[0].say);
    expect(p).toContain('1. "I will kill them." → the quest goes on: a step of defeating 3 hostile foes');
    expect(p).toContain('2. "Find someone else." → the quest ENDS here');
    expect(p).toContain('"Old Wit"');
  });

  it('never offers an earlier typed decision as a route', () => {
    const typed = { ...beat, decisions: [...beat.decisions, { ...beat.decisions[0], label: 'typed', free: true as const }] };
    expect(routes(typed)).toHaveLength(3);
    expect(freePrompt(ctx('x', typed))).not.toContain('"typed"');
  });
});

describe('parseFree', () => {
  it('reads talk', () => {
    expect(parseFree('{"kind": "talk", "reply": "Ten crowns, no more."}', ctx('How much?'))).toEqual({ kind: 'talk', reply: 'Ten crowns, no more.' });
  });

  it('reads a decision and goes the way of its route', () => {
    const c = ctx('Fine, I will deal with the drowners.');
    const a = parseFree('{"kind": "decision", "lead": 1, "reply": "Gods bless you.", "consequence": "The hunter set out for the lake."}', c);
    expect(a).toMatchObject({ kind: 'decision', route: 0 });
    if (a?.kind !== 'decision') throw new Error('not a decision');
    const d = freeDecision(c.said, a);
    expect(d).toEqual({
      label: 'Fine, I will deal with the drowners.',
      reply: 'Gods bless you.',
      consequence: 'The hunter set out for the lake.',
      next: { kind: 'slay', count: 3 },
      free: true,
    });
  });

  it('reads a course of the hero’s own, with the count drawn by the game', () => {
    const c = ctx('I will hunt the pike that drags them down instead.');
    const a = parseFree('{"kind": "decision", "lead": "slay", "reply": "The pike? Gods…", "consequence": "The hunter went after the giant pike."}', c, () => 0);
    expect(a).toMatchObject({ kind: 'decision', route: null, next: { kind: 'slay', count: 1 } });
    const end = parseFree('{"kind": "decision", "lead": "end", "reply": "So be it.", "consequence": "c"}', c);
    expect(end).toMatchObject({ next: null, route: null });
    const talk = parseFree('{"kind": "decision", "lead": "talk", "reply": "Go.", "consequence": "c", "meet": {"who": "the miller"}}', c);
    expect(talk).toMatchObject({ next: { kind: 'talk', count: 0 }, meet: { who: 'the miller' } });
  });

  it('ends the quest only where an offered decision would, and goes on only where one does', () => {
    const last = { ...beat, decisions: beat.decisions.filter((d) => !d.next) };
    expect(ownLeads(last)).toEqual(['end']);
    expect(parseFree('{"kind": "decision", "lead": "slay", "reply": "Go.", "consequence": "c"}', ctx('x', last))).toBeNull();
    const on = { ...beat, decisions: beat.decisions.filter((d) => d.next) };
    expect(ownLeads(on)).toEqual(['slay', 'collect', 'talk']);
    expect(parseFree('{"kind": "decision", "lead": "end", "reply": "Go.", "consequence": "c"}', ctx('x', on))).toBeNull();
  });

  it('keeps a meeting only on a route that leads to a talk', () => {
    const meet = '"meet": {"name": null, "who": "the ferryman"}';
    const talk = parseFree(`{"kind": "decision", "route": 3, "reply": "Go.", "consequence": "c", ${meet}}`, ctx('x'));
    expect(talk).toMatchObject({ meet: { who: 'the ferryman' } });
    const slay = parseFree(`{"kind": "decision", "route": 1, "reply": "Go.", "consequence": "c", ${meet}}`, ctx('x'));
    expect(slay).not.toHaveProperty('meet');
  });

  it('refuses a route the beat does not have, narration, and anything else', () => {
    expect(parseFree('{"kind": "decision", "route": 4, "reply": "Go.", "consequence": "c"}', ctx('x'))).toBeNull();
    expect(parseFree('{"kind": "decision", "route": 1, "reply": "Go."}', ctx('x'))).toBeNull();
    expect(parseFree(`{"kind": "talk", "reply": "${beat.npc.name} says that it is ten crowns."}`, ctx('x'))).toBeNull();
    expect(parseFree('{"kind": "shrug", "reply": "Hm."}', ctx('x'))).toBeNull();
    expect(parseFree('no json', ctx('x'))).toBeNull();
  });
});

describe('beatPrompt', () => {
  it('tells the next beat the player steered it', () => {
    const base: BeatContext = {
      lang: 'en', index: 1, seed: 's', job: { kind: 'slay', count: 1 }, plan: [null, null], title: 't',
      history: [{ npcName: 'A', placeName: null, situation: 's', chose: 'I hunt the pike.', consequence: 'c', own: true }],
      chronicle: [], places: [], characters: [],
    };
    expect(beatPrompt(base)).toContain('THE PLAYER STEERED THE QUEST');
    expect(beatPrompt(base)).toContain('The hero decided in their own words');
    expect(beatPrompt({ ...base, history: [{ ...base.history[0], own: undefined }] })).not.toContain('STEERED');
  });
});

describe('heardAside', () => {
  it('passes on what the hero said in their own words', () => {
    const heard = heardAside(beat, false, [], [{ label: 'Is the lake deep?', reply: 'Deep enough.' }]);
    expect(heard).toBe(`the hero said "Is the lake deep?", ${beat.npc.name}: Deep enough.`);
  });
});
