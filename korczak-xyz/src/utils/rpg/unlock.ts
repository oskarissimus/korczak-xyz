import type { Beat, Decision, DialogueOption } from './quest';

/**
 * Whether a decision may be offered yet: only once what it rests on has been heard (owner, 30 Oct
 * 2026: "Zbiorę filtry i odczynniki do twojej odtrutki" was offered before the hero asked Suchy how
 * he meant to save them, and only his answer spoke of the antidote — in `rpgSaves/wmvtzzd421`,
 * beat 2, the decision carried no `after` at all).
 *
 * Two checks. The model's own `after`, as before. And because the model forgets it as often as it
 * sets it, the label's words against what was said: a word of the label that nothing heard so far
 * contains, but that something still unheard at this beat does — the witness, a clue not yet
 * examined, a question not yet asked — keeps the decision back until one of those has been heard.
 * Any of them will do: knowledge is knowledge whoever gave it. A word nobody says anywhere
 * ("odczynniki") gates nothing, so a label that only invents detail is never locked away for good.
 *
 * Every source it can wait for is reachable at the beat, so asking everything always opens
 * everything; it may leave no decision open until something has been asked, which is the point.
 */
export interface Heard {
  /** The witness has been spoken to (`witnessHeard`). */
  witness: boolean;
  /** Clues examined, by index. */
  seen: ReadonlySet<number>;
  /** Small-talk questions asked, by index. */
  asked: ReadonlySet<number>;
  /** What the hero said in their own words and was answered (`freeTalk`). */
  free?: readonly DialogueOption[];
}

export function decisionOpen(b: Beat, d: Decision, heard: Heard, before: string): boolean {
  const a = d.after;
  if (a !== undefined) {
    const ok = a === 'witness' ? heard.witness : typeof a === 'number' ? heard.seen.has(a) : heard.asked.has(a.ask);
    if (!ok) return false;
  }
  const said = stems([before, heardText(b, heard)].join(' '));
  const unsaid = stems(unheardText(b, heard));
  for (const s of stems(d.label)) if (!said.has(s) && unsaid.has(s)) return false;
  return true;
}

/**
 * Everything the earlier beats of the quest put in front of the hero, generously: a word that was
 * anywhere in them is known, which can only open a decision, never lock one.
 */
export function knownBefore(beats: readonly Beat[], index: number): string {
  return beats
    .filter((b) => b.index < index)
    .flatMap((b) => [
      b.title,
      b.objectiveText,
      b.npc.name,
      b.place?.name ?? '',
      b.greeting,
      ...b.story.flatMap((p) => [p.ask, p.say]),
      ...b.smallTalk.flatMap((o) => [o.label, o.reply]),
      ...b.clues.flatMap((c) => [c.name, c.text, c.ask, c.reply]),
      ...(b.witness ? [b.witness.npc.name, b.witness.greeting, ...b.witness.talk.flatMap((o) => [o.label, o.reply])] : []),
      ...b.decisions.flatMap((d) => [d.label, d.reply, d.consequence]),
    ])
    .join(' ');
}

/** What this beat has put in front of the hero so far, including the questions on offer. */
function heardText(b: Beat, h: Heard): string {
  const w = b.witness;
  return [
    b.title,
    b.objectiveText,
    b.npc.name,
    b.place?.name ?? '',
    b.job?.targetName ?? '',
    b.greeting,
    ...b.story.flatMap((p) => [p.ask, p.say]),
    // The questions are on screen beside the decisions; only an answer waits to be asked.
    ...b.smallTalk.flatMap((o, i) => (h.asked.has(i) ? [o.label, o.reply] : [o.label])),
    ...b.clues.flatMap((c, i) => (h.seen.has(i) ? [c.name, c.text, c.ask, c.reply] : [])),
    ...(w && h.witness ? [w.greeting, ...w.talk.flatMap((o) => [o.label, o.reply])] : []),
    ...(h.free ?? []).flatMap((o) => [o.label, o.reply]),
  ].join(' ');
}

function unheardText(b: Beat, h: Heard): string {
  const w = b.witness;
  return [
    ...b.smallTalk.flatMap((o, i) => (h.asked.has(i) ? [] : [o.reply])),
    ...b.clues.flatMap((c, i) => (h.seen.has(i) ? [] : [c.name, c.text, c.ask, c.reply])),
    ...(w && !h.witness ? [w.npc.name, w.greeting, ...w.talk.flatMap((o) => [o.label, o.reply])] : []),
  ].join(' ');
}

/**
 * Words too common to tell anything: pronouns, possessives, the verbs every line has. Polish and
 * English, as the game is told in either.
 */
const COMMON = new Set(
  [
    'może', 'jest', 'mnie', 'tego', 'przy', 'było', 'będę', 'tylko', 'teraz', 'potem', 'przed', 'przez',
    'twój', 'twoja', 'twoje', 'twojej', 'twojego', 'twoim', 'twoich', 'mojej', 'mojego', 'moich', 'nasza',
    'nasze', 'naszą', 'naszej', 'wasza', 'wasze', 'jeszcze', 'wszystko', 'wszyscy', 'wszystkich', 'który',
    'która', 'które', 'którzy', 'kiedy', 'gdzie', 'dlaczego', 'jestem', 'jesteś', 'będzie', 'zrobię',
    'zrobimy', 'możesz', 'mogę', 'musimy', 'muszę', 'chcesz', 'chcę', 'ciebie', 'siebie', 'sobie', 'tobie',
    'razem', 'zanim', 'bardzo', 'dobrze', 'właśnie', 'naprawdę', 'tutaj', 'tamte', 'tamten', 'takie',
    'there', 'their', 'about', 'would', 'could', 'should', 'which', 'where', 'while', 'these', 'those',
    'other', 'first', 'after', 'before', 'every', 'think', 'going', 'really', 'yours', 'right', 'will',
    'what', 'with', 'from', 'that', 'this', 'them', 'they', 'your', 'have', 'here', 'then', 'when',
  ].map(stem),
);

/** The first five letters stand in for a Polish word's endings: odtrutki, odtrutkę → "odtru". */
function stem(word: string): string {
  return word.toLowerCase().slice(0, 5);
}

/**
 * The words of a text that can carry something learnt: five letters and more, or a four-letter
 * capitalised one, which is a name (Zoya, Kruk) as often as not.
 */
function stems(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.match(/\p{L}+/gu) ?? []) {
    if (w.length < 4 || (w.length === 4 && w[0] === w[0].toLowerCase())) continue;
    const s = stem(w);
    if (!COMMON.has(s)) out.add(s);
  }
  return out;
}
