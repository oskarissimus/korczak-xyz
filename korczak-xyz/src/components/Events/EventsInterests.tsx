/**
 * The Interests tab: what to watch for.
 *
 * The island owns only which interest is in the one form slot; everything else lives in
 * `useEventInterests`.
 */
import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useEventInterests } from '../../hooks/useEventInterests';
import type { InterestDraft } from '../../utils/events/interests';
import type { Interest } from '../../utils/events/types';
import EventsGate from './EventsGate';
import InterestForm from './InterestForm';
import SyncBadge from './SyncBadge';
import { fill, translations, type Lang } from './translations';
import { countryLabel } from '../../utils/events/countries';

interface Props {
  lang: Lang;
}

export default function EventsInterests({ lang }: Props) {
  const auth = useAuth();
  return (
    <EventsGate auth={auth} lang={lang} path="/interests/">
      <InterestsPanel lang={lang} />
    </EventsGate>
  );
}

/** Split out so the hooks below only ever run for a signed-in user. */
function InterestsPanel({ lang }: Props) {
  const auth = useAuth();
  const data = useEventInterests(auth.user);
  const t = translations[lang];
  const [editing, setEditing] = useState<'new' | string | null>(null);

  if (!data.ready) return <div className="ev-loading" />;

  const current =
    editing && editing !== 'new' ? data.interests.find((i) => i.id === editing) : undefined;

  const submit = (draft: InterestDraft) => {
    if (editing === 'new') data.addInterest(draft);
    else if (editing) data.updateInterest(editing, draft);
    setEditing(null);
  };

  return (
    <div className="ev-interests">
      <section className="ev-section">
        <h2 className="ev-subhead">{t.interestsHeading}</h2>
        <p className="ev-note">{t.interestsIntro}</p>
        <SyncBadge sync={data.sync} lang={lang} onRetry={data.retrySync} />
      </section>

      {editing ? (
        <InterestForm
          lang={lang}
          existing={current}
          onSubmit={submit}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <div className="ev-actions">
          <button
            type="button"
            className="ev-action ev-action--primary"
            onClick={() => setEditing('new')}
          >
            {t.addInterest}
          </button>
        </div>
      )}

      <ul className="ev-list">
        {data.interests.map((interest) => (
          <InterestRow
            key={interest.id}
            interest={interest}
            lang={lang}
            onEdit={() => setEditing(interest.id)}
            onToggleMute={() => data.setMuted(interest.id, !interest.muted)}
            onRemove={() => {
              if (window.confirm(fill(t.confirmDelete, { label: interest.label }))) {
                data.removeInterest(interest.id);
              }
            }}
          />
        ))}
      </ul>
    </div>
  );
}

function InterestRow({
  interest,
  lang,
  onEdit,
  onToggleMute,
  onRemove,
}: {
  interest: Interest;
  lang: Lang;
  onEdit: () => void;
  onToggleMute: () => void;
  onRemove: () => void;
}) {
  const t = translations[lang];
  /*
   * The countries belong here as much as the keywords do. Left off, an interest that quietly drops
   * four conferences a week looks exactly like one that constrains nothing — which is the failure
   * this whole axis was added to make visible, reappearing one screen along.
   *
   * `@` for both a city and a country, since both answer "where" and a two-letter code does not
   * read as a city name. `+` for the international clause, because it is a second way to pass
   * rather than a second thing to satisfy.
   */
  const rules = [
    ...interest.keywords,
    ...(interest.tags ?? []).map((tag) => `#${tag}`),
    ...(interest.cities ?? []).map((city) => `@${city}`),
    ...(interest.countries ?? []).map((code) => `@${countryLabel(code)}`),
    ...(interest.internationalAnywhere ? [`+${t.reachInternational}`] : []),
    /*
     * Only when it is on, unlike the rules above it — this is the one filter that runs whether or
     * not an interest mentions it, so what is worth showing is the interest that has turned it
     * off. A chip on every row saying "and not press releases" would be a rule nobody set.
     */
    ...(interest.includeCoverage ? [`+${t.kindCoverage}`] : []),
  ];

  return (
    <li className={`ev-interest${interest.muted ? ' ev-interest--muted' : ''}`}>
      <div className="ev-interest-head">
        <h3 className="ev-interest-name">{interest.label}</h3>
        <div className="ev-actions">
          <button type="button" className="ev-link" onClick={onEdit}>
            {t.editInterest}
          </button>
          <button type="button" className="ev-link" onClick={onToggleMute}>
            {interest.muted ? t.unmuteInterest : t.muteInterest}
          </button>
          <button type="button" className="ev-link" onClick={onRemove}>
            {t.deleteInterest}
          </button>
        </div>
      </div>

      <div className="ev-interest-rules">
        {rules.length === 0 ? (
          <span className="ev-hint">—</span>
        ) : (
          rules.map((rule) => (
            <span className="ev-chip" key={rule}>
              {rule}
            </span>
          ))
        )}
      </div>

      {interest.excludeKeywords?.length ? (
        <p className="ev-hint">
          {t.fieldExclude}: {interest.excludeKeywords.join(', ')}
        </p>
      ) : null}

      <p className="ev-hint">
        {t.fieldLead}: {interest.leadDays}
        {interest.muted ? ` · ${t.mutedNote}` : ''}
      </p>
    </li>
  );
}
