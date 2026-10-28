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
import { classicWorld, firstObject, worldLines, type LandmarkModel, type WorldBrief } from './genesis';
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
  /**
   * How they look, in English, for the picture their 3D model is made from (`personPrompt`): build,
   * age, clothes, hair. Absent in beats from before it was asked; they are drawn from `voice` then.
   */
  appearance?: string;
  /** Their model from fal.ai once made (`ensurePersonModel`), kept wherever they are, so it is made once. */
  model?: LandmarkModel;
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
  /**
   * For a decision that leads to a talk: whom the hero sets out to meet. `name` only when it is
   * someone already met; without it, a new person the next beat must invent (owner, 28 Oct 2026: a
   * witness said "my friend from the tribe knows more", the hero went to find the friend, and the
   * next beat had the witness himself waiting there).
   */
  meet?: Meeting;
}

/** Whom a talk step is with, as the decision before it set out. */
export interface Meeting {
  /** Someone already met, by their exact name; absent for someone new. */
  name?: string;
  /** Who they are, in the story's words: "Tiago's friend from the tribe, a scout on the outskirts". */
  who: string;
}

export interface BeatJob {
  kind: ObjectiveKind;
  count: number;
  /** Names one of the things, for the HUD counter: "herb", "drowner". */
  targetName: string;
  look: TargetLook;
  /**
   * A thing to gather, in English, for the fal.ai model it is shown as in an invented world (owner,
   * 27 Oct 2026: "the things to pick up should be generated assets too"), and that model once made.
   * For a slay job, one of the enemies, made only when they walk on two legs (`humanoid`) and rigged
   * as a person is (`people.ts`).
   */
  prop?: string;
  model?: LandmarkModel;
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
  /**
   * What else the hero heard there besides the npc's story: the witness, the follow-up questions
   * asked (`heardAside`). A decision may rest on it, so the next beat has to know it was said.
   */
  heard?: string;
  /** The witness at the place, so the next beat knows who that was. */
  witnessName?: string;
  /** Whom the chosen decision sent the hero to meet (`Decision.meet`). */
  meet?: Meeting;
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
  /** What kind of quest this is and how it touches the world's past (`drawMood`); absent is a grim one of its own. */
  mood?: QuestMood;
}

/*
 * THE QUEST'S MOOD (owner, 28 Oct 2026: "a new quest should not be a strict continuation of the last
 * one; it may cross it, but rather rarely than often, the same place or the same person. Not every
 * quest needs a deep moral choice: there can be simple, easy, light quests that show the world, and
 * funny ones"). Left to the prompt, every quest was a grey dilemma that "refers to at least one of
 * those deeds" — so both are drawn here, once per quest, and told to the model as given, like the jobs.
 */
export const TONES = ['light', 'comic', 'adventure', 'grim'] as const;
export type Tone = (typeof TONES)[number];
/** How the quest touches the world's past: not at all, through a place already standing, or a person already met. */
export const TIES = ['fresh', 'place', 'person'] as const;
export type Tie = (typeof TIES)[number];
export interface QuestMood {
  tone: Tone;
  tie: Tie;
}

const TONE_WEIGHTS: Record<Tone, number> = { light: 25, comic: 20, adventure: 25, grim: 30 };
/** Most quests are their own story; a crossing with the past is the exception. */
const TIE_WEIGHTS: Record<Tie, number> = { fresh: 65, place: 20, person: 15 };

function weighted<T extends string>(weights: Partial<Record<T, number>>, rand: () => number): T {
  const entries = Object.entries(weights) as [T, number][];
  let r = rand() * entries.reduce((n, [, w]) => n + w, 0);
  for (const [k, w] of entries) {
    if ((r -= w) < 0) return k;
  }
  return entries[entries.length - 1][0];
}

/** A quest's tone and tie, drawn at its start: a tie only to what the world already has. */
export function drawMood(past: { places: number; people: number }, rand: () => number = Math.random): QuestMood {
  const tone = weighted(TONE_WEIGHTS, rand);
  const ties: Partial<Record<Tie, number>> = { fresh: TIE_WEIGHTS.fresh };
  if (past.places > 0) ties.place = TIE_WEIGHTS.place;
  if (past.people > 0) ties.person = TIE_WEIGHTS.person;
  return { tone, tie: weighted(ties, rand) };
}

/** A mood as stored or sent, or null. */
export function parseMood(raw: unknown): QuestMood | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const tone = (TONES as readonly unknown[]).includes(r.tone) ? (r.tone as Tone) : null;
  const tie = (TIES as readonly unknown[]).includes(r.tie) ? (r.tie as Tie) : null;
  return tone && tie ? { tone, tie } : null;
}

/** Quests from before the mood: grim, and their own story. */
const DEFAULT_MOOD: QuestMood = { tone: 'grim', tie: 'fresh' };

/**
 * Whether `name` is one of the dead. Also by a single name inside a longer one, because the model
 * names a target "Ronin Takeda" and then the man "Takeda".
 */
export function isDead(name: string, dead: readonly string[] | undefined): boolean {
  return (dead ?? []).some((d) => samePerson(name, d));
}

/** Whether two names are one person's: the same, or one's words all inside the other's. */
export function samePerson(a: string, b: string): boolean {
  const mine = nameWords(a);
  const theirs = nameWords(b);
  if (mine.length === 0 || theirs.length === 0) return false;
  const [short, long] = mine.length <= theirs.length ? [mine, theirs] : [theirs, mine];
  return short.every((w) => long.includes(w));
}

/** A name's words of three letters or more, lower case: "Ronin Takeda" is ronin, takeda. */
function nameWords(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3);
}

/**
 * What the hero heard at a beat besides the npc's story, in one string for `StepRecord.heard`: the
 * witness's greeting and answers once spoken to, and the follow-up questions asked. Only the story
 * used to be passed on, so "my friend from the tribe knows more" — the witness's line the decision
 * rested on — never reached the beat that followed it.
 */
export function heardAside(b: Beat, witnessHeard: boolean, askedTalk: Iterable<number>): string {
  const parts: string[] = [];
  if (b.witness && witnessHeard) {
    const w = b.witness;
    parts.push(`${w.npc.name} (another person there): ${[w.greeting, ...w.talk.map((o) => o.reply)].join(' ')}`);
  }
  for (const i of [...askedTalk].sort((a, z) => a - z)) {
    const o = b.smallTalk[i];
    if (o) parts.push(`asked "${o.label}", ${b.npc.name}: ${o.reply}`);
  }
  return parts.join(' | ').slice(0, HEARD_MAX);
}

/** How much of what else was heard is kept per step, as the game sends it and the demo accepts it. */
export const HEARD_MAX = 700;
/** How much of a step's story is kept (it was 300, which cut the elder off mid-word). */
export const SITUATION_MAX = 700;

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
  '- assets: what stands there, for 3D models made from pictures, so IN ENGLISH whatever the language above:',
  '  [{"role": "landmark", "what": the landmark alone as it looks, at most 14 words, "size": [height, length] in metres:',
  '   its highest point and its whole footprint, roof and overhangs included, next to a 1.8 m person, erring larger},',
  '   {"role": "scatter", "what": a thing that stands or lies around the place many times over, at most 14 words,',
  '    "size": [height, length]}] — the landmark once when there is one, and one or two "scatter" things',
  '  ("a rusted pressure tank", "a cracked burial urn", "a coral head"). Each a single solid object, made the way',
  '  this world makes things; never a tree or plant (the world has its own), never ground, water or a crowd.',
  '  A new place is {"name", "direction", "distance", "biome", "features", "groundColor", "landmark", "assets"};',
];

/** How this quest is to stand to the chronicle: its own story, crossing the past at most once. */
function tieLines(tie: Tie): string[] {
  const own = 'THIS QUEST is a story of its own, NOT a sequel to the earlier ones: new trouble, mostly new people and new places.';
  if (tie === 'place') {
    return [
      own,
      'It crosses the past in one way only: one of its steps happens at a place already standing in this world',
      '(listed below), and may show what became of it. Nobody from those quests needs to appear.',
    ];
  }
  if (tie === 'person') {
    return [
      own,
      'It crosses the past in one way only: one person already met (from PEOPLE ALREADY IN THIS WORLD) takes part,',
      'with a new trouble of their own, not the old one continued.',
    ];
  }
  return [own, 'The past may show at most in a passing remark or a rumour; do not build on it.'];
}

/** Whether to go back to a place: always free within the quest, and to an older one only when the tie says so. */
function placeAdvice(ctx: BeatContext, mood: QuestMood): string {
  const ours = ctx.history.some((s) => s.placeName);
  const grow = 'Otherwise build a new place, in a direction and distance nothing stands at yet (the world grows outward).';
  const older = ctx.places.filter((p) => !ctx.history.some((s) => s.placeName === p.name));
  if (mood.tie === 'place' && older.length) {
    return `This quest is to pass through one of the places from before it (${list(older.map((p) => p.name))}) in one of its steps, unless a step so far already has. ${grow}`;
  }
  return `${ours ? 'A place this quest has already been to may be used again. ' : ''}The older places stay standing but are no part of this quest unless it truly needs one — never required. ${grow}`;
}

/** Every name the world has used, living and dead, which no new character may take. */
function takenNames(ctx: BeatContext): string[] {
  const all = [...ctx.characters.map((c) => c.name), ...(ctx.dead ?? [])];
  return all.filter((n, i) => n && all.findIndex((m) => m.toLowerCase() === n.toLowerCase()) === i);
}

/** What the quest feels like, and so what its decisions are: a dilemma only in a grim one. */
const TONE_LINES: Record<Tone, string[]> = {
  grim: [
    'THIS QUEST’S TONE: grim and grey. Make the decisions real choices with a cost — mercy or coin, truth or',
    'peace, a promise kept or broken — so that each one leads to a genuinely different story.',
  ],
  adventure: [
    'THIS QUEST’S TONE: adventure. Danger, wonder and a clear goal; nobody needs to be morally grey and there is',
    'no dilemma. The decisions are different ways to go about it — bold, clever, careful, kind — each leading',
    'somewhere genuinely different.',
  ],
  light: [
    'THIS QUEST’S TONE: light. A small, easy, warm errand that shows off this world: its everyday life, trades,',
    'customs, food, festivals, oddities and the people in it. Low stakes, no dilemma, nobody dies, nobody is a',
    'villain. Foes, if the step has any, are pests or a nuisance. The decisions are different ways to help, each',
    'pleasant, each leading somewhere different. Keep it short and simple.',
  ],
  comic: [
    'THIS QUEST’S TONE: comic. Make the player laugh: an absurd problem taken deadly seriously, a vain, stubborn',
    'or ridiculous character, misunderstandings, this world’s quirks played for laughs, a punchline of an ending.',
    'Nobody dies; foes are more silly than grim. The decisions are funny alternatives, each leading somewhere',
    'different. Funny in the characters’ own lines, never a narrator winking.',
  ],
};

function meetingWords(m: Meeting): string {
  return m.name ? `"${m.name}", already met (${m.who})` : `someone NOT met yet: ${m.who}`;
}

/** Who a talk step's npc is: whom the decision went to meet, never by default whoever was just left. */
function talkNpc(ctx: BeatContext): string[] {
  const last = ctx.history.at(-1);
  const left = last ? [last.npcName, ...(last.witnessName ? [last.witnessName] : [])] : [];
  const notLeft = left.length
    ? ` It is not ${left.map((n) => `"${n}"`).join(' or ')}, whom the hero has just left, unless that is who the decision named.`
    : '';
  if (last?.meet?.name) {
    return [`The "npc" is the person the hero set out to meet: "${last.meet.name}" (${last.meet.who}), with exactly that name.`];
  }
  if (last?.meet) {
    return [
      `The "npc" is the person the hero set out to meet: ${last.meet.who}. They have not been met yet: a NEW character with a name of their own.${notLeft}`,
    ];
  }
  return [`The "npc" is the person the last decision sends the hero to meet: a new character, or one already met (same exact name).${notLeft}`];
}

function thisStep(ctx: BeatContext, hub: string): string[] {
  const job = ctx.job;
  const mood = ctx.mood ?? DEFAULT_MOOD;
  if (!job) {
    return [
      `THIS STEP IS THE OPENING. The hero meets someone (the "npc") in ${hub}, who presents a problem.`,
      ...(ctx.characters.length
        ? [
            mood.tie === 'person'
              ? 'The npc may be the person already met who returns in this quest (see above), or someone new who leads the hero to them.'
              : 'Someone the hero has not met yet, with a name of their own: the world grows with every quest.',
          ]
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
      ? `or a place already standing in this world, given as {"name": "<its exact name>"}: ${list(ctx.places.map((p) => p.name))}. ${placeAdvice(ctx, mood)}`
      : '',
    job.kind === 'talk' ? `or "village" to have the meeting in ${hub}.` : '',
  ].filter(Boolean);
  const npc = 'The "npc" is the person the hero talks to there: a new character, or one already met (same exact name).';
  if (job.kind === 'talk') {
    return [`THIS STEP: the hero goes to meet someone and talk (given by the last decision).`, ...where, ...talkNpc(ctx)];
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
  const mood = ctx.mood ?? DEFAULT_MOOD;
  const lines: string[] = [
    'You are the storyteller of an RPG played like a branching text adventure: the quest is written one step at a',
    'time, and the hero’s decisions decide what comes next.',
    '',
    ...worldLines(world),
    '',
  ];
  if (chronicle.length) {
    lines.push('THE WORLD REMEMBERS the hero’s earlier quests (the world’s past, not this quest’s plot):');
    for (const q of chronicle) {
      const chose = q.steps.map((s) => `chose "${s.chose}" (${s.consequence})`).join('; then ');
      lines.push(`- "${q.title}": ${chose}. Ending: ${q.ending}`);
    }
  }
  if (chronicle.length || ctx.places.length || ctx.characters.length) lines.push(...tieLines(mood.tie), '');
  const living = ctx.characters.filter((c) => !isDead(c.name, ctx.dead));
  if (living.length) {
    lines.push(
      `PEOPLE ALREADY IN THIS WORLD (whoever of them takes part is written with this exact name, in the same voice and manner): ${living
        .map((c) => (c.voice ? `"${c.name}" (${c.voice})` : `"${c.name}"`))
        .join(', ')}.`,
      '',
    );
  }
  const taken = takenNames(ctx);
  if (taken.length) {
    lines.push(
      `NAMES ALREADY TAKEN: ${list(taken)}. Each belongs to one person only, living or dead. Someone who returns`,
      'is written with exactly that name. A NEW character never gets any of these names, nor a first name or a',
      'surname from one of them (no second "Takeda", no "Marta Nowak" beside a "Marta", no son named after his',
      'father), so the player never mistakes one person for another.',
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
        ...(s.heard ? [`   Also heard there: ${s.heard}`] : []),
        `   The hero decided (said to ${s.npcName}): "${s.chose}" — ${s.consequence}`,
        ...(s.meet ? [`   and set out to meet: ${meetingWords(s.meet)}`] : []),
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
  lines.push(...TONE_LINES[mood.tone], 'Never two decisions that are two ways of saying the same thing.', '');
  lines.push(
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
    'Every decision is said to the npc, who answers it ("reply"); never address the witness in a label. A decision',
    'that follows up something the witness said speaks of them in the third person ("I will find the friend Tiago',
    'spoke of.") and sets "after": "witness".',
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
    `Make it original${mood.tone === 'grim' ? ', with a twist or a hint of moral greyness' : ''}. Inspiration: ${ctx.seed}.`,
    '',
    'Answer with ONE JSON object and nothing else, no markdown fence, with these keys:',
    '{',
    '  "title": string (the quest’s title),',
    '  "npc": {"name": string, "gender": "male" or "female", "age": "young", "middle_aged" or "old" (picks their voice),',
    '          "color": "#rrggbb" for their clothes,',
    `          "voice": string (in English, to design their voice: "Native ${language}. Male or Female, <age range>. Persona: <2–5 words>. Emotion: <2–3 adjectives>." then one sentence on timbre, pace and how they talk, never on how they sound recorded (no phone, radio, echo); for someone already met, what you were told),`,
    '          "appearance": string (IN ENGLISH whatever the language above, at most 20 words: how they look, for a 3D model of',
    '                        them: build, age, clothes, hair, nothing held — "a stooped old woman in a patched green wool dress and',
    '                        leather apron, grey braid"; for someone already met, what you were told)},',
    ctx.job ? '  "place": {...} or {"name": string}' + (ctx.job.kind === 'talk' ? ' or "village",' : ',') : '  "place": "village",',
    ctx.job && ctx.job.kind !== 'talk'
      ? '  "targetName": string (singular noun for one of the things), "look": {"shape": string, "color": string, "size": number},'
      : '',
    ctx.job?.kind === 'collect'
      ? '  "targetProp": string (IN ENGLISH whatever the language above, at most 12 words: one of the things alone as it looks, for a 3D model — "a cracked green glowing reactor core"),'
      : ctx.job?.kind === 'slay'
        ? '  "targetProp": string (IN ENGLISH whatever the language above, at most 20 words: one of them alone as it looks, for a 3D model — "a gaunt drowned man with grey-green skin, rags and weeds in his hair"),'
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
    '  "witness": {"name": string, "gender": string, "age": string, "color": string, "voice": string, "appearance": string,',
    '              "greeting": string,',
    '              "talk": [{"label": string, "reply": string}]} or null,',
    '  "decisions": [{"label": string (what the hero says, first person, at most 12 words),',
    '                 "reply": string (the npc’s answer), "consequence": string (one sentence: what it changed),',
    '                 "after": "witness", "clue 1", "clue 2", "question 1" or "question 2", only when needed,',
    '                 "dies": [names of anyone who dies if the hero chooses this], only when someone does,',
    '                 "meet": {"name": exact name of someone already met, or null for someone new, "who": who they are in a few words},',
    '                 only for a decision that leads on to meeting and talking with someone}],',
    '  "dead": [names of everyone this step tells is dead: killed earlier, found dead, said to have died] (may be empty)',
    '}',
  );
  return lines.filter((l, i, all) => l !== '' || all[i - 1] !== '').join('\n');
}

/** A few nudges so two runs do not tell the same story; these are a grim quest's, `seedFor` the rest's. */
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

const LIGHT_SEEDS: Record<Exclude<Tone, 'grim'>, string[]> = {
  light: [
    'a festival short of one thing',
    'a lost pet with opinions',
    'a recipe that needs one rare ingredient',
    'a shy suitor and a letter',
    'a craftsman’s masterpiece missing its last part',
    'a child’s birthday',
    'a traveller asking the way',
    'a local custom the hero does not know',
    'a delivery that must arrive today',
    'an old couple’s anniversary',
  ],
  comic: [
    'a self-proclaimed genius and their invention',
    'a feud over a prize vegetable',
    'a pompous official and a missing hat',
    'a fortune teller who is always wrong',
    'a bet made while drunk',
    'an animal that someone swears can talk',
    'a hero’s reputation wildly exaggerated',
    'a wedding where everything goes wrong',
    'a ghost who is merely annoying',
    'a merchant selling something useless as a miracle',
  ],
  adventure: [
    'a map with one corner torn off',
    'a beast that has been seen nearer the settlement',
    'a rescue against the clock',
    'something wondrous that fell from the sky',
    'a race or a contest',
    'a guide who never came back',
    'an old path reopened',
    'a treasure everyone says is a legend',
    'a storm coming',
    'a stranger who needs an escort',
  ],
};

/** A seed that suits the quest's tone. */
export function seedFor(tone: Tone, rand: () => number = Math.random): string {
  const seeds = tone === 'grim' ? SEEDS : LIGHT_SEEDS[tone];
  return seeds[Math.floor(rand() * seeds.length)];
}

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
      // Something after the object, such as braces a model kept closing (`firstObject`).
      return firstObject(reply);
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
  const appearance = text(r.appearance, 200);
  // A name inside a known one is that person ("Takeda" is "Ronin Takeda"): a new character may not
  // take an old one's name (owner, 28 Oct 2026: "no new characters with old characters' names").
  const met = known.find((c) => same(c.name, name)) ?? known.find((c) => samePerson(c.name, name));
  // Someone met before voices (or looks) were described keeps everything else, and gets one now.
  if (met) {
    const more = { ...(!met.voice && voice ? { voice } : {}), ...(!met.appearance && appearance ? { appearance } : {}) };
    return Object.keys(more).length ? { ...met, ...more } : met;
  }
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
    ...(appearance && { appearance }),
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
  // The hero went to meet someone new; a beat with someone already met waiting there is not that meeting.
  const meet = ctx.job?.kind === 'talk' ? ctx.history.at(-1)?.meet : undefined;
  if (meet && !meet.name && ctx.characters.some((c) => samePerson(c.name, npc.name))) return null;

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
      const prop = ctx.job.kind === 'collect' ? text(r.targetProp, 120) : ctx.job.kind === 'slay' ? text(r.targetProp, 200) : '';
      if (prop) job.prop = prop;
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
    const meet = next?.kind === 'talk' ? meeting(d?.meet, ctx.characters) : null;
    decisions.push({
      label,
      reply: replyText,
      consequence: text(d?.consequence, 200) ?? label,
      next,
      ...(after !== undefined && { after }),
      ...(dies.length > 0 && { dies }),
      ...(meet && { meet }),
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

/** A decision's `meet`: a known person by their exact name, or someone new described. */
function meeting(raw: unknown, known: readonly Character[]): Meeting | null {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  const who = text(r?.who, 160);
  const name = text(r?.name, 60);
  const met = name ? (known.find((c) => same(c.name, name)) ?? known.find((c) => samePerson(c.name, name))) : undefined;
  if (met) return { name: met.name, who: who ?? met.name };
  return who ? { who } : null;
}

/** A model's list of names: strings only, short, at most six. */
function names(raw: unknown): string[] {
  return (Array.isArray(raw) ? raw : [])
    .map((n) => text(n, 60))
    .filter((n): n is string => n !== null)
    .slice(0, 6);
}
