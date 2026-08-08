/*
 * The card front for a `name` card: the songbook's chord-diagram notation with one dot on it.
 *
 * The renderer marks its ink with `●` and nothing else, so painting is a split on that one
 * character — the same trick `ChordShapes.astro` plays with a regex, minus the HTML escaping,
 * because here React does it.
 */

import { renderNoteDiagram } from '../../utils/fretboard/diagram';
import type { Notation } from '../../utils/fretboard/notes';

interface NoteCardProps {
  stringIndex: number;
  fret: number;
  stringLabels: boolean;
  notation: Notation;
  /**
   * What the diagram says, for anyone not reading it as a picture. It names the position, not
   * the note — that is the question, and reading out the answer would be a strange kind of help.
   */
  label: string;
}

function DiagramLine({ line }: { line: string }) {
  const parts = line.split('●');
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && <span className="fb-dot">●</span>}
          {part}
        </span>
      ))}
    </>
  );
}

export default function NoteCard({
  stringIndex,
  fret,
  stringLabels,
  notation,
  label,
}: NoteCardProps) {
  const lines = renderNoteDiagram(stringIndex, fret, { stringLabels, notation });
  return (
    <pre className="fb-diagram" role="img" aria-label={label}>
      {lines.map((line, i) => (
        <span key={i}>
          <DiagramLine line={line} />
          {i < lines.length - 1 ? '\n' : ''}
        </span>
      ))}
    </pre>
  );
}
