/*
 * The words of the menu's world proposals (`proposals.ts`; owner, 2 Nov 2026: "the player opens the
 * game and has four proposed worlds generated for them — not whole worlds with a bible and assets,
 * only proposals a world can be generated from — each with a cover picture, and under them the menu
 * as it is, where you can still type your own idea"). The prompt that asks a very fast model for
 * four, and the reader of its answer as it streams. Kept apart from `proposals.ts`, which asks the
 * network and keeps them, so both halves can be tested without either.
 *
 * Plain lines rather than JSON, as the intro's narration (`introScript.ts`): a card shows the moment
 * its lines end and its cover starts drawing then, while the next one is still being written.
 */

import type { Lang } from './quest';
import { languageName } from './language';

export const PROPOSAL_COUNT = 4;
/** The longest idea kept: a few words, never a sentence. */
export const IDEA_MAX = 60;

/** One proposed world: a premise to make a world from, never the world itself. */
export interface Proposal {
  /** The world's name, in the game's language. */
  name: string;
  /**
   * The world as a player would type it into the field, two to six words ("pirates on a sea of sand",
   * "a detective story in 1920s Kraków"): the card's caption and what a tap puts in the field (owner,
   * 10 Nov 2026: "proposals with a picture, but with the texts that used to sit under the prompt").
   * Empty on an item made before it, which shows its name and is made as before.
   */
  idea: string;
  /** One or two sentences: what it is and why one would go there. */
  pitch: string;
  /** Its genre in two to four words, for the card's corner. */
  genre: string;
  /** Two colours for the card while (or when there is no) cover. */
  colors: [string, string];
  /** The cover, described in English for FLUX; null until its line has come. */
  picture: string | null;
  /** The cover's URL once drawn (the gateway keeps it in the bucket, so it lasts). */
  image: string | null;
}

/**
 * How the four spread from the familiar to the strange, one each, so the menu always offers a world
 * anybody knows at once beside one nobody has seen (the slider's three bands, `genesis.ts`, plus a
 * second familiar one outside fantasy, since a classic RPG setting is the likeliest pick).
 */
export const PROPOSAL_KINDS = [
  'a classic RPG setting players love at once — high or dark fantasy, sword and sorcery, a gothic land, a northern saga — fresh through its details; the genre’s staples welcome',
  'another well-loved genre that is NOT medieval fantasy — a pirate archipelago, a desert of sultanates, a mythic antiquity, a wuxia realm, a frontier, a space station, a gaslit city — with one small twist of its own',
  'a familiar genre with ONE strong, unusual twist built from its seeds, which makes it its own',
  'anything at all, as far from a stock setting as its seeds can carry it: any era, scale or place, no clichés (no dark lord, chosen one, floating islands, generic cyberpunk)',
] as const;

export interface ProposalAsk {
  lang: Lang;
  /** Two dice words per proposal, in `PROPOSAL_KINDS` order: what keeps four from being the four a model always writes. */
  seeds: string[][];
  /** Worlds to be unlike ("name: pitch"): ones this reader already had, or the pool's newest. */
  avoid: string[];
  /** The avoid list is the pool's own proposals, not worlds a player has been to (`proposalPool.ts`). */
  avoidPool?: boolean;
}

export const COVER_STYLE = 'painterly fantasy book cover art, wide establishing shot, dramatic atmospheric light, rich colour, no text, no letters, no title';

export function coverPrompt(picture: string): string {
  return `${picture.replace(/[.\s]+$/, '')}. ${COVER_STYLE}`;
}

export function proposalPrompt(ask: ProposalAsk): string {
  const language = languageName(ask.lang);
  const lines = [
    'You propose worlds for a role-playing game. The player opens the game and picks one of your proposals;',
    'only then is the whole world written. So each proposal is a premise, not a world: a name, a pitch that',
    'makes one want to go there, a short idea, its genre, two colours and a cover picture.',
    '',
    `Write ${PROPOSAL_COUNT} proposals, as different from one another as you can make them:`,
  ];
  PROPOSAL_KINDS.forEach((kind, i) => {
    // The familiar two take their dice as flavour only: as the premise, salt and pollen made the "classic" one a strange desert.
    const how = i < 2 ? 'only as small flavour — a custom, a trade, a landmark — never as the premise' : 'transformed and combined, never literal';
    const seeds = ask.seeds[i]?.length ? ` Seeds, drawn by dice, used ${how}: ${ask.seeds[i].join(', ')}.` : '';
    lines.push(`${i + 1}. ${kind}.${seeds}`);
  });
  if (ask.avoid.length) {
    lines.push(
      '',
      ask.avoidPool
        ? 'These worlds are ALREADY PROPOSED; every new proposal must be unlike all of them — another land, another trouble, other names:'
        : 'The player has ALREADY BEEN to these worlds; every proposal must be unlike all of them:',
    );
    for (const w of ask.avoid.slice(ask.avoidPool ? 0 : -8, ask.avoidPool ? 24 : undefined)) lines.push(`- ${w.slice(0, 160)}`);
  }
  lines.push(
    '',
    'Every world must be playable as this game: a landscape to walk, a settlement, people who talk, something',
    'dangerous to fight and things to gather. None is a franchise: no names, places, creatures or terms from',
    'existing books, films, games or comics. A feel is welcome; a borrowed name is not.',
    '',
    `In ${language}: the name (one to four words, invented, evocative), the pitch (one or two sentences, at most`,
    '30 words, concrete: the land, its people, its trouble — no "a world where…" opener), the idea (two to six',
    'words, lower case, how a player would type the world into a search box: "pirates on a sea of sand",',
    '"a detective story in 1920s Kraków", "dragons and railways", "a tea house in the afterlife"), the genre (two to four',
    'words, plain, no English loanwords). The colours are two hex colours of its look. The cover is IN ENGLISH, at most 35 words: one wide',
    'cinematic scene of the world for an image model — its land, its light, a figure or a settlement in it.',
    '',
    `Answer in exactly this format, ${PROPOSAL_COUNT} blocks of six lines and nothing else:`,
    'N: <name>',
    'S: <idea>',
    'P: <pitch>',
    'G: <genre>',
    'C: <#rrggbb> <#rrggbb>',
    'I: <cover picture>',
  );
  return lines.join('\n');
}

/** `N:` … `I:` at the start of a line, forgiving the decorations models add: bold, a number, a dash. */
const LINE = /^\s*(?:[-*>]\s*)?(?:\d+[.)]\s*)?(?:\*\*)?\s*([NSPGCI])\s*(?:\*\*)?\s*[:：]\s*(?:\*\*)?\s*(.*)$/i;
const HEX = /#[0-9a-f]{6}\b/gi;

function clean(text: string): string {
  return text
    .replace(/\*\*/g, '')
    .replace(/^["„“”]+|["„“”]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A colour pair for a name that came with none: the same name always gets the same two. */
export function fallbackColors(name: string): [string, string] {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  const hsl = (hh: number, s: number, l: number) => {
    const a = (s * Math.min(l, 1 - l)) / 100;
    const f = (n: number) => {
      const k = (n + hh / 30) % 12;
      const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return Math.round(255 * c).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  };
  return [hsl(hue, 45, 0.32), hsl((hue + 40) % 360, 55, 0.55)];
}

/**
 * The proposals in the answer so far. Only whole lines count until `final` (the stream's last line
 * may be half a word); a proposal starts at its `N:` and the lines after it are its own; anything
 * else is ignored. A proposal with no pitch yet is left out. At most `PROPOSAL_COUNT`.
 */
export function parseProposals(soFar: string, final = false): Proposal[] {
  const lines = soFar.split('\n');
  if (!final) lines.pop();
  const out: Proposal[] = [];
  let colors: string[] | null = null;
  for (const raw of lines) {
    const m = LINE.exec(raw);
    if (!m) continue;
    const key = m[1].toUpperCase();
    const body = clean(m[2]);
    if (!body) continue;
    if (key === 'N') {
      if (out.length >= PROPOSAL_COUNT) break;
      colors = null;
      out.push({ name: body.slice(0, 60), idea: '', pitch: '', genre: '', colors: fallbackColors(body), picture: null, image: null });
      continue;
    }
    const p = out[out.length - 1];
    if (!p) continue;
    if (key === 'S' && !p.idea) p.idea = body.slice(0, IDEA_MAX);
    else if (key === 'P' && !p.pitch) p.pitch = body.slice(0, 300);
    else if (key === 'G' && !p.genre) p.genre = body.slice(0, 40);
    else if (key === 'C' && !colors) {
      colors = body.match(HEX) ?? [];
      if (colors.length >= 2) p.colors = [colors[0].toLowerCase(), colors[1].toLowerCase()];
      else if (colors.length === 1) p.colors = [colors[0].toLowerCase(), p.colors[1]];
    } else if (key === 'I' && !p.picture) p.picture = body.slice(0, 300);
  }
  return out.filter((p) => p.pitch);
}

/**
 * What the genesis is told when a proposal is picked: the proposal as the player's own description
 * (`GenesisContext.wish`), so the world is built on it the way a typed idea is, and keeps its name.
 */
export function proposalWish(p: Pick<Proposal, 'name' | 'pitch' | 'genre'>, lang: Lang): string {
  const text =
    lang === 'pl'
      ? `Świat nazywa się „${p.name}”${p.genre ? ` (${p.genre})` : ''}. ${p.pitch}`
      : `The world is called "${p.name}"${p.genre ? ` (${p.genre})` : ''}. ${p.pitch}`;
  return text.slice(0, 600);
}

/**
 * The prompt that gives items from before `idea` theirs (`growPool` on the server, once): one JSON
 * object, id to idea, in English like the source.
 */
export function ideaPrompt(items: { id: string; name: string; pitch: string; genre: string }[]): string {
  return [
    'These are proposed worlds for a role-playing video game. For each, write its idea: two to six words, lower case,',
    'how a player would type that world into a search box — "pirates on a sea of sand", "a detective story in 1920s',
    'Kraków", "dragons and railways", "a tea house in the afterlife". Plain and concrete, no invented names.',
    'Answer with a JSON object: each id as a key, its idea as the value.',
    '',
    JSON.stringify(Object.fromEntries(items.map((p) => [p.id, `${p.name} (${p.genre}): ${p.pitch}`]))),
  ].join('\n');
}

/** The slider position a picked proposal is made at: the well-loved version of what it says, since it is already the premise. */
export const PROPOSAL_EXOTIC = 25;

/** Is this a proposal as kept in localStorage? */
export function validProposal(raw: unknown): Proposal | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string' || typeof r.pitch !== 'string' || !r.name || !r.pitch) return null;
  const colors =
    Array.isArray(r.colors) && r.colors.length === 2 && r.colors.every((c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c))
      ? (r.colors as [string, string])
      : fallbackColors(r.name);
  return {
    name: r.name.slice(0, 60),
    idea: typeof r.idea === 'string' ? r.idea.slice(0, IDEA_MAX) : '',
    pitch: r.pitch.slice(0, 300),
    genre: typeof r.genre === 'string' ? r.genre.slice(0, 40) : '',
    colors,
    picture: typeof r.picture === 'string' ? r.picture.slice(0, 300) : null,
    image: typeof r.image === 'string' && /^https:\/\//.test(r.image) ? r.image : null,
  };
}
