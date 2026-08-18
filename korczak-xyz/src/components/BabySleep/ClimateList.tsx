/*
 * The nights already logged, newest first — and, as much as anything, the prompt to finish the ones
 * that are only half done. A row with a temperature and no verdict is a morning nobody answered, and
 * it is worth nothing to the chart until somebody does.
 */

import { authorLabel } from '../../utils/babySleep/format';
import type { NightObservation } from '../../utils/babySleep/climateStats';
import { fill, type Translation } from './translations';

interface ClimateListProps {
  nights: NightObservation[];
  /**
   * Who is reading. Nights logged by anyone else are named; the reader's own are not — on a log
   * shared between two people, labelling every row is noise.
   */
  viewer: string | null;
  formatDay: (t: number) => string;
  formatTemp: (v: number) => string;
  onEdit: (night: string) => void;
  onClear: (night: string) => void;
  t: Translation;
}

export default function ClimateList({
  nights,
  viewer,
  formatDay,
  formatTemp,
  onEdit,
  onClear,
  t,
}: ClimateListProps) {
  if (nights.length === 0) {
    return <p className="bs-hint">{t.climateEmpty}</p>;
  }

  const verdictLabel = (night: NightObservation) => {
    if (night.verdict === 'cold') return t.verdictCold;
    if (night.verdict === 'ok') return t.verdictOk;
    if (night.verdict === 'warm') return t.verdictWarm;
    return null;
  };

  return (
    <ul className="bs-entries bs-climate-rows">
      {nights.map((night) => {
        const verdict = verdictLabel(night);
        const other = night.authorEmail && night.authorEmail !== viewer ? night.authorEmail : null;
        return (
          <li
            key={night.night}
            className={`bs-entry bs-climate-row${
              night.verdict ? ` bs-climate-row--${night.verdict}` : ''
            }`}
          >
            <span className="bs-climate-date">{formatDay(night.at)}</span>
            <span className="bs-climate-temp">
              {night.tempC != null ? `${formatTemp(night.tempC)}°` : t.climateNotLogged}
            </span>
            <span className="bs-climate-window">
              {night.window === 'open'
                ? t.windowOpen
                : night.window === 'closed'
                  ? t.windowClosed
                  : t.climateNotLogged}
            </span>
            <span className="bs-climate-verdict">{verdict ?? t.climateVerdictMissing}</span>
            {other && <span className="bs-entry-author">{fill(t.loggedBy, { name: authorLabel(other) })}</span>}
            <span className="bs-entry-actions">
              <button type="button" className="bs-action" onClick={() => onEdit(night.night)}>
                {t.climateEdit}
              </button>
              <button type="button" className="bs-action" onClick={() => onClear(night.night)}>
                {t.climateClear}
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
