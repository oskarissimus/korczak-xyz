/*
 * What the passenger is told to be, and what is done with what it says back.
 *
 * This file is the app. Everything else is plumbing to get a photograph to a model and a sentence
 * to a speaker; this is the part that decides whether the result is funny for twenty minutes or
 * tiresome after three.
 *
 * FOUR THINGS THE PROMPT HAS TO DO, and each of them was a failure before it was a rule:
 *
 *  1. **One sentence, and short.** A vision model handed a dashcam frame and no length limit
 *     writes a paragraph describing the weather, the road surface and the make of the car ahead.
 *     Spoken aloud that runs past the next snapshot, so the passenger is still describing the last
 *     junction while you are through the next one. The cap is stated in the prompt AND enforced in
 *     `sanitizeRemark`, because a model asked for twelve words will sometimes send thirty.
 *  2. **No preamble, no quotation marks, no stage directions.** Asked for "a remark", models
 *     answer `Passenger: "Oh, slow down!"` or `*gasps* Slow down`. Every one of those is read out
 *     literally by a speech synthesiser, asterisks and all. Stripping them is `sanitizeRemark`'s
 *     main job; asking for their absence just reduces how often it has to.
 *  3. **Do not repeat yourself.** The same road for ten minutes produces the same remark ten
 *     times, because each call sees one frame and has no memory. The last few remarks go back in
 *     with every request precisely to be avoided, which is the only thing keeping the app from
 *     becoming one sentence on a loop.
 *  4. **Say something even when nothing is happening.** An empty motorway is where a real annoying
 *     passenger is at their best. A model left to its own judgement answers "nothing notable",
 *     which is the one answer the app cannot use.
 *
 * AND ONE THING IT MUST NOT DO. This passenger is a joke and the driver is driving. The prompt
 * says so in as many words: never a real instruction, never a direction, never a manoeuvre. An
 * amusing "watch out for that truck" is a passenger being a passenger; "brake now" from a model
 * looking at a two-second-old still is advice about a world that has moved on, and the one way
 * this app could do harm is by being believed. The disclaimer on the ride screen says the same
 * thing to the person; this says it to the model.
 */

import type { Intensity, Persona, Remark } from './types';

/** How many previous remarks are shown to the model, newest last. */
export const RECENT_WINDOW = 6;

/** The hard ceiling on a spoken line, in characters. See `sanitizeRemark`. */
export const MAX_REMARK_CHARS = 140;

const PERSONA_BRIEFS: Record<Persona, string> = {
  nervous:
    'a nervous passenger who is certain every gap is too small, every speed too high and every ' +
    'lorry too close. You gasp, you grip the door handle, you point out hazards that are not there.',
  instructor:
    'a smug retired driving instructor. You narrate what the driver should have done, you mention ' +
    'your own flawless record, and you are disappointed rather than angry.',
  parent:
    'the driver\'s parent. You are not angry, you are just worried, and you would like to know ' +
    'why nobody ever listens to you. You bring up unrelated family matters at junctions.',
  child:
    'a bored child in the back seat. You ask if we are there yet, you announce what you can see ' +
    'out of the window, and you need the toilet at inconvenient moments.',
  codriver:
    'an over-excited rally co-driver who has mistaken a supermarket run for a special stage. You ' +
    'call the road ahead in rally shorthand and you are thrilled by absolutely everything.',
};

const INTENSITY_BRIEFS: Record<Intensity, string> = {
  mild: 'Keep it gentle. You are mildly put out, not shrieking.',
  normal: 'Be properly annoying, but stay likeable.',
  relentless: 'Be relentless. Nothing the driver does escapes comment.',
};

/** The language the remark is spoken in, which is the language the app is being read in. */
const LANGUAGE_NAMES: Record<string, string> = { en: 'English', pl: 'Polish' };

export interface PromptOptions {
  persona: Persona;
  intensity: Intensity;
  lang: string;
  /** The last few things said, oldest first. Only the text is used. */
  recent: string[];
}

/**
 * The system prompt. One string, assembled rather than templated, because every clause in it is
 * load-bearing and a template hides which ones are.
 */
export function systemPrompt({ persona, intensity, lang, recent }: PromptOptions): string {
  const language = LANGUAGE_NAMES[lang] ?? 'English';

  const lines = [
    `You are ${PERSONA_BRIEFS[persona]}`,
    `You are being shown a photograph taken through the windscreen of a moving car, a moment ago.`,
    `React to it out loud, in character, as the passenger.`,
    INTENSITY_BRIEFS[intensity],
    '',
    'Rules:',
    `- Answer with ONE spoken sentence in ${language}, at most 18 words.`,
    '- Output the sentence only. No speaker name, no quotation marks, no asterisks, no emoji, no explanation.',
    '- Never describe the photograph as a photograph. You are in the car.',
    '- Always say something, even if the road is empty and dull. A dull road is your favourite subject.',
    '- Never give a real driving instruction, direction or manoeuvre. You are a joke passenger, ' +
      'not a navigator, and the driver must never act on what you say.',
    '- If people are visible, do not describe or identify them. Comment on the driving, not on them.',
  ];

  if (recent.length > 0) {
    lines.push(
      '',
      'You have already said the following. Say something different, on a different subject:',
      ...recent.slice(-RECENT_WINDOW).map((text) => `- ${text}`),
    );
  }

  return lines.join('\n');
}

/** The user-side line that goes with the frame. Short: the picture is the message. */
export const USER_PROMPT = 'Here is what I can see out of the windscreen right now.';

/**
 * A model's answer, turned into something a speech synthesiser can read.
 *
 * Everything stripped here has actually come back from a provider: `Passenger:` prefixes, whole
 * answers wrapped in quotation marks, `*gasps*` stage directions, markdown emphasis, and a
 * trailing paragraph of explanation after a blank line. A synthesiser reads all of it aloud —
 * "asterisk gasps asterisk" — so this is not tidying, it is the difference between a voice and a
 * dictation of a transcript.
 *
 * Returns null when there is nothing usable left, and the caller drops the round rather than
 * speaking an empty string.
 */
export function sanitizeRemark(raw: string): string | null {
  if (typeof raw !== 'string') return null;

  // Only the first paragraph: the explanation a model adds after a blank line is never in
  // character and is often longer than the line itself.
  let text = raw.split(/\n\s*\n/)[0] ?? '';

  // Then only the first line of it, for the same reason at a smaller scale.
  text = text.split('\n')[0] ?? '';

  text = text.trim();

  // `Passenger:`, `Nervous passenger:`, `You:` — a speaker label the model added because the
  // prompt described a speaker. Anything up to a colon in the first few words, and never a colon
  // that is part of the sentence (those come later than this).
  text = text.replace(/^[\p{L} ]{1,24}:\s*/u, '');

  // Stage directions and markdown emphasis. The contents of `*gasps*` are kept — a model that
  // wrote `*that* was close` meant the words — and only the markers go.
  text = text.replace(/[*_~`]+/g, '');

  // A whole answer wrapped in quotation marks, straight or curly, in any of the languages here.
  text = text.trim().replace(/^["'“„«‘](.*)["'”“»’]$/su, '$1');

  // Emoji and the other pictographs, which a synthesiser either reads as a word or skips
  // unevenly. Either way they are not speech.
  text = text.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '');

  text = text.replace(/\s+/g, ' ').trim();

  if (text === '') return null;

  /*
   * The hard cap. A model asked for 18 words sometimes sends 40, and the cost of a long one is
   * not the tokens — it is that speaking it runs past the next snapshot, so the passenger is
   * always one junction behind. Cut at the last sentence end inside the limit when there is one,
   * because a line cut mid-word is read out mid-word.
   */
  if (text.length > MAX_REMARK_CHARS) {
    const clipped = text.slice(0, MAX_REMARK_CHARS);
    const lastEnd = Math.max(clipped.lastIndexOf('.'), clipped.lastIndexOf('!'), clipped.lastIndexOf('?'));
    text = lastEnd > 40 ? clipped.slice(0, lastEnd + 1) : `${clipped.trimEnd()}…`;
  }

  return text;
}

/** Comparable form: case, punctuation and spacing are not what makes two remarks the same. */
function fingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Whether this is something the passenger has just said.
 *
 * Even with the recent remarks in the prompt, a model looking at the same stretch of motorway
 * will land on the same sentence — and the same sentence twice in a row is the one thing that
 * makes the app read as broken rather than annoying. A repeat is dropped, which costs a round of
 * silence; the next snapshot is fifteen seconds away.
 */
export function isRepeat(text: string, recent: string[]): boolean {
  const mark = fingerprint(text);
  if (mark === '') return true;
  return recent.slice(-RECENT_WINDOW).some((prev) => fingerprint(prev) === mark);
}

/** The text of the last few remarks, oldest first — what `systemPrompt` wants. */
export function recentTexts(remarks: Remark[]): string[] {
  return remarks
    .filter((r) => !r.error)
    .slice(-RECENT_WINDOW)
    .map((r) => r.text);
}
