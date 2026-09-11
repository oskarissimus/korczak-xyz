/**
 * The signed-in gate every tab of this app sits behind.
 *
 * Unlike the typing trainer or the flashcards, this app has nothing to offer a signed-out visitor:
 * the watching happens on a server, against interests stored on an account, and the notifications
 * have to know where to go. So it hard-gates, in the order `BabySleepShare` established — and the
 * loading branch renders an empty reserved block rather than a disabled form, because a form you
 * cannot use is worse than no form at all.
 */
import type { ReactNode } from 'react';
import type { AuthApi } from '../../hooks/useAuth';
import { translations, type Lang } from './translations';

interface Props {
  auth: AuthApi;
  lang: Lang;
  /** Where to come back to after signing in. Unprefixed; the locale is applied here. */
  path: string;
  children: ReactNode;
}

export default function EventsGate({ auth, lang, path, children }: Props) {
  const t = translations[lang];

  // No Firebase configured at all — a deploy-time fact, not something a sign-in would fix.
  if (!auth.enabled) {
    return (
      <div className="ev-feed">
        <p className="ev-note">{t.unavailable}</p>
      </div>
    );
  }

  if (auth.loading) return <div className="ev-loading" />;

  if (!auth.user) {
    /*
     * The query string comes back with you. A notification carries the event it was about in one
     * (`links.ts`), and that is the whole reason this tab was opened — dropping it here would hand
     * a signed-out tap the feed's first screen after signing in, which is precisely the bug the
     * deep link exists to fix, moved one step later where it is harder to notice.
     */
    const search = typeof window === 'undefined' ? '' : window.location.search;
    const redirect =
      (lang === 'pl' ? `/pl/apps/events${path}` : `/apps/events${path}`) + search;
    const login = lang === 'pl' ? '/pl/login/' : '/login/';
    return (
      <div className="ev-feed">
        <section className="ev-section">
          <h2 className="ev-subhead">{t.signedOutTitle}</h2>
          <p className="ev-note">{t.signedOutBody}</p>
          <p>
            <a className="ev-action" href={`${login}?redirect=${encodeURIComponent(redirect)}`}>
              {t.signIn}
            </a>
          </p>
        </section>
      </div>
    );
  }

  return <>{children}</>;
}
