/**
 * The Alerts tab: turning notifications on, choosing which of the two kinds arrive, and showing
 * what was sent — plus the one table that says whether this app can see at all.
 *
 * That last part is not a diagnostic afterthought. Everything else here is arranged so that *not
 * knowing* is never mistaken for *nothing being wrong*: an unread notice is escalated rather than
 * cleared, and an unreadable feed is an error rather than an empty one. The feed health rows are
 * where that promise is kept visible — a WTP feed behind a WAF challenge returns HTTP 202 and zero
 * bytes, which without this table looks exactly like a quiet fortnight on the metro.
 */
import { useEffect, useState } from 'react';
import { describeError, log } from '../../lib/logger';
import { useAuth } from '../../hooks/useAuth';
import { useWebPush } from '../../hooks/useWebPush';
import { useTransitSettings } from '../../hooks/useTransitSettings';
import { pullAlerts, pullFeedHealth } from '../../utils/transit/browser/cloud';
import { REFRESH_MINUTES, WTP_FEEDS } from '../../utils/transit/sources';
import type { FeedFetch, TransitAlert } from '../../utils/transit/types';
import PushPanel from '../Events/PushPanel';
import TransitGate from './TransitGate';
import { fill, relativeTime, translations, type Lang } from './translations';

interface Props {
  lang: Lang;
}

export default function TransitAlerts({ lang }: Props) {
  const auth = useAuth();
  return (
    <TransitGate auth={auth} lang={lang} path="/alerts/">
      <AlertsPanel lang={lang} />
    </TransitGate>
  );
}

function AlertsPanel({ lang }: Props) {
  const auth = useAuth();
  /*
   * `stampArmedAt: false`: the subscription is shared with Event Watch, the arming moment is not.
   * See the option's note in `useWebPush` — this app stamps its own, in `useTransitSettings`, and
   * only once an endpoint actually exists.
   */
  const push = useWebPush(auth.user, lang, { stampArmedAt: false });
  const { settings, update } = useTransitSettings(auth.user, push.state);
  const t = translations[lang];
  const now = Date.now();

  const [alerts, setAlerts] = useState<TransitAlert[]>([]);
  const [health, setHealth] = useState<FeedFetch[]>([]);

  useEffect(() => {
    const uid = auth.user?.uid;
    if (!uid) return;
    let cancelled = false;

    // Settled independently, for the reason the events app's alerts panel does it: a panel whose
    // whole job is telling you what is broken must not be the quietest thing on the page.
    void (async () => {
      const [sent, feeds] = await Promise.allSettled([pullAlerts(uid), pullFeedHealth()]);
      if (cancelled) return;
      if (sent.status === 'fulfilled') setAlerts(sent.value);
      else log.warn('transit.alerts.pull.failed', describeError(sent.reason));
      if (feeds.status === 'fulfilled') setHealth(feeds.value);
      else log.warn('transit.health.pull.failed', describeError(feeds.reason));
    })();

    return () => {
      cancelled = true;
    };
  }, [auth.user]);

  return (
    <div className="ev-alerts tr-alerts">
      <section className="ev-section">
        <h2 className="ev-subhead">{t.alertsHeading}</h2>
        <p className="ev-note">{t.alertsIntro}</p>
        <PushPanel push={push} lang={lang} />
      </section>

      <section className="ev-section">
        <label className="ev-check">
          <input
            type="checkbox"
            checked={settings.lineAlerts}
            onChange={(e) => update({ lineAlerts: e.target.checked })}
          />
          <span>{t.settingLine}</span>
        </label>
        <label className="ev-check">
          <input
            type="checkbox"
            checked={settings.changeAlerts}
            onChange={(e) => update({ changeAlerts: e.target.checked })}
          />
          <span>{t.settingChange}</span>
        </label>
      </section>

      <section className="ev-section">
        <h3 className="ev-subhead">{t.feedHealthHeading}</h3>
        <ul className="ev-sources">
          {WTP_FEEDS.map((entry) => {
            const row = health.find((h) => h.id === entry.feed);
            const bad = !row || !row.ok;
            return (
              <li className={`ev-row${bad ? ' ev-row--bad' : ''}`} key={entry.feed}>
                <span className="ev-row-main">
                  {entry.feed === 'change' ? t.filterChange : t.filterImpediment}
                  <span className="ev-row-meta">
                    {' '}
                    {fill(t.refreshEvery, { n: REFRESH_MINUTES[entry.feed] })}
                  </span>
                </span>
                <span className="ev-row-meta">
                  {!row
                    ? t.feedNever
                    : row.ok
                      ? fill(t.feedOk, {
                          when: relativeTime(row.fetchedAt, now, t),
                          count: row.itemCount,
                        })
                      : `${fill(t.feedBad, {
                          when: row.lastOkAt ? relativeTime(row.lastOkAt, now, t) : '—',
                        })} · ${fill(t.feedFailures, { count: row.consecutiveFailures })}`}
                </span>
                {/*
                  * The error and the first bytes of whatever arrived instead of a feed. This is the
                  * one place a WAF challenge is legible — "HTTP 202 with no feed" is a sentence you
                  * can act on, where an empty list is one you would misread.
                  */}
                {row && !row.ok && row.error ? <span className="ev-reason">{row.error}</span> : null}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="ev-section">
        <h3 className="ev-subhead">{t.historyHeading}</h3>
        {alerts.length === 0 ? (
          <p className="ev-hint">{t.historyEmpty}</p>
        ) : (
          <ul className="ev-history">
            {alerts.map((alert) => (
              <li className="ev-row" key={alert.id}>
                <span className="ev-row-main">
                  <a className="ev-link" href={alert.url} target="_blank" rel="noopener noreferrer">
                    {alert.summary ?? alert.title}
                  </a>
                </span>
                <span className="ev-row-meta">
                  {alert.kind === 'route' ? t.historyRoute : t.historyLine} ·{' '}
                  {alert.lines.join(' + ')} · {relativeTime(alert.claimedAt, now, t)}
                  {alert.sentAt === null ? ` · ✕ ${t.historyFailed}` : ''}
                </span>
                {alert.stops.length > 0 ? (
                  <span className="ev-reason">{alert.stops.join(', ')}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
