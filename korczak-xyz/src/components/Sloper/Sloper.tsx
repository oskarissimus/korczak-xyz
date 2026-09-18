/*
 * The whole of `/apps/sloper/`, as one island.
 *
 * sloper on GitHub Pages was a `HashRouter` over five routes. There is no router here and the
 * five routes are five values of one `stage`, which is forced rather than preferred: the assets
 * are `Blob`s held in memory and nothing persists them, so a genuine navigation between stages
 * would throw away a video that cost real money to make. The step rail down the left is the whole
 * of the navigation, and a step you have not reached is not a link.
 *
 * The shape is a setup wizard's on purpose: a rail of numbered steps beside the sheet, the step
 * you are on named in a band over it, and a sunken status strip along the bottom. It is the one
 * layout everybody already knows how to read — where you are, what is behind you, how much is
 * left — and this app genuinely is an installer-shaped thing: five steps, one after another, each
 * unlocked by finishing the one before it.
 *
 * The sign-in notice is a notice and not a gate. Everything up to the last step works signed out,
 * exactly as it did on GitHub Pages — but the keys then live in this browser alone, and the
 * assembler (which runs on a machine somebody pays for) refuses an unauthenticated request. Both
 * halves of that are worth saying before somebody spends an hour of API calls finding out.
 */

import { useEffect, useRef } from 'react';

import { useAuth } from '../../hooks/useAuth';
import { useSloperConfig } from '../../hooks/useSloperConfig';
import { useSloperRun } from '../../hooks/useSloperRun';
import type { Stage } from '../../utils/sloper/types';
import AssemblyStage from './AssemblyStage';
import AssetsStage from './AssetsStage';
import ConfigStage from './ConfigStage';
import OutputStage from './OutputStage';
import ScenesStage from './ScenesStage';
import { fill, translations, type Lang, type Translation } from './translations';

const STAGES: Stage[] = ['config', 'scenes', 'assets', 'assembly', 'output'];

/*
 * Spelt out rather than taken from `getLocalizedPath`. That helper lives in `src/i18n/index.ts`
 * alongside the whole translation table, and importing it here would compile every string on the
 * site into this island's bundle — the same reason `utils/pwa/apps.ts` does not ship to the
 * browser. One route in two locales is cheaper written down.
 */
function loginPath(lang: Lang): string {
  return lang === 'pl' ? '/pl/login/' : '/login/';
}

// The rail's labels are short because five of them are read as a column at a glance; the band
// over the sheet says the same step at length. Two registers for one step, the way an installer's
// left panel and its title band differ.
const STAGE_LABELS: Record<Stage, keyof Translation> = {
  config: 'stepConfig',
  scenes: 'stepScenes',
  assets: 'stepAssets',
  assembly: 'stepAssembly',
  output: 'stepOutput',
};

const STAGE_TITLES: Record<Stage, keyof Translation> = {
  config: 'configTitle',
  scenes: 'scenesTitle',
  assets: 'assetsTitle',
  assembly: 'assemblyTitle',
  output: 'outputTitle',
};

interface StepRailProps {
  stage: Stage;
  reachable: Stage[];
  onGo: (stage: Stage) => void;
  t: Translation;
}

function StepRail({ stage, reachable, onGo, t }: StepRailProps) {
  const current = STAGES.indexOf(stage);

  return (
    <nav className="slp-rail" aria-label={t.steps}>
      <p className="slp-rail-title">{t.steps}</p>
      <ol>
        {STAGES.map((step, i) => {
          const label = t[STAGE_LABELS[step]];
          const done = i < current;
          const here = step === stage;
          const open = reachable.includes(step);

          return (
            <li
              key={step}
              className={`slp-step${here ? ' slp-step-here' : ''}${done ? ' slp-step-done' : ''}`}
            >
              {/* Where you are is never colour alone — the same rule the charts are built on.
                  A tick, an arrow and a number say done, here and not yet on their own, and the
                  cell is one width so the five labels line up. */}
              <span className="slp-step-mark" aria-hidden="true">
                {done ? '✓' : here ? '▶' : i + 1}
              </span>
              {open && !here ? (
                <button type="button" onClick={() => onGo(step)}>
                  {label}
                </button>
              ) : (
                <span
                  className="slp-step-label"
                  aria-current={here ? 'step' : undefined}
                  title={here || open ? undefined : t.stepLocked}
                >
                  {label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

interface SloperProps {
  lang: Lang;
}

export default function Sloper({ lang }: SloperProps) {
  const t = translations[lang];
  const auth = useAuth();
  const { config, ready, sync, update, reset: resetConfig } = useSloperConfig(auth.user);
  const run = useSloperRun();

  /*
   * The unload warning, which is the same one sloper had and for the same reason: everything on
   * this page is in memory, and a reload during a generation loses assets that were paid for.
   * Armed only while something is genuinely in flight — a prompt that warns on every navigation
   * is one people learn to dismiss without reading.
   */
  useEffect(() => {
    if (!run.busy) return;

    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Browsers ignore the text and show their own, but `returnValue` still has to be set.
      e.returnValue = t.leaveWarning;
      return t.leaveWarning;
    };

    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [run.busy, t.leaveWarning]);

  /*
   * The assembly stage starts working the moment it is reached, rather than behind another
   * button: by then every choice has been made and the only thing left is the wait.
   *
   * The latch is a ref rather than the phase, because `run` is a fresh object on every render —
   * the effect therefore runs on every render, and a phase updated by `setState` is still the old
   * value on the render that scheduled it. Without the ref that is two uploads of 20 MB. `reset`
   * and the Retry button clear it by moving off the stage and calling `startAssembly` directly.
   */
  const assemblyStartedRef = useRef(false);
  useEffect(() => {
    if (run.stage !== 'assembly') {
      assemblyStartedRef.current = false;
      return;
    }
    if (run.assembly !== 'idle' || assemblyStartedRef.current) return;
    assemblyStartedRef.current = true;
    void run.startAssembly(config);
  }, [config, run]);

  if (!ready) return <div className="slp-loading" />;

  // Where the rail may take you back to. Never forward — each step is unlocked by finishing the
  // one before it, and `output` is reachable only while there is a video to show.
  const reachable: Stage[] = ['config'];
  if (run.scenes.length > 0 || run.stage !== 'config') reachable.push('scenes');
  if (run.assets.size > 0) reachable.push('assets');
  if (run.video) reachable.push('output');

  const syncLabel =
    sync === 'synced' ? t.syncSynced
    : sync === 'syncing' ? t.syncSyncing
    : sync === 'error' ? t.syncError
    : t.syncLocal;

  return (
    <div className="slp-app">
      <StepRail stage={run.stage} reachable={reachable} onGo={run.goTo} t={t} />

      <div className="slp-main">
        <header className="slp-head">
          <h2 className="slp-head-title">{t[STAGE_TITLES[run.stage]]}</h2>
          <p className="slp-head-count">
            {fill(t.stepCounter, {
              n: STAGES.indexOf(run.stage) + 1,
              total: STAGES.length,
            })}
          </p>
        </header>

        {!auth.user && auth.enabled && (
          <aside className="slp-signin">
            <h2 className="slp-subhead">{t.signedOutTitle}</h2>
            <p>{t.signedOutBody}</p>
            <a className="retro-btn" href={loginPath(lang)}>
              {t.signedOutLink}
            </a>
          </aside>
        )}

        {/* One place for everything that went wrong, so no stage has to grow its own banner. The
            assembly stage draws its own failure instead, because there the error IS the screen. */}
        {run.error && run.stage !== 'assembly' && (
          <div className="slp-banner">
            <p className="slp-error">{run.error}</p>
            <button type="button" className="slp-banner-close" onClick={run.dismissError}>
              {t.errorDismiss}
            </button>
          </div>
        )}

        {run.stage === 'config' && (
          <ConfigStage
            config={config}
            update={update}
            reset={resetConfig}
            onStart={() => run.goTo('scenes')}
            t={t}
            lang={lang}
          />
        )}

        {run.stage === 'scenes' && (
          <ScenesStage
            config={config}
            scenes={run.scenes}
            streaming={run.streaming}
            tokenUsage={run.tokenUsage}
            estimatedCost={run.estimatedCost}
            onGenerate={(prompt) => void run.generateScenes(config, prompt)}
            onStop={run.stopStreaming}
            onAdd={run.addScene}
            onUpdate={run.updateScene}
            onRemove={run.removeScene}
            onClear={run.clearScenes}
            onBack={() => run.goTo('config')}
            onNext={() => {
              run.startAssets(config);
              run.goTo('assets');
            }}
            t={t}
            lang={lang}
          />
        )}

        {run.stage === 'assets' && (
          <AssetsStage
            scenes={run.scenes}
            assets={run.assets}
            assetsFor={run.assetsFor}
            generating={run.generatingAssets}
            onRetry={(assetId) => void run.retryAsset(config, assetId)}
            onBack={() => run.goTo('scenes')}
            onNext={() => run.goTo('assembly')}
            t={t}
          />
        )}

        {run.stage === 'assembly' && (
          <AssemblyStage
            phase={run.assembly}
            uploadMB={run.uploadMB}
            error={run.error}
            onRetry={() => void run.startAssembly(config)}
            onBack={() => run.goTo('assets')}
            t={t}
          />
        )}

        {run.stage === 'output' && run.video && (
          <OutputStage video={run.video} onStartOver={run.reset} t={t} />
        )}

        {/* The status strip sits at the foot of the sheet, where a property sheet's own does, and
            the sentence that explains an amber badge sits with the badge rather than a screen
            away from it. */}
        {sync === 'error' && <p className="slp-note">{t.syncErrorHint}</p>}

        <div className="slp-statusbar">
          <span className={`slp-sync slp-sync-${sync}`}>{syncLabel}</span>
          {auth.user?.email && <span className="slp-who">{auth.user.email}</span>}
        </div>
      </div>
    </div>
  );
}
