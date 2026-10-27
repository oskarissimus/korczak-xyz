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
  MAX_PARTS,
  PART_MATERIALS,
  PART_SHAPES,
  parseLook,
  parsePlace,
  placeFromMiddles,
  type PlaceSpec,
  type TargetLook,
} from './place';
import { classicWorld, worldLines, type LandmarkModel, type WorldBrief } from './genesis';
import { asAge, type VoiceAge } from './voicePick';

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
  /** Picks the voice, with `age`. */
  gender: 'male' | 'female';
  /** How old they sound, for the voice (`voicePick.ts`); absent in beats from before it was asked. */
  age?: VoiceAge;
  /**
   * Who they are as a voice, in English, for ElevenLabs' Voice Design (`voiceDesign.ts`): language,
   * gender, age, persona, emotion, timbre and pace. Also the manner their lines are written in, and
   * what the model is reminded of when they come back. Absent in beats from before it was asked.
   */
  voice?: string;
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
  /**
   * What the hunter must have heard before this is offered: the witness, a clue by index, or a
   * small-talk question by index (`{ ask }`). A decision that rests on something optional waits for
   * it (owner, Oct 2026: a choice named the innkeeper whom only the witness had mentioned, and one
   * accused the blacksmith whom only a follow-up question had). Absent: the story is enough.
   */
  after?: 'witness' | number | { ask: number };
  /** Who dies if the hero chooses this, by name (`dead` in `BeatContext`). */
  dies?: string[];
}

export interface BeatJob {
  kind: ObjectiveKind;
  count: number;
  /** Names one of the things, for the HUD counter: "herb", "drowner". */
  targetName: string;
  look: TargetLook;
}

/** One turn of a character telling their story: what the hunter says to hear it, and what they say. */
export interface StoryPart {
  ask: string;
  say: string;
}

/** Something at the place the hunter can examine, and what asking the character about it brings. */
export interface Clue {
  name: string;
  /** What the hunter notices, in their own words. */
  text: string;
  /** The hunter's question about it, offered once it has been examined. */
  ask: string;
  reply: string;
  look: TargetLook;
  /**
   * The thing itself in English, for the picture its 3D model is made from (`landmark3d.ts`,
   * `generateClueModel`): an image model reads Polish badly. Absent in beats from before it.
   */
  prop?: string;
  /** Its model from fal.ai once made, kept on the beat so the autosave never asks twice. */
  model?: LandmarkModel;
}

/** Somebody else at the place, with their own view of it. */
export interface Witness {
  npc: Character;
  greeting: string;
  talk: DialogueOption[];
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
  /**
   * The character's story, told in turns: the hunter asks, they say a little more. The decisions
   * come after the last part.
   */
  story: StoryPart[];
  /** The story in one string, for later prompts and the chronicle. */
  situation: string;
  /** Things to examine at the place, each opening a question for the character. */
  clues: Clue[];
  witness: Witness | null;
  /** Said if talked to before the job is done. */
  waitingLine: string;
  /** Talk that changes nothing: lore, a rumour, a joke. */
  smallTalk: DialogueOption[];
  decisions: Decision[];
  /**
   * Who is dead as this beat tells it, by name: someone the story says was killed or found dead.
   * Never its own npc or witness. Absent in beats from before it was asked.
   */
  dead?: string[];
}

/** One decided beat, as later beats and the chronicle are told it. */
export interface StepRecord {
  npcName: string;
  placeName: string | null;
  situation: string;
  chose: string;
  consequence: string;
  /**
   * What the hero did at the place before the talk, in English with the target as the model named
   * it: "killed Ronin Takeda", "killed 4 × bandit". Absent for a talk and in steps from before it.
   */
  done?: string;
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
  /** The world's places so far (its atlas and this quest's), which a beat may return to and a new one must keep clear of. */
  places: PlaceSpec[];
  /** The world's people so far, who may come back. */
  characters: Character[];
  /** Where it all happens (`genesis.ts`); absent is the classic world of the hand-written quest. */
  world?: WorldBrief;
  /**
   * Everyone dead in this world, by name: a foe the hero killed, someone a decision killed, someone
   * the story said had died. Nobody here comes back (owner, Oct 2026: "I killed Takeda earlier and
   * here he suddenly is and you can talk to him").
   */
  dead?: string[];
}

/**
 * Whether `name` is one of the dead. Also by a single name inside a longer one, because the model
 * names a target "Ronin Takeda" and then the man "Takeda".
 */
export function isDead(name: string, dead: readonly string[] | undefined): boolean {
  const mine = nameWords(name);
  if (mine.length === 0) return false;
  return (dead ?? []).some((d) => {
    const theirs = nameWords(d);
    if (theirs.length === 0) return false;
    const [short, long] = mine.length <= theirs.length ? [mine, theirs] : [theirs, mine];
    return short.every((w) => long.includes(w));
  });
}

/** A name's words of three letters or more, lower case: "Ronin Takeda" is ronin, takeda. */
function nameWords(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3);
}

/** One line for what a beat's job came to, for `StepRecord.done`; null for a talk. */
export function jobDone(job: BeatJob | null): string | null {
  if (!job) return null;
  const verb = job.kind === 'slay' ? 'killed' : 'gathered';
  return job.count === 1 ? `${verb} ${job.targetName}` : `${verb} ${job.count} × ${job.targetName}`;
}

/** Whom a beat's job killed by name: a single foe, the one the story set the hero on. */
export function slainBy(job: BeatJob | null): string | null {
  return job?.kind === 'slay' && job.count === 1 ? job.targetName : null;
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

/** A hand-written story in parts, as [what the hunter asks, what they are told]. */
function told(parts: [string, string][]): Pick<Beat, 'story' | 'situation'> {
  const story = parts.map(([ask, say]) => ({ ask, say }));
  return { story, situation: story.map((p) => p.say).join(' ') };
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
      ...told(
        pl
          ? [
              ['Co się stało?', 'Jezioro, panie. Na wschodzie, za polem. Coś tam siedzi w trzcinach i wyłazi, jak się ściemni.'],
              ['Co takiego?', 'Utopce. Trzy, może więcej. Kowalowa widziała je przy kładce, ledwo uciekła. Dziewki boją się chodzić po wodę.'],
              ['Czego ode mnie chcesz?', 'Ubij je, panie. Wieś się zrzuci. Zapłacę uczciwie, słowo sołtysa.'],
            ]
          : [
              ['What happened?', 'The lake, sir. East, past the field. Something sits in the reeds and comes out when it gets dark.'],
              ['What kind of something?', 'Drowners. Three, maybe more. The smith’s wife saw them by the footbridge and barely got away. The girls are afraid to fetch water.'],
              ['What do you want of me?', 'Kill them, sir. The village will pay. Honest coin, on my word as alderman.'],
            ],
      ),
      clues: [],
      witness: null,
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
    ...told(
      pl
        ? [
            ['Wiedziałeś, co tu siedzi?', 'Wiedziałem, kim byli. Tego z blizną na ręku poznałem. Janek, od Wierzbów.'],
            ['Znałeś ich?', 'Wszyscy znaliśmy. Utopili się zeszłej wiosny, kiedy sołtys kazał zamknąć śluzę, żeby mu młyn szedł. A teraz płaci za ich zabicie drugi raz.'],
            ['Czego chcesz?', 'Niczego, panie. Tylko… ich wdowy nie mają za co żyć. Pomyśl o tym, zanim weźmiesz jego srebro.'],
          ]
        : [
            ['You knew what was out here?', 'I knew who they were. The one with the scar on his arm, I knew him. Janek, from the willow farm.'],
            ['You knew them?', 'We all did. They drowned last spring, when the alderman had the sluice shut so his mill would turn. Now he pays to have them killed a second time.'],
            ['What do you want?', 'Nothing, sir. Only… their widows have nothing to live on. Think on that before you take his silver.'],
          ],
    ),
    clues: [],
    witness: null,
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
  if (job.kind === 'slay') return job.count === 1 ? 'defeating a single dangerous foe' : `defeating ${job.count} hostile foes`;
  return `gathering ${job.count} things`;
}

/**
 * How a model builds a landmark from blocks (`place.ts`, `Landmark`). The example is a windmill
 * because it uses everything at once: a body, a roof, a door, sails that turn.
 */
const LANDMARK_LINES = [
  '- landmark: the building or thing that makes the place what it is (a mill if it is a mill, a',
  '  wreck, a shrine, a pump station, a giant skeleton…), built from up to ' + MAX_PARTS + ' simple parts like toy blocks.',
  '  Make its shape say what it is: proportions, a roof, a door, a chimney, a mast. Each part:',
  `  {"shape": one of ${list(PART_SHAPES)} (wedge = a gable-roof prism, ridge along z),`,
  '   "size": [width x, height y, depth z] in metres, "at": [x, y, z] where its MIDDLE is,',
  '   "turn": degrees about the vertical, "tilt": [degrees about x, degrees about z],',
  `   "material": one of ${list(PART_MATERIALS)} (wall/roof are this world's own), "color": optional "#rrggbb",`,
  '   "spin": optional "x", "y" or "z" for a part that turns about its middle (sails, a wheel), so parts',
  '   that turn together share one "at"}.',
  '  Metres, the landmark\'s own centre at 0,0, ground at y 0, its front facing +z (toward the hero);',
  '  everything within 9 m of the centre and under 24 m high; a person is 1.8 m, a door 2 m tall.',
  '  Every "at" is the part\'s middle: a part on the ground has y = half its height, and a part resting on',
  '  another has y = the top of that one + half its own height. Example, a windmill:',
  '  {"name": "the old mill", "parts": [{"shape": "cylinder", "size": [5, 7, 5], "at": [0, 3.5, 0], "material": "wall"},',
  '   {"shape": "cone", "size": [6, 3, 6], "at": [0, 8.5, 0], "material": "roof"},',
  '   {"shape": "box", "size": [1.2, 2, 0.3], "at": [0, 1, 2.45], "material": "dark"},',
  '   {"shape": "box", "size": [0.6, 11, 0.2], "at": [0, 6, 2.8], "material": "wood", "spin": "z"},',
  '   {"shape": "box", "size": [11, 0.6, 0.2], "at": [0, 6, 2.8], "material": "wood", "spin": "z"}]}',
  '  (the two sails share their middle, so they turn together as one cross). Leave it out only for a place that',
  '  is truly nothing but nature.',
  '  A new place is {"name", "direction", "distance", "biome", "features", "groundColor", "landmark"};',
];

function thisStep(ctx: BeatContext, hub: string): string[] {
  const job = ctx.job;
  if (!job) {
    return [
      `THIS STEP IS THE OPENING. The hero meets someone (the "npc") in ${hub}, who presents a problem.`,
      ...(ctx.characters.length
        ? ['Usually someone the hero has not met yet: the world grows with every quest. One of the people already here may come back instead when the chronicle gives them a reason.']
        : []),
      `Set "place" to "village" (that is ${hub}).`,
    ];
  }
  const where = [
    'Where it happens ("place"): either a NEW place, built from these blocks, so choose only from them:',
    '- name: an evocative name of its own (required; the landmark has a name of its own besides)',
    `- direction from ${hub}: one of ${list(DIRECTIONS)}`,
    `- distance: one of ${list(DISTANCES)}`,
    `- biome: one of ${list(BIOMES)}`,
    `- features: 1 to 4 of ${list(FEATURES)}`,
    '- groundColor: a "#rrggbb" colour that suits the mood of the place',
    ...LANDMARK_LINES,
    ctx.places.length
      ? `or a place already standing in this world, given as {"name": "<its exact name>"}: ${list(ctx.places.map((p) => p.name))}. Mostly build new places, in directions and distances nothing stands at yet (the world grows outward), and return to an old one when the story calls for it.`
      : '',
    job.kind === 'talk' ? `or "village" to have the meeting in ${hub}.` : '',
  ].filter(Boolean);
  const npc = 'The "npc" is the person the hero talks to there: a new character, or one already met (same exact name).';
  if (job.kind === 'talk') {
    return [`THIS STEP: the hero goes to meet someone and talk (given by the last decision).`, ...where, npc];
  }
  const shapes = job.kind === 'slay' ? ENEMY_SHAPES : ITEM_SHAPES;
  return [
    job.kind === 'slay'
      ? job.count === 1
        ? 'THIS STEP: the hero must defeat a single dangerous foe at the place — a creature, machine, spirit, whatever this world fears — bigger than a common one (size 1.5 to 2). Count 1, given.'
        : `THIS STEP: the hero must defeat ${job.count} hostile foes at the place. Count ${job.count}, given; choose foes that belong to this world, the place and the story.`
      : `THIS STEP: the hero must gather ${job.count} things lying at the place. Count ${job.count}, given; choose what suits this world and the story.`,
    ...where,
    `${npc} They are at the place and speak once the job is done.`,
    `What the targets look like ("look"): shape is one of ${list(shapes)}; a "#rrggbb" colour; size 0.5 to 2.`,
  ];
}

/** The prompt for one beat. Everything the model may choose, and everything it may not, is in it. */
export function beatPrompt(ctx: BeatContext): string {
  const language = ctx.lang === 'pl' ? 'Polish' : 'English';
  const chronicle = ctx.chronicle.slice(-5);
  const world = ctx.world ?? classicWorld(ctx.lang);
  const lines: string[] = [
    'You are the storyteller of an RPG played like a branching text adventure: the quest is written one step at a',
    'time, and the hero’s decisions decide what comes next.',
    '',
    ...worldLines(world),
    '',
  ];
  if (chronicle.length) {
    lines.push('THE WORLD REMEMBERS the hero’s earlier quests:');
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
  const living = ctx.characters.filter((c) => !isDead(c.name, ctx.dead));
  if (living.length) {
    lines.push(
      `PEOPLE ALREADY IN THIS WORLD (bring one back by this exact name when it fits, in the same voice and manner): ${living
        .map((c) => (c.voice ? `"${c.name}" (${c.voice})` : `"${c.name}"`))
        .join(', ')}.`,
      '',
    );
  }
  if (ctx.dead?.length) {
    lines.push(
      `THE DEAD: ${list(ctx.dead)}. They are dead for good. None of them is ever the "npc" or the "witness", none of`,
      'them appears, speaks, fights or is met again, not under another title or as a ghost, unless this world’s',
      'magic is stated to raise the dead. Others may only speak of them as dead: grieve them, curse them, inherit',
      'their feuds, find their bodies.',
      '',
    );
  }
  if (ctx.history.length) {
    lines.push(`THIS QUEST SO FAR ("${ctx.title ?? ''}"):`);
    ctx.history.forEach((s, i) => {
      lines.push(
        `${i + 1}. At ${s.placeName ?? world.hub}${s.done ? `, where the hero ${s.done}` : ''}, ${s.npcName}: ${s.situation}`,
        `   The hero decided: "${s.chose}" — ${s.consequence}`,
      );
    });
    lines.push(
      `Now write step ${ctx.index + 1} of at most ${MAX_BEATS}. It follows directly from the last decision and honours it.`,
      '',
    );
  }
  lines.push(...thisStep(ctx, world.hub), '');
  lines.push(`THE DECISIONS that end this step: exactly ${ctx.plan.length}, in this order. Each one is given:`);
  ctx.plan.forEach((next, i) => {
    lines.push(
      next
        ? `${i + 1}. leads on to a step of ${jobWords(next)}: write it as a course of action the hero takes, not what it will turn up.`
        : `${i + 1}. ENDS the quest: its "reply" is the epilogue, how it ends for everyone involved.`,
    );
  });
  lines.push(
    'Make them real choices with a cost — mercy or coin, truth or peace, a promise kept or broken — so that each',
    'one leads to a genuinely different story. Never two ways of saying the same thing.',
    '',
    'HOW IT IS TOLD. This is a conversation with a real person, not a briefing. Nobody pours out the whole story',
    'and the stakes in their first breath: the npc opens with a line or two the way a real person would (a plea,',
    'suspicion, fear, a reaction to the hero at the door), and the story comes out in 2 to 4 parts as the hero',
    'asks — what happened, what they saw, what they are afraid of or ashamed of, and only at the end what they want.',
    'Let them hesitate, hold something back, contradict themselves, get one detail wrong. Concrete details',
    '(a name, a smell, the time of night), not abstractions. Each part is 1 to 3 spoken sentences.',
    'More of the truth is found, not told: 1 or 2 "clues" are things lying at the place the hero can examine',
    '(claw marks, a torn shawl, a letter, fresh digging), and each one lets the hero ask the npc about it — and',
    'the npc then admits something they did not say. A "witness" may stand there too: someone else with their own',
    'version, a rumour, or a reason to want the opposite of what the npc wants.',
    'The player hears the greeting and the story parts, and only then the decisions and the questions, so none of',
    'them may refer to anything not yet said (a clue’s question is offered only after it is examined).',
    'A DECISION IS AN INTENTION, NOT A CONCLUSION. Its "label" says what the hero will do ("I will search the',
    'burnt barn.", "I will track the beast by the pen tonight."), never what doing it will prove or uncover: no',
    'culprit, no hidden motive, no fact the hero has not been told. Wrong: "I will search the ashes and find',
    'proof the blacksmith did it." when nobody has named the blacksmith. The truth comes out in the NEXT step,',
    'while the hero does what they chose, so the "consequence" also says only what the hero set out to do;',
    'what is found is for the next step to write. A decision that ends the quest may name only who and what the',
    'player has already heard of.',
    'Each decision rests on the npc’s greeting and story parts by default. A decision that only makes sense',
    'after something optional — the witness, a clue, or the answer to a "smallTalk" question — sets "after":',
    '"witness", "clue 1", "clue 2", "question 1" or "question 2" (smallTalk in order), and the game offers it only',
    'once the hero has heard that; at least one decision must need none of them. If a smallTalk answer names',
    'someone or something, a decision that uses it waits for that question.',
    '',
    'THEY ARE CHARACTERS, NOT NARRATORS (owner: "like people in a theatre or a film, not the narrator of a book").',
    'Every person has a temperament and a way of talking, which their "voice" describes, and every line of theirs',
    'sounds like it: a gruff smith in clipped half-sentences, a frightened girl who rambles and backtracks, a liar',
    'smooth and a little too eager, a proud elder who answers a question with a question. Nobody explains everything',
    'in order or puts the truth in the clearest words: they trail off (…), interrupt themselves, dodge, answer a',
    'different question, exaggerate, lie, joke, snap, use this world’s sayings and curses. Half-sentences are fine.',
    'What matters most to them comes out sideways, and some of it only when the hero presses. The npc and the',
    'witness never sound alike. The player must still be able to follow: the facts a decision needs are said',
    'somewhere, just not tidily.',
    '',
    'IT IS SPOKEN DIALOGUE, read aloud by a voice actor. Every "greeting", "say", "waitingLine", every "reply" and',
    'everything the witness says is that person’s own words to the hero, in the first person ("I", "my',
    'daughter"), addressing them as "you". Never narration, never stage directions, never the speaker in the third',
    'person, never "she says that…". Wrong: "Helena weeps and says her daughter-in-law hanged herself."',
    'Right: "My Hania… she hanged herself. On the old willow, by the graves." A clue’s "text" is the',
    'hero’s own eye, first person ("Claw marks, and too high for a wolf.").',
    'Every "label" and "ask" is the hero’s own spoken line, short: at most 12 words, one sentence.',
    `Write everything the player reads in ${language}. Keep each line under 280 characters.`,
    `Make it original, with a twist or a hint of moral greyness. Inspiration: ${ctx.seed}.`,
    '',
    'Answer with ONE JSON object and nothing else, no markdown fence, with these keys:',
    '{',
    '  "title": string (the quest’s title),',
    '  "npc": {"name": string, "gender": "male" or "female", "age": "young", "middle_aged" or "old" (picks their voice),',
    '          "color": "#rrggbb" for their clothes,',
    `          "voice": string (in English, to design their voice: "Native ${language}. Male or Female, <age range>. Persona: <2–5 words>. Emotion: <2–3 adjectives>." then one sentence on timbre, pace and how they talk; for someone already met, what you were told)},`,
    ctx.job ? '  "place": {...} or {"name": string}' + (ctx.job.kind === 'talk' ? ' or "village",' : ',') : '  "place": "village",',
    ctx.job && ctx.job.kind !== 'talk'
      ? '  "targetName": string (singular noun for one of the things), "look": {"shape": string, "color": string, "size": number},'
      : '',
    '  "objectiveText": string (one line for the journal: what to do in this step),',
    ctx.job && ctx.job.kind !== 'talk'
      ? '  "waitingLine": string (what the npc says if talked to before the job is done),'
      : '',
    '  "greeting": string (the first thing the npc says, one or two sentences),',
    '  "story": [{"ask": string (what the hero says to hear more), "say": string (the npc’s next part)}],',
    '  "smallTalk": [{"label": string (a follow-up question about something in the story), "reply": string}],',
    `  "clues": [{"name": string (a few words), "text": string, "ask": string, "reply": string, "shape": one of ${list(ITEM_SHAPES)},`,
    '             "prop": string (IN ENGLISH whatever the language above, at most 12 words: the object alone as it',
    '                     looks, for a 3D model — "a torn blue wool shawl caught on a thorn branch")}],',
    '  "witness": {"name": string, "gender": string, "age": string, "color": string, "voice": string, "greeting": string,',
    '              "talk": [{"label": string, "reply": string}]} or null,',
    '  "decisions": [{"label": string (what the hero says, first person, at most 12 words),',
    '                 "reply": string (the npc’s answer), "consequence": string (one sentence: what it changed),',
    '                 "after": "witness", "clue 1", "clue 2", "question 1" or "question 2", only when needed,',
    '                 "dies": [names of anyone who dies if the hero chooses this], only when someone does}],',
    '  "dead": [names of everyone this step tells is dead: killed earlier, found dead, said to have died] (may be empty)',
    '}',
  );
  return lines.filter((l, i, all) => l !== '' || all[i - 1] !== '').join('\n');
}

/** A few nudges so two runs do not tell the same story. */
export const SEEDS = [
  'a grieving widow',
  'a greedy merchant',
  'a superstitious elder',
  'a child who saw something',
  'a curse nobody admits to',
  'an old debt',
  'a missing brother',
  'a forbidden love',
  'a deserter hiding from those they served',
  'an outcast the settlement needs and fears',
  'a feud between two families',
  'a relic someone powerful wants back',
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

/**
 * A line that tells about the character instead of being said by them: it opens with their own name
 * as the subject ("Helena płacze…", not "Helena, listen") or reports speech ("mówi, że", "says
 * that"). Models fall into this as the story gets long; the owner caught it in the first week.
 */
export function narrated(line: string, name: string): boolean {
  if (!line) return false;
  const words = name.trim().split(/\s+/);
  const opens = [name.trim(), words[words.length - 1]].some(
    (n) => n.length > 1 && line.startsWith(n) && !/^[,!?:]/.test(line.slice(n.length).trimStart()),
  );
  // Not \b: in JavaScript it is ASCII-only, and there is no boundary before "że".
  const reported = /(^|\s)(mówi|powiada|szepcze|błaga|says|whispers|begs|tells you),? (że|that)(?=[\s,.]|$)/i.test(line);
  return opens || reported;
}

/** What the hunter says to hear more, when a story part comes without its own question. */
const MORE: Record<Lang, string[]> = {
  en: ['What happened?', 'Go on.', 'And then?', 'What do you want of me?'],
  pl: ['Co się stało?', 'Mów dalej.', 'I co potem?', 'Czego ode mnie chcesz?'],
};

function options(raw: unknown, max: number): DialogueOption[] {
  return (Array.isArray(raw) ? raw : [])
    .map((o) => {
      const option = o as Record<string, unknown> | null;
      const label = text(option?.label, 100);
      const replyText = text(option?.reply);
      return label && replyText ? { label, reply: replyText } : null;
    })
    .filter((o): o is DialogueOption => o !== null)
    .slice(0, max);
}

/**
 * A decision's `after`: "witness", "clue 2" (or a bare 2) as clue index 1, "question 1" as small-talk
 * index 0.
 */
function rawAfter(raw: unknown): Decision['after'] {
  if (typeof raw === 'string' && /witness|świadek/i.test(raw)) return 'witness';
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.match(/\d+/)?.[0]) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > 2) return undefined;
  return typeof raw === 'string' && /question|pytanie|smalltalk/i.test(raw) ? { ask: n - 1 } : n - 1;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const CLOTHES = ['#7a5230', '#4a5d6b', '#6b3a4a', '#3f5a3a', '#5b4a7a', '#8a6a3a', '#3a4a5b'];

function character(raw: unknown, known: readonly Character[]): Character | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const name = text(r.name, 60);
  if (!name) return null;
  const voice = text(r.voice, 400);
  const met = known.find((c) => same(c.name, name));
  // Someone met before voices were described keeps everything else, and gets one now.
  if (met) return met.voice || !voice ? met : { ...met, voice };
  const color = typeof r.color === 'string' && /^#[0-9a-f]{6}$/i.test(r.color.trim()) ? r.color.trim().toLowerCase() : null;
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const age = asAge(r.age);
  return {
    name,
    gender: r.gender === 'female' ? 'female' : 'male',
    color: color ?? CLOTHES[h % CLOTHES.length],
    ...(age && { age }),
    ...(voice && { voice }),
  };
}

function beatPlace(raw: unknown, ctx: BeatContext, job: Job): PlaceSpec | null | undefined {
  if (typeof raw === 'string' && /village|wie[sś]/i.test(raw)) return job.kind === 'talk' ? null : undefined;
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  const name = typeof r?.name === 'string' ? r.name : '';
  const earlier = ctx.places.find((p) => same(p.name, name));
  if (earlier) return earlier;
  // The model writes every part by its middle; the game keeps them by their base (`place.ts`).
  const fresh = parsePlace(placeFromMiddles(raw));
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
  // The dead do not come back; a beat written around one cannot be played, the next model may do better.
  if (isDead(npc.name, ctx.dead)) return null;

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
    const after = rawAfter(d?.after);
    const dies = names(d?.dies);
    decisions.push({
      label,
      reply: replyText,
      consequence: text(d?.consequence, 200) ?? label,
      next,
      ...(after !== undefined && { after }),
      ...(dies.length > 0 && { dies }),
    });
  }

  const title = text(r.title, 80) ?? ctx.title;
  const greeting = text(r.greeting) ?? '';
  const story: StoryPart[] = (Array.isArray(r.story) ? r.story : [])
    .map((o, i) => {
      const part = o as Record<string, unknown> | null;
      const say = text(part?.say, 500);
      return say ? { ask: text(part?.ask, 100) ?? MORE[ctx.lang][Math.min(i, MORE[ctx.lang].length - 1)], say } : null;
    })
    .filter((p): p is StoryPart => p !== null)
    .slice(0, 5);
  // The beat format before the story came in parts, which a model may still fall back to.
  const flat = text(r.situation, 700);
  if (story.length === 0 && flat) story.push({ ask: MORE[ctx.lang][0], say: flat });
  if (!title || story.length === 0) return null;
  const situation = story.map((p) => p.say).join(' ');

  const smallTalk = options(r.smallTalk, 2);
  const clues: Clue[] = (Array.isArray(r.clues) ? r.clues : [])
    .map((o) => {
      const c = o as Record<string, unknown> | null;
      const name = text(c?.name, 50);
      const seen = text(c?.text, 300);
      const ask = text(c?.ask, 100);
      const replyText = text(c?.reply);
      if (!name || !seen || !ask || !replyText) return null;
      const prop = text(c?.prop, 120);
      return {
        name,
        text: seen,
        ask,
        reply: replyText,
        look: parseLook({ shape: c?.shape, color: '#e8d9a8', size: 0.8 }, 'collect'),
        ...(prop ? { prop } : {}),
      };
    })
    .filter((c): c is Clue => c !== null)
    .slice(0, 2);
  let witness: Witness | null = null;
  const w = r.witness && typeof r.witness === 'object' ? (r.witness as Record<string, unknown>) : null;
  const wnpc = w ? character(w, ctx.characters) : null;
  if (w && wnpc && !same(wnpc.name, npc.name) && !isDead(wnpc.name, ctx.dead)) {
    const wGreeting = text(w.greeting);
    const talk = options(w.talk, 2);
    if (wGreeting && !narrated(wGreeting, wnpc.name) && !talk.some((o) => narrated(o.reply, wnpc.name))) {
      witness = { npc: wnpc, greeting: wGreeting, talk };
    }
  }

  // A gate on something the beat does not have is no gate; and if every decision waits, the
  // character's story was not enough to decide on, which the prompt forbids. Better a beat that can
  // be finished than one that cannot: then nothing waits.
  for (const d of decisions) {
    const a = d.after;
    if (a === 'witness' ? !witness : typeof a === 'number' ? !clues[a] : a && !smallTalk[a.ask]) delete d.after;
  }
  if (decisions.every((d) => d.after !== undefined)) for (const d of decisions) delete d.after;

  // Narration where a line should be spoken breaks the scene and the voice; the next model may do better.
  const spoken = [
    greeting,
    ...story.map((p) => p.say),
    text(r.waitingLine) ?? '',
    ...decisions.map((d) => d.reply),
    ...smallTalk.map((o) => o.reply),
    ...clues.map((c) => c.reply),
  ];
  if (spoken.some((line) => narrated(line, npc.name))) return null;

  // Whoever is standing there talking is not dead, whatever the list says.
  const dead = names(r.dead).filter((n) => !same(n, npc.name) && !(witness && same(n, witness.npc.name)));

  return {
    index: ctx.index,
    // The opening names the quest; a later beat may rename it, but only the opening has to.
    title: ctx.index === 0 ? title : (ctx.title ?? title),
    npc,
    place,
    job,
    objectiveText: text(r.objectiveText, 120) ?? `${npc.name} — ${place?.name ?? VILLAGE_STEP[ctx.lang]}`,
    greeting,
    story,
    situation,
    clues,
    witness,
    waitingLine: text(r.waitingLine) ?? greeting,
    smallTalk,
    decisions,
    ...(dead.length > 0 && { dead }),
  };
}

/** A model's list of names: strings only, short, at most six. */
function names(raw: unknown): string[] {
  return (Array.isArray(raw) ? raw : [])
    .map((n) => text(n, 60))
    .filter((n): n is string => n !== null)
    .slice(0, 6);
}
