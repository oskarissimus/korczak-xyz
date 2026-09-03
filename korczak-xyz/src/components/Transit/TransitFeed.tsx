/**
 * The Now tab: what is happening on the metro, arranged by how much of it is yours.
 *
 * Also where the push subscription is re-verified, for the reason it is on the events app's feed:
 * iOS drops subscriptions silently after a few weeks and fires no `pushsubscriptionchange`, so the
 * only defence is checking on launch — and this is the tab the icon opens.
 */
import { useMemo, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useTransitFeed } from '../../hooks/useTransitFeed';
import { useTransitSegments } from '../../hooks/useTransitSegments';
import { useWebPush } from '../../hooks/useWebPush';
import { buildTransitFeed, type SectionKey } from '../../utils/transit/feed';
import { loadShowOther, saveShowOther } from '../../utils/transit/browser/storage';
import type { FeedKind } from '../../utils/transit/types';
import NoticeCard from './NoticeCard';
import TransitGate from './TransitGate';
import { fill, translations, type Lang } from './translations';

interface Props {
  lang: Lang;
}

export default function TransitFeed({ lang }: Props) {
  const auth = useAuth();
  return (
    <TransitGate auth={auth} lang={lang} path="/">
      <FeedPanel lang={lang} />
    </TransitGate>
  );
}

function FeedPanel({ lang }: Props) {
  const auth = useAuth();
  const feed = useTransitFeed(auth.user);
  const { segments } = useTransitSegments(auth.user);
  const t = translations[lang];

  const [filter, setFilter] = useState<FeedKind | 'all'>('all');
  /*
   * Read from localStorage on the first render rather than in an effect. This control *reveals*
   * rows rather than hiding them, so a frame of the wrong state is harmless either way — but the
   * events app learnt that a persisted view preference applied one frame late reads as the app
   * forgetting the setting every time it opens, and there is no reason to repeat it.
   */
  const [showOther, setShowOther] = useState<boolean>(() => loadShowOther());

  const chooseShowOther = (next: boolean) => {
    setShowOther(next);
    saveShowOther(next);
  };

  // Re-arm silently. Nothing is rendered for it here — the Alerts tab is where push has a UI.
  useWebPush(auth.user, lang, { verifyOnly: true, stampArmedAt: false });

  const now = Date.now();
  const built = useMemo(
    () =>
      buildTransitFeed(feed.items, segments, {
        now,
        feed: filter === 'all' ? undefined : filter,
        includeOther: showOther,
      }),
    // `now` is deliberately not a dependency: re-grouping on a clock tick nobody can see would
    // rebuild the list for nothing. It is recomputed when the data actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feed.items, segments, filter, showOther],
  );

  const heading: Record<SectionKey, string> = {
    route: t.sectionRoute,
    line: t.sectionLine,
    other: t.sectionOther,
  };
  const emptyText: Record<SectionKey, string | null> = {
    route: t.sectionRouteEmpty,
    line: t.sectionLineEmpty,
    other: null,
  };

  return (
    <div className="ev-feed tr-feed">
      <div className="ev-city">
        <label className="ev-city-label" htmlFor="tr-filter">
          {t.feedHeading}
        </label>
        <select
          id="tr-filter"
          className="ev-city-select"
          value={filter}
          onChange={(e) => setFilter(e.target.value as FeedKind | 'all')}
        >
          <option value="all">{t.filterAll}</option>
          <option value="impediment">{t.filterImpediment}</option>
          <option value="change">{t.filterChange}</option>
        </select>
      </div>

      {feed.error ? <p className="ev-error">{feed.error}</p> : null}
      {feed.ready && !feed.fresh && feed.items.length > 0 ? (
        <p className="ev-note">{t.offline}</p>
      ) : null}

      {built.totalCount === 0 ? (
        <section className="ev-section">
          <p className="ev-empty">{t.feedEmpty}</p>
          <p className="ev-hint">{t.feedEmptyHint}</p>
        </section>
      ) : (
        built.sections.map((section) => (
          <section className="ev-group" key={section.key}>
            <h2 className="ev-group-head">{heading[section.key]}</h2>
            {section.key === 'other' ? <p className="ev-hint">{t.otherIntro}</p> : null}
            {section.rows.length === 0 ? (
              <p className="ev-empty">{emptyText[section.key]}</p>
            ) : (
              <div className="ev-list">
                {section.rows.map((row) => (
                  <NoticeCard key={row.item.id} item={row.item} verdict={row.verdict} lang={lang} />
                ))}
              </div>
            )}
          </section>
        ))
      )}

      {/*
        * The coverage line, and it is measured over metro notices rather than over matched rows —
        * see `buildTransitFeed`. An extractor that has quietly stopped otherwise looks exactly
        * like a fortnight in which nothing needed reading.
        */}
      {built.metroCount > 0 ? (
        <p className="ev-hint tr-coverage">
          {built.extractedCount === 0
            ? fill(t.coverageNone, { total: built.metroCount })
            : fill(t.coverage, { read: built.extractedCount, total: built.metroCount })}
        </p>
      ) : null}

      <p className="ev-actions">
        <button
          type="button"
          className="ev-link"
          onClick={() => chooseShowOther(!showOther)}
        >
          {showOther ? t.hideOther : t.showOther}
        </button>
      </p>
    </div>
  );
}
