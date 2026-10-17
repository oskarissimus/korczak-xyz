/*
 * The RPG's story layer: what a quest is, the one written by hand, and how a model's answer becomes
 * part of one.
 *
 * A QUEST IS WRITTEN ONE STEP AT A TIME, AFTER EACH DECISION. Since Oct 2026 (owner: "a generative
 * feel, like a text RPG with an LLM: branching, and our decisions shape the quests to come") a
 * quest is up to `MAX_BEATS` beats. Each beat is a character somewhere — the village square or a
 * place of its own — maybe a job to do there first, and then a situation with two or three
 * decisions. The model writes the next beat only once the hunter has decided, with every earlier
 * beat and decision in the prompt, and the quest's ending goes into the chronicle
 * (`chronicle.ts`) that every later quest is written against.
 *
 * THE MODEL WRITES WORDS AND CHOOSES BLOCKS; THE ENGINE BUILDS AND THE GAME SHAPES. The model
 * invents places only out of the closed vocabularies in `place.ts`. What the branching looks like
 * is the game's: `planDecisions` draws, before the model is asked, what each decision leads to
 * (kill, gather, go and talk to someone, or end the quest), and the prompt hands that over as
 * given. Left to choose, models wrote "collect 3" every time, and a model left to decide when a
 * story ends never ends it. `parseBeat` is the boundary, pure so a test can pin it: an answer
 * that does not fit the plan is not played.
 */

import {
  BIOMES,
  DIRECTIONS,
  DISTANCES,
  ENEMY_SHAPES,
  FEATURES,
  ITEM_SHAPES,
  freeSlot,
  parseLook,
  parsePlace,
  type PlaceSpec,
  type TargetLook,
} from './place';

export type Lang = 'en' | 'pl';

/** What can be done at a place: gather things lying there, or kill what lives there. */
export type ObjectiveKind = 'collect' | 'slay';
/** What a beat asks of the hunter before its character has something to say: `talk` is nothing. */
export type JobKind = ObjectiveKind | 'talk';

export interface Job {
  kind: JobKind;
  /** 0 for `talk`. */
  count: number;
}

export interface DialogueOption {
  /** What the player says. */
  label: string;
  /** What the NPC answers. */
  reply: string;
}

export interface Character {
  name: string;
  /** Picks the voice. */
  gender: 'male' | 'female';
  /** `#rrggbb`, their clothes. */
  color: string;
}

export interface Decision {
  /** What the hunter says or does, in their own words. */
  label: string;
  /** The character's answer. For a decision that ends the quest, the epilogue. */
  reply: string;
  /** One sentence for the chronicle: what this choice did to the world. */
  consequence: string;
  /** What the next beat asks of the hunter; null ends the quest here. Drawn by the game. */
  next: Job | null;
}

export interface BeatJob {
  kind: ObjectiveKind;
  count: number;
  /** Names one of the things, for the HUD counter: "herb", "drowner". */
  targetName: string;
  look: TargetLook;
}

export interface Beat {
  /** 0 is the opening, in the village. */
  index: number;
  /** The quest's title; carried from the opening unless a beat renames it. */
  title: string;
  npc: Character;
  /** Where the character stands and the job happens; null is the village square. */
  place: PlaceSpec | null;
  job: BeatJob | null;
  /** One line for the journal while the beat is open. */
  objectiveText: string;
  /** Said when the hunter comes to talk with the job done (or there is none). */
  greeting: string;
  /** The situation, and the dilemma the decisions answer. */
  situation: string;
  /** Said if talked to before the job is done. */
  waitingLine: string;
  /** Talk that changes nothing: lore, a rumour, a joke. */
  smallTalk: DialogueOption[];
  decisions: Decision[];
}

/** One decided beat, as later beats and the chronicle are told it. */
export interface StepRecord {
  npcName: string;
  placeName: string | null;
  situation: string;
  chose: string;
  consequence: string;
}

/** A finished quest, as every later quest is told it. */
export interface ChronicleEntry {
  title: string;
  at: number;
  steps: StepRecord[];
  ending: string;
}

/** Everything the model is told when it writes a beat. */
export interface BeatContext {
  lang: Lang;
  index: number;
  seed: string;
  /** This beat's job, drawn by the previous decision; null for the opening. */
  job: Job | null;
  /** What each of this beat's decisions leads to, in order. */
  plan: (Job | null)[];
  title: string | null;
  history: StepRecord[];
  chronicle: ChronicleEntry[];
  /** This quest's places so far, which a beat may return to and a new one must keep clear of. */
  places: PlaceSpec[];
  /** This quest's characters so far, who may come back. */
  characters: Character[];
}

export const MAX_BEATS = 4;
export const MIN_COUNT = 1;
export const MAX_COUNT = 5;

/**
 * Slay 40%, collect 30%, talk 30%. Slay is 1–4 (one is a single dangerous creature, which the
 * prompt says), collect 2–5 (one thing to pick up is an errand, not a job).
 */
export function pickJob(random: () => number = Math.random, kinds: readonly JobKind[] = ['slay', 'collect', 'talk']): Job {
  const weight: Record<JobKind, number> = { slay: 0.4, collect: 0.3, talk: 0.3 };
  const total = kinds.reduce((s, k) => s + weight[k], 0);
  let roll = random() * total;
  let kind = kinds[kinds.length - 1];
  for (const k of kinds) {
    roll -= weight[k];
    if (roll < 0) {
      kind = k;
      break;
    }
  }
  if (kind === 'talk') return { kind, count: 0 };
  const low = kind === 'slay' ? 1 : 2;
  const high = kind === 'slay' ? 4 : 5;
  return { kind, count: low + Math.min(high - low, Math.floor(random() * (high - low + 1))) };
}

/** Jobs of different kinds, so two decisions never lead to the same thing to do. */
function distinctJobs(n: number, random: () => number): Job[] {
  const jobs: Job[] = [];
  let kinds: JobKind[] = ['slay', 'collect', 'talk'];
  for (let i = 0; i < n; i++) {
    const job = pickJob(random, kinds);
    jobs.push(job);
    kinds = kinds.filter((k) => k !== job.kind);
  }
  return jobs;
}

/**
 * What each decision of beat `index` leads to: on, to a job, or to the end (null). The opening
 * always branches two ways; the second beat two or three (one of them may end it); the third
 * goes on once or ends; the last only ends — two or three different endings.
 */
export function planDecisions(index: number, random: () => number = Math.random): (Job | null)[] {
  if (index >= MAX_BEATS - 1) return random() < 0.5 ? [null, null] : [null, null, null];
  if (index === 0) return distinctJobs(2, random);
  if (index === 1) return random() < 0.5 ? distinctJobs(2, random) : [...distinctJobs(2, random), null];
  return [...distinctJobs(1, random), null];
}

const VILLAGE_STEP: Record<Lang, string> = { en: 'the village square', pl: 'plac we wsi' };

/** The quest the game plays without a key: the drowners, now with two ways to end it. */
export function staticBeat(lang: Lang, index: number): Beat {
  const pl = lang === 'pl';
  const alderman: Character = { name: pl ? 'Sołtys Bogumił' : 'Alderman Bogumil', gender: 'male', color: '#7a5230' };
  if (index === 0) {
    return {
      index,
      title: pl ? 'Utopce znad jeziora' : 'Drowners by the Lake',
      npc: alderman,
      place: null,
      job: null,
      objectiveText: pl ? 'Porozmawiaj z sołtysem' : 'Talk to the alderman',
      greeting: pl
        ? 'Wiedźmin? We wsi? Bogom niech będą dzięki. Mamy kłopot, panie.'
        : 'A witcher? In our village? Thank the gods. We have trouble, sir.',
      situation: pl
        ? 'Nad jeziorem na wschodzie zalęgły się utopce. Trzy sztuki, może więcej. Dziewki boją się chodzić po wodę. Zapłacę uczciwie, jeśli się z nimi rozprawisz.'
        : 'Drowners have nested by the lake to the east. Three of them, maybe more. The girls are afraid to fetch water. I will pay honest coin if you deal with them.',
      waitingLine: '',
      smallTalk: [
        {
          label: pl ? 'Co to za miejsce?' : 'What is this place?',
          reply: pl
            ? 'Wierzbowo, panie. Kiedyś stał tu gród, dziś zostały ruiny na północy. Po nocach coś tam świeci, ale nikt nie sprawdzał.'
            : 'Willowby, sir. There was a keep here once; only the ruins to the north are left. Something glows there at night, but nobody has gone to look.',
        },
      ],
      decisions: [
        {
          label: pl ? 'Zajmę się nimi.' : 'I will deal with them.',
          reply: pl
            ? 'Dzięki ci, panie. Jezioro jest na wschód od wsi, za polem. Rybak Mirek tam czeka, on ci wszystko pokaże.'
            : 'Thank you, sir. The lake is east of the village, past the field. Mirek the fisherman is waiting there.',
          consequence: pl ? 'Wiedźmin przyjął zlecenie na utopce.' : 'The witcher took the contract on the drowners.',
          next: { kind: 'slay', count: 3 },
        },
        {
          label: pl ? 'Za taką cenę? Poszukaj głupszego.' : 'For that price? Find a bigger fool.',
          reply: pl
            ? 'Jak uważasz, panie. Wieś sobie poradzi… jakoś.'
            : 'As you wish, sir. The village will manage… somehow.',
          consequence: pl ? 'Wiedźmin odmówił wsi pomocy.' : 'The witcher refused to help the village.',
          next: null,
        },
      ],
    };
  }
  return {
    index,
    title: pl ? 'Utopce znad jeziora' : 'Drowners by the Lake',
    npc: { name: pl ? 'Rybak Mirek' : 'Mirek the Fisherman', gender: 'male', color: '#4a5d6b' },
    place: {
      name: pl ? 'Jezioro za polem' : 'The Lake Past the Field',
      direction: 'east',
      distance: 'far',
      biome: 'lakeshore',
      features: ['water', 'rocks', 'dead_trees'],
      groundColor: '#5d7a45',
    },
    job: { kind: 'slay', count: 3, targetName: pl ? 'utopiec' : 'drowner', look: { shape: 'humanoid', color: '#3f5a4a', size: 1 } },
    objectiveText: pl ? 'Zabij utopce nad jeziorem' : 'Kill the drowners by the lake',
    greeting: pl ? 'Ubiłeś je! Widziałem z łodzi, panie.' : 'You killed them! I saw it from the boat, sir.',
    situation: pl
      ? 'Sołtys obiecał ci zapłatę, ale powiem ci coś: te utopce to topielcy z zeszłej wiosny, kiedy sołtys kazał zamknąć śluzę. Ich wdowy nie mają za co żyć.'
      : 'The alderman promised you coin, but hear this: those drowners were the men drowned last spring, when the alderman had the sluice shut. Their widows have nothing to live on.',
    waitingLine: pl ? 'Uważaj, panie, wciąż tam są!' : 'Careful, sir, they are still out there!',
    smallTalk: [],
    decisions: [
      {
        label: pl ? 'Biorę zapłatę i ruszam w drogę.' : 'I take my pay and move on.',
        reply: pl
          ? 'Rozumiem, każdy musi z czegoś żyć. Bywaj, wiedźminie.'
          : 'I understand, everyone has to live on something. Farewell, witcher.',
        consequence: pl ? 'Wiedźmin wziął zapłatę od sołtysa.' : 'The witcher took the alderman’s coin.',
        next: null,
      },
      {
        label: pl ? 'Oddaj moją zapłatę wdowom.' : 'Give my pay to the widows.',
        reply: pl
          ? 'Niech cię bogowie błogosławią. Wieś będzie o tobie śpiewać, a sołtys… sołtys będzie się wstydził.'
          : 'May the gods bless you. The village will sing of you, and the alderman… the alderman will be ashamed.',
        consequence: pl
          ? 'Wiedźmin oddał zapłatę wdowom topielców; sołtys stracił twarz.'
          : 'The witcher gave his pay to the drowned men’s widows; the alderman lost face.',
        next: null,
      },
    ],
  };
}

const list = (items: readonly string[]) => items.map((i) => `"${i}"`).join(', ');

function jobWords(job: Job): string {
  if (job.kind === 'talk') return 'going somewhere to meet and talk with someone (no fight, nothing to gather)';
  if (job.kind === 'slay') return job.count === 1 ? 'killing a single dangerous creature' : `killing ${job.count} monsters`;
  return `gathering ${job.count} things`;
}

function thisStep(ctx: BeatContext): string[] {
  const job = ctx.job;
  if (!job) {
    return [
      'THIS STEP IS THE OPENING. The hunter meets a villager (the "npc") in the village square, who presents a problem.',
      'Set "place" to "village".',
    ];
  }
  const where = [
    'Where it happens ("place"): either a NEW place, built from these blocks, so choose only from them:',
    `- direction from the village: one of ${list(DIRECTIONS)}`,
    `- distance: one of ${list(DISTANCES)}`,
    `- biome: one of ${list(BIOMES)}`,
    `- features: 1 to 4 of ${list(FEATURES)}`,
    '- groundColor: a "#rrggbb" colour that suits the mood of the place',
    '  and give it an evocative name of its own;',
    ctx.places.length
      ? `or a place this quest has already been to, given as {"name": "<its exact name>"}: ${list(ctx.places.map((p) => p.name))}.`
      : '',
    job.kind === 'talk' ? 'or "village" to have the meeting in the village square.' : '',
  ].filter(Boolean);
  const npc = 'The "npc" is the person the hunter talks to there: a new character, or one met earlier in this quest (same exact name).';
  if (job.kind === 'talk') {
    return [`THIS STEP: the hunter goes to meet someone and talk (given by the last decision).`, ...where, npc];
  }
  const shapes = job.kind === 'slay' ? ENEMY_SHAPES : ITEM_SHAPES;
  return [
    job.kind === 'slay'
      ? job.count === 1
        ? 'THIS STEP: the hunter must kill a single dangerous creature at the place, bigger than a common monster (size 1.5 to 2). Count 1, given.'
        : `THIS STEP: the hunter must kill ${job.count} monsters at the place. Count ${job.count}, given; choose a monster that suits the place and the story.`
      : `THIS STEP: the hunter must gather ${job.count} things lying at the place. Count ${job.count}, given; choose what suits the story (herbs, relics, letters, bones…).`,
    ...where,
    `${npc} They are at the place and speak once the job is done.`,
    `What the targets look like ("look"): shape is one of ${list(shapes)}; a "#rrggbb" colour; size 0.5 to 2.`,
  ];
}

/** The prompt for one beat. Everything the model may choose, and everything it may not, is in it. */
export function beatPrompt(ctx: BeatContext): string {
  const language = ctx.lang === 'pl' ? 'Polish' : 'English';
  const chronicle = ctx.chronicle.slice(-5);
  const lines: string[] = [
    'You are the storyteller of a dark-fantasy RPG in the spirit of The Witcher 3, played like a branching text adventure:',
    'the quest is written one step at a time, and the hunter’s decisions decide what comes next.',
    'The player is a monster hunter in and around a small village.',
    '',
  ];
  if (chronicle.length) {
    lines.push('THE WORLD REMEMBERS the hunter’s earlier quests:');
    for (const q of chronicle) {
      const chose = q.steps.map((s) => `chose "${s.chose}" (${s.consequence})`).join('; then ');
      lines.push(`- "${q.title}": ${chose}. Ending: ${q.ending}`);
    }
    lines.push(
      'Let it show: people who were helped or wronged remember, rumours travel, debts come due. Characters from',
      'those quests may come back. Refer to at least one of those deeds somewhere in this step.',
      '',
    );
  }
  if (ctx.history.length) {
    lines.push(`THIS QUEST SO FAR ("${ctx.title ?? ''}"):`);
    ctx.history.forEach((s, i) => {
      lines.push(
        `${i + 1}. At ${s.placeName ?? 'the village'}, ${s.npcName}: ${s.situation}`,
        `   The hunter decided: "${s.chose}" — ${s.consequence}`,
      );
    });
    lines.push(
      `Now write step ${ctx.index + 1} of at most ${MAX_BEATS}. It follows directly from the last decision and honours it.`,
      '',
    );
  }
  lines.push(...thisStep(ctx), '');
  lines.push(`THE DECISIONS that end this step: exactly ${ctx.plan.length}, in this order. Each one is given:`);
  ctx.plan.forEach((next, i) => {
    lines.push(
      next
        ? `${i + 1}. leads on to a step of ${jobWords(next)}: write it as a course of action the hunter takes.`
        : `${i + 1}. ENDS the quest: its "reply" is the epilogue, how it ends for everyone involved.`,
    );
  });
  lines.push(
    'The player hears the greeting, then the situation, and only then the decisions and the questions, so none',
    'of them may refer to anything the npc has not said yet.',
    'Make them real choices with a cost — mercy or coin, truth or peace, a promise kept or broken — so that each',
    'one leads to a genuinely different story. Never two ways of saying the same thing.',
    '',
    `Write everything the player reads in ${language}. Keep each line under 280 characters.`,
    `Make it original, with a twist or a hint of moral greyness. Inspiration: ${ctx.seed}.`,
    '',
    'Answer with ONE JSON object and nothing else, no markdown fence, with these keys:',
    '{',
    '  "title": string (the quest’s title),',
    '  "npc": {"name": string, "gender": "male" or "female", "color": "#rrggbb" for their clothes},',
    ctx.job ? '  "place": {...} or {"name": string}' + (ctx.job.kind === 'talk' ? ' or "village",' : ',') : '  "place": "village",',
    ctx.job && ctx.job.kind !== 'talk'
      ? '  "targetName": string (singular noun for one of the things), "look": {"shape": string, "color": string, "size": number},'
      : '',
    '  "objectiveText": string (one line for the journal: what to do in this step),',
    ctx.job && ctx.job.kind !== 'talk'
      ? '  "waitingLine": string (what the npc says if talked to before the job is done),'
      : '',
    '  "greeting": string (the first thing the npc says: one or two sentences that already name the trouble, so',
    '              that asking about it is the natural reply),',
    '  "situation": string (what the npc tells when asked: the whole problem and the dilemma the decisions answer;',
    '               every person, place and fact the decisions or the smallTalk mention must be named here),',
    '  "smallTalk": [{"label": string (a follow-up question about something said in the situation), "reply": string}],',
    '  "decisions": [{"label": string (what the hunter says or does, first person, short),',
    '                 "reply": string (the npc’s answer), "consequence": string (one sentence: what it changed)}]',
    '}',
  );
  return lines.filter((l, i, all) => l !== '' || all[i - 1] !== '').join('\n');
}

/** A few nudges so two runs do not tell the same story. */
export const SEEDS = [
  'a grieving widow',
  'a greedy merchant',
  'a superstitious priest',
  'a child who saw something',
  'a curse nobody admits to',
  'an old debt',
  'a missing brother',
  'a forbidden love',
  'a deserter hiding from his lord',
  'a witch the village needs and fears',
  'a feud between two families',
  'a relic the temple wants back',
];

function text(value: unknown, max = 400): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/** The first `{…}` in a reply, which tolerates a fence or a sentence around it. */
export function extractJson(reply: string): unknown {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const body = reply.slice(start, end + 1);
  try {
    return JSON.parse(body);
  } catch {
    // The two ways a model's JSON is usually broken: a raw line break inside a string (Gemma does
    // this with long lines), and a trailing comma. Outside strings both repairs are harmless.
    try {
      return JSON.parse(body.replace(/[\u0000-\u001f]+/g, ' ').replace(/,\s*([}\]])/g, '$1'));
    } catch {
      return null;
    }
  }
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const CLOTHES = ['#7a5230', '#4a5d6b', '#6b3a4a', '#3f5a3a', '#5b4a7a', '#8a6a3a', '#3a4a5b'];

function character(raw: unknown, known: readonly Character[]): Character | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const name = text(r.name, 60);
  if (!name) return null;
  const met = known.find((c) => same(c.name, name));
  if (met) return met;
  const color = typeof r.color === 'string' && /^#[0-9a-f]{6}$/i.test(r.color.trim()) ? r.color.trim().toLowerCase() : null;
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { name, gender: r.gender === 'female' ? 'female' : 'male', color: color ?? CLOTHES[h % CLOTHES.length] };
}

function beatPlace(raw: unknown, ctx: BeatContext, job: Job): PlaceSpec | null | undefined {
  if (typeof raw === 'string' && /village|wie[sś]/i.test(raw)) return job.kind === 'talk' ? null : undefined;
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  const name = typeof r?.name === 'string' ? r.name : '';
  const earlier = ctx.places.find((p) => same(p.name, name));
  if (earlier) return earlier;
  const fresh = parsePlace(raw);
  if (fresh) return freeSlot(fresh, ctx.places);
  // A meeting needs nowhere special; a fight or a search does.
  return job.kind === 'talk' ? null : undefined;
}

/**
 * A model's reply as a beat, or null when it cannot be played. The parts the game depends on are
 * not guessed: a beat without a character, a place its job needs, the thing to kill or gather, or
 * as many decisions as the plan has is thrown away. The job and what each decision leads to come
 * from the context, whatever the model wrote.
 */
export function parseBeat(reply: string, ctx: BeatContext): Beat | null {
  const raw = extractJson(reply);
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const npc = character(r.npc, ctx.characters);
  if (!npc) return null;

  let place: PlaceSpec | null = null;
  let job: BeatJob | null = null;
  if (ctx.job) {
    const p = beatPlace(r.place, ctx, ctx.job);
    if (p === undefined) return null;
    place = p;
    if (ctx.job.kind !== 'talk') {
      const targetName = text(r.targetName, 40);
      if (!targetName) return null;
      job = {
        kind: ctx.job.kind,
        count: Math.min(MAX_COUNT, Math.max(MIN_COUNT, ctx.job.count)),
        targetName,
        look: parseLook(r.look, ctx.job.kind),
      };
    }
  }

  const rawDecisions = Array.isArray(r.decisions) ? r.decisions : [];
  const decisions: Decision[] = [];
  for (const [i, next] of ctx.plan.entries()) {
    const d = (rawDecisions[i] ?? null) as Record<string, unknown> | null;
    const label = text(d?.label, 120);
    const replyText = text(d?.reply, 600);
    if (!label || !replyText) return null;
    decisions.push({ label, reply: replyText, consequence: text(d?.consequence, 200) ?? label, next });
  }

  const title = text(r.title, 80) ?? ctx.title;
  const situation = text(r.situation, 700);
  const greeting = text(r.greeting) ?? '';
  if (!title || !situation) return null;

  const smallTalk = Array.isArray(r.smallTalk)
    ? r.smallTalk
        .map((o) => {
          const option = o as Record<string, unknown> | null;
          const label = text(option?.label, 80);
          const replyText = text(option?.reply);
          return label && replyText ? { label, reply: replyText } : null;
        })
        .filter((o): o is DialogueOption => o !== null)
        .slice(0, 2)
    : [];

  return {
    index: ctx.index,
    // The opening names the quest; a later beat may rename it, but only the opening has to.
    title: ctx.index === 0 ? title : (ctx.title ?? title),
    npc,
    place,
    job,
    objectiveText: text(r.objectiveText, 120) ?? `${npc.name} — ${place?.name ?? VILLAGE_STEP[ctx.lang]}`,
    greeting,
    situation,
    waitingLine: text(r.waitingLine) ?? greeting,
    smallTalk,
    decisions,
  };
}
