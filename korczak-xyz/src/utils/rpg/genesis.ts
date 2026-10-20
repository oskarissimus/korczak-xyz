/*
 * Where the game happens: a world a model invents from nothing, before the first quest (owner, Oct
 * 2026: "a really random world, unlimited — a techno utopia, a world of magic, a water world, a
 * winter one, a space one — not a catalogue drawn from, but something from an LLM and its
 * temperature, more exotic than the usual medieval fantasy, and no franchise, only a feel").
 *
 * TEMPERATURE ALONE DOES NOT DO IT. Asked ten times for "an original world", a model gives floating
 * islands, a steampunk city and crystals of mana ten times over: it changes the words, not the idea,
 * and turned up far enough it turns incoherent before it turns strange. So the randomness comes from
 * outside and the model only makes sense of it:
 *
 * - **Seeds the game draws** (`seedWords.ts`, and a random Wikipedia title when the network allows):
 *   three unrelated things the world must be built around. Nobody listed worlds; "lighthouse,
 *   fermentation, a battle of 1632" is not a setting anybody wrote down.
 * - **Four candidates in one answer**, as different from one another as the model can make them,
 *   each with its own honest `typicality`. The game, not the model, picks one of the two least
 *   typical — since the slider, the two nearest the slider's target (`pickWorld`). A model asked
 *   for a spread reaches further than one asked for an answer.
 * - **A slider from familiar to exotic** (`exotic`, 0–100): three prompts — a classic RPG setting
 *   with the seeds as flavour, a familiar genre twisted by the seeds, or anything at all — a
 *   typicality to aim the candidates and the pick at, and a temperature from 0.9 to 1.35.
 * - **What the reader has already been given** goes in as worlds to be unlike, and the usual
 *   clichés as things to stay away from.
 * - **A higher temperature for this call only** (`genesisTemperature`); the quests are asked at the
 *   usual one, where coherence matters more than surprise.
 *
 * What comes back is the world's **bible**: its name and feel, who lives there and what they build
 * with, what is dangerous, who the player is and how people address them, the settlement where it
 * starts, and its `look` — the few numbers and words the scene is drawn from (`RpgScene.applyWorld`).
 * The bible goes into every beat's prompt in place of the line that used to say "The Witcher 3".
 *
 * COMPILED TWICE, like `quest.ts`: the demo's function builds this prompt on the server from a
 * context it checks field by field (`demoGenesis`), so nothing here may import the DOM.
 */

import type { Lang } from './quest';

/** A world's colours, light, air, water and growth: what `RpgScene.applyWorld` draws. */
export interface WorldLook {
  sky: string;
  fog: string;
  sun: string;
  ground: string;
  /** Leaves, grass, whatever grows. */
  foliage: string;
  wall: string;
  roof: string;
  /** One colour that says "this world": banners, lamps, glows. */
  accent: string;
  time: (typeof TIMES)[number];
  haze: (typeof HAZES)[number];
  weather: (typeof WEATHERS)[number];
  water: (typeof WATERS)[number];
  growth: (typeof GROWTHS)[number];
  /** What stands where a forest would: the kit's trees, or shapes of the world's own. */
  flora: (typeof FLORAS)[number];
  wallSurface: (typeof WALL_SURFACES)[number];
  roofSurface: (typeof ROOF_SURFACES)[number];
}

export const TIMES = ['dawn', 'day', 'dusk', 'night'] as const;
export const HAZES = ['clear', 'light', 'thick'] as const;
export const WEATHERS = ['none', 'rain', 'snow', 'ash', 'spores', 'sparks'] as const;
export const WATERS = ['dry', 'pools', 'flooded'] as const;
export const GROWTHS = ['barren', 'sparse', 'lush'] as const;
export const FLORAS = ['pines', 'broadleaf', 'dead', 'fungi', 'spires', 'none'] as const;
export const WALL_SURFACES = ['plaster', 'stone', 'planks', 'rock'] as const;
export const ROOF_SURFACES = ['thatch', 'planks', 'stone', 'leaves'] as const;

/** The words of a world every beat's prompt is given. */
export interface WorldBrief {
  name: string;
  /** Two or three sentences: what this world is, as one would see and smell it. */
  pitch: string;
  tone: string;
  /** How far its technology and its magic go, if it has either. */
  tech: string;
  climate: string;
  /** Who lives here, what they look like, what they wear. */
  people: string;
  /** What they build with and how it looks. */
  architecture: string;
  /** What is dangerous here: what the player fights. */
  threats: string;
  /** Who the player is here, and why they help strangers. */
  player: string;
  /** How people address the player, said to them: "wanderer", "diver". */
  address: string;
  /** The settlement where every quest starts. */
  hub: string;
  /** A few words people here use. */
  words: string[];
}

export interface WorldBible extends WorldBrief {
  /** Minted by the game; the chronicle and the world's places are kept under it. */
  id: string;
  lang: Lang;
  createdAt: number;
  /** What it grew from, for the console. */
  seeds: string[];
  /** 0–100, the model's own estimate of how ordinary it is. */
  typicality: number;
  look: WorldLook;
}

/** Everything the genesis prompt is built from. */
export interface GenesisContext {
  lang: Lang;
  /** Three unrelated things drawn by the game. */
  seeds: string[];
  /** Worlds this reader has already been given, to be unlike: "name: pitch". */
  avoid: string[];
  /**
   * How exotic, 0–100, from the slider on the intro screen: 0 is a world any RPG player knows at
   * once, 100 is one nobody has seen. Owner, Oct 2026, a day after the worlds became wholly
   * exotic: "we overdid it, it is too exotic; a slider, typical RPG worlds on the left, the exotic
   * ones on the right".
   */
  exotic: number;
}

/** Where the slider starts: closer to the familiar, since all the way right was too much. */
export const DEFAULT_EXOTIC = 35;

export function clampExotic(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : DEFAULT_EXOTIC;
}

/** The most exotic call's temperature: the quests are asked at 1. Gemini allows up to 2. */
export const GENESIS_TEMPERATURE = 1.35;

/** Hotter the further right: a familiar world wants coherence more than surprise. */
export function genesisTemperature(exotic: number): number {
  return Math.round((0.9 + (GENESIS_TEMPERATURE - 0.9) * (clampExotic(exotic) / 100)) * 100) / 100;
}

/** The typicality the game picks closest to: 85 at the far left, 5 at the far right. */
export function typicalityTarget(exotic: number): number {
  return Math.round(85 - 0.8 * clampExotic(exotic));
}

/** The look of the world the game had before there were worlds, and of the hand-written quest. */
export const CLASSIC_LOOK: WorldLook = {
  sky: '#9fb8c8',
  fog: '#9fb8c8',
  sun: '#fff1d6',
  ground: '#6f7a4a',
  foliage: '#7d9a6a',
  wall: '#f0e6d6',
  roof: '#c8a86a',
  accent: '#ffd36b',
  time: 'day',
  haze: 'light',
  weather: 'none',
  water: 'pools',
  growth: 'lush',
  flora: 'pines',
  wallSurface: 'plaster',
  roofSurface: 'thatch',
};

/**
 * The world of the hand-written quest, played with no key or when no world could be invented. Its
 * id is the language, which is what the chronicle was kept under before there were worlds, so a
 * chronicle from then is this world's.
 */
export function classicWorld(lang: Lang): WorldBible {
  const pl = lang === 'pl';
  return {
    id: lang,
    lang,
    createdAt: 0,
    seeds: [],
    typicality: 100,
    name: pl ? 'Kraina Wierzb' : 'The Willowlands',
    pitch: pl
      ? 'Wsie wśród bagien i borów, gdzie ludzie płacą wędrownym łowcom za to, czego sami boją się dotknąć.'
      : 'Villages among marshes and pine woods, where people pay wandering hunters for what they are afraid to touch.',
    tone: pl ? 'mroczny, przyziemny' : 'dark, earthy',
    tech: pl ? 'średniowiecze, rzadka i podejrzana magia' : 'medieval, magic rare and distrusted',
    climate: pl ? 'chłodna jesień' : 'a cool autumn',
    people: pl ? 'chłopi w lnie i wełnie, rybacy, sołtysi' : 'peasants in linen and wool, fishermen, aldermen',
    architecture: pl ? 'chaty z bielonego tynku i drewna pod strzechą' : 'whitewashed timber cottages under thatch',
    threats: pl ? 'utopce, wilkołaki, upiory' : 'drowners, werewolves, wraiths',
    player: pl ? 'wędrowny łowca potworów' : 'a wandering monster hunter',
    address: pl ? 'panie' : 'sir',
    hub: pl ? 'Wierzbowo' : 'Willowby',
    words: [],
    look: CLASSIC_LOOK,
  };
}

const list = (items: readonly string[]) => items.map((i) => `"${i}"`).join(', ');

/**
 * Names that are somebody's property or a franchise's, refused in any field: a world that says one
 * is not played (`parseWorlds`). The prompt asks for a feel, never a borrowed name; this is the
 * check behind it, since a model reaches for "a school of magic like Hogwarts" by reflex.
 */
const FRANCHISE = [
  'hogwart',
  'hogwarc',
  'witcher',
  'wiedźmin',
  'wiedzmin',
  'geralt',
  'kaer morhen',
  'novigrad',
  'middle-earth',
  'śródziemi',
  'mordor',
  'gondor',
  'hobbit',
  'jedi',
  'sith',
  'westeros',
  'azeroth',
  'tamriel',
  'skyrim',
  'narnia',
  'arrakis',
  'pokémon',
  'pokemon',
  'warhammer',
  'dumbledore',
  'muggle',
  'mugol',
  'starfleet',
  'klingon',
  'hyrule',
  'cthulhu',
];

export function franchised(text: string): boolean {
  const folded = text.toLowerCase();
  return FRANCHISE.some((name) => folded.includes(name));
}

/** The prompt for a new world. Everything the model may choose, and everything it may not, is in it. */
export function genesisPrompt(ctx: GenesisContext): string {
  const language = ctx.lang === 'pl' ? 'Polish' : 'English';
  const exotic = clampExotic(ctx.exotic);
  const lines = exotic < 34 ? familiarLines(ctx) : exotic < 67 ? twistedLines(ctx) : exoticLines(ctx);
  return finish(lines, ctx, language, typicalityTarget(exotic));
}

/** The left of the slider: a setting players know and love, made fresh by its details. */
function familiarLines(ctx: GenesisContext): string[] {
  return [
    'You invent the setting of a role-playing game: one whole world, in the spirit of the classic RPGs.',
    '',
    'Make it a world any RPG player feels at home in at once: high fantasy, dark fantasy, sword and sorcery,',
    'a low-magic medieval land, or another well-loved genre setting (a pirate archipelago, a desert of',
    'sultanates and djinn, a northern saga of fjords and longhouses, a gothic land of vampires, a mythic',
    'antiquity, a wuxia mountain realm). The genre’s staples are welcome: knights, mages, elves, dwarves,',
    'orcs, dragons, the undead, ruined castles, taverns, monsters in the woods. It is fresh through its',
    'details — its people, customs, places and troubles — not through a strange premise.',
    '',
    `SEEDS, drawn at random by dice: ${list(ctx.seeds)}. Use them only as small flavour — a custom, a trade, a`,
    'landmark, a local superstition — never as the premise, and never literally if one names a real person,',
    'place or event.',
    '',
    'It is not a franchise: no names, places, creatures, factions or terms from existing books, films, games',
    'or comics (no Hogwarts, no witchers, no hobbits, no Jedi). A feel is welcome; a borrowed name is not.',
  ];
}

/** The middle: a familiar genre with one strong turn. */
function twistedLines(ctx: GenesisContext): string[] {
  return [
    'You invent the setting of a role-playing game: one whole world.',
    '',
    'At its heart it is a genre players know — fantasy, science fiction, historical, mythic, gothic,',
    'post-apocalyptic — but with ONE strong unusual twist that makes it its own: something about its land,',
    'its magic or technology, or how its people live, that no stock setting has.',
    '',
    `SEEDS, drawn at random by dice: ${list(ctx.seeds)}. Build the twist from them, transformed and combined,`,
    'never literal: a seed that names a real person, place or event is only an image or an idea to take from.',
    '',
    'It is not a franchise: no names, places, creatures, factions or terms from existing books, films, games',
    'or comics (no Hogwarts, no witchers, no hobbits, no Jedi). A feel is welcome; a borrowed name is not.',
  ];
}

/** The right of the slider: anything at all, as far from a stock setting as the seeds can carry it. */
function exoticLines(ctx: GenesisContext): string[] {
  return [
    'You invent the setting of a role-playing game: one whole world, from nothing.',
    '',
    `SEEDS, drawn at random by dice: ${list(ctx.seeds)}.`,
    'Build the world so that these things are CENTRAL to it, transformed and combined, never literal: a seed',
    'that names a real person, place or event is only an image or an idea to take from, never something that',
    'appears. The seeds are the point: they are what keeps this from being a world anybody has seen.',
    '',
    'The world may be ANYTHING: any era or none, any technology, magic, both or neither, any climate and any',
    'scale — under a sea, on a moon, on the back of something vast, in a city with no edge, in a desert of glass,',
    'in perpetual winter or in a jungle of machines. It is not a franchise: no names, places, creatures, factions',
    'or terms from existing books, films, games or comics (no Hogwarts, no witchers, no hobbits, no Jedi). A feel',
    'is welcome; a borrowed name is not.',
    'Stay away from the clichés unless a seed truly demands one: a medieval European village with a monster',
    'problem, elves, dwarves, orcs, dragons, mana, crystals of power, a dark lord, a chosen one, steampunk',
    'airships, floating islands, a generic cyberpunk megacorporation, a post-apocalyptic wasteland.',
  ];
}

function finish(lines: string[], ctx: GenesisContext, language: string, target: number): string {
  if (ctx.avoid.length) {
    lines.push('', 'The player has ALREADY BEEN to these worlds; every candidate must be unlike all of them:');
    for (const w of ctx.avoid) lines.push(`- ${w}`);
  }
  lines.push(
    '',
    'Write 4 CANDIDATE worlds, as different from one another as you can make them. For each, rate honestly how',
    '"typical" it is, 0 to 100: how close it comes to what an average fantasy or science-fiction game offers',
    `(0: nobody has seen anything like it; 100: a stock setting). Aim them around ${target}.`,
    '',
    'Every world must be PLAYABLE as this game: the player walks a landscape, talks to people, fights what is',
    'dangerous and gathers things. So it has a settlement where the player starts ("hub"), people who talk and',
    'walk on two legs (they may be strange to look at), something dangerous worth fighting ("threats"), and a',
    'role for the player that gives them a reason to help strangers ("player").',
    'The game draws it in simple 3D — ground, sky, fog, light, weather, plants, buildings — from the "look", so',
    'choose the look to show this world and nothing generic.',
    '',
    `Write every text field in ${language}. Be concrete and sensory, not grand. Each text field at most 240 characters.`,
    '',
    'Answer with ONE JSON object and nothing else, no markdown fence:',
    '{"worlds": [{',
    '  "name": string (the world’s own name),',
    '  "typicality": number 0–100,',
    '  "pitch": string (2–3 sentences: what this world is, as one would see, hear and smell it),',
    '  "tone": string (a few words),',
    '  "tech": string (how far technology and magic go here, if at all),',
    '  "climate": string,',
    '  "people": string (who lives here, what they look like and wear),',
    '  "architecture": string (what they build with, how it looks),',
    '  "threats": string (what is dangerous: what the player fights),',
    '  "player": string (who the player is here and why they help),',
    '  "address": string (how people address the player, one or two words, as said to them),',
    '  "hub": string (the name of the settlement where the player starts),',
    '  "words": [up to 6 words or short phrases people here use],',
    '  "look": {',
    '    "sky", "fog", "sun", "ground", "foliage", "wall", "roof", "accent": each a "#rrggbb" colour',
    '      (foliage is whatever grows; wall and roof are the buildings; accent is the world’s signature glow),',
    `    "time": one of ${list(TIMES)},`,
    `    "haze": one of ${list(HAZES)},`,
    `    "weather": one of ${list(WEATHERS)},`,
    `    "water": one of ${list(WATERS)} (flooded: shallow water everywhere but the paths and places),`,
    `    "growth": one of ${list(GROWTHS)},`,
    `    "flora": one of ${list(FLORAS)} (what stands where a forest would; fungi: giant mushrooms; spires: tall`,
    '      crystal or metal spikes),',
    `    "wallSurface": one of ${list(WALL_SURFACES)}, "roofSurface": one of ${list(ROOF_SURFACES)}`,
    '  }',
    '}]}',
  );
  return lines.join('\n');
}

function text(value: unknown, max = 240): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function hex(value: unknown): string | null {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toLowerCase() : null;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  if (typeof value !== 'string') return fallback;
  const key = value.toLowerCase().trim();
  return options.find((o) => o === key) ?? fallback;
}

/** A model's look, every value checked; what is missing or unknown is the classic one. */
/**
 * `color` brought up to at least `floor` of brightness (the largest channel, 0–1), keeping its hue.
 * The models paint some worlds in pure black — a ground of #000000 under a sky of #000000 — and a
 * world nobody can see is not exotic, it is broken.
 */
export function lift(color: string, floor: number): string {
  const n = parseInt(color.slice(1), 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const max = Math.max(...rgb);
  const want = Math.round(floor * 255);
  if (max >= want) return color;
  const out = max === 0 ? [want, want, want] : rgb.map((v) => Math.round((v * want) / max));
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function parseLook(raw: unknown): WorldLook {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const c = CLASSIC_LOOK;
  const sky = lift(hex(r.sky) ?? c.sky, 0.14);
  return {
    sky,
    fog: lift(hex(r.fog) ?? sky, 0.14),
    sun: lift(hex(r.sun) ?? c.sun, 0.6),
    ground: lift(hex(r.ground) ?? c.ground, 0.45),
    foliage: lift(hex(r.foliage) ?? c.foliage, 0.35),
    wall: lift(hex(r.wall) ?? c.wall, 0.4),
    roof: lift(hex(r.roof) ?? c.roof, 0.4),
    accent: lift(hex(r.accent) ?? c.accent, 0.5),
    time: oneOf(r.time, TIMES, c.time),
    haze: oneOf(r.haze, HAZES, c.haze),
    weather: oneOf(r.weather, WEATHERS, c.weather),
    water: oneOf(r.water, WATERS, c.water),
    growth: oneOf(r.growth, GROWTHS, c.growth),
    flora: oneOf(r.flora, FLORAS, c.flora),
    wallSurface: oneOf(r.wallSurface, WALL_SURFACES, c.wallSurface),
    roofSurface: oneOf(r.roofSurface, ROOF_SURFACES, c.roofSurface),
  };
}

/** A world's words, or null when one the game needs is missing. */
export function parseBrief(raw: unknown): WorldBrief | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const name = text(r.name, 60);
  const pitch = text(r.pitch, 400);
  const player = text(r.player);
  const hub = text(r.hub, 60);
  const threats = text(r.threats);
  if (!name || !pitch || !player || !hub || !threats) return null;
  return {
    name,
    pitch,
    tone: text(r.tone, 120) ?? '',
    tech: text(r.tech) ?? '',
    climate: text(r.climate) ?? '',
    people: text(r.people) ?? '',
    architecture: text(r.architecture) ?? '',
    threats,
    player,
    address: text(r.address, 40) ?? '',
    hub,
    words: (Array.isArray(r.words) ? r.words : [])
      .map((w) => text(w, 40))
      .filter((w): w is string => w !== null)
      .slice(0, 6),
  };
}

/** The first `{…}` in a reply, which tolerates a fence or a sentence around it. */
function extract(reply: string): unknown {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const body = reply.slice(start, end + 1);
  try {
    return JSON.parse(body);
  } catch {
    try {
      return JSON.parse(body.replace(/[\u0000-\u001f]+/g, ' ').replace(/,\s*([}\]])/g, '$1'));
    } catch {
      return null;
    }
  }
}

/**
 * The candidates a model wrote, each a whole bible, without one that borrows a franchise's names or
 * lacks something the game needs. Empty when none can be played.
 */
export function parseWorlds(reply: string, ctx: GenesisContext, now = Date.now()): WorldBible[] {
  const raw = extract(reply) as Record<string, unknown> | null;
  const candidates = Array.isArray(raw?.worlds) ? raw!.worlds : raw && typeof raw === 'object' && 'name' in raw ? [raw] : [];
  const worlds: WorldBible[] = [];
  for (const [i, c] of candidates.slice(0, 6).entries()) {
    const brief = parseBrief(c);
    if (!brief) continue;
    if (franchised(JSON.stringify(brief))) continue;
    const r = c as Record<string, unknown>;
    const typicality = Number(r.typicality);
    worlds.push({
      ...brief,
      id: `w${now.toString(36)}${i}`,
      lang: ctx.lang,
      createdAt: now,
      seeds: ctx.seeds,
      typicality: Number.isFinite(typicality) ? Math.min(100, Math.max(0, Math.round(typicality))) : 50,
      look: parseLook(r.look),
    });
  }
  return worlds;
}

/**
 * One of the two whose typicality is closest to `target` (`typicalityTarget`), by the game's dice
 * rather than the model's taste. At the slider's far right that is the two least typical.
 */
export function pickWorld(worlds: readonly WorldBible[], target = 0, random: () => number = Math.random): WorldBible | null {
  if (worlds.length === 0) return null;
  const sorted = [...worlds].sort((a, b) => Math.abs(a.typicality - target) - Math.abs(b.typicality - target));
  const pool = sorted.slice(0, Math.min(2, sorted.length));
  return pool[Math.floor(random() * pool.length)] ?? pool[0];
}

/** The lines of the beat prompt that say where the story happens and who the player is. */
export function worldLines(w: WorldBrief): string[] {
  const lines = [
    `THE WORLD: "${w.name}". ${w.pitch}`,
    w.tone && `Tone: ${w.tone}.`,
    w.tech && `Technology and magic: ${w.tech}.`,
    w.climate && `Climate: ${w.climate}.`,
    w.people && `People: ${w.people}.`,
    w.architecture && `They build: ${w.architecture}.`,
    `What is dangerous: ${w.threats}.`,
    `THE PLAYER ("the hero") is ${w.player}.${w.address ? ` People address them as "${w.address}".` : ''}`,
    `The hero is based in ${w.hub}, the settlement where every quest starts.`,
    w.words.length ? `Words people here use: ${w.words.join(', ')}.` : '',
    'Everything you write belongs to THIS world: its people, things, creatures, names, idioms and dangers. Never',
    'medieval European fantasy unless the world is that; never a name from an existing book, film or game.',
  ];
  return lines.filter((l): l is string => Boolean(l));
}

function cut(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

/**
 * A stranger's world, made safe to put in a prompt: every string cut to what the game itself sends.
 * Used by the demo's function for a beat's `world` and checked by `demoGenesis` for a genesis.
 */
export function demoWorld(value: unknown): WorldBrief | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const r = value as Record<string, unknown>;
  const brief: WorldBrief = {
    name: cut(r.name, 60),
    pitch: cut(r.pitch, 400),
    tone: cut(r.tone, 120),
    tech: cut(r.tech, 240),
    climate: cut(r.climate, 240),
    people: cut(r.people, 240),
    architecture: cut(r.architecture, 240),
    threats: cut(r.threats, 240),
    player: cut(r.player, 240),
    address: cut(r.address, 40),
    hub: cut(r.hub, 60),
    words: Array.isArray(r.words) ? r.words.slice(0, 6).map((w) => cut(w, 40)).filter(Boolean) : [],
  };
  return brief.name && brief.player && brief.hub ? brief : undefined;
}

/** A genesis context from a stranger: three short seeds, a few short worlds to avoid, the slider. */
export function demoGenesis(value: unknown): GenesisContext {
  const r = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const strings = (v: unknown, n: number, max: number) =>
    Array.isArray(v) ? v.slice(0, n).map((s) => cut(s, max).trim()).filter(Boolean) : [];
  return {
    lang: r.lang === 'pl' ? 'pl' : 'en',
    seeds: strings(r.seeds, 4, 80),
    avoid: strings(r.avoid, 8, 200),
    exotic: clampExotic(r.exotic),
  };
}
