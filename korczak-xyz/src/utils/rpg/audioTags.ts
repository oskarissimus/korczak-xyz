/*
 * Audio tags in a character's line: `[coughs]`, `[sighs]`, `[whispers]` (owner, Oct 2026: "ElevenLabs
 * supports things like [cough], maybe we talk to it wrong?"). We did: the model wrote them in Polish
 * and in either bracket ("[Kaszel].", "(Kaszle pyłem)", "(Kliknięcie językiem)"), they went to
 * `eleven_flash_v2_5` as they were, and Flash has no tags at all — it read "Kaszel" out loud, and
 * the screen showed the brackets. Only the v3/v4 models act a tag out, and they are told in English.
 *
 * So the prompt asks for English tags in square brackets from `TAGS`, and every line is read
 * through `directions`: a known tag (or an old save's Polish one, by `ALIASES`) is spoken as its
 * English tag on the expressive model and shown as a short italic aside in the game's language; any
 * other bracket or parenthesis is a stage direction, shown and never spoken. A line goes to the
 * expressive model only when it has a tag to act (`voicing`); everything else stays on Flash.
 */

import type { Lang } from "./quest";

/** Their low-latency model; it speaks Polish and English with the same voices. It has no audio tags. */
export const FLASH_MODEL = "eleven_flash_v2_5";

/**
 * The model for a line with an audio tag in it: Flash reads a tag out as a word, v4 acts it.
 * ElevenLabs serves v4 only through Text to Dialogue (`/v1/text-to-dialogue`, one input here), at
 * twice Flash's price — a credit a character, not half (`cost.ts`) — so only a tagged line goes to
 * it. The same voice ids work on both.
 */
export const TAG_MODEL = "eleven_v4";

/** The tags the prompt offers, with how the dialogue shows them. From ElevenLabs' v4 prompting guide. */
export const TAGS: Record<string, Record<Lang, string>> = {
  coughs: { pl: "kaszle", en: "coughs" },
  sighs: { pl: "wzdycha", en: "sighs" },
  laughs: { pl: "śmieje się", en: "laughs" },
  chuckles: { pl: "chichocze", en: "chuckles" },
  whispers: { pl: "szeptem", en: "whispering" },
  shouts: { pl: "krzyczy", en: "shouting" },
  crying: { pl: "płacze", en: "crying" },
  sobs: { pl: "szlocha", en: "sobs" },
  gasps: { pl: "łapie powietrze", en: "gasps" },
  "clears throat": { pl: "odchrząkuje", en: "clears throat" },
  gulps: { pl: "przełyka ślinę", en: "gulps" },
  snorts: { pl: "prycha", en: "snorts" },
  exhales: { pl: "wypuszcza powietrze", en: "exhales" },
  groans: { pl: "jęczy", en: "groans" },
  sniffs: { pl: "pociąga nosem", en: "sniffs" },
};

/**
 * What a direction may be written as, by its start, lower-cased: the English forms besides the
 * tag's own, and the Polish the model wrote before it was told (the quest of 29 Oct 2026 has
 * "[Kaszel]", "[kaszel]", "(Kaszel)" and "(Kaszle pyłem)" in one beat).
 */
const ALIASES: [string, string][] = [
  ["cough", "coughs"],
  ["kaszl", "coughs"],
  ["kaszel", "coughs"],
  ["sigh", "sighs"],
  ["westchn", "sighs"],
  ["wzdych", "sighs"],
  ["laugh", "laughs"],
  ["śmiech", "laughs"],
  ["śmieje", "laughs"],
  ["chuckl", "chuckles"],
  ["chichot", "chuckles"],
  ["chichocz", "chuckles"],
  ["whisper", "whispers"],
  ["szept", "whispers"],
  ["shout", "shouts"],
  ["krzycz", "shouts"],
  ["krzyk", "shouts"],
  ["cry", "crying"],
  ["płacz", "crying"],
  ["płacze", "crying"],
  ["sob", "sobs"],
  ["szloch", "sobs"],
  ["łka", "sobs"],
  ["gasp", "gasps"],
  ["clears throat", "clears throat"],
  ["odchrząk", "clears throat"],
  ["chrząk", "clears throat"],
  ["gulp", "gulps"],
  ["przełyka", "gulps"],
  ["snort", "snorts"],
  ["prych", "snorts"],
  ["exhale", "exhales"],
  ["groan", "groans"],
  ["jęk", "groans"],
  ["jęcz", "groans"],
  ["sniff", "sniffs"],
  ["pociąga nosem", "sniffs"],
];

export type LinePart =
  | { kind: "say"; text: string }
  | { kind: "aside"; tag: string | null; text: string };

function tagOf(inner: string): string | null {
  const s = inner.trim().toLowerCase();
  if (TAGS[s]) return s;
  for (const [start, tag] of ALIASES) if (s.startsWith(start)) return tag;
  return null;
}

/** The line in pieces: what is said, and each `[…]` or `(…)` with the tag it stands for, if any. */
export function directions(text: string): LinePart[] {
  const parts: LinePart[] = [];
  const re = /\[([^\]]{1,120})\]|\(([^)]{1,200})\)/g;
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > at)
      parts.push({ kind: "say", text: text.slice(at, m.index) });
    const inner = (m[1] ?? m[2]).trim();
    parts.push({ kind: "aside", tag: tagOf(inner), text: inner });
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push({ kind: "say", text: text.slice(at) });
  return parts;
}

/** Whether the line has something for an expressive model to act. */
export function hasTags(text: string): boolean {
  return directions(text).some((p) => p.kind === "aside" && p.tag !== null);
}

/**
 * What ElevenLabs is sent: with `tags`, each known tag as its English `[tag]`; without, none of
 * them. Stage directions are never sent, on any model — a voice reading "(Cyriak freezes…)" in the
 * character's voice is worse than silence. A direction taken out takes the full stop after it
 * ("[Kaszel]. Pył…") when what comes before already ends a sentence, or nothing does.
 */
export function spokenText(text: string, tags: boolean): string {
  let out = "";
  let dropped = false;
  for (const p of directions(text)) {
    if (p.kind === "aside") {
      if (tags && p.tag) {
        out = `${out.trimEnd()} [${p.tag}]`;
        dropped = false;
      } else dropped = true;
      continue;
    }
    let say = p.text;
    if (dropped && (/^\s*$|[.!?…]\s*$/.test(out) || out.endsWith("]")))
      say = say.replace(/^\s*[.,;:]/, "");
    dropped = false;
    out +=
      out && !/\s$/.test(out) && !/^\s/.test(say) && !/^[.,;:!?…]/.test(say)
        ? ` ${say}`
        : say;
  }
  return out
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?…])/g, "$1")
    .trim();
}

/** How the dialogue shows an aside: a known tag in the game's language, anything else as written. */
export function asideLabel(
  part: Extract<LinePart, { kind: "aside" }>,
  lang: Lang,
): string {
  return part.tag ? TAGS[part.tag][lang] : part.text;
}

/** The model a line is spoken with, and the text it is sent; `tags: false` keeps everything on Flash. */
export function voicing(
  text: string,
  tags = true,
): { model: string; text: string } {
  const acted = tags && hasTags(text);
  return {
    model: acted ? TAG_MODEL : FLASH_MODEL,
    text: spokenText(text, acted),
  };
}

/**
 * The request for one clip, the same from the browser and from the demo function. 128 kbps: the
 * same credits as 64, and no codec smear on top of whatever the voice already has. v4 takes
 * stability as a setting of the dialogue; 0.5 is its "natural", between creative and robust.
 */
export function speechRequest(
  key: string,
  voiceId: string,
  text: string,
  lang: Lang,
  model: string,
): [string, { method: "POST"; headers: Record<string, string>; body: string }] {
  const headers = { "xi-api-key": key, "Content-Type": "application/json" };
  if (model === TAG_MODEL) {
    return [
      "https://api.elevenlabs.io/v1/text-to-dialogue?output_format=mp3_44100_128",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          inputs: [{ text, voice_id: voiceId }],
          model_id: model,
          language_code: lang,
          settings: { stability: 0.5 },
        }),
      },
    ];
  }
  return [
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        text,
        model_id: model,
        language_code: lang,
        voice_settings: { stability: 0.45, similarity_boost: 0.75 },
      }),
    },
  ];
}

/** A v4 answer that is about the model, not the moment: anything but a rate limit or their outage. */
export function refusedModel(status: number): boolean {
  return status >= 400 && status < 500 && status !== 429;
}
