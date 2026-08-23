/**
 * The Alerts tab: turning notifications on, proving they work, and showing what broke.
 *
 * The three things here all exist because push fails invisibly. The state machine distinguishes
 * "not installed" from "denied" from "granted but unsubscribed" so a dead setup says which kind of
 * dead it is; the test button is the only way to tell a working chain from a broken one before you
 * miss something; and the source table is what makes a scrape that quietly returns nothing visible
 * at all.
 */
import { useEffect, useState } from 'react';
import { getApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useAuth } from '../../hooks/useAuth';
import { useWebPush } from '../../hooks/useWebPush';
import { pullNotices, pullSourceHealth } from '../../utils/events/browser/cloud';
import { canArm } from '../../utils/events/pushState';
import type { Notice, SourceHealth } from '../../utils/events/types';
import EventsGate from './EventsGate';
import { fill, relativeTime, translations, type Lang } from './translations';

interface Props {
  lang: Lang;
}

export default function EventsAlerts({ lang }: Props) {
  const auth = useAuth();
  return (
    <EventsGate auth={auth} lang={lang} path="/alerts/">
      <AlertsPanel lang={lang} />
    </EventsGate>
  );
}

function AlertsPanel({ lang }: Props) {
  const auth = useAuth();
  const push = useWebPush(auth.user, lang);
  const t = translations[lang];
  const now = Date.now();

  const [notices, setNotices] = useState<Notice[]>([]);
  const [sources, setSources] = useState<SourceHealth[]>([]);
  const [test, setTest] = useState<'idle' | 'sending' | 'sent' | string>('idle');

  useEffect(() => {
    if (!auth.user) return;
    void (async () => {
      const [n, s] = await Promise.all([pullNotices(auth.user!.uid), pullSourceHealth()]);
      setNotices(n);
      setSources(s);
    })().catch(() => {
      // The history and the source table are both nice-to-have; a failure here must not take the
      // arming UI down with it, which is the part somebody came to this screen to use.
    });
  }, [auth.user]);

  const sendTest = async () => {
    if (!push.currentSubId) return;
    setTest('sending');
    try {
      const call = httpsCallable(getFunctions(getApp(), 'europe-central2'), 'sendTestPush');
      await call({ subId: push.currentSubId });
      setTest('sent');
    } catch (e) {
      // The status code is the whole value here: "Apple returned 403" is debuggable, "something
      // went wrong" sends you reading server logs.
      setTest(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="ev-alerts">
      <section className="ev-section">
        <h2 className="ev-subhead">{t.alertsHeading}</h2>
        <PushPanel push={push} lang={lang} />
      </section>

      {push.state === 'ready' ? (
        <section className="ev-section">
          <div className="ev-actions">
            <button
              type="button"
              className="ev-action"
              onClick={sendTest}
              disabled={test === 'sending'}
            >
              {test === 'sending' ? t.testSending : t.sendTest}
            </button>
          </div>
          {test === 'sent' ? <p className="ev-hint">{t.testSent}</p> : null}
          {test !== 'idle' && test !== 'sending' && test !== 'sent' ? (
            <p className="ev-error" role="alert">
              {fill(t.testFailed, { error: test })}
            </p>
          ) : null}
        </section>
      ) : null}

      {push.devices.length > 0 ? (
        <section className="ev-section">
          <h3 className="ev-subhead">{t.devicesHeading}</h3>
          <ul className="ev-devices">
            {push.devices.map((device) => (
              <li className="ev-row" key={device.id}>
                <span className="ev-row-main">
                  {shortUa(device.ua)}
                  {device.id === push.currentSubId ? ' ·' : ''}
                </span>
                <span className="ev-row-meta">
                  {fill(t.deviceLastSeen, { when: relativeTime(device.lastSeenAt, now, t) })}{' '}
                  <button
                    type="button"
                    className="ev-link"
                    onClick={() => void push.removeDevice(device.id)}
                  >
                    {t.deviceRemove}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="ev-section">
        <h3 className="ev-subhead">{t.sourcesHeading}</h3>
        {sources.length === 0 ? (
          <p className="ev-hint">{t.sourceNever}</p>
        ) : (
          <ul className="ev-sources">
            {sources.map((source) => (
              <li
                className={`ev-row${source.consecutiveFailures > 0 ? ' ev-row--bad' : ''}`}
                key={source.id}
              >
                <span className="ev-row-main">{source.label}</span>
                <span className="ev-row-meta">
                  {source.consecutiveFailures > 0
                    ? fill(t.sourceFailing, {
                        when: source.lastOkAt ? relativeTime(source.lastOkAt, now, t) : '—',
                      })
                    : fill(t.sourceOk, { count: source.lastCount })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ev-section">
        <h3 className="ev-subhead">{t.historyHeading}</h3>
        {notices.length === 0 ? (
          <p className="ev-hint">{t.historyEmpty}</p>
        ) : (
          <ul className="ev-history">
            {notices.map((notice) => (
              <li className="ev-row" key={notice.id}>
                <span className="ev-row-main">{notice.title}</span>
                <span className="ev-row-meta">
                  {notice.kind} · {relativeTime(notice.claimedAt, now, t)}
                  {notice.sentAt === null ? ' · ✕' : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PushPanel({ push, lang }: { push: ReturnType<typeof useWebPush>; lang: Lang }) {
  const t = translations[lang];

  if (push.state === 'unsupported') {
    return (
      <div className="ev-push">
        <p className="ev-push-state">{t.pushUnsupported}</p>
        <p className="ev-hint">{t.pushUnsupportedHint}</p>
      </div>
    );
  }

  if (push.state === 'needs-install') {
    // The one state that must be unmissable: on iOS nothing works until the app is on the home
    // screen, and no button on this page can put it there.
    return (
      <div className="ev-push ev-push--install">
        <p className="ev-push-state">{t.pushNeedsInstall}</p>
        <p className="ev-hint">{t.pushNeedsInstallHint}</p>
      </div>
    );
  }

  if (push.state === 'blocked') {
    return (
      <div className="ev-push">
        <p className="ev-push-state">{t.pushBlocked}</p>
        <p className="ev-hint">{t.pushBlockedHint}</p>
      </div>
    );
  }

  if (push.state === 'ready') {
    return (
      <div className="ev-push">
        <p className="ev-push-state">✓ {t.pushReady}</p>
        {push.error ? <p className="ev-error">{push.error}</p> : null}
      </div>
    );
  }

  // prompt · arming · granted-no-sub · unsaved. The last two are transient — the launch check is
  // already fixing them — so they read as progress rather than as an error.
  return (
    <div className="ev-push">
      <p className="ev-push-state">
        {push.state === 'prompt' ? t.pushPrompt : push.state === 'arming' ? t.pushArming : t.pushSaving}
      </p>
      <p className="ev-hint">{t.pushPromptHint}</p>
      {canArm(push.state) ? (
        <div className="ev-actions">
          <button type="button" className="ev-action ev-action--primary" onClick={() => void push.arm()}>
            {t.pushPrompt}
          </button>
        </div>
      ) : null}
      {push.error ? <p className="ev-error">{push.error}</p> : null}
    </div>
  );
}

/** Enough of a user agent to tell the phone from the laptop, and no more. */
function shortUa(ua: string): string {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Linux/.test(ua)) return 'Linux';
  return ua.slice(0, 40) || '?';
}
