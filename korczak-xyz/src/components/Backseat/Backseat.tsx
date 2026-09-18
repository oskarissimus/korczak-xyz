/*
 * The whole of `/apps/backseat/`, as one island.
 *
 * TWO SCREENS, ONE ISLAND, NO ROUTER, and for a harder reason than sloper's: this app holds a live
 * `MediaStream`. A genuine navigation tears the island down mid-ride, and while the unmount does
 * stop the tracks, anything that goes wrong on that path leaves a camera running behind a page
 * nobody is looking at. One island with a `screen` state has no such path — the camera is acquired
 * and released by the same hook that owns the ride, and the only way out is the Stop button or
 * closing the tab.
 *
 * THE SCREENS ARE NOT TABS. `setup` and `ride` are not two views of one thing you might want side
 * by side; they are before and after. The camera is off on one and on on the other, so switching
 * back is not navigation, it is stopping — which is why the Settings button on the ride screen
 * lives inside `RideScreen`'s Stop and there is no second route back.
 *
 * WHAT IS SAVED AND WHAT IS NOT. The settings are saved in this browser and, signed in, in the
 * account — the same arrangement as sloper's keys and the same code shape. A ride is not saved at
 * all: no localStorage (the budget argument in `utils/backseat/storage.ts`) and no Firestore.
 * Signed out, everything on this page works exactly as it does signed in, and the keys simply live
 * in this browser alone. That is the honest state, not a degraded one, which is why the sign-in
 * notice is a notice and not a gate.
 */

import { useEffect } from 'react';

import { useAuth } from '../../hooks/useAuth';
import { useBackseatConfig } from '../../hooks/useBackseatConfig';
import { useBackseatRide } from '../../hooks/useBackseatRide';
import RideScreen from './RideScreen';
import SetupScreen from './SetupScreen';
import { cameraMessage, translations, type Lang, type Translation } from './translations';

/*
 * Spelt out rather than taken from `getLocalizedPath`. That helper lives in `src/i18n/index.ts`
 * alongside the whole translation table, and importing it here would compile every string on the
 * site into this island's bundle — the same reason `utils/pwa/apps.ts` does not ship to the
 * browser. One route in two locales is cheaper written down.
 */
function loginPath(lang: Lang): string {
  return lang === 'pl' ? '/pl/login/' : '/login/';
}

interface BackseatProps {
  lang: Lang;
}

export default function Backseat({ lang }: BackseatProps) {
  const t: Translation = translations[lang];
  const auth = useAuth();
  const { config, ready, sync, borrowed, update, reset } = useBackseatConfig(auth.user);
  const ride = useBackseatRide(config, lang);

  const riding = ride.status !== 'idle';

  /*
   * The unload warning, armed only while the camera is actually on.
   *
   * It is not about losing work — there is none to lose — it is about the camera. A tab closed
   * mid-ride releases the stream, but a navigation somebody did not mean (a mis-tapped link, a
   * back gesture) ends the journey silently, and the next thing that happens is a passenger who
   * has stopped talking with no explanation. A prompt that fires on every navigation is one people
   * learn to dismiss without reading, so it is armed on exactly this condition and no other.
   */
  useEffect(() => {
    if (!riding) return;

    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Browsers ignore the text and show their own, but `returnValue` still has to be set.
      e.returnValue = '';
      return '';
    };

    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [riding]);

  if (!ready) return <div className="bks-loading" />;

  const syncLabel =
    sync === 'synced' ? t.syncSynced
    : sync === 'syncing' ? t.syncSyncing
    : sync === 'error' ? t.syncError
    : t.syncLocal;

  return (
    <div className="bks-app">
      <header className="bks-head">
        <h2 className="bks-head-title">{riding ? t.rideTitle : t.setupTitle}</h2>
      </header>

      {riding ? (
        <RideScreen
          status={ride.status}
          videoRef={ride.videoRef}
          remarks={ride.remarks}
          current={ride.current}
          speaking={ride.speaking}
          error={ride.error}
          cameraError={ride.cameraError}
          onStop={ride.stop}
          onHush={ride.hush}
          onDismissError={ride.dismissError}
          t={t}
          lang={lang}
        />
      ) : (
        <>
          {/* A camera refusal or a fatal provider error lands back here, where the settings that
              caused it are. Shown above the sheet rather than beside the Start button, because
              what it is about is the last attempt and not the next one. */}
          {ride.cameraError && (
            <p className="bks-error bks-note">{cameraMessage(t, ride.cameraError)}</p>
          )}

          {ride.error && (
            <div className="bks-banner">
              <p className="bks-error">{ride.error}</p>
              <button type="button" className="bks-banner-close" onClick={ride.dismissError}>
                {t.errorDismiss}
              </button>
            </div>
          )}

          {!auth.user && auth.enabled && (
            <aside className="bks-signin">
              <h3 className="bks-subhead">{t.signedOutTitle}</h3>
              <p>{t.signedOutBody}</p>
              <a className="retro-btn" href={loginPath(lang)}>
                {t.signedOutLink}
              </a>
            </aside>
          )}

          <SetupScreen
            config={config}
            update={update}
            reset={reset}
            borrowed={borrowed}
            /* Handed the hook's own callback, with nothing awaited in between: the speech engine
               is unlocked by an utterance spoken inside a real user gesture, and one `await`
               before that point loses the gesture on iOS — the app is then silent for the whole
               ride with nothing in any log. See `primeSpeech`. */
            onStart={ride.start}
            t={t}
            lang={lang}
          />
        </>
      )}

      {sync === 'error' && <p className="bks-note">{t.syncErrorHint}</p>}

      <div className="bks-statusbar">
        <span className={`bks-sync bks-sync-${sync}`}>{syncLabel}</span>
        {auth.user?.email && <span className="bks-who">{auth.user.email}</span>}
      </div>
    </div>
  );
}
