/*
 * One night's two halves on one card.
 *
 * They are separate records — see `climate.ts` — but they are not separate errands: at 21:00 the
 * temperature and the window are blank and the verdict is not yet knowable, and at 07:00 it is the
 * other way round. So the card shows both, and whichever is blank is the one you came to fill in.
 *
 * The verdict buttons commit on the tap rather than waiting for Save. There is nothing to check and
 * nothing to combine — it is one of three values, and a morning with a baby is not the moment for a
 * second tap. The temperature does have to be parsed, so its half keeps a Save.
 */

import { useEffect, useState } from 'react';

import type { EveningDraft, NightVerdict, WindowState } from '../../utils/babySleep/climate';
import { VERDICTS, WINDOW_STATES, parseTemp } from '../../utils/babySleep/climate';
import type { NightObservation } from '../../utils/babySleep/climateStats';
import type { Translation } from './translations';

interface ClimateFormProps {
  /** `yyyy-mm-dd` of the night being logged. */
  night: string;
  /** What is already logged for it, if anything. */
  logged: NightObservation | null;
  title: string;
  onNight: (night: string) => void;
  onEvening: (draft: EveningDraft) => void;
  onVerdict: (verdict: NightVerdict | null) => void;
  onDone?: () => void;
  t: Translation;
}

export default function ClimateForm({
  night,
  logged,
  title,
  onNight,
  onEvening,
  onVerdict,
  onDone,
  t,
}: ClimateFormProps) {
  const [temp, setTemp] = useState('');
  const [window, setWindow] = useState<WindowState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  /*
   * The fields follow the night. Changing the date, or a sync arriving with the other parent's
   * entry, has to redraw them — a form still showing last night's 11° over a date field reading
   * tonight is how you overwrite a good record with a stale one.
   */
  useEffect(() => {
    setTemp(logged?.tempC != null ? String(logged.tempC) : '');
    setWindow(logged?.window ?? null);
    setError(null);
    setSaved(false);
  }, [night, logged?.tempC, logged?.window]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseTemp(temp);
    if (!parsed.ok) {
      setError(parsed.error === 'not-a-number' ? t.climateErrTemp : t.climateErrRange);
      return;
    }
    setError(null);
    setSaved(true);
    onEvening({ tempC: parsed.tempC, window });
    onDone?.();
  };

  const chooseVerdict = (verdict: NightVerdict) => {
    // Tapping the verdict already showing means "no, I mis-tapped" — it clears rather than
    // re-writing the same value, which is the only way back from a wrong tap on a three-way choice.
    onVerdict(logged?.verdict === verdict ? null : verdict);
  };

  return (
    <form className="bs-form bs-climate-form" onSubmit={submit}>
      <h2 className="bs-subhead">{title}</h2>

      <div className="bs-field">
        <label className="bs-field-label" htmlFor={`climate-night-${night}`}>
          {t.climateNight}
        </label>
        <input
          id={`climate-night-${night}`}
          type="date"
          className="bs-date"
          value={night}
          onChange={(e) => e.target.value && onNight(e.target.value)}
        />
      </div>

      <div className="bs-field">
        <label className="bs-field-label" htmlFor={`climate-temp-${night}`}>
          {t.climateTemp}
        </label>
        <div className="bs-temp-field">
          <input
            id={`climate-temp-${night}`}
            type="text"
            className="bs-temp"
            /* `text` with a numeric mode rather than `type="number"`: the spinner is useless on a
               phone, and a minus sign is one keystroke away here instead of behind a keypad toggle. */
            inputMode="text"
            autoComplete="off"
            placeholder="—"
            value={temp}
            onChange={(e) => setTemp(e.target.value)}
          />
          <span className="bs-temp-unit">{t.climateTempUnit}</span>
        </div>
        <p className="bs-hint">{t.climateTempHint}</p>
      </div>

      <div className="bs-field">
        <span className="bs-field-label">{t.climateWindow}</span>
        <div className="bs-toggle">
          {WINDOW_STATES.map((state) => (
            <button
              key={state}
              type="button"
              className={`bs-toggle-btn${window === state ? ' bs-toggle-btn--on' : ''}`}
              aria-pressed={window === state}
              onClick={() => setWindow(window === state ? null : state)}
            >
              {state === 'open' ? t.windowOpen : t.windowClosed}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="bs-error" role="alert">
          {error}
        </p>
      )}

      <div className="bs-form-actions">
        <button type="submit" className="bs-action">
          {t.climateSave}
        </button>
        {saved && !error && <span className="bs-saved">{t.climateSaved}</span>}
      </div>

      <div className="bs-field">
        <span className="bs-field-label">{t.climateVerdict}</span>
        <div className="bs-toggle bs-verdicts">
          {VERDICTS.map((verdict) => (
            <button
              key={verdict}
              type="button"
              className={`bs-toggle-btn bs-verdict bs-verdict--${verdict}${
                logged?.verdict === verdict ? ' bs-toggle-btn--on' : ''
              }`}
              aria-pressed={logged?.verdict === verdict}
              onClick={() => chooseVerdict(verdict)}
            >
              {verdict === 'cold' ? t.verdictCold : verdict === 'ok' ? t.verdictOk : t.verdictWarm}
            </button>
          ))}
        </div>
      </div>
    </form>
  );
}
