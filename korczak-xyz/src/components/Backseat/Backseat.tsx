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

import { useEffect, useRef, useState } from 'react';

import { useAuth } from '../../hooks/useAuth';
import { useBackseatConfig } from '../../hooks/useBackseatConfig';
import { useBackseatRide } from '../../hooks/useBackseatRide';
import { demoRestrictions, quickRoastConfig, remarkLanguage } from '../../utils/backseat/defaults';
import { fetchDemoStatus, type DemoStatus } from '../../utils/backseat/demo';
import { FLAVOURS, type FlavourId } from '../../utils/backseat/flavour';
import type { RemarkLanguage } from '../../utils/backseat/types';
import QuickRoast from './QuickRoast';
import RideScreen from './RideScreen';
import SetupScreen from './SetupScreen';
import { cameraMessage, forFlavour, type Lang, type Translation } from './translations';

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
  /**
   * Which app this island is: the passenger (`/apps/backseat/`) or the roaster
   * (`/apps/roaster/`). A string rather than the flavour object, because Astro serialises props.
   */
  flavour?: FlavourId;
}

export default function Backseat({ lang, flavour: flavourId = 'backseat' }: BackseatProps) {
  const flavour = FLAVOURS[flavourId];
  const t: Translation = forFlavour(flavourId, lang);
  const auth = useAuth();
  const { config, ready, sync, update, reset } = useBackseatConfig(auth.user, flavour);

  /*
   * Whether the site's own key is answering today, asked once per load and before any camera.
   *
   * The setup sheet needs it to know whether to offer the demo at all, and the ride needs its
   * interval floor. Null means "not asked yet or cannot be asked", which the sheet reads as no
   * demo — a function that is down and a demo that is switched off are the same thing from here.
   */
  const roaster = flavourId === 'roaster';
  const [demo, setDemo] = useState<DemoStatus | null>(null);
  /*
   * Which screen the roaster shows when it is not roasting: `auto` is the one-button demo for
   * somebody with no key (or who chose the demo), the setup sheet for everybody else, and either
   * can be asked for by name from the other.
   */
  const [view, setView] = useState<'auto' | 'quick' | 'setup'>('auto');
  /** The one-button demo's language: the page's, until the flag is tapped. */
  const [quickLang, setQuickLang] = useState<RemarkLanguage>(lang);

  /*
   * The roaster's demo is the one-button screen, not a fieldset on the setup sheet. It is offered
   * while it is open and also once it has run out for this device or for today — then the button
   * is greyed with the sentence why, which is better than the screen silently turning into a form
   * asking for an API key.
   */
  const demoOffered =
    roaster &&
    demo !== null &&
    (demo.available || demo.reason === 'ip-cap' || demo.reason === 'app-cap');
  const quick =
    demoOffered &&
    (view === 'quick' || (view === 'auto' && (config.demoMode || !config.apiKeys.google)));

  // The two-step demo cannot lend a Live session and puts a floor under the interval
  // (`demoRestrictions`); the roaster's one-button demo is Live on tokens and sets everything
  // itself (`quickRoastConfig`). A pass-through when neither is on.
  const effective =
    quick && demo
      ? quickRoastConfig(config, { liveModel: demo.model, lang: quickLang })
      : demoRestrictions(config, demo?.minIntervalSeconds);
  const ride = useBackseatRide(
    effective,
    quick ? quickLang : remarkLanguage(effective, lang),
    auth.user?.uid ?? null,
    flavour,
  );

  const riding = ride.status !== 'idle';

  /*
   * Asked again whenever a ride ends, so a demo that ran out mid-ride shows as spent rather than
   * offering a button that will be refused. The roaster's demo is Live sessions, counted apart
   * from the passenger's two-step remarks (`demoLimits.ts`), so it asks about those.
   */
  useEffect(() => {
    if (riding) return;
    const controller = new AbortController();
    void fetchDemoStatus(flavourId, controller.signal, roaster ? 'live' : 'remark').then(
      (status) => {
        if (!controller.signal.aborted) setDemo(status);
      },
    );
    return () => controller.abort();
  }, [flavourId, roaster, riding]);

  /*
   * What goes full screen. The whole island rather than the preview: a full-screen viewfinder is
   * the layout this app exists not to have (`backseat.css`), and what somebody wants bigger is the
   * sentence. It is on the island's own root so the Win95 window, the navbar and the taskbar all
   * stay behind it.
   */
  const appRef = useRef<HTMLDivElement | null>(null);

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
    sync === 'synced'
      ? t.syncSynced
      : sync === 'syncing'
        ? t.syncSyncing
        : sync === 'error'
          ? t.syncError
          : t.syncLocal;

  return (
    <div className="bks-app" ref={appRef}>
      <header className="bks-head">
        <h2 className="bks-head-title">{riding ? t.rideTitle : t.setupTitle}</h2>
      </header>

      {riding ? (
        <RideScreen
          status={ride.status}
          videoRef={ride.videoRef}
          mirrored={effective.camera.facing === 'user'}
          fullscreenTarget={appRef}
          remarks={ride.remarks}
          current={ride.current}
          speaking={ride.speaking}
          pending={ride.pending}
          lastLatencyMs={ride.lastLatencyMs}
          demoRemaining={ride.demoRemaining}
          language={
            quick
              ? {
                  value: quickLang,
                  onToggle: () => setQuickLang((l) => (l === 'pl' ? 'en' : 'pl')),
                }
              : undefined
          }
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

          {quick && demo ? (
            <QuickRoast
              demo={demo}
              language={quickLang}
              onLanguage={setQuickLang}
              /* Straight to the hook, nothing awaited: see the Start note below. */
              onStart={ride.start}
              onOwnKey={() => {
                if (config.demoMode) update({ demoMode: false });
                setView('setup');
              }}
              t={t}
              lang={lang}
            />
          ) : (
            <>
              {demoOffered && (
                <button type="button" className="bks-linkish" onClick={() => setView('quick')}>
                  {t.quickBackToDemo}
                </button>
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
                saving={Boolean(auth.user)}
                /* Handed the hook's own callback, with nothing awaited in between: the speech engine
               is unlocked by an utterance spoken inside a real user gesture, and one `await`
               before that point loses the gesture on iOS — the app is then silent for the whole
               ride with nothing in any log. See `primeVoices`. */
                onStart={ride.start}
                /* The roaster's demo is the one-button screen above, never the sheet's fieldset. */
                demo={roaster ? null : demo}
                flavour={flavourId}
                t={t}
                lang={lang}
              />
            </>
          )}
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
