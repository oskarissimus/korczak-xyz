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
 */

import type { Translation } from './translations';

interface PlayerBarProps {
  name: string;
  playing: boolean;
  ended: boolean;
  locationWarning: boolean;
  onToggle: () => void;
  onClose: () => void;
  t: Translation;
}

export default function PlayerBar({
  name,
  playing,
  ended,
  locationWarning,
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

      {locationWarning && <p className="ag-warning">{t.locationWarning}</p>}
    </div>
  );
}
