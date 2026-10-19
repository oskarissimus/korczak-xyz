/*
 * Every line said in this quest, in order, for the developer console (owner, Oct 2026: "the whole
 * history of the lines spoken, because sometimes I am working out whether the narration and the
 * dialogue hold together"). What the characters said, what the hunter asked and decided, what the
 * clues read, and where each step began, so a quest can be read back as the player met it.
 *
 * A line shown again (the menu after a question goes back to the story's last part) is recorded
 * once per beat, as the voice reads it once. Kept in the autosave, so it survives Continue; cleared
 * when a quest starts.
 */

export type TranscriptKind = "beat" | "npc" | "ask" | "decision" | "clue";

export interface TranscriptLine {
  kind: TranscriptKind;
  /** The beat it was said in, from 0. */
  beat: number;
  /** A character, a clue's name, or the step's title. */
  speaker: string;
  text: string;
}

/** Enough for a long quest; the oldest go first beyond it. */
const LIMIT = 600;

let lines: TranscriptLine[] = [];
let version = 0;
const listeners = new Set<() => void>();

function changed() {
  version += 1;
  for (const l of listeners) l();
}

export function subscribeTranscript(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function transcriptVersion(): number {
  return version;
}

export function transcript(): readonly TranscriptLine[] {
  return lines;
}

/** Adds `line`, unless the same thing was already said by the same speaker in the same beat. */
export function recordLine(line: TranscriptLine): void {
  const text = line.text.trim();
  if (!text) return;
  if (lines.some((l) => l.beat === line.beat && l.kind === line.kind && l.speaker === line.speaker && l.text === text)) return;
  lines = [...lines, { ...line, text }].slice(-LIMIT);
  changed();
}

/** A new quest starts empty; a resumed one starts from its save. */
export function resetTranscript(saved: readonly TranscriptLine[] = []): void {
  lines = saved
    .filter(
      (l) => l && typeof l.text === "string" && typeof l.speaker === "string",
    )
    .slice(-LIMIT);
  changed();
}
