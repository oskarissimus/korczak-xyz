/**
 * The push permission panel: which of the several ways this can be dead it currently is.
 *
 * Extracted from `EventsAlerts` so the transport app can render the same one. It is shared rather
 * than copied because **every state it names is a fact about the platform, not about the app** —
 * iOS refusing push outside an installed app, a permission the browser has already denied, a
 * subscription granted but not yet stored. Two apps on one origin share a service worker and a
 * single push subscription, so they are literally in the same state at the same moment, and two
 * panels wording that state differently would be two answers to one question.
 *
 * The strings stay in `Events/translations.ts` for the same reason: one mechanism, one wording. The
 * transport app passes its own `lang` and gets the same sentences.
 */
import type { useWebPush } from '../../hooks/useWebPush';
import { canArm } from '../../utils/events/pushState';
import { translations, type Lang } from './translations';

export default function PushPanel({ push, lang }: { push: ReturnType<typeof useWebPush>; lang: Lang }) {
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
