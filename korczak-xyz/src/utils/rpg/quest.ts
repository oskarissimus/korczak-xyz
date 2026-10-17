/*
 * The RPG's story layer: what a quest is, the one written by hand, and how a model's answer becomes
 * one.
 *
 * THE MODEL WRITES WORDS, THE WORLD STAYS FIXED. The map, its places and what can be done in them
 * are the engine's (`RpgScene.ts`); a model only chooses among them — which place, which of the two
 * objectives, how many — and writes the dialogue around that choice. So a quest from the model can
 * never send the player somewhere that does not exist, and a malformed answer degrades to the
 * hand-written quest rather than to a game that cannot be finished. `parseQuest` is that boundary,
 * and it is pure so it can be pinned by a test.
 */

export type Lang = 'en' | 'pl';

/** The places the scene builds. A quest may only point at one of these. */
export const LOCATIONS = ['ruins', 'forest', 'lake'] as const;
export type LocationId = (typeof LOCATIONS)[number];

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
  location: LocationId;
  kind: ObjectiveKind;
  /** Names one of the things, for the HUD counter: "herb", "drowner". */
  targetName: string;
  count: number;
}

export const MIN_COUNT = 1;
export const MAX_COUNT = 5;

/** The quest the game plays without a key, or when the model's answer cannot be used. */
export function staticQuest(lang: Lang): Quest {
  if (lang === 'pl') {
    return {
      title: 'Utopce znad jeziora',
      npcName: 'Sołtys Bogumił',
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
      location: 'lake',
      kind: 'slay',
      targetName: 'utopiec',
      count: 3,
    };
  }
  return {
    title: 'Drowners by the Lake',
    npcName: 'Alderman Bogumil',
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
    location: 'lake',
    kind: 'slay',
    targetName: 'drowner',
    count: 3,
  };
}

const PLACE_HINTS: Record<LocationId, string> = {
  ruins: 'ruins of an old keep, north of the village',
  forest: 'a dark pine forest, west of the village',
  lake: 'a misty lake, east of the village',
};

/** The prompt that asks for a quest. Everything the model may choose is spelled out in it. */
export function questPrompt(lang: Lang, seed: string): string {
  const language = lang === 'pl' ? 'Polish' : 'English';
  const places = LOCATIONS.map((id) => `- "${id}": ${PLACE_HINTS[id]}`).join('\n');
  return [
    'You write side quests for a dark-fantasy RPG in the spirit of The Witcher 3.',
    'The player is a monster hunter who has just arrived in a small village. A villager gives them a job.',
    '',
    'The world has exactly these places for the job:',
    places,
    '',
    'And exactly two kinds of job:',
    '- "collect": pick up N things lying at the place (herbs, relics, lost items…)',
    '- "slay": kill N monsters at the place (drowners, wolves, ghouls…)',
    '',
    `Write everything the player reads in ${language}. Keep each line under 280 characters.`,
    `Make it original, with a small twist or a hint of moral greyness. Inspiration: ${seed}.`,
    '',
    'Answer with ONE JSON object and nothing else, no markdown fence, with these keys:',
    '{',
    '  "title": string, "npcName": string, "greeting": string, "pitch": string,',
    '  "smallTalk": [{"label": string, "reply": string}, {"label": string, "reply": string}],',
    '  "acceptLine": string, "declineLine": string, "waitingLine": string, "completeLine": string,',
    '  "objectiveText": string,',
    `  "location": one of ${LOCATIONS.map((l) => `"${l}"`).join(', ')},`,
    '  "kind": "collect" or "slay",',
    '  "targetName": string (singular noun for one of the things),',
    `  "count": integer ${MIN_COUNT}-${MAX_COUNT}`,
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
  try {
    return JSON.parse(reply.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * A model's reply as a quest, or null when it cannot be played. Lines the model left out are filled
 * from the hand-written quest; the parts the engine depends on — place, kind, count — are not
 * guessed: a reply that gets those wrong is not used.
 */
export function parseQuest(reply: string, lang: Lang): Quest | null {
  const raw = extractJson(reply);
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const location = r.location;
  if (typeof location !== 'string' || !(LOCATIONS as readonly string[]).includes(location)) return null;
  if (r.kind !== 'collect' && r.kind !== 'slay') return null;
  const count = typeof r.count === 'number' ? Math.round(r.count) : Number.NaN;
  if (!Number.isFinite(count)) return null;

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
    greeting: text(r.greeting) ?? fallback.greeting,
    pitch,
    smallTalk,
    acceptLine: text(r.acceptLine) ?? fallback.acceptLine,
    declineLine: text(r.declineLine) ?? fallback.declineLine,
    waitingLine: text(r.waitingLine) ?? fallback.waitingLine,
    completeLine: text(r.completeLine) ?? fallback.completeLine,
    objectiveText,
    location: location as LocationId,
    kind: r.kind,
    targetName,
    count: Math.min(MAX_COUNT, Math.max(MIN_COUNT, count)),
  };
}
