/*
 * The RPG's story layer: what a quest is, the one written by hand, and how a model's answer becomes
 * one.
 *
 * THE MODEL WRITES WORDS AND CHOOSES BLOCKS; THE ENGINE BUILDS. Since Oct 2026 the model invents
 * the place a quest happens in, but only out of closed vocabularies the scene knows how to build
 * (`place.ts`: direction, distance, biome, features, a ground colour, and the targets' shape,
 * colour and size) and writes the dialogue. The objective and how many it asks for are not the
model's: left to choose, it wrote "collect 3" nearly every time, so `pickJob` draws them and the
prompt hands them over as given. So a
 * quest from the model can never ask for something the scene cannot make, and a malformed answer
 * degrades to the hand-written quest rather than to a game that cannot be finished. `parseQuest`
 * is that boundary, and it is pure so it can be pinned by a test.
 */

import {
  BIOMES,
  DIRECTIONS,
  DISTANCES,
  ENEMY_SHAPES,
  FEATURES,
  ITEM_SHAPES,
  parseLook,
  parsePlace,
  type PlaceSpec,
  type TargetLook,
} from './place';

export type Lang = 'en' | 'pl';


/** What can be done at a place: gather things lying there, or kill what lives there. */
export type ObjectiveKind = 'collect' | 'slay';

export interface DialogueOption {
  /** What the player says. */
  label: string;
  /** What the NPC answers. */
  reply: string;
}

export interface Quest {
  title: string;
  npcName: string;
  /** Picks the quest giver's voice. */
  npcGender: 'male' | 'female';
  greeting: string;
  /** Asked about the work, the NPC says this; the player may then accept or turn it down. */
  pitch: string;
  /** Talk that changes nothing: lore, a rumour, a joke. Shown beside the quest's own lines. */
  smallTalk: DialogueOption[];
  acceptLine: string;
  declineLine: string;
  /** What the NPC says if talked to before the work is done. */
  waitingLine: string;
  completeLine: string;
  /** One line for the journal while the quest is open. */
  objectiveText: string;
  /** Where it happens: invented by the model, built by the scene. See `place.ts`. */
  place: PlaceSpec;
  /** What the targets look like. */
  look: TargetLook;
  kind: ObjectiveKind;
  /** Names one of the things, for the HUD counter: "herb", "drowner". */
  targetName: string;
  count: number;
}

export const MIN_COUNT = 1;
export const MAX_COUNT = 5;

/** The job a quest asks for, drawn by the game before the model is asked. */
export interface Job {
  kind: ObjectiveKind;
  count: number;
}

/**
 * Half slay, half collect. Slay is 1–4 (one is a single dangerous creature, which the prompt says),
 * collect 2–5 (one thing to pick up is an errand, not a quest).
 */
export function pickJob(random: () => number = Math.random): Job {
  const kind: ObjectiveKind = random() < 0.5 ? 'slay' : 'collect';
  const low = kind === 'slay' ? 1 : 2;
  const high = kind === 'slay' ? 4 : 5;
  return { kind, count: low + Math.min(high - low, Math.floor(random() * (high - low + 1))) };
}

function jobLine(job: Job): string {
  if (job.kind === 'slay') {
    return job.count === 1
      ? 'THE JOB IS GIVEN: "slay", count 1 — a single dangerous creature at the place, bigger than a common monster (size 1.5 to 2).'
      : `THE JOB IS GIVEN: "slay", count ${job.count} — kill ${job.count} monsters at the place (drowners, wolves, ghouls, wraiths… choose one that suits the place).`;
  }
  return `THE JOB IS GIVEN: "collect", count ${job.count} — pick up ${job.count} things lying at the place (herbs, relics, bones, lost belongings, letters… choose what suits the story).`;
}

/** The quest the game plays without a key, or when the model's answer cannot be used. */
export function staticQuest(lang: Lang): Quest {
  if (lang === 'pl') {
    return {
      title: 'Utopce znad jeziora',
      npcName: 'Sołtys Bogumił',
      npcGender: 'male',
      greeting: 'Wiedźmin? We wsi? Bogom niech będą dzięki. Mamy kłopot, panie.',
      pitch:
        'Nad jeziorem na wschodzie zalęgły się utopce. Trzy sztuki, może więcej. Dziewki boją się chodzić po wodę. Zapłacę uczciwie, jeśli się z nimi rozprawisz.',
      smallTalk: [
        {
          label: 'Co to za miejsce?',
          reply:
            'Wierzbowo, panie. Kiedyś stał tu gród, dziś zostały ruiny na północy. Po nocach coś tam świeci, ale nikt nie sprawdzał.',
        },
        {
          label: 'Jakieś wieści z traktu?',
          reply: 'Kupcy mówią, że w lesie na zachodzie rośnie jaskółcze ziele. Zielarka by je chętnie kupiła.',
        },
      ],
      acceptLine: 'Dzięki ci, panie. Jezioro jest na wschód od wsi, za polem. Wracaj cały.',
      declineLine: 'Rozumiem… Jakbyś zmienił zdanie, będę tutaj.',
      waitingLine: 'I jak, panie? Utopce wciąż tam siedzą, słychać je po zmroku.',
      completeLine: 'Ubiłeś je wszystkie? Niech cię bogowie prowadzą, wiedźminie. Oto twoja zapłata.',
      objectiveText: 'Zabij utopce nad jeziorem na wschodzie',
      place: {
        name: 'Jezioro za polem',
        direction: 'east',
        distance: 'far',
        biome: 'lakeshore',
        features: ['water', 'rocks', 'dead_trees'],
        groundColor: '#5d7a45',
      },
      look: { shape: 'humanoid', color: '#3f5a4a', size: 1 },
      kind: 'slay',
      targetName: 'utopiec',
      count: 3,
    };
  }
  return {
    title: 'Drowners by the Lake',
    npcName: 'Alderman Bogumil',
    npcGender: 'male',
    greeting: 'A witcher? In our village? Thank the gods. We have trouble, sir.',
    pitch:
      'Drowners have nested by the lake to the east. Three of them, maybe more. The girls are afraid to fetch water. I will pay honest coin if you deal with them.',
    smallTalk: [
      {
        label: 'What is this place?',
        reply:
          'Willowby, sir. There was a keep here once; only the ruins to the north are left. Something glows there at night, but nobody has gone to look.',
      },
      {
        label: 'Any news from the road?',
        reply: 'Merchants say swallow herb grows in the forest to the west. The herbalist would pay for it.',
      },
    ],
    acceptLine: 'Thank you, sir. The lake is east of the village, past the field. Come back in one piece.',
    declineLine: 'I understand… If you change your mind, I will be here.',
    waitingLine: 'Well, sir? The drowners are still there, you can hear them after dark.',
    completeLine: 'You killed them all? May the gods guide you, witcher. Here is your reward.',
    objectiveText: 'Kill the drowners by the lake to the east',
    place: {
      name: 'The Lake Past the Field',
      direction: 'east',
      distance: 'far',
      biome: 'lakeshore',
      features: ['water', 'rocks', 'dead_trees'],
      groundColor: '#5d7a45',
    },
    look: { shape: 'humanoid', color: '#3f5a4a', size: 1 },
    kind: 'slay',
    targetName: 'drowner',
    count: 3,
  };
}

const list = (items: readonly string[]) => items.map((i) => `"${i}"`).join(', ');

/** The prompt that asks for a quest. Everything the model may choose is spelled out in it. */
export function questPrompt(lang: Lang, seed: string, job: Job): string {
  const language = lang === 'pl' ? 'Polish' : 'English';
  return [
    'You write side quests for a dark-fantasy RPG in the spirit of The Witcher 3.',
    'The player is a monster hunter who has just arrived in a small village. A villager gives them a job.',
    '',
    'Invent the PLACE where the job happens, somewhere outside the village. The game builds it from',
    'these building blocks, so choose only from them:',
    `- direction from the village: one of ${list(DIRECTIONS)}`,
    `- distance: one of ${list(DISTANCES)}`,
    `- biome: one of ${list(BIOMES)}`,
    `- features: 1 to 4 of ${list(FEATURES)}`,
    '- groundColor: a "#rrggbb" colour that suits the mood of the place',
    'Give the place an evocative name of its own. The villager should tell the player how to find it.',
    '',
    jobLine(job),
    'Do not change the kind or the count; build the story around them.',
    job.kind === 'slay'
      ? `What the targets look like: shape is one of ${list(ENEMY_SHAPES)}; a "#rrggbb" colour; size 0.5 to 2.`
      : `What the targets look like: shape is one of ${list(ITEM_SHAPES)}; a "#rrggbb" colour; size 0.5 to 2.`,
    '',
    `Write everything the player reads in ${language}. Keep each line under 280 characters.`,
    `Make it original, with a small twist or a hint of moral greyness. Inspiration: ${seed}.`,
    '',
    'Answer with ONE JSON object and nothing else, no markdown fence, with these keys:',
    '{',
    '  "title": string, "npcName": string, "npcGender": "male" or "female",',
    '  "greeting": string, "pitch": string,',
    '  "smallTalk": [{"label": string, "reply": string}, {"label": string, "reply": string}],',
    '  "acceptLine": string, "declineLine": string, "waitingLine": string, "completeLine": string,',
    '  "objectiveText": string,',
    '  "place": {"name": string, "direction": string, "distance": string, "biome": string,',
    '            "features": [string], "groundColor": string},',
    `  "kind": "${job.kind}",`,
    '  "targetName": string (singular noun for one of the things),',
    '  "look": {"shape": string, "color": string, "size": number},',
    `  "count": ${job.count}`,
    '}',
  ].join('\n');
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
 * A model's reply as a quest, or null when it cannot be played. Lines the model left out are filled
 * from the hand-written quest; the parts the engine depends on — place, kind, count — are not
 * guessed: a reply that gets those wrong is not used. Given a `job`, its kind and count win over
 * whatever the model wrote, so a model that ignores the prompt cannot bring "collect 3" back.
 */
export function parseQuest(reply: string, lang: Lang, job?: Job): Quest | null {
  const raw = extractJson(reply);
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  // Case and a stray space are forgiven, and a count written as "3": models do both.
  const place = parsePlace(r.place);
  if (!place) return null;
  const kind = job?.kind ?? (typeof r.kind === 'string' ? r.kind.trim().toLowerCase() : '');
  if (kind !== 'collect' && kind !== 'slay') return null;
  const count = job?.count ?? Math.round(Number(r.count));
  if (!Number.isFinite(count) || (!job && (r.count === null || r.count === ''))) return null;

  const fallback = staticQuest(lang);
  const smallTalk = Array.isArray(r.smallTalk)
    ? r.smallTalk
        .map((o) => {
          const option = o as Record<string, unknown> | null;
          const label = text(option?.label, 80);
          const replyText = text(option?.reply);
          return label && replyText ? { label, reply: replyText } : null;
        })
        .filter((o): o is DialogueOption => o !== null)
        .slice(0, 3)
    : [];

  const title = text(r.title, 80);
  const pitch = text(r.pitch, 600);
  const objectiveText = text(r.objectiveText, 120);
  const targetName = text(r.targetName, 40);
  // Without these the quest has no story of its own; the hand-written one is better than a mix.
  if (!title || !pitch || !objectiveText || !targetName) return null;

  return {
    title,
    npcName: text(r.npcName, 60) ?? fallback.npcName,
    npcGender: r.npcGender === 'female' ? 'female' : 'male',
    greeting: text(r.greeting) ?? fallback.greeting,
    pitch,
    smallTalk,
    acceptLine: text(r.acceptLine) ?? fallback.acceptLine,
    declineLine: text(r.declineLine) ?? fallback.declineLine,
    waitingLine: text(r.waitingLine) ?? fallback.waitingLine,
    completeLine: text(r.completeLine) ?? fallback.completeLine,
    objectiveText,
    place,
    look: parseLook(r.look, kind),
    kind,
    targetName,
    count: Math.min(MAX_COUNT, Math.max(MIN_COUNT, count)),
  };
}
