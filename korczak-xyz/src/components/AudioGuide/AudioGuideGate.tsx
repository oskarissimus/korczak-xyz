/**
 * The account gate in front of the whole audio guide.
 *
 * Every tap on a pin is two model calls and a minute of synthesised speech, billed to the
 * reader's own keys, which are kept in their account. So the app opens for **approved accounts
 * only**, the same admission every other account-backed app on the site waits for.
 *
 * It gates the whole island rather than the tap, on purpose: behind it are a geolocation prompt
 * and Overpass requests on every pan, and neither is worth spending on a visitor who is then told
 * they cannot have a guide. The frame stays the app's own shape — bar, stage, footnote — so the
 * page is exactly as tall behind the gate as in front of it, and nothing jumps when it opens.
 *
 * THIS IS NOT SECURITY, and nothing needs it to be. The narration function answers anybody who
 * posts to it, but spends only the keys it is sent (`audio-guide-function/function.go`).
 */
import type { ReactNode } from 'react';
import type { AuthApi } from '../../hooks/useAuth';
import { translations, type Lang } from './translations';

interface Props {
  auth: AuthApi;
  lang: Lang;
  children: ReactNode;
}

/*
 * Spelt out rather than taken from `getLocalizedPath`, for the reason `Backseat.tsx` gives: that
 * helper would compile the whole site's translation table into this island.
 */
function loginHref(lang: Lang): string {
  const back = lang === 'pl' ? '/pl/apps/audio-guide/' : '/apps/audio-guide/';
  const login = lang === 'pl' ? '/pl/login/' : '/login/';
  return `${login}?redirect=${encodeURIComponent(back)}`;
}

function Frame({ lang, children }: { lang: Lang; children?: ReactNode }) {
  const t = translations[lang];
  return (
    <div className="ag-app">
      <div className="ag-stage">
        <div className="ag-map ag-map-placeholder" />
        {children && <div className="ag-gate">{children}</div>}
      </div>
      <p className="ag-foot">
        {t.pitch}
        <span className="ag-credits">{t.credits}</span>
      </p>
    </div>
  );
}

export default function AudioGuideGate({ auth, lang, children }: Props) {
  const t = translations[lang];

  // No Firebase in this build — a deploy-time fact, not something a sign-in would fix.
  if (!auth.enabled) {
    return (
      <Frame lang={lang}>
        <div className="ag-error">
          <p className="ag-error-body">{t.gateUnavailable}</p>
        </div>
      </Frame>
    );
  }

  // Signed in and the verdict is still on its way. An empty stage, not a sign-in button that
  // would be wrong half a second from now.
  if (auth.loading) return <Frame lang={lang} />;

  if (!auth.user) {
    const pending = auth.status === 'pending';
    return (
      <Frame lang={lang}>
        <div className="ag-error">
          <p className="ag-gate-title">{pending ? t.gatePendingTitle : t.gateSignedOutTitle}</p>
          <p className="ag-error-body">{pending ? t.gatePendingBody : t.gateSignedOutBody}</p>
          {!pending && (
            <div className="ag-error-actions">
              <a className="retro-btn" href={loginHref(lang)}>
                {t.gateSignIn}
              </a>
            </div>
          )}
        </div>
      </Frame>
    );
  }

  return <>{children}</>;
}
