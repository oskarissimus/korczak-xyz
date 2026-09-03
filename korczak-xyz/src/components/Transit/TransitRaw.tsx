/**
 * The Raw tab: every item of both feeds, exactly as it arrived.
 *
 * This is the tab that makes the rest of the app arguable rather than only obeyable. A card says
 * "no stops at Politechnika, Pole Mokotowskie, Racławicka" on the authority of a language model
 * reading four sentences of Polish; the only way to check that is to read the four sentences. So
 * the archive keeps every item of both feeds — including the ones that could not be parsed at all,
 * which are precisely the ones worth looking at.
 *
 * The XML is collapsed by default and shown per item. Rendering forty blocks of markup would make
 * the tab unreadable for the ordinary case, which is "which of these did the collector actually
 * see".
 */
import { useEffect, useState } from 'react';
import { describeError, log } from '../../lib/logger';
import { useAuth } from '../../hooks/useAuth';
import { pullRaw } from '../../utils/transit/browser/cloud';
import { REFRESH_MINUTES, WTP_FEEDS } from '../../utils/transit/sources';
import type { RawFeedItem } from '../../utils/transit/types';
import TransitGate from './TransitGate';
import { fill, relativeTime, translations, whenLabel, type Lang } from './translations';

interface Props {
  lang: Lang;
}

export default function TransitRaw({ lang }: Props) {
  const auth = useAuth();
  return (
    <TransitGate auth={auth} lang={lang} path="/raw/">
      <RawPanel lang={lang} />
    </TransitGate>
  );
}

function RawPanel({ lang }: Props) {
  const auth = useAuth();
  const t = translations[lang];
  const now = Date.now();
  const [rows, setRows] = useState<RawFeedItem[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.user) return;
    let cancelled = false;
    void (async () => {
      try {
        const archived = await pullRaw();
        if (!cancelled) setRows(archived);
      } catch (e) {
        log.warn('transit.raw.pull.failed', describeError(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.user]);

  return (
    <div className="ev-alerts tr-raw">
      <section className="ev-section">
        <h2 className="ev-subhead">{t.rawHeading}</h2>
        <p className="ev-note">{t.rawIntro}</p>
      </section>

      {/*
        * The pages, listed statically from the catalogue: no network, no collector run, so this
        * says something useful offline and on an account whose first collection has not happened.
        * The link's text is the URL because the whole offer is that it can be checked.
        */}
      <section className="ev-section">
        <h3 className="ev-subhead">{t.sourcesHeading}</h3>
        <ul className="ev-pages">
          {WTP_FEEDS.map((entry) => (
            <li className="ev-page" key={entry.feed}>
              <a className="ev-page-url" href={entry.url} target="_blank" rel="noopener noreferrer">
                {entry.url.replace(/^https?:\/\//, '')}
              </a>
              <span className="ev-page-meta">
                {entry.feed === 'change' ? t.filterChange : t.filterImpediment} ·{' '}
                {fill(t.refreshEvery, { n: REFRESH_MINUTES[entry.feed] })}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="ev-section">
        {rows.length === 0 ? (
          <p className="ev-hint">{t.rawEmpty}</p>
        ) : (
          <ul className="ev-history tr-raw-list">
            {rows.map((row) => (
              <li className={`ev-row${row.parsed ? '' : ' ev-row--bad'}`} key={row.id}>
                <span className="ev-row-main">
                  <a className="ev-link" href={row.url} target="_blank" rel="noopener noreferrer">
                    {row.title || row.guid}
                  </a>
                </span>
                <span className="ev-row-meta">
                  {whenLabel(row.publishedAt, lang)} ·{' '}
                  {row.parsed ? t.rawParsed : t.rawUnparsed} ·{' '}
                  {fill(t.rawFetched, { when: relativeTime(row.fetchedAt, now, t) })}
                </span>
                <button
                  type="button"
                  className="ev-link"
                  onClick={() => setOpen(open === row.id ? null : row.id)}
                >
                  {open === row.id ? t.rawHide : t.rawShow}
                </button>
                {open === row.id ? <pre className="tr-xml">{row.xml}</pre> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
