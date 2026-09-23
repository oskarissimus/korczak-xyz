/*
 * The player, which is one button and the name of what it is playing.
 *
 * No scrubber, no timeline, no volume. This is listened to while walking, with the phone in a
 * pocket or held at arm's length — the whole interaction is start, stop, hear it again — and
 * every control added is another thing to hit by mistake with a thumb while looking at a
 * building. The phone's own volume buttons work.
 *
 * The state is a word as well as an icon. A triangle and two bars are only distinguishable if you
 * can see them, and this is read outdoors in daylight.
 *
 * Under it, where the facts came from. The narration is made only of facts checked against these,
 * and a listener who doubts one can read the source rather than take a machine's word for it.
 */

import { sourceLabel } from '../../utils/audioGuide/narration';
import type { Translation } from './translations';

interface PlayerBarProps {
  name: string;
  playing: boolean;
  ended: boolean;
  locationWarning: boolean;
  sources: string[];
  onToggle: () => void;
  onClose: () => void;
  t: Translation;
}

export default function PlayerBar({
  name,
  playing,
  ended,
  locationWarning,
  sources,
  onToggle,
  onClose,
  t,
}: PlayerBarProps) {
  const action = playing ? t.pause : ended ? t.replay : t.play;
  const state = playing ? t.playing : ended ? t.finished : t.paused;

  return (
    <div className="ag-player">
      <div className="ag-player-row">
        <button
          type="button"
          className="ag-play"
          onClick={onToggle}
          aria-label={`${action}: ${name}`}
        >
          <span className="ag-play-glyph" aria-hidden="true">
            {playing ? '❚❚' : '▶'}
          </span>
        </button>

        <div className="ag-player-text">
          <span className="ag-player-name">{name}</span>
          <span className="ag-player-state">{state}</span>
        </div>

        <button type="button" className="ag-player-close" onClick={onClose} aria-label={t.close}>
          ×
        </button>
      </div>

      {sources.length > 0 && (
        <p className="ag-sources">
          {t.sourcesLabel}{' '}
          {sources.map((link, i) => (
            <span key={link}>
              {i > 0 && ' · '}
              <a href={link} target="_blank" rel="noopener noreferrer">
                {sourceLabel(link)}
              </a>
            </span>
          ))}
        </p>
      )}

      {locationWarning && <p className="ag-warning">{t.locationWarning}</p>}
    </div>
  );
}
