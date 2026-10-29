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
 * - a decision: the hero commits to something. It goes the way one of the beat's own decisions goes
 *   (`route`), because the branching's shape is the game's, not the model's (`planDecisions`): a
 *   typed line can end the quest only where an offered decision would, and lead on only to a job the
 *   game drew. The reply and the consequence are the model's, written as those decisions' are.
 *
 * The character knows only what this step has said, and the prompt holds only what the hero has
 * heard: the story, the clues examined, the witness if talked to, the questions asked. A typed line
 * is offered only once the story has been told, as the decisions are. `parseFree` is the boundary.
 */

import { TAGS } from './audioTags';
import { classicWorld, worldLines, type WorldBrief } from './genesis';
import {
  extractJson,
  isDead,
  jobWords,
  meeting,
  names,
  narrated,
  type Beat,
  type Character,
  type Decision,
  type Lang,
  type QuestMood,
  type StepRecord,
} from './quest';

/** As long as the reader may type: a line, not a letter. */
export const FREE_MAX = 200;

export interface FreeContext {
  lang: Lang;
  world?: WorldBrief;
  title: string | null;
  mood?: QuestMood;
  /** The quest's decided steps before this one. */
  history: StepRecord[];
  beat: Beat;
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
      /** Which of the beat's offered decisions this one goes the way of, by index. */
      route: number;
      dies?: string[];
      meet?: Decision['meet'];
    };

/** The beat's decisions a typed one can go the way of: the offered ones, never an earlier typed one. */
export function routes(b: Beat): Decision[] {
  return b.decisions.filter((d) => !d.free);
}

const TAG_LIST = Object.keys(TAGS).map((t) => `[${t}]`).join(', ');

export function freePrompt(ctx: FreeContext): string {
  const language = ctx.lang === 'pl' ? 'Polish' : 'English';
  const world = ctx.world ?? classicWorld(ctx.lang);
  const b = ctx.beat;
  const npc = b.npc;
  const lines: string[] = [
    'You are the storyteller of an RPG played like a branching text adventure. The player has just typed what the',
    `hero says to ${npc.name}, instead of picking one of the offered lines. Answer it as ${npc.name}.`,
    '',
    ...worldLines(world),
    '',
  ];
  if (ctx.mood) lines.push(`This quest's tone: ${ctx.mood.tone}.`, '');
  if (ctx.history.length) {
    lines.push(`THIS QUEST SO FAR ("${ctx.title ?? b.title}"):`);
    ctx.history.forEach((s, i) => {
      lines.push(`${i + 1}. At ${s.placeName ?? world.hub}, ${s.npcName}: ${s.situation}`, `   The hero decided: "${s.chose}" — ${s.consequence}`);
    });
    lines.push('');
  }
  if (ctx.dead?.length) lines.push(`THE DEAD, for good: ${ctx.dead.map((n) => `"${n}"`).join(', ')}.`, '');
  lines.push(
    `NOW, at ${b.place?.name ?? world.hub}${b.job ? `, where the hero has just finished ${jobWords(b.job)}` : ''}.`,
    `${npc.name}${npc.voice ? ` (${npc.voice})` : ''} has told the hero, in this order:`,
  );
  if (b.greeting) lines.push(`- "${b.greeting}"`);
  for (const p of b.story) lines.push(`- the hero: "${p.ask}" — ${npc.name}: "${p.say}"`);
  const seen = ctx.seen.map((i) => b.clues[i]).filter(Boolean);
  if (seen.length) lines.push(`The hero examined: ${seen.map((c) => `${c.name} ("${c.text}")`).join('; ')}.`);
  if (ctx.heard) lines.push(`Also heard here: ${ctx.heard}`);
  lines.push('');
  const offered = routes(b);
  lines.push('THE DECISIONS the game offers here, each with where it leads:');
  offered.forEach((d, i) => {
    lines.push(
      `${i + 1}. "${d.label}" → ${d.next ? `the quest goes on: a step of ${jobWords(d.next)}` : 'the quest ENDS here'}. ${npc.name} answers: "${d.reply}"`,
    );
  });
  lines.push(
    '',
    `THE HERO NOW SAYS: "${ctx.said}"`,
    '',
    'Decide what that is:',
    '- "decision": the hero commits to a course of action that settles what happens next — takes the job, refuses,',
    '  sets out somewhere, sides with someone, attacks, gives up, ends it. Then "route" is the number of the offered',
    '  decision whose outcome it is closest to (where it leads: on to that step, or the end), and you write the',
    `  rest as that decision's is written. Its "reply" is ${npc.name}'s answer, and for a route that ENDS the quest, the`,
    '  epilogue, how it ends for everyone involved. Its "consequence" is one sentence on what the hero set out to do,',
    '  never what doing it will uncover: the truth is found in the next step.',
    '- "talk": anything else — a question, a remark, a joke, a threat that is only words, a line that is unclear.',
    `  ${npc.name} answers and the conversation goes on.`,
    '',
    `${npc.name} KNOWS ONLY THIS STEP: what they said above, and what a person like them would know. They may answer,`,
    'dodge, lie, refuse, joke, or be offended, in their own manner, and add a small concrete detail; they never',
    'reveal what the next step should uncover, never name a culprit or a place nobody mentioned, and never',
    'settle the decision for the hero. If the hero asks for something impossible in this world, they react to it',
    'as a person would. A new name is never one of the dead and never one already in this story.',
    '',
    `IT IS SPOKEN DIALOGUE, read aloud by a voice actor: ${npc.name}'s own words to the hero, first person, addressing`,
    'them as "you". Never narration, never stage directions, never the speaker in the third person, never',
    `"she says that…". A sound the voice actor makes goes in as an audio tag, in English and square brackets, only one of: ${TAG_LIST}`,
    `— at most one. Write the reply and the consequence in ${language}, the reply 1 to 3 sentences, under 280 characters.`,
    '',
    'Answer with ONE JSON object and nothing else, no markdown fence:',
    '{"kind": "talk", "reply": string}',
    'or',
    '{"kind": "decision", "route": number, "reply": string, "consequence": string,',
    ' "dies": [names of anyone who dies because of it], only when someone does,',
    ' "meet": {"name": exact name of someone already met, or null for someone new, "who": who they are in a few words},',
    '         only when the route leads on to meeting and talking with someone}',
  );
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
export function parseFree(raw: string, ctx: FreeContext): FreeAnswer | null {
  const r = extractJson(raw) as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return null;
  const reply = line(r.reply, 400);
  if (!reply || narrated(reply, ctx.beat.npc.name)) return null;
  const kind = typeof r.kind === 'string' ? r.kind.toLowerCase() : '';
  if (kind === 'talk') return { kind: 'talk', reply };
  if (kind !== 'decision') return null;
  const offered = routes(ctx.beat);
  const n = typeof r.route === 'number' ? r.route : Number(String(r.route ?? '').match(/\d+/)?.[0]);
  if (!Number.isInteger(n) || n < 1 || n > offered.length) return null;
  const consequence = line(r.consequence, 300);
  if (!consequence) return null;
  const route = offered[n - 1];
  // Nobody standing here dies of words unless the line says so; the model's list is the story's.
  const dies = names(r.dies).filter((d) => !isDead(d, ctx.dead));
  const meet = route.next?.kind === 'talk' ? (meeting(r.meet, ctx.characters) ?? route.meet) : undefined;
  return {
    kind: 'decision',
    reply,
    consequence,
    route: ctx.beat.decisions.indexOf(route),
    ...(dies.length > 0 && { dies }),
    ...(meet && { meet }),
  };
}

/** The typed line as a decision of the beat, going where its route goes. */
export function freeDecision(b: Beat, said: string, a: Extract<FreeAnswer, { kind: 'decision' }>): Decision {
  return {
    label: said,
    reply: a.reply,
    consequence: a.consequence,
    next: b.decisions[a.route].next,
    ...(a.dies && { dies: a.dies }),
    ...(a.meet && { meet: a.meet }),
    free: true,
  };
}
