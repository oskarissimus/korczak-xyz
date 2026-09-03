/**
 * The My route tab: which stretches of which lines are the journey.
 *
 * This is the app's one piece of configuration, and the shape of it is the point. A leg is a line
 * and two stations and it means **every station between them** — so the seeded way home is two
 * rows, Rondo Daszyńskiego → Świętokrzyska on M2 and Świętokrzyska → Imielin on M1, because a
 * journey with a change is two rides and a closure at Rondo ONZ belongs to the first of them.
 *
 * Muting is here rather than in the alert settings on purpose: it is a fact about one leg ("I know
 * about the works on this stretch, stop shouting"), not about the app. A muted leg still matches
 * and still shows in the feed's route section — it simply cannot raise an alert to the loud kind.
 */
import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useTransitSegments } from '../../hooks/useTransitSegments';
import { segmentLength, segmentStations } from '../../utils/transit/segments';
import type { WatchedSegment } from '../../utils/transit/types';
import SegmentForm from './SegmentForm';
import SyncBadge from './SyncBadge';
import TransitGate from './TransitGate';
import { fill, translations, type Lang } from './translations';

interface Props {
  lang: Lang;
}

export default function TransitRoutes({ lang }: Props) {
  const auth = useAuth();
  return (
    <TransitGate auth={auth} lang={lang} path="/routes">
      <RoutesPanel lang={lang} />
    </TransitGate>
  );
}

function RoutesPanel({ lang }: Props) {
  const auth = useAuth();
  const routes = useTransitSegments(auth.user);
  const t = translations[lang];
  /** `null` for closed, `'new'` for the add form, or the id being edited. */
  const [editing, setEditing] = useState<string | null>(null);

  const save = (draft: Parameters<typeof routes.addSegment>[0], id: string | null): boolean => {
    const ok = id && id !== 'new' ? routes.updateSegment(id, draft) : routes.addSegment(draft);
    if (ok) setEditing(null);
    return ok;
  };

  return (
    <div className="ev-interests tr-routes">
      <section className="ev-section">
        <h2 className="ev-subhead">{t.routesHeading}</h2>
        <p className="ev-note">{t.routesIntro}</p>
        <SyncBadge sync={routes.sync} lang={lang} onRetry={routes.retrySync} />
      </section>

      {routes.segments.length === 0 && editing === null ? (
        <p className="ev-empty">{t.routesEmpty}</p>
      ) : null}

      <div className="ev-list">
        {routes.segments.map((segment) =>
          editing === segment.id ? (
            <SegmentForm
              key={segment.id}
              lang={lang}
              editing={segment}
              onSave={(draft) => save(draft, segment.id)}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <SegmentRow
              key={segment.id}
              segment={segment}
              lang={lang}
              onEdit={() => setEditing(segment.id)}
              onMute={() => routes.setMuted(segment.id, !segment.muted)}
              onRemove={() => routes.removeSegment(segment.id)}
            />
          ),
        )}
      </div>

      {editing === 'new' ? (
        <SegmentForm
          lang={lang}
          onSave={(draft) => save(draft, null)}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <p className="ev-actions">
          <button
            type="button"
            className="ev-action ev-action--primary"
            onClick={() => setEditing('new')}
          >
            {t.addLeg}
          </button>
        </p>
      )}
    </div>
  );
}

function SegmentRow({
  segment,
  lang,
  onEdit,
  onMute,
  onRemove,
}: {
  segment: WatchedSegment;
  lang: Lang;
  onEdit: () => void;
  onMute: () => void;
  onRemove: () => void;
}) {
  const t = translations[lang];
  const stations = segmentStations(segment);

  return (
    <article className={`ev-interest tr-leg${segment.muted ? ' ev-interest--muted' : ''}`}>
      <div className="ev-interest-head">
        <span className="ev-interest-name">{segment.label}</span>
        <span className={`tr-line tr-line--${segment.line.toLowerCase()}`}>{segment.line}</span>
        {segment.muted ? <span className="ev-chip">{t.muted}</span> : null}
      </div>

      {/*
        * Every station, not just the endpoints. The interval *is* the rule, and a row that showed
        * only its ends would leave the reader guessing whether Rondo ONZ counts — which is exactly
        * the question this app exists to answer without guessing.
        */}
      <p className="ev-interest-rules tr-stations">
        {stations.map((station) => (
          <span key={station} className="tr-stop">
            {station}
          </span>
        ))}
      </p>
      <p className="ev-card-sub">{fill(t.stops, { count: segmentLength(segment) })}</p>

      <p className="ev-actions">
        <button type="button" className="ev-link" onClick={onEdit}>
          {t.editLeg}
        </button>
        <button type="button" className="ev-link" onClick={onMute}>
          {segment.muted ? t.unmuteLeg : t.muteLeg}
        </button>
        <button type="button" className="ev-link" onClick={onRemove}>
          {t.removeLeg}
        </button>
      </p>
    </article>
  );
}
