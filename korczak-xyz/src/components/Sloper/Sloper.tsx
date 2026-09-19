/*
 * The whole of `/apps/sloper/`, as one island.
 *
 * sloper on GitHub Pages was a `HashRouter` over five routes. There is no router here and the
 * five routes are five values of one `stage`. That is still forced rather than preferred even now
 * that sittings are saved: a genuine navigation tears the island down mid-generation, which
 * cancels requests already paid for, and no amount of Firestore brings a half-drawn picture back.
 * The step rail down the left is the whole of the navigation, and a step you have not reached is
 * not a link.
 *
 * WHAT DOES NAVIGATE IS THE PROJECT ID. `?p=Kx3_pQ2mTaV` in the address bar names the sitting, and
 * this file is where the two hooks that make that work meet: `useSloperProject` owns the id, the
 * URL and the writes; `useSloperRun` owns the sitting. The effect below is the whole of the
 * autosave — it hands the project hook a snapshot on every render, and that hook decides whether
 * anything has actually changed and when to send it. Putting it here rather than inside the run
 * hook is what keeps the settings in the picture: `config` lives in a third hook, and this is the
 * only place all three are in scope.
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
import { useSloperProject } from '../../hooks/useSloperProject';
import { useSloperRun } from '../../hooks/useSloperRun';
import { projectSettings } from '../../utils/sloper/projects';
import type { Stage } from '../../utils/sloper/types';
import AssemblyStage from './AssemblyStage';
import AssetsStage from './AssetsStage';
import ConfigStage from './ConfigStage';
import OutputStage from './OutputStage';
import ProjectMenu from './ProjectMenu';
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

  /* No visible caption: the rail is a plain sunken list, and `aria-label` is where the word
     "Steps" lives now that the navy title bar has gone. */
  return (
    <nav className="slp-rail" aria-label={t.steps}>
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
  const project = useSloperProject(auth.user);
  const run = useSloperRun(project, t.assetNotSaved);

  /*
   * The unload warning, which is the same one sloper had and, signed out, for the same reason:
   * everything on this page is in memory and a reload during a generation loses assets that were
   * paid for. Signed in it survives for a narrower reason — the finished ones are already in the
   * bucket, and what leaving still costs is the requests in the air. Same condition either way,
   * because `run.busy` is exactly "something this page is holding up"; only the sentence differs.
   *
   * WHAT IS NO LONGER IN IT is the assembly, for a signed-in sitting. The encode happens in the
   * account now and closing the tab does not touch it, so `busy` deliberately excludes it — a
   * prompt that is not true is worse than no prompt, because it is the one that teaches people to
   * dismiss the next one unread. See `busy` in `useSloperRun`.
   *
   * Armed only while something is genuinely in flight — a prompt that warns on every navigation
   * is one people learn to dismiss without reading.
   */
  const leaveWarning = project.enabled ? t.leaveWarningSaved : t.leaveWarning;
  useEffect(() => {
    if (!run.busy) return;

    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Browsers ignore the text and show their own, but `returnValue` still has to be set.
      e.returnValue = leaveWarning;
      return leaveWarning;
    };

    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [leaveWarning, run.busy]);

  /*
   * AUTOSAVE, ALL OF IT.
   *
   * Every render hands the project hook the current shape of the sitting; that hook serializes it,
   * compares it with what it last wrote, and schedules a write only if they differ. That is why
   * this effect can afford to have `run` — a fresh object on every render — among its inputs: the
   * expensive half of the decision is made downstream, on the data rather than on identity, which
   * is the only comparison that is actually right here. Two renders producing identical scenes
   * must not produce two writes, and one render producing changed scenes must.
   *
   * It does nothing at all until a project has been minted, which happens on leaving the settings
   * step. Before that there is nothing anybody would want back.
   *
   * THE `opened` GUARD IS NOT BELT AND BRACES, it is the one ordering hazard here. On the render
   * where a fetched project arrives, `project.id` is already the new one while `run` is still the
   * sitting that was on screen a moment ago — `useSloperRun`'s hydrate effect sets its state in the
   * same commit, and state set in an effect is not visible until the render after it. Without this
   * line, opening a project from the menu writes the previous sitting straight over it. `opened`
   * is non-null for exactly that one render and is cleared by the hydrate effect, so the guard
   * lifts on the render where `run` has caught up.
   */
  const { save } = project;
  useEffect(() => {
    if (!project.id || project.opened) return;
    save({
      stage: run.stage,
      prompt: run.prompt,
      scenes: run.scenes,
      assets: run.storedAssets,
      timings: run.storedTimings,
      video: run.videoMeta,
      // Without the keys, always. They have one home per account and a copy per project would be
      // a second place to miss when one is revoked — see `.claude/rules/sloper.md`.
      settings: projectSettings(config),
    });
  }, [config, project.id, project.opened, run, save]);

  /*
   * Opening a project puts its settings back.
   *
   * Without this the snapshot would be written and never read, and worse, a project reopened after
   * the video size was changed would assemble at the new size — FFmpeg letterboxing twelve
   * pictures that were drawn for the old one. A project's settings are a property of the video
   * rather than of the person, so they come back with it.
   *
   * `update` takes a partial and shallow-merges, so handing it a keyless snapshot leaves
   * `apiKeys` exactly as it is. That is the whole reason `projectSettings` strips them on the way
   * out: a project can restore how a video was made without having any opinion about which keys
   * are current.
   *
   * It runs on the same render the hydrate effect consumes `opened` on — hook order puts
   * `useSloperRun`'s effects before this file's, but `project.opened` in this closure is still the
   * value this render was given, so clearing it there does not skip this.
   */
  const openedSettings = project.opened?.settings ?? null;
  useEffect(() => {
    if (openedSettings) update(openedSettings);
  }, [openedSettings, update]);

  /*
   * The assembly stage starts working the moment it is reached, rather than behind another
   * button: by then every choice has been made and the only thing left is the wait.
   *
   * The latch is a ref rather than the phase, because `run` is a fresh object on every render —
   * the effect therefore runs on every render, and a phase updated by `setState` is still the old
   * value on the render that scheduled it. Without the ref that is two uploads of 20 MB. `reset`
   * and the Retry button clear it by moving off the stage and calling `startAssembly` directly.
   *
   * A project reopened onto an assembly that is already running lands on this stage with a phase
   * of its own, which is what the `idle` test keeps out: the wait screen is then a report on work
   * happening elsewhere, and starting a second assembly of it is the one thing that must not
   * happen here.
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

  // The two badges answer two different questions and are deliberately not merged: the first is
  // "are my keys on this account", the second is "is this sitting on this account". Either can be
  // fine while the other is not.
  const saveLabel =
    project.state === 'saving' ? t.saveSaving
    : project.state === 'saved' ? t.saveSaved
    : project.state === 'loading' ? t.saveLoading
    : project.state === 'error' ? t.saveError
    : project.state === 'idle' ? t.saveIdle
    : t.saveOff;

  return (
    // The menu bar spans the window, above the rail and the sheet both, because it belongs to the
    // page's title bar rather than to either column — see the note at the top of `ProjectMenu`.
    <div className="slp-shell">
      <ProjectMenu
        enabled={project.enabled}
        openId={project.id}
        openName={project.name}
        list={project.list}
        onOpen={project.open}
        t={t}
        lang={lang}
      />

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

          {/* A `?p=` that names nothing this account can see. Worth a sentence rather than a silent
              redirect: the usual cause is a link opened while signed into the wrong account, and
              "starting a fresh one" is the difference between that and "your project is gone". */}
          {project.missing && <p className="slp-note">{t.projectMissing}</p>}

          {run.restoring && <p className="slp-note">{t.restoringVideo}</p>}

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
              onStart={() => {
                // Where a project is minted. Not on load — the list is meant to be the videos you
                // made, not the times you opened the page.
                project.begin();
                run.goTo('scenes');
              }}
              t={t}
              lang={lang}
            />
          )}

          {run.stage === 'scenes' && (
            <ScenesStage
              config={config}
              prompt={run.prompt}
              onPromptChange={run.setPrompt}
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
              background={run.assemblyBackground}
              uploadMB={run.uploadMB}
              error={run.error}
              onRetry={() => void run.startAssembly(config)}
              onBack={() => run.goTo('assets')}
              t={t}
            />
          )}

          {run.stage === 'output' && run.video && (
            <OutputStage video={run.video} saved={project.enabled} onStartOver={run.reset} t={t} />
          )}

          {/* The status strip sits at the foot of the sheet, where a property sheet's own does, and
              the sentence that explains an amber badge sits with the badge rather than a screen
              away from it. */}
          {sync === 'error' && <p className="slp-note">{t.syncErrorHint}</p>}
          {project.state === 'error' && <p className="slp-note">{t.saveErrorHint}</p>}

          <div className="slp-statusbar">
            <span className={`slp-sync slp-sync-${sync}`}>{syncLabel}</span>
            <span className={`slp-sync slp-save-${project.state}`}>{saveLabel}</span>
            {auth.user?.email && <span className="slp-who">{auth.user.email}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
