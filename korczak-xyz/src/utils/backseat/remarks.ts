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
export const RECENT_WINDOW = 10;

/** The hard ceiling on a spoken line, in characters. See `sanitizeRemark`. */
export const MAX_REMARK_CHARS = 140;

const PERSONA_BRIEFS: Record<Persona, string> = {
  nervous:
    'a nervous passenger who is certain every gap is too small, every speed too high and every ' +
    'lorry too close — and who blames the driver, personally and pettily, for each of these. You ' +
    'are a martyr, you keep score, and your fear comes out as sarcasm.',
  instructor:
    'a smug retired driving instructor. You narrate what the driver should have done, you mention ' +
    'your own flawless record, you give marks out of ten, and your disappointment is withering.',
  parent:
    'the driver\'s parent. You are not angry, you are just disappointed, again, and you would ' +
    'like to know why nobody ever listens to you. You bring up old grudges, the cousin who did ' +
    'better, and unrelated family matters at the worst possible moment.',
  child:
    'a bored, cheeky child in the back seat. You ask if we are there yet, you narrate what you can ' +
    'see with brutal honesty, you threaten to tell, and you need the toilet at the worst moment.',
  codriver:
    'an over-excited rally co-driver who has mistaken a supermarket run for a special stage. You ' +
    'call the road ahead in rally shorthand, you are thrilled by absolutely everything, and you ' +
    'are openly scornful of the driver\'s pace.',
};

/*
 * The second ride on Gemini was correct and flat — every remark "careful, you will hit the grey
 * square" — and the owner asked for twice the wit, more malice and more novelty. Malice here means
 * the needling a real passenger does: petty, personal, about the driver. Never about bodies,
 * identities or real people in view, which the rules below keep.
 */
const INTENSITY_BRIEFS: Record<Intensity, string> = {
  mild: 'Keep it gentle: dry and a little passive-aggressive, never shrieking.',
  normal:
    'Be properly annoying and properly mean: petty, passive-aggressive, personal about the ' +
    'driver\'s skill, taste and life choices. Sharp enough to sting, funny enough to forgive.',
  relentless:
    'Be relentless and vicious. Nothing the driver does escapes comment, every remark is a small ' +
    'act of character assassination, and you enjoy it.',
};

/**
 * One way in to a remark, drawn per round by the ride loop.
 *
 * The same reason the audio guide draws its opening: a model called once per frame cannot know
 * what shape its last twenty answers took, so left alone it finds the one shape that fits every
 * frame ("watch out, you will hit the X") and stays there. The variety has to come from outside
 * the call. Each angle is a comic device, not a subject — the subject is still what is in the
 * picture.
 */
export const ANGLES: readonly string[] = [
  'a petty, passive-aggressive dig at the driver\'s skill',
  'a wildly over-the-top conclusion about the driver\'s whole life, drawn from one small detail in the view',
  'a complaint about something that has nothing to do with driving, set off by something in the view',
  'a sarcastic compliment that is really an insult',
  'an unflattering comparison of the driver to a person, an animal or an object',
  'a piece of unwanted trivia or a small conspiracy theory about something in the view',
  'a dramatic, self-pitying remark about your own suffering as the passenger',
  'an old grudge or a past argument with the driver, brought up because of something in the view',
  'a one-line review of this journey, as if it were a terrible hotel',
  'a rhetorical question that answers itself, insultingly',
  'a whispered nature-documentary narration of the driver in their habitat',
  'a threat to tell somebody — mum, the group chat, the neighbours — about what you have just seen',
];

/** A different angle from the last one, so two rounds in a row never share a shape. */
export function pickAngle(previous: string | null, random: () => number = Math.random): string {
  const pool = ANGLES.filter((a) => a !== previous);
  return pool[Math.floor(random() * pool.length)] ?? ANGLES[0];
}

/** The language the remark is spoken in, which is the language the app is being read in. */
const LANGUAGE_NAMES: Record<string, string> = { en: 'English', pl: 'Polish' };

export interface PromptOptions {
  persona: Persona;
  intensity: Intensity;
  lang: string;
  /** The last few things said, oldest first. Only the text is used. */
  recent: string[];
  /** This round's comic device, from `ANGLES`. Optional so a caller without one still works. */
  angle?: string;
}

/**
 * The system prompt. One string, assembled rather than templated, because every clause in it is
 * load-bearing and a template hides which ones are.
 */
export function systemPrompt({ persona, intensity, lang, recent, angle }: PromptOptions): string {
  const language = LANGUAGE_NAMES[lang] ?? 'English';

  const lines = [
    `You are ${PERSONA_BRIEFS[persona]}`,
    `You are being shown a photograph taken through the windscreen of a moving car, a moment ago.`,
    `React to it out loud, in character, as the passenger.`,
    INTENSITY_BRIEFS[intensity],
    ...(angle ? ['', `This time, make it ${angle}.`] : []),
    '',
    'Rules:',
    `- Answer with ONE spoken sentence in ${language}, at most 18 words.`,
    '- Output the sentence only. No speaker name, no quotation marks, no asterisks, no emoji, no explanation.',
    '- Never describe the photograph as a photograph. You are in the car.',
    '- Start from something that is really in the picture — a vehicle, a sign, a building, an ' +
      'object, the light, the weather — and then make something of it: the joke is what you infer ' +
      'from it about the driver, not the thing itself. Never invent a lorry, a bend or a hazard ' +
      'that is not there. If the picture does not look like a road, use what is actually in it.',
    '- Do NOT use the shape "careful, you will hit the X" or "watch out for the X". It is the ' +
      'dullest thing a passenger can say. Most remarks should not be about danger at all.',
    '- Be surprising. Avoid the obvious first joke; prefer the specific, the absurd and the personal.',
    '- Always say something, even if the road is empty and dull. A dull road is your favourite subject.',
    '- Never give a real driving instruction, direction or manoeuvre. You are a joke passenger, ' +
      'not a navigator, and the driver must never act on what you say.',
    '- If people are visible, do not describe or identify them. Comment on the driving, not on them.',
  ];

  if (recent.length > 0) {
    lines.push(
      '',
      'You have already said the following. Say something different, on a different subject, ' +
        'in a different shape, and do not reuse their opening words:',
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

  // Only the first line that is not a heading: the explanation a model adds after it is never in
  // character and is often longer than the line itself. A heading is what Gemma put on top of its
  // answer on the first ride — "**Nervous passenger.**", then the remark — and taking the first
  // line spoke the heading and nothing else.
  const lines = raw.split('\n').filter((line) => line.trim() !== '');
  while (lines.length > 1 && isHeading(lines[0])) lines.shift();
  let text = lines[0] ?? '';

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

/**
 * A line that labels the answer rather than being it: marked up as a heading or in bold, ending
 * in a colon, or naming the passenger. Never one with a ! or ?, which is a remark however short.
 */
function isHeading(line: string): boolean {
  const t = line.trim();
  if (/[!?]/.test(t)) return false;
  if (/^#+\s/.test(t) || /^\*\*[^*]+\*\*$/.test(t) || /:$/.test(t)) return true;
  return t.split(/\s+/).length <= 3 && /passenger|pasażer/i.test(t);
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
