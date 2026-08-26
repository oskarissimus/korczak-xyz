/*
 * The line under a chart that says what the pointer is on.
 *
 * Three rules, and each one is a mistake this repo has already made somewhere else:
 *
 *   1. **The line reserves its own height.** A readout that appears and disappears is a row that
 *      grows and shrinks, which moves the chart under the finger that is scrubbing it. Same
 *      discipline as the typing trainer's sync slot, and for the same reason.
 *   2. **Idle shows a hint, not data.** An empty reserved line and a feature that is not working
 *      look identical, and on a phone there is otherwise nothing at all to say the chart can be
 *      asked a question. So the idle state is an instruction, dimmed — never a stale reading, since
 *      one slot meaning two things is exactly what makes an indicator unreadable.
 *   3. **Nothing here may clip.** It wraps. A truncated value is the one output this line must not
 *      produce, and these strings are long in Polish.
 *
 * `aria-live="polite"` rather than a role: the chart keeps `role="img"` and its `aria-label`, so
 * this is an announcement beside the picture, not a replacement for it.
 */

interface ChartReadoutProps {
  /** What the pointer is on, or null when it is not on anything. */
  text: string | null;
  /** What to say instead — how to use the chart, not what is in it. */
  hint: string;
}

export default function ChartReadout({ text, hint }: ChartReadoutProps) {
  return (
    <p className={`chart-readout${text ? '' : ' chart-readout--idle'}`} aria-live="polite">
      {text ?? hint}
    </p>
  );
}
