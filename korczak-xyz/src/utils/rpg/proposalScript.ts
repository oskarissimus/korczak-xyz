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
 *
 * **Since 10 Nov 2026 a proposal is a few words and a picture, nothing more** (owner: "simplify it to
 * what it was with Kraków and so on — those were very good suggestions; no description any more, only
 * the phrase and the picture per proposal"). The worlds had been an invented name and a 30-word pitch
 * packed with dice words, two of the four kinds asked to be strange: they read overwrought next to the
 * four hand-written phrases they replaced. `name`, `pitch` and `genre` stay only so a pool or a kept
 * proposal from before still reads; nothing writes them now.
 */

import type { Lang } from './quest';
import { languageName } from './language';

export const PROPOSAL_COUNT = 4;
/** The longest idea kept: a few words, never a sentence. */
export const IDEA_MAX = 60;

/** One proposed world: a premise to make a world from, never the world itself. */
export interface Proposal {
  /** The world's name, in the game's language. Before 10 Nov 2026 only; '' since. */
  name: string;
  /**
   * The world as a player would type it into the field, two to six words ("pirates on a sea of sand",
   * "a detective story in 1920s Kraków"): the card's caption and what a tap puts in the field (owner,
   * 10 Nov 2026: "proposals with a picture, but with the texts that used to sit under the prompt").
   * Since then the whole proposal, with its picture. Empty only on an item older than ideas.
   */
  idea: string;
  /** One or two sentences: what it is and why one would go there. Before 10 Nov 2026 only; '' since. */
  pitch: string;
  /** Its genre in two to four words. Before 10 Nov 2026 only; '' since. */
  genre: string;
  /** Two colours for the card while (or when there is no) cover. */
  colors: [string, string];
  /** The cover, described in English for FLUX; null until its line has come. */
  picture: string | null;
  /** The cover's URL once drawn (the gateway keeps it in the bucket, so it lasts). */
  image: string | null;
}

/**
 * Four kinds, one of each in a batch of four, so the strip mixes them the way the hand-written four
 * did: dragons and railways, pirates on a sea of sand, a detective story in 1920s Kraków, a tea house
 * in the afterlife. Each is a familiar thing with one twist, never a strange thing for its own sake.
 */
export const PROPOSAL_KINDS = [
  'classic fantasy with one unexpected twist (like "dragons and railways")',
  'another well-loved genre — pirates, a western, noir, space, myth, samurai, post-apocalypse — with one twist (like "pirates on a sea of sand")',
  'a real place and time anybody knows, made into an adventure (like "a detective story in 1920s Kraków")',
  'something cosy, gentle or funny (like "a tea house in the afterlife")',
] as const;

export interface ProposalAsk {
  lang: Lang;
  /** Ideas already in the pool, which a new one must not repeat. */
  avoid: string[];
}

export const COVER_STYLE = 'painterly fantasy book cover art, wide establishing shot, dramatic atmospheric light, rich colour, no text, no letters, no title';

export function coverPrompt(picture: string): string {
  return `${picture.replace(/[.\s]+$/, '')}. ${COVER_STYLE}`;
}

export function proposalPrompt(ask: ProposalAsk): string {
  const language = languageName(ask.lang);
  const lines = [
    'You suggest worlds for a role-playing game. The player sees a few short ideas under a field where they',
    'describe the world they want, each with a picture, and taps one to put it in the field.',
    '',
    'An idea is two to six plain words, lower case, the way a player would type it: one familiar thing and one',
    'twist, concrete and instantly clear, that makes one smile or want to go there. Exactly like these four:',
    '- pirates on a sea of sand',
    '- a detective story in 1920s Kraków',
    '- dragons and railways',
    '- a tea house in the afterlife',
    'No invented names, no franchise, no adjective pile-ups, nothing that needs explaining.',
    '',
    `Write ${PROPOSAL_COUNT} ideas, one of each kind, in this order:`,
    ...PROPOSAL_KINDS.map((kind, i) => `${i + 1}. ${kind}`),
  ];
  if (ask.avoid.length) {
    lines.push('', 'These are already suggested; every new idea must be clearly different from all of them:');
    for (const w of ask.avoid.slice(0, 40)) lines.push(`- ${w.slice(0, 80)}`);
  }
  lines.push(
    '',
    `The idea in ${language}. The picture IN ENGLISH, at most 35 words: one wide cinematic scene of that world`,
    'for an image model — its land, its light, a figure or a building in it.',
    '',
    `Answer in exactly this format, ${PROPOSAL_COUNT} blocks of two lines and nothing else:`,
    'S: <idea>',
    'I: <picture>',
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
 * may be half a word); a proposal starts at its `S:` (or, from before ideas, its `N:`) and the lines
 * after it are its own; anything else is ignored. One with neither an idea nor a pitch yet is left
 * out. At most `PROPOSAL_COUNT`.
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
    // `S:` starts a proposal; so does `N:`, the name an answer from before ideas opened with.
    const p = out[out.length - 1];
    const starts = key === 'S' ? !p || Boolean(p.idea) || Boolean(p.picture) : key === 'N';
    if (starts) {
      if (out.length >= PROPOSAL_COUNT) break;
      colors = null;
      out.push({
        name: key === 'N' ? body.slice(0, 60) : '',
        idea: key === 'S' ? body.slice(0, IDEA_MAX) : '',
        pitch: '',
        genre: '',
        colors: fallbackColors(body),
        picture: null,
        image: null,
      });
      continue;
    }
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
  return out.filter((p) => p.idea || p.pitch);
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

/** The slider position a picked proposal is made at: the well-loved version of what it says, since it is already the premise. */
export const PROPOSAL_EXOTIC = 25;

/** Is this a proposal as kept in localStorage? */
export function validProposal(raw: unknown): Proposal | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name.slice(0, 60) : '';
  const idea = typeof r.idea === 'string' ? r.idea.slice(0, IDEA_MAX) : '';
  const pitch = typeof r.pitch === 'string' ? r.pitch.slice(0, 300) : '';
  if (!idea && !(name && pitch)) return null;
  const colors =
    Array.isArray(r.colors) && r.colors.length === 2 && r.colors.every((c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c))
      ? (r.colors as [string, string])
      : fallbackColors(idea || name);
  return {
    name,
    idea,
    pitch,
    genre: typeof r.genre === 'string' ? r.genre.slice(0, 40) : '',
    colors,
    picture: typeof r.picture === 'string' ? r.picture.slice(0, 300) : null,
    image: typeof r.image === 'string' && /^https:\/\//.test(r.image) ? r.image : null,
  };
}
