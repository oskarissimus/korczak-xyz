/*
 * The starter interests, and the rules for editing one.
 *
 * Portable: browser and Node, no imports outside this directory. See types.ts.
 */

import type { Interest } from './types';

/** A new interest's defaults. `leadDays` of 14 is a fortnight's warning, which suits most tickets. */
export const DEFAULT_LEAD_DAYS = 14;

export interface InterestDraft {
  label: string;
  keywords: string[];
  excludeKeywords?: string[];
  tags?: string[];
  cities?: string[];
  fromDay?: string;
  toDay?: string;
  leadDays: number;
  muted?: boolean;
}

/**
 * The five interests a new account starts with — the owner's own list, expressed in this app's
 * vocabulary.
 *
 * Seeded as ordinary rows, not hard-coded and not special-cased, so every one can be edited,
 * muted or deleted like any other. The seeding is idempotent by id, and a deleted seed stays
 * deleted (its tombstone outranks a re-seed at the same rev).
 *
 * Two of them are worth reading closely because they are the two shapes an interest can take:
 *
 *   - `events-seed-opera` has **no keywords at all**. It is `tags: ['opera']`, meaning "everything
 *     the opera house announces" — which is what "I want to know when new repertoire is announced"
 *     actually asks for, and which no keyword list could express. This is the case
 *     `matchesInterest` treats an empty keyword array as *no constraint* for.
 *   - `events-seed-floyd` carries exclusions. 'floyd' alone reaches guitar hardware ("Floyd Rose"
 *     tremolos) and, in an English-language feed, news about a person. The vetoes are cheaper than
 *     a narrower keyword list that would miss "The Wall live".
 *
 * Keywords are stored unfolded, as typed, because they are shown back in the editor; `foldText`
 * runs at match time on both sides.
 */
export const SEED_INTERESTS: ReadonlyArray<{ id: string } & InterestDraft> = [
  {
    id: 'events-seed-klezmer',
    label: 'Klezmer',
    keywords: [
      // Trailing `*` is a prefix match — Polish inflects, so a bare 'klezmer' would never
      // reach "koncert klezmerski". See containsWord.
      'klezmer*',
      'muzyka zydowsk*',
      'kultury zydowskiej',
      'jewish music',
      'yiddish',
    ],
    leadDays: 21,
  },
  {
    id: 'events-seed-floyd',
    label: 'Pink Floyd',
    keywords: [
      'pink floyd',
      'the wall',
      'dark side of the moon',
      'wish you were here',
      'floyd tribute',
      'tribute to pink floyd',
    ],
    // 'Floyd Rose' is a tremolo bridge; a guitar shop's listing is not a concert.
    excludeKeywords: ['floyd rose'],
    leadDays: 30,
  },
  {
    id: 'events-seed-medieval',
    label: 'Castles & medieval fairs',
    keywords: [
      'sredniowieczn*',
      'rycersk*',
      'medieval',
      'rekonstrukcj*',
      'oblezeni*',
      'inscenizacj*',
      'zamek',
      'zamku',
      'grodzisk*',
    ],
    leadDays: 21,
  },
  {
    id: 'events-seed-dev',
    label: 'Python & dev',
    keywords: [
      'python',
      'pycon',
      'django',
      'devops',
      'hackathon',
      'meetup',
      'programistyczn*',
    ],
    leadDays: 14,
  },
  {
    id: 'events-seed-opera',
    label: 'Opera Narodowa',
    // Deliberately empty: this interest is "whatever the opera house puts on", and the tag is
    // what says so. See the note above and matchesInterest's comment.
    keywords: [],
    tags: ['opera'],
    leadDays: 45,
  },
];

/**
 * Turns a draft into a stored row.
 *
 * `createdAt` is set once and never moved by an edit — that is what stops changing an interest's
 * keywords from re-arming its entire backlog as fresh announcements.
 */
export function newInterest(
  draft: InterestDraft,
  ctx: { id: string; writerId: string; now: number },
): Interest {
  return {
    id: ctx.id,
    rev: 0,
    updatedAt: ctx.now,
    writerId: ctx.writerId,
    createdAt: ctx.now,
    label: draft.label.trim(),
    keywords: cleanList(draft.keywords),
    excludeKeywords: optionalList(draft.excludeKeywords),
    tags: optionalList(draft.tags),
    cities: optionalList(draft.cities),
    fromDay: draft.fromDay || undefined,
    toDay: draft.toDay || undefined,
    leadDays: clampLead(draft.leadDays),
    muted: draft.muted || undefined,
  };
}

/** An edit. Bumps `rev`, leaves `createdAt` alone, and clears any tombstone. */
export function reviseInterest(
  interest: Interest,
  draft: InterestDraft,
  ctx: { writerId: string; now: number },
): Interest {
  const next = newInterest(draft, { id: interest.id, writerId: ctx.writerId, now: ctx.now });
  return { ...next, rev: interest.rev + 1, createdAt: interest.createdAt };
}

/** A tombstone. Never a deleteDoc: the delete has to reach the other device. */
export function tombstoneInterest(
  interest: Interest,
  ctx: { writerId: string; now: number },
): Interest {
  return { ...interest, rev: interest.rev + 1, updatedAt: ctx.now, writerId: ctx.writerId, deleted: true };
}

export function seedInterests(ctx: { writerId: string; now: number }): Interest[] {
  return SEED_INTERESTS.map(({ id, ...draft }) => newInterest(draft, { ...ctx, id }));
}

/**
 * Adds any seed the account has never held.
 *
 * Keyed by id and checked against tombstones too, so deleting a seed is permanent rather than
 * something the next page load undoes. That distinction is the whole reason this is not just
 * "seed when the list is empty".
 */
export function withMissingSeeds(
  existing: Interest[],
  ctx: { writerId: string; now: number },
): Interest[] {
  const known = new Set(existing.map((i) => i.id));
  const missing = SEED_INTERESTS.filter((seed) => !known.has(seed.id));
  if (missing.length === 0) return existing;
  return [
    ...existing,
    ...missing.map(({ id, ...draft }) => newInterest(draft, { ...ctx, id })),
  ];
}

function cleanList(list: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list ?? []) {
    const value = raw.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** Absent rather than empty: an empty array in Firestore is a field that means nothing. */
function optionalList(list: string[] | undefined): string[] | undefined {
  const cleaned = cleanList(list);
  return cleaned.length > 0 ? cleaned : undefined;
}

function clampLead(days: number): number {
  if (!Number.isFinite(days)) return DEFAULT_LEAD_DAYS;
  return Math.min(365, Math.max(0, Math.round(days)));
}

/** Splits a comma or newline separated field into keywords. Used by the editor. */
export function parseKeywords(raw: string): string[] {
  return cleanList(raw.split(/[,\n]/));
}
