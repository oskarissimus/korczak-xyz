/**
 * Adding or editing one leg.
 *
 * Two `<select>`s over the station tables rather than free text, and that is the whole of the
 * validation story: a station you cannot type is a station that cannot fail to resolve, and the one
 * error left — two stations on different lines — is impossible to reach from this form once the
 * line picker filters both lists.
 *
 * The error message stays anyway. `normalizeSegment` is the choke point every write goes through
 * and it can refuse for a reason this form cannot cause today: a leg edited on a build that knew a
 * station this one has since dropped. Silently doing nothing on save is the one outcome that must
 * not happen.
 */
import { useState, type FormEvent } from 'react';
import { STATIONS } from '../../utils/transit/lines';
import { defaultLabel, type SegmentDraft } from '../../utils/transit/segments';
import { METRO_LINES, type MetroLine, type WatchedSegment } from '../../utils/transit/types';
import { translations, type Lang } from './translations';

interface Props {
  lang: Lang;
  /** The leg being edited, or undefined to add one. */
  editing?: WatchedSegment;
  /** Returns false when the draft was refused; the form then shows why and stays open. */
  onSave: (draft: SegmentDraft) => boolean;
  onCancel: () => void;
}

export default function SegmentForm({ lang, editing, onSave, onCancel }: Props) {
  const t = translations[lang];
  const [line, setLine] = useState<MetroLine>(editing?.line ?? 'M1');
  const [from, setFrom] = useState(editing?.from ?? STATIONS.M1[0]);
  const [to, setTo] = useState(editing?.to ?? STATIONS.M1[1]);
  const [label, setLabel] = useState(editing?.label ?? '');
  const [failed, setFailed] = useState(false);

  /* Changing the line invalidates both endpoints, so both are reset to that line's own ends. */
  const chooseLine = (next: MetroLine) => {
    setLine(next);
    setFrom(STATIONS[next][0]);
    setTo(STATIONS[next][STATIONS[next].length - 1]);
    setFailed(false);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const ok = onSave({ label: label.trim(), line, from, to, muted: editing?.muted });
    if (!ok) setFailed(true);
  };

  return (
    <form className="ev-form tr-form" onSubmit={submit}>
      <label className="ev-field">
        <span className="ev-field-label">{t.fieldLine}</span>
        <select
          className="ev-input"
          value={line}
          onChange={(e) => chooseLine(e.target.value as MetroLine)}
        >
          {METRO_LINES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>

      <label className="ev-field">
        <span className="ev-field-label">{t.fieldFrom}</span>
        <select className="ev-input" value={from} onChange={(e) => setFrom(e.target.value)}>
          {STATIONS[line].map((station) => (
            <option key={station} value={station}>
              {station}
            </option>
          ))}
        </select>
      </label>

      <label className="ev-field">
        <span className="ev-field-label">{t.fieldTo}</span>
        <select className="ev-input" value={to} onChange={(e) => setTo(e.target.value)}>
          {STATIONS[line].map((station) => (
            <option key={station} value={station}>
              {station}
            </option>
          ))}
        </select>
      </label>

      <label className="ev-field">
        <span className="ev-field-label">{t.fieldLabel}</span>
        <input
          className="ev-input"
          type="text"
          value={label}
          placeholder={defaultLabel(line, from, to)}
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>

      {failed ? <p className="ev-error">{t.invalidLeg}</p> : null}

      <p className="ev-actions">
        <button type="submit" className="ev-action ev-action--primary">
          {t.save}
        </button>
        <button type="button" className="ev-action" onClick={onCancel}>
          {t.cancel}
        </button>
      </p>
    </form>
  );
}
