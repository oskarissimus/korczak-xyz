/*
 * THE HERO'S OWN WORDS. Owner, 29 Oct 2026: "add a free-text option to the dialogue options". Beside
 * the decisions a beat offers, the reader may type what the hero says, and a model answers it in the
 * character's voice. The dialogue was a menu of lines the beat already held, so talking cost nothing;
 * a typed line costs one short request, asked while the reader waits.
 *
 * What was typed is one of two things, and the model says which:
 * - talk: a question, a remark, a joke, a line that settles nothing. The character answers and the
 *   conversation goes on; the exchange is passed on with the step (`heardAside`), so a later beat
 *   knows it was said.
 * - a decision: the hero commits to something, and the player steers the quest by it (owner, 30 Oct
 *   2026: "with free text there should also be a way to steer the quest, not only to chat and ask").
 *   It leads where one of the beat's offered decisions leads, or, for a course of the hero's own, to
 *   a step of the kind the model names (`ownLeads`): any kind where the quest goes on here, the end
 *   only where an offered decision ends it, the count still drawn by the game (`pickJob`). The next
 *   beat is written from the hero's words (`StepRecord.own`).
 *
 * The character knows only what this step has said, and the prompt holds only what the hero has
 * heard: the story so far, the clues examined, the witness if talked to, the questions asked.
 *
 * Since 11 Nov 2026 (owner: "with any npc there is a free-text option… at every stage you can talk
 * with any npc, make small talk or push the story") the line may be said to anyone — the step's
 * character on any screen, its witness, anyone else in the world (`FreeContext.to`) — at any time.
 * Said where the step can no longer be decided, or with no step, it is only talk (`decide`), and the
 * game hands it to the next step as heard. `parseFree` is the boundary.
 */

import { TAGS } from './audioTags';
import { classicWorld, worldLines, type WorldBrief } from './genesis';
import { personaWords } from './persona';
import {
  extractJson,
  isDead,
  jobWords,
  meeting,
  names,
  narrated,
  pickJob,
  type Beat,
  type Character,
  type Decision,
  type Job,
  type Lang,
  type QuestMood,
  type StepRecord,
} from './quest';
import { languageName } from './language';
import { CONTENT_RULES } from './contentPolicy';

/** As long as the reader may type: a line, not a letter. */
export const FREE_MAX = 200;

export interface FreeContext {
  lang: Lang;
  world?: WorldBrief;
  title: string | null;
  mood?: QuestMood;
  /** The quest's decided steps before this one. */
  history: StepRecord[];
  /** The step in play; null while none is (the opening still being written, between quests). */
  beat: Beat | null;
  /**
   * Whom the hero speaks to (owner, 11 Nov 2026: "with any npc there is a free-text option, at every
   * stage"): the step's own character when absent, else its witness or anyone else in the world.
   */
  to?: Character;
  /** What `to` said last, and where they stand, for someone who is not this step's character. */
  their?: { line?: string; place?: string | null };
  /** How many parts of the step's story the hero has heard; absent is all of them. */
  told?: number;
  /** The step's job is not done yet. */
  jobLeft?: boolean;
  /**
   * Whether the line may settle the step: false once it is decided and the next one is being
   * written, or with no step at all. Then everything typed is talk.
   */
  decide?: boolean;
  /** What the hero heard here besides the story (`heardAside`), typed lines included. */
  heard: string;
  /** The clues examined, by index. */
  seen: number[];
  /** The world's people, so a meeting with someone already met keeps their exact name. */
  characters: Character[];
  dead?: string[];
  /** What the hero says now. */
  said: string;
}

export type FreeAnswer =
  | { kind: 'talk'; reply: string }
  | {
      kind: 'decision';
      reply: string;
      consequence: string;
      /** What the next step asks of the hero; null ends the quest. */
      next: Job | null;
      /** The offered decision it goes the way of, by index in the beat; null for a course of the hero's own. */
      route: number | null;
      dies?: string[];
      meet?: Decision['meet'];
    };

/** Who answers the typed line. */
export function listener(ctx: FreeContext): Character | null {
  return ctx.to ?? ctx.beat?.npc ?? null;
}

/** Whether the typed line may settle the step, not only talk. */
export function mayDecide(ctx: FreeContext): boolean {
  return Boolean(ctx.beat) && ctx.decide !== false && routes(ctx.beat!).length > 0;
}

/** The beat's decisions a typed one can go the way of: the offered ones, never an earlier typed one. */
export function routes(b: Beat): Decision[] {
  return b.decisions.filter((d) => !d.free);
}

/**
 * Where a course of the hero's own may lead: any kind of step where the quest goes on here, the end
 * where an offered decision ends it. The count is still the game's (`pickJob`).
 */
export function ownLeads(b: Beat): ('slay' | 'collect' | 'talk' | 'end')[] {
  const offered = routes(b);
  return [
    ...(offered.some((d) => d.next) ? (['slay', 'collect', 'talk'] as const) : []),
    ...(offered.some((d) => !d.next) ? (['end'] as const) : []),
  ];
}

const LEAD_WORDS: Record<'slay' | 'collect' | 'talk' | 'end', string> = {
  slay: 'a fight: the next step has the hero defeat a foe or foes',
  collect: 'a search: the next step has the hero gather things',
  talk: 'a meeting: the next step has the hero go and talk with someone',
  end: 'the end: the quest ENDS here, and the "reply" is the epilogue',
};

const TAG_LIST = TAGS.map((t) => `[${t}]`).join(', ');

export function freePrompt(ctx: FreeContext): string {
  const language = languageName(ctx.lang);
  const world = ctx.world ?? classicWorld(ctx.lang);
  const b = ctx.beat;
  const to = listener(ctx)!;
  const own = Boolean(b && to.name === b.npc.name);
  const witness = b?.witness && to.name === b.witness.npc.name ? b.witness : null;
  const decide = mayDecide(ctx);
  const lines: string[] = [
    'You are the storyteller of an RPG played like a branching text adventure. The player has just typed what the',
    `hero says to ${to.name}, in their own words. Answer it as ${to.name}.`,
    '',
    ...worldLines(world),
    '',
    ...CONTENT_RULES,
    '',
  ];
  if (ctx.mood) lines.push(`This quest's tone: ${ctx.mood.tone}.`, '');
  if (ctx.history.length) {
    lines.push(`THIS QUEST SO FAR ("${ctx.title ?? b?.title ?? ''}"):`);
    ctx.history.forEach((s, i) => {
      lines.push(
        `${i + 1}. At ${s.placeName ?? world.hub}, ${s.npcName}: ${s.situation}`,
        ...(s.heard ? [`   Also heard there: ${s.heard}`] : []),
        `   The hero decided (said to ${s.to ?? s.npcName}): "${s.chose}" — ${s.consequence}`,
      );
    });
    lines.push('');
  }
  if (ctx.dead?.length) lines.push(`THE DEAD, for good: ${ctx.dead.map((n) => `"${n}"`).join(', ')}.`, '');
  const persona = to.persona ? [`${to.name} is ${personaWords(to.persona)}; they answer like it, without ever naming it.`] : [];
  const voice = to.voice ? ` (${to.voice})` : '';
  if (b) {
    const npc = b.npc;
    const told = Math.max(0, Math.min(b.story.length, ctx.told ?? b.story.length));
    lines.push(
      `NOW, at ${b.place?.name ?? world.hub}${b.job ? (ctx.jobLeft ? `, where the hero has yet to finish ${jobWords(b.job)}` : `, where the hero has just finished ${jobWords(b.job)}`) : ''}.`,
    );
    if (own) lines.push(...persona);
    lines.push(`${npc.name}${own ? voice : ''}, whose step of the quest this is, has told the hero, in this order:`);
    if (b.greeting) lines.push(`- "${b.greeting}"`);
    for (const p of b.story.slice(0, told)) lines.push(`- the hero: "${p.ask}" — ${npc.name}: "${p.say}"`);
    if (told < b.story.length) lines.push(`(${npc.name} has not told the rest yet, and the hero does not know it.)`);
    if (ctx.jobLeft && b.waitingLine) lines.push(`- and, until the job is done: "${b.waitingLine}"`);
    const seen = ctx.seen.map((i) => b.clues[i]).filter(Boolean);
    if (seen.length) lines.push(`The hero examined: ${seen.map((c) => `${c.name} ("${c.text}")`).join('; ')}.`);
    if (ctx.heard) lines.push(`Also heard here: ${ctx.heard}`);
    lines.push('');
  } else {
    lines.push('NOW: no step of a quest is in play; the hero is walking the world while the story finds its next turn.', '');
  }
  if (!own) {
    lines.push(`THE HERO IS TALKING TO ${to.name}${voice}${witness ? `, another person at this place` : ', someone in this world'}.`, ...persona);
    if (witness) {
      lines.push(`${to.name} has said to the hero: "${witness.greeting}"`);
      for (const o of witness.talk) lines.push(`- asked "${o.label}" — "${o.reply}"`);
    } else {
      if (ctx.their?.place !== undefined) lines.push(`${to.name} is at ${ctx.their.place ?? world.hub}.`);
      if (ctx.their?.line) lines.push(`The last thing ${to.name} said to the hero: "${ctx.their.line}"`);
      lines.push(
        `If ${to.name} appears in the quest above, that is what they lived through; otherwise they are a person of this`,
        'world going about their own life, with their own worries, work and opinions.',
      );
    }
    lines.push('');
  }
  if (decide) {
    const offered = routes(b!);
    lines.push('THE DECISIONS the game offers the hero at this step, each with where it leads:');
    offered.forEach((d, i) => {
      lines.push(
        `${i + 1}. "${d.label}" → ${d.next ? `the quest goes on: a step of ${jobWords(d.next)}` : 'the quest ENDS here'}.${own ? ` ${b!.npc.name} answers: "${d.reply}"` : ''}`,
      );
    });
    lines.push(
      '',
      `THE HERO NOW SAYS to ${to.name}: "${ctx.said}"`,
      '',
      'Decide what that is:',
      '- "decision": the hero commits to a course of action that settles what happens next — takes the job, refuses,',
      '  sets out somewhere, sides with someone, attacks, gives up, ends it, or proposes a plan of their own ("I will…",',
      '  "Let us…", "I would rather…", "First I go to…"), even one phrased as a question. THE PLAYER IS STEERING THE',
      "  QUEST: the next step is written from the hero's words, wherever they lead, not from an offered decision.",
      ...(own
        ? []
        : [
            `  It counts though it is said to ${to.name} and not to ${b!.npc.name}: the player may push the story through anyone.`,
          ]),
      ...(ctx.jobLeft
        ? [
            `  The job here is not done yet: a line about doing it, or asking about it, is talk. Only a clear change of`,
            '  course — leaving it, going elsewhere first, a plan of their own instead — is a decision.',
          ]
        : []),
      '  "lead" says what kind of step comes next:',
      "  - the number of an offered decision, when the hero's course is essentially that one;",
      `  - otherwise, for a course of the hero's own, one of: ${ownLeads(b!).map((l) => `"${l}" (${LEAD_WORDS[l]})`).join(', ')}.`,
      '    Pick the one that fits what the hero said: setting out to find someone is "talk", to hunt or fight is "slay",',
      '    to fetch, gather or search for things is "collect".',
      `  Its "reply" is ${to.name}'s answer to the hero's plan, and for a decision that ENDS the quest, the epilogue, how`,
      '  it ends for everyone involved. Its "consequence" is one sentence on what the hero set out to do, in their own',
      '  terms, never what doing it will uncover: the truth is found in the next step.',
      '- "talk": a question, small talk, a remark, a joke, a threat that is only words, a line that is unclear. Not a plan.',
      `  ${to.name} answers and the conversation goes on. What is said is remembered and may shape the story later.`,
      '',
    );
  } else {
    lines.push(
      '',
      `THE HERO NOW SAYS to ${to.name}: "${ctx.said}"`,
      '',
      `This is talk: ${to.name} answers and the conversation goes on. What is said is remembered, and the story`,
      'that comes next may take it up, so a plan the hero states here is heard and may well be followed.',
      '',
    );
  }
  lines.push(
    own
      ? `${to.name} KNOWS ONLY THIS STEP: what they said above, and what a person like them would know.`
      : `${to.name} KNOWS ONLY what they lived through and saw, what was said to them, and what a person like them would know — not what others told the hero in private.`,
    'They may answer, dodge, lie, refuse, joke, gossip, or be offended, in their own manner, and add a small',
    'concrete detail; they never reveal what the next step should uncover, never name a culprit or a place nobody',
    'mentioned, and never settle the decision for the hero. If the hero asks for something impossible in this',
    'world, they react to it as a person would. A new name is never one of the dead and never one already in this story.',
    '',
    `IT IS SPOKEN DIALOGUE, read aloud by a voice actor: ${to.name}'s own words to the hero, first person, addressing`,
    'them as "you". Never narration, never stage directions, never the speaker in the third person, never',
    `"she says that…". A sound the voice actor makes goes in as an audio tag, in English and square brackets, only one of: ${TAG_LIST}`,
    `— at most one. Write the reply${decide ? ' and the consequence' : ''} in ${language}, the reply 1 to 3 sentences, under 280 characters.`,
    '',
    'Answer with ONE JSON object and nothing else, no markdown fence:',
    '{"kind": "talk", "reply": string}',
  );
  if (decide) {
    lines.push(
      'or',
      '{"kind": "decision", "lead": number or string, "reply": string, "consequence": string,',
      ' "dies": [names of anyone who dies because of it], only when someone does,',
      ' "meet": {"name": exact name of someone already met, or null for someone new, "who": who they are in a few words},',
      '         only when the next step is meeting and talking with someone}',
    );
  }
  return lines.join('\n');
}

function line(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * The model's answer as the game can play it, or null: a reply that is narrated rather than spoken
 * is not, nor a decision whose route is not one of the beat's.
 */
export function parseFree(raw: string, ctx: FreeContext, random: () => number = Math.random): FreeAnswer | null {
  const r = extractJson(raw) as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return null;
  const to = listener(ctx);
  const reply = line(r.reply, 400);
  if (!reply || !to || narrated(reply, to.name)) return null;
  const kind = typeof r.kind === 'string' ? r.kind.toLowerCase() : '';
  if (kind === 'talk') return { kind: 'talk', reply };
  if (kind !== 'decision') return null;
  // Where nothing can be settled, a plan is heard and answered, and waits for the story to take it up.
  if (!mayDecide(ctx)) return { kind: 'talk', reply };
  const b = ctx.beat!;
  const consequence = line(r.consequence, 300);
  if (!consequence) return null;
  const offered = routes(b);
  // "route" is what the first version asked for; an answer that still writes it plays.
  const lead = r.lead ?? r.route;
  const own = typeof lead === 'string' ? ownLeads(b).find((l) => l === lead.trim().toLowerCase()) : undefined;
  let route: Decision | null = null;
  let next: Job | null;
  if (own) next = own === 'end' ? null : pickJob(random, [own]);
  else {
    const n = typeof lead === 'number' ? lead : Number(String(lead ?? '').match(/\d+/)?.[0]);
    if (!Number.isInteger(n) || n < 1 || n > offered.length) return null;
    route = offered[n - 1];
    next = route.next;
  }
  // Nobody standing here dies of words unless the line says so; the model's list is the story's.
  const dies = names(r.dies).filter((d) => !isDead(d, ctx.dead));
  const meet = next?.kind === 'talk' ? (meeting(r.meet, ctx.characters) ?? route?.meet) : undefined;
  return {
    kind: 'decision',
    reply,
    consequence,
    next,
    route: route ? b.decisions.indexOf(route) : null,
    ...(dies.length > 0 && { dies }),
    ...(meet && { meet }),
  };
}

/** The typed line as a decision of the beat, going where the model said it leads. */
export function freeDecision(said: string, a: Extract<FreeAnswer, { kind: 'decision' }>, to?: string): Decision {
  return {
    label: said,
    ...(to && { to }),
    reply: a.reply,
    consequence: a.consequence,
    next: a.next,
    ...(a.dies && { dies: a.dies }),
    ...(a.meet && { meet: a.meet }),
    free: true,
  };
}
