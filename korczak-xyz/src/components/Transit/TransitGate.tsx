/**
 * The signed-in gate every tab of this app sits behind.
 *
 * Same shape and same argument as `EventsGate`: the watching happens on a server, against legs
 * stored on an account, and the notifications have to know where to go. The loading branch renders
 * an empty reserved block rather than a disabled form, because a form you cannot use is worse than
 * no form at all.
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

export default function TransitGate({ auth, lang, path, children }: Props) {
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
    const redirect = lang === 'pl' ? `/pl/apps/transit${path}` : `/apps/transit${path}`;
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
