/*
 * WHO A CHARACTER IS (owner, 30 Oct 2026: "make the characters have a personality type assigned,
 * Jung/MBTI, or an archetype too, optionally"). Every new npc and witness gets one of the sixteen
 * types, and most of them one of the twelve Jungian archetypes besides; the prompt describes both in
 * words and asks for the lines, the "voice" and the choices to follow them, shown and never named.
 *
 * Drawn here, not left to the model, for the reason the jobs and the mood are (`quest.ts`): a model
 * asked to "give each character a personality" writes the same three wise, wounded introverts. The
 * witness is drawn at least two letters away from the npc, since the prompt already asks that the
 * two never sound alike, and never with the same archetype.
 */
import type { Lang } from './quest';

export const MBTI_TYPES = [
  'INTJ', 'INTP', 'ENTJ', 'ENTP',
  'INFJ', 'INFP', 'ENFJ', 'ENFP',
  'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ',
  'ISTP', 'ISFP', 'ESTP', 'ESFP',
] as const;
export type Mbti = (typeof MBTI_TYPES)[number];

export const ARCHETYPES = [
  'innocent', 'everyman', 'hero', 'caregiver', 'explorer', 'rebel',
  'lover', 'creator', 'jester', 'sage', 'magician', 'ruler',
] as const;
export type Archetype = (typeof ARCHETYPES)[number];

export interface Persona {
  mbti: Mbti;
  /** Absent for about a third of them: a type is enough to write someone by. */
  archetype?: Archetype;
}

/** How each type talks and acts, in English, for the prompt: behaviour a reader can hear, not a test result. */
const MBTI_MANNER: Record<Mbti, string> = {
  INTJ: 'reserved and strategic; speaks in few, precise words, already three moves ahead, impatient with fools, trusts plans over people',
  INTP: 'detached and curious; thinks aloud, qualifies everything, gets lost in how a thing works, forgets the feelings in the room',
  ENTJ: 'commanding and blunt; takes charge, sets terms, talks of results and costs, treats the hero as a resource to deploy',
  ENTP: 'quick and argumentative; plays devil’s advocate, jumps between ideas, teases, enjoys a clever angle more than the truth',
  INFJ: 'quiet and perceptive; speaks of meaning and of people’s hidden motives, guarded about themselves, sudden flashes of conviction',
  INFP: 'gentle and idealistic; hesitant, speaks from the heart, hurt by cruelty, stubborn about what they believe is right',
  ENFJ: 'warm and persuasive; reads the hero, appeals to their better nature, speaks for others, a little too eager to guide',
  ENFP: 'enthusiastic and scattered; rambles with feeling, leaps to possibilities, warm, easily distracted, wears every mood openly',
  ISTJ: 'dutiful and dry; plain facts in order, dates and numbers, distrusts the new, follows the rules and expects the hero to',
  ISFJ: 'kind and anxious; worries about others before themselves, remembers small details, apologises, avoids open conflict',
  ESTJ: 'brisk and organised; tells rather than asks, judges by results, no patience for excuses, proud of order and tradition',
  ESFJ: 'sociable and caring; talks of family and neighbours, cares what people will say, warm but quick to take offence',
  ISTP: 'laconic and practical; few words, all about what works, calm in danger, shrugs off feelings and speeches',
  ISFP: 'soft-spoken and sensitive; lives in the moment, notices beauty and pain, private, acts on feeling rather than argument',
  ESTP: 'brash and daring; talks fast, wants action now, takes risks, bargains, jokes in the face of danger',
  ESFP: 'lively and theatrical; loves an audience, exaggerates, laughs easily, lives for now, dodges anything gloomy',
};

/** What drives each archetype, in English, for the prompt. */
const ARCHETYPE_DRIVE: Record<Archetype, string> = {
  innocent: 'the Innocent: wants things to be good and simple, trusting, naive, afraid of doing wrong',
  everyman: 'the Everyman: wants to belong, plain-spoken, down to earth, distrusts anyone who sets themselves above others',
  hero: 'the Hero: wants to prove their worth, brave, competitive, cannot bear to look weak',
  caregiver: 'the Caregiver: wants to protect others, self-sacrificing, can smother and guilt-trip',
  explorer: 'the Explorer: wants freedom and the unknown, restless, hates being tied down',
  rebel: 'the Rebel: wants to overturn what is rotten, defiant, scornful of authority, a little reckless',
  lover: 'the Lover: wants closeness and passion, devoted, jealous, ruled by attachment',
  creator: 'the Creator: wants to make something lasting, proud of their craft, perfectionist, touchy about their work',
  jester: 'the Jester: wants to enjoy the moment, jokes to dodge pain, irreverent, says the true thing as a joke',
  sage: 'the Sage: wants to understand, measured, quotes what they know, may hide behind knowledge instead of acting',
  magician: 'the Magician: wants to change how things are, visionary, speaks in hints, a manipulator if it suits them',
  ruler: 'the Ruler: wants control and order, responsible, authoritative, fears chaos and losing their place',
};

/** The names the console shows them by. */
const MBTI_NAME: Record<Lang, Record<Mbti, string>> = {
  en: {
    INTJ: 'Architect', INTP: 'Logician', ENTJ: 'Commander', ENTP: 'Debater',
    INFJ: 'Advocate', INFP: 'Mediator', ENFJ: 'Protagonist', ENFP: 'Campaigner',
    ISTJ: 'Logistician', ISFJ: 'Defender', ESTJ: 'Executive', ESFJ: 'Consul',
    ISTP: 'Virtuoso', ISFP: 'Adventurer', ESTP: 'Entrepreneur', ESFP: 'Entertainer',
  },
  pl: {
    INTJ: 'Architekt', INTP: 'Logik', ENTJ: 'Dowódca', ENTP: 'Dyskutant',
    INFJ: 'Rzecznik', INFP: 'Mediator', ENFJ: 'Protagonista', ENFP: 'Działacz',
    ISTJ: 'Logistyk', ISFJ: 'Obrońca', ESTJ: 'Wykonawca', ESFJ: 'Konsul',
    ISTP: 'Wirtuoz', ISFP: 'Poszukiwacz przygód', ESTP: 'Przedsiębiorca', ESFP: 'Animator',
  },
};

const ARCHETYPE_NAME: Record<Lang, Record<Archetype, string>> = {
  en: {
    innocent: 'Innocent', everyman: 'Everyman', hero: 'Hero', caregiver: 'Caregiver', explorer: 'Explorer', rebel: 'Rebel',
    lover: 'Lover', creator: 'Creator', jester: 'Jester', sage: 'Sage', magician: 'Magician', ruler: 'Ruler',
  },
  pl: {
    innocent: 'Niewinny', everyman: 'Zwykły człowiek', hero: 'Bohater', caregiver: 'Opiekun', explorer: 'Odkrywca',
    rebel: 'Buntownik', lover: 'Kochanek', creator: 'Twórca', jester: 'Błazen', sage: 'Mędrzec', magician: 'Mag',
    ruler: 'Władca',
  },
};

/** How often a character has an archetype besides the type. */
const ARCHETYPE_SHARE = 2 / 3;

const pick = <T>(list: readonly T[], rand: () => number): T => list[Math.min(list.length - 1, Math.floor(rand() * list.length))];

/** In how many of the four letters two types differ. */
export function letterDistance(a: Mbti, b: Mbti): number {
  let n = 0;
  for (let i = 0; i < 4; i++) if (a[i] !== b[i]) n++;
  return n;
}

/** One character's type, and maybe an archetype, none of them the ones in `avoid`. */
export function drawPersona(rand: () => number = Math.random, avoid?: Persona): Persona {
  const types = avoid ? MBTI_TYPES.filter((t) => letterDistance(t, avoid.mbti) >= 2) : MBTI_TYPES;
  const mbti = pick(types, rand);
  if (rand() >= ARCHETYPE_SHARE) return { mbti };
  const archetypes = ARCHETYPES.filter((a) => a !== avoid?.archetype);
  return { mbti, archetype: pick(archetypes, rand) };
}

/** Whoever a beat brings in new: the npc, and a witness unlike them. */
export function drawPersonas(rand: () => number = Math.random): { npc: Persona; witness: Persona } {
  const npc = drawPersona(rand);
  return { npc, witness: drawPersona(rand, npc) };
}

/** A persona from JSON (an autosave, the demo's request), or null. */
export function parsePersona(raw: unknown): Persona | null {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  const mbti = typeof r?.mbti === 'string' ? r.mbti.trim().toUpperCase() : '';
  if (!(MBTI_TYPES as readonly string[]).includes(mbti)) return null;
  const archetype = typeof r?.archetype === 'string' ? r.archetype.trim().toLowerCase() : '';
  return (ARCHETYPES as readonly string[]).includes(archetype)
    ? { mbti: mbti as Mbti, archetype: archetype as Archetype }
    : { mbti: mbti as Mbti };
}

/** The persona described for the prompt: "ENTP — quick and argumentative…; archetype the Jester: …". */
export function personaWords(p: Persona): string {
  const type = `${p.mbti}, ${MBTI_MANNER[p.mbti]}`;
  return p.archetype ? `${type}; archetype ${ARCHETYPE_DRIVE[p.archetype]}` : type;
}

/** The persona as the console names it: "ENTP Dyskutant · Błazen". */
export function personaLabel(p: Persona, lang: Lang): string {
  const type = `${p.mbti} ${MBTI_NAME[lang][p.mbti]}`;
  return p.archetype ? `${type} · ${ARCHETYPE_NAME[lang][p.archetype]}` : type;
}
