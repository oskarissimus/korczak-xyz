/*
 * The config tab: what bedtime is aiming at.
 *
 * One setting so far — the clock time he should be in the crib by, which is the moment the routine
 * ends. It is the log's only *intention*, and it is here rather than on the stats page because the
 * stats page answers what happened and this answers what was meant to happen; mixing a control that
 * changes the goalposts into a page of measurements invites moving them until the measurements look
 * better.
 *
 * The field is committed by a button rather than on change. A `<input type="time">` fires on every
 * keystroke and on every spin of a native picker, so committing as it moves would push a document
 * per intermediate hour — and each of those is a write the other parent's phone pulls.
 *
 * The window setting on the stats page is deliberately *not* moved here: that is which range this
 * browser is looking at, a preference belonging to nobody, while everything on this tab is the
 * household's and syncs. See `targets.ts`.
 */

import { useEffect, useState } from 'react';

import { useAuth } from '../../hooks/useAuth';
import { useDataOwner } from '../../hooks/useDataOwner';
import { useSleepTargets } from '../../hooks/useSleepTargets';
import { formatClock, minutesFromTimeInput } from '../../utils/babySleep/format';
import SyncBadge from './SyncBadge';
import { fill, translations, type Lang } from './translations';

interface BabySleepConfigProps {
  lang: Lang;
}

export default function BabySleepConfig({ lang }: BabySleepConfigProps) {
  const t = translations[lang];
  const { user } = useAuth();
  const owner = useDataOwner(user);
  const { ready, cribMinutes, sync, setCribMinutes, retrySync } = useSleepTargets(user, owner);

  const [field, setField] = useState('');
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);

  /*
   * The stored target fills the field — on load, and again when a pull brings the other parent's
   * value in. Typing is not interrupted by that: what arrives is a value somebody deliberately set,
   * and the alternative is a field that goes on showing a number the log no longer holds.
   */
  useEffect(() => {
    setField(cribMinutes == null ? '' : formatClock(cribMinutes));
    setError(false);
  }, [cribMinutes]);

  const commit = (event: React.FormEvent) => {
    event.preventDefault();
    const minutes = minutesFromTimeInput(field);
    if (minutes == null) {
      setError(true);
      setSaved(false);
      return;
    }
    setError(false);
    setSaved(true);
    setCribMinutes(minutes);
  };

  const clear = () => {
    setError(false);
    setSaved(false);
    setCribMinutes(null);
  };

  if (!ready) return <div className="bs-loading" />;

  return (
    <div className="bs-config">
      <p className="bs-hint">{t.configIntro}</p>

      <form className="bs-form" onSubmit={commit}>
        <h2 className="bs-subhead">{t.configTargetTitle}</h2>

        <div className="bs-field">
          <label className="bs-field-label" htmlFor="bs-crib-target">
            {t.configCribTarget}
          </label>
          {/* `.bs-when` for the width cap it puts on a time input, which is otherwise 100% of a
              form that is as wide as the window. */}
          <div className="bs-when">
            <input
              id="bs-crib-target"
              type="time"
              className="bs-time"
              value={field}
              onChange={(e) => {
                setField(e.target.value);
                setSaved(false);
              }}
            />
          </div>
        </div>

        <p className="bs-hint">{t.configCribHint}</p>

        {error && (
          <p className="bs-error" role="alert">
            {t.configErrTime}
          </p>
        )}
        {saved && !error && (
          <p className="bs-note" role="status">
            {cribMinutes == null
              ? t.configSaved
              : fill(t.configSavedAt, { time: formatClock(cribMinutes) })}
          </p>
        )}

        <div className="bs-form-actions">
          <button type="submit" className="bs-action">
            {t.save}
          </button>
          {cribMinutes != null && (
            <button type="button" className="bs-action" onClick={clear}>
              {t.configClear}
            </button>
          )}
        </div>
      </form>

      <p className="bs-note">{t.configNote}</p>

      <SyncBadge sync={sync} onRetry={retrySync} t={t} />
    </div>
  );
}
