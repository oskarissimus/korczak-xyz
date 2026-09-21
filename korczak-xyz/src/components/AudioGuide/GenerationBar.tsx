/*
 * The twenty seconds between the tap and the voice.
 *
 * It is a progress bar over an operation with no progress to report — see `progress.ts` for why
 * that is honest rather than a lie — and it is here at all because the alternative on a phone is
 * a screen that does nothing for twenty seconds, which people read as a broken app and tap again.
 *
 * The Cancel button is the point of the whole component. Tapping the wrong pin in a dense square
 * is easy, and without a way out the reader waits for a guide to somewhere they did not mean.
 */

import { useEffect, useState } from 'react';

import { progressAt, SLOW_MS, stageAt, type Stage } from '../../utils/audioGuide/progress';
import type { Translation } from './translations';

interface GenerationBarProps {
  startedAt: number;
  name: string;
  onCancel: () => void;
  t: Translation;
}

const TICK_MS = 250;

function stageLabel(stage: Stage, t: Translation): string {
  switch (stage) {
    case 'researching':
      return t.stageResearching;
    case 'writing':
      return t.stageWriting;
    case 'speaking':
      return t.stageSpeaking;
    case 'finishing':
      return t.stageFinishing;
  }
}

export default function GenerationBar({ startedAt, name, onCancel, t }: GenerationBarProps) {
  const [elapsed, setElapsed] = useState(() => Date.now() - startedAt);

  /*
   * An interval rather than requestAnimationFrame. A bar that crosses the screen in twenty
   * seconds moves about a pixel every fifty milliseconds, so sixty frames a second buys nothing
   * visible — and this runs on a phone in someone's hand, outdoors, where the battery matters
   * more than the smoothness. It also keeps ticking with the tab backgrounded, where rAF stops.
   */
  useEffect(() => {
    setElapsed(Date.now() - startedAt);
    const id = setInterval(() => setElapsed(Date.now() - startedAt), TICK_MS);
    return () => clearInterval(id);
  }, [startedAt]);

  const progress = progressAt(elapsed);
  const percent = Math.round(progress * 100);

  return (
    <div className="ag-generating">
      <div className="ag-generating-head">
        <span className="ag-generating-title">{t.generating}</span>
        <span className="ag-generating-name">{name}</span>
      </div>

      <div
        className="ag-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={t.generating}
      >
        <div className="ag-progress-fill" style={{ width: `${percent}%` }} />
      </div>

      {/* The words are the state, the bar only confirms it — the same rule the charts follow. */}
      <p className="ag-generating-stage">{stageLabel(stageAt(progress), t)}</p>

      {elapsed > SLOW_MS && <p className="ag-note">{t.slow}</p>}

      <button type="button" className="retro-btn ag-cancel" onClick={onCancel}>
        {t.cancel}
      </button>
    </div>
  );
}
