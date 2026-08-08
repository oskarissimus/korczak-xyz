/*
 * The verdict, drawn over the box the card is answered in.
 *
 * The written verdict under the card is precise but small, and it is read *after* the answer —
 * by which time a correct card has 700ms left before the next one. What is wanted at a glance is
 * the maru/batsu pair: a ring with a tick inside it, or a ring with a cross. So this is drawn
 * over the diagram (a `name` card) or the neck (a `find` card), at the size of the box itself.
 *
 * It is an SVG rather than the `✓`/`✕` characters for the reason `chordMarks.css` explains at
 * length: neither glyph is in VT323, so both arrive from whatever fallback the platform has, at
 * whatever size and weight that font draws them. Here they would also have to be centred over a
 * grid, which a glyph with an unknown bearing cannot be.
 *
 * No fill: the marks under it are the rest of the answer — which frets sound the note, which one
 * was pressed — and a disc would hide exactly those. Legibility over the navy comes from the
 * drop shadow in the stylesheet instead.
 */

interface VerdictProps {
  correct: boolean;
}

export default function Verdict({ correct }: VerdictProps) {
  return (
    /* aria-hidden throughout: `.fb-feedback` is the live region, and it says the same thing in
       words. Announcing it twice is worse than not drawing it at all. */
    <span className="fb-verdict-overlay" aria-hidden="true">
      <svg
        className={`fb-verdict-mark ${correct ? 'fb-verdict-mark--ok' : 'fb-verdict-mark--bad'}`}
        viewBox="0 0 100 100"
        focusable="false"
      >
        <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="7" />
        {correct ? (
          <path
            d="M30 51 L44 66 L71 35"
            fill="none"
            stroke="currentColor"
            strokeWidth="9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <path
            d="M35 35 L65 65 M65 35 L35 65"
            fill="none"
            stroke="currentColor"
            strokeWidth="9"
            strokeLinecap="round"
          />
        )}
      </svg>
    </span>
  );
}
