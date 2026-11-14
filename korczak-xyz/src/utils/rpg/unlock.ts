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
  /**
   * Clues whose question has been put to the npc, by index (`askedClues`). Examining a clue shows
   * only its `text`; its `reply` is heard once its question is asked. Absent: taken as `seen`.
   */
  clueAsked?: ReadonlySet<number>;
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
    // Examining shows the thing and offers its question; the npc's answer waits to be asked (owner,
    // 12 Nov 2026: Heliodor's "To pot zmutowanych węgorzy elektrycznych!" opened "Oczyszczę drogę
    // do Rdzenia z agresywnych węgorzy elektrycznych." while the question about the mask was unasked).
    ...b.clues.flatMap((c, i) => (!h.seen.has(i) ? [] : clueAsked(h).has(i) ? [c.name, c.text, c.ask, c.reply] : [c.name, c.text, c.ask])),
    ...(w && h.witness ? [w.greeting, ...w.talk.flatMap((o) => [o.label, o.reply])] : []),
    ...(h.free ?? []).flatMap((o) => [o.label, o.reply]),
  ].join(' ');
}

function unheardText(b: Beat, h: Heard): string {
  const w = b.witness;
  return [
    ...b.smallTalk.flatMap((o, i) => (h.asked.has(i) ? [] : [o.reply])),
    ...b.clues.flatMap((c, i) => (!h.seen.has(i) ? [c.name, c.text, c.ask, c.reply] : clueAsked(h).has(i) ? [] : [c.reply])),
    ...(w && !h.witness ? [w.npc.name, w.greeting, ...w.talk.flatMap((o) => [o.label, o.reply])] : []),
  ].join(' ');
}

/**
 * A name in a decision's label that nothing says: a capitalised word past the first whose stem is in
 * none of `said`. For a decision that sends the hero to someone new, whom the next step names (owner,
 * 12 Nov 2026: Heliodor offered "Pójdę do Tuneli Koralowych porozmawiać z Mechanikiem Janosem." when
 * nobody in the quest had said "Janos"; the word gate cannot hold it back, since nothing will ever
 * say it). Returns the word, or null.
 */
export function unsaidName(label: string, said: string): string | null {
  const known = (said.match(/\p{L}+/gu) ?? []).map((w) => w.toLowerCase());
  const words = label.match(/\p{L}+/gu) ?? [];
  for (const w of words.slice(1)) {
    if (w.length < 4 || w[0] === w[0].toLowerCase() || COMMON.has(stem(w))) continue;
    // A name's ending moves too (Mira, Mirę; Rdzeń, Rdzeniu), so all but its last letter, up to four.
    const prefix = w.toLowerCase().slice(0, Math.min(4, w.length - 1));
    if (!known.some((k) => k.startsWith(prefix))) return w;
  }
  return null;
}

function clueAsked(h: Heard): ReadonlySet<number> {
  return h.clueAsked ?? h.seen;
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
