/*
 * The RPG: a village, one quest giver, and a quest a model writes on the reader's own key — or the
 * hand-written one when there is no key or the model's answer cannot be played.
 *
 * The story is a small state machine here (`QuestState`); space and time are `RpgScene`'s. The
 * dialogue is a menu built from the quest's lines, not a chat: every option is one the quest
 * already wrote, so talking costs no request and cannot wander off the quest.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

import { useAccountKeys } from '../../hooks/useAccountKeys';
import { useAuth } from '../../hooks/useAuth';
import { describeError, log } from '../../lib/logger';
import { staticQuest, type Lang, type Quest } from '../../utils/rpg/quest';
import { generateQuest, type QuestSource } from '../../utils/rpg/storyteller';
import { RpgScene } from './RpgScene';
import { translations } from './translations';

type QuestState = 'available' | 'active' | 'ready' | 'done';

interface DialogueLine {
  speaker: string;
  text: string;
}

interface Choice {
  label: string;
  action: () => void;
}

declare global {
  interface Window {
    rpg?: { scene: RpgScene; state: () => { quest: Quest; questState: QuestState; progress: number } };
  }
}

export default function Rpg({ lang }: { lang: Lang }) {
  const t = translations[lang];
  const auth = useAuth();
  const account = useAccountKeys(auth.user);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<RpgScene | null>(null);

  const [quest, setQuest] = useState<Quest | null>(null);
  const [source, setSource] = useState<QuestSource>('static');
  const [questState, setQuestState] = useState<QuestState>('available');
  const [progress, setProgress] = useState(0);
  const [dialogue, setDialogue] = useState<{ line: DialogueLine; choices: Choice[] } | null>(null);
  const [prompt, setPrompt] = useState<'talk' | 'pickup' | null>(null);
  const [hp, setHp] = useState(100);
  const [compass, setCompass] = useState<{ angle: number; distance: number } | null>(null);
  const [locked, setLocked] = useState(false);
  const [started, setStarted] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  // The scene's callbacks are bound once; they read the story through refs.
  const questRef = useRef<Quest | null>(null);
  const questStateRef = useRef<QuestState>('available');
  const progressRef = useRef(0);
  questRef.current = quest;
  questStateRef.current = questState;
  progressRef.current = progress;

  const openTalkRef = useRef<() => void>(() => {});

  const flash = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast((current) => (current === text ? null : current)), 2600);
  }, []);

  // --- the quest ----------------------------------------------------------------------------------

  const loadQuest = useCallback(async () => {
    setGenerating(true);
    const keys = { google: account.keys.google, openai: account.keys.openai };
    let next: Quest = staticQuest(lang);
    let from: QuestSource = 'static';
    try {
      const generated = await generateQuest(keys, lang);
      if (generated) {
        next = generated.quest;
        from = generated.source;
      } else if (keys.google || keys.openai) {
        log.warn('rpg.quest.unusable', {});
      }
    } catch (e) {
      log.warn('rpg.quest.failed', describeError(e));
    }
    setQuest(next);
    setSource(from);
    setQuestState('available');
    setProgress(0);
    sceneRef.current?.clearObjective();
    sceneRef.current?.setMarker('npc');
    setGenerating(false);
  }, [account.keys.google, account.keys.openai, lang]);

  const loadedRef = useRef(false);
  useEffect(() => {
    if (!account.ready || loadedRef.current) return;
    loadedRef.current = true;
    void loadQuest();
  }, [account.ready, loadQuest]);

  // --- the scene ----------------------------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const scene = new RpgScene(canvas, {
      onPrompt: setPrompt,
      onTalk: () => openTalkRef.current(),
      onProgress: () => {
        const q = questRef.current;
        if (!q || questStateRef.current !== 'active') return;
        const done = progressRef.current + 1;
        progressRef.current = done;
        setProgress(done);
        if (done >= q.count) {
          setQuestState('ready');
          scene.setMarker('npc');
        }
      },
      onHealth: setHp,
      onDeath: () => flash(translations[lang].died),
      onCompass: (angle, distance) => setCompass(angle === null ? null : { angle, distance }),
      onLockChange: setLocked,
    });
    sceneRef.current = scene;
    scene.setPaused(true);
    scene.setMarker('npc');
    scene.resize(container.clientWidth, container.clientHeight);
    scene.start();
    window.rpg = {
      scene,
      state: () => ({
        quest: questRef.current!,
        questState: questStateRef.current,
        progress: progressRef.current,
      }),
    };

    const observer = new ResizeObserver(() => scene.resize(container.clientWidth, container.clientHeight));
    observer.observe(container);
    return () => {
      observer.disconnect();
      scene.dispose();
      sceneRef.current = null;
      delete window.rpg;
    };
  }, [flash, lang]);

  // The world stands still whenever something other than walking has the reader's attention.
  useEffect(() => {
    sceneRef.current?.setPaused(!started || dialogue !== null || generating || questState === 'done');
  }, [started, dialogue, generating, questState]);

  // --- dialogue -----------------------------------------------------------------------------------

  const close = useCallback(() => {
    setDialogue(null);
    // Straight back to the world: the click that closed the dialogue is a user gesture.
    window.setTimeout(() => sceneRef.current?.requestLock(), 0);
  }, []);

  const openTalk = useCallback(() => {
    const q = questRef.current;
    if (!q) return;
    const npc = (text: string): DialogueLine => ({ speaker: q.npcName, text });
    const state = questStateRef.current;

    const smallTalk = (back: () => void): Choice[] =>
      q.smallTalk.map((o) => ({ label: o.label, action: () => setDialogue({ line: npc(o.reply), choices: [{ label: t.back, action: back }] }) }));

    const bye: Choice = { label: t.goodbye, action: close };

    if (state === 'available') {
      const root = () =>
        setDialogue({
          line: npc(q.greeting),
          choices: [
            {
              label: t.askWork,
              action: () =>
                setDialogue({
                  line: npc(q.pitch),
                  choices: [
                    {
                      label: t.accept,
                      action: () => {
                        setQuestState('active');
                        setProgress(0);
                        sceneRef.current?.spawnObjective(q.location, q.kind, q.count);
                        sceneRef.current?.setMarker(q.location);
                        setDialogue({ line: npc(q.acceptLine), choices: [bye] });
                        flash(`${t.questStarted}: ${q.title}`);
                      },
                    },
                    { label: t.decline, action: () => setDialogue({ line: npc(q.declineLine), choices: [bye] }) },
                  ],
                }),
            },
            ...smallTalk(() => root()),
            bye,
          ],
        });
      root();
    } else if (state === 'active') {
      const root = () =>
        setDialogue({ line: npc(q.waitingLine), choices: [...smallTalk(() => root()), bye] });
      root();
    } else if (state === 'ready') {
      setDialogue({
        line: npc(q.greeting),
        choices: [
          {
            label: t.itsDone,
            action: () => {
              setQuestState('done');
              sceneRef.current?.setMarker(null);
              sceneRef.current?.heal();
              setDialogue({ line: npc(q.completeLine), choices: [{ label: t.goodbye, action: () => setDialogue(null) }] });
            },
          },
        ],
      });
    } else {
      setDialogue({ line: npc(t.thanksAgain), choices: [bye] });
    }
  }, [close, flash, t]);
  openTalkRef.current = openTalk;

  // Escape closes a dialogue; number keys pick an option, as in every RPG since the nineties.
  useEffect(() => {
    if (!dialogue) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      const n = Number(e.key);
      if (n >= 1 && n <= dialogue.choices.length) dialogue.choices[n - 1].action();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, dialogue]);

  const begin = () => {
    setStarted(true);
    sceneRef.current?.setPaused(false);
    sceneRef.current?.requestLock();
  };

  const newQuest = async () => {
    setDialogue(null);
    sceneRef.current?.teleport('npc');
    await loadQuest();
  };

  const fullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => {});
  };

  // --- render -------------------------------------------------------------------------------------

  const objective =
    quest && questState === 'active'
      ? `${quest.objectiveText} (${progress}/${quest.count})`
      : quest && questState === 'ready'
        ? t.returnTo(quest.npcName)
        : quest && questState === 'available'
          ? t.talkTo(quest.npcName)
          : null;

  return (
    <div className="rpg-container" ref={containerRef}>
      <canvas ref={canvasRef} className="rpg-canvas" />

      {started && (
        <>
          <div className="rpg-journal">
            {quest && <div className="rpg-journal-title">{quest.title}</div>}
            {objective && <div className="rpg-journal-objective">◆ {objective}</div>}
            {questState === 'done' && <div className="rpg-journal-objective">✓ {t.completed}</div>}
          </div>

          <div className="rpg-hp" aria-label={`${t.health} ${hp}`}>
            <div className="rpg-hp-fill" style={{ width: `${hp}%` }} />
          </div>

          {compass && questState !== 'done' && (
            <div className="rpg-compass">
              <span className="rpg-compass-arrow" style={{ transform: `rotate(${compass.angle}rad)` }}>
                ▲
              </span>
              <span className="rpg-compass-distance">{Math.round(compass.distance)} m</span>
            </div>
          )}

          {!locked && !dialogue && questState !== 'done' && <div className="rpg-hint">{t.clickToLook}</div>}

          {prompt && !dialogue && (
            <div className="rpg-prompt">
              <kbd>E</kbd> {prompt === 'talk' ? t.talk : t.pickUp}
            </div>
          )}

          {toast && <div className="rpg-toast">{toast}</div>}
        </>
      )}

      {dialogue && (
        <div className="rpg-dialogue" role="dialog">
          <div className="rpg-dialogue-speaker">{dialogue.line.speaker}</div>
          <p className="rpg-dialogue-text">{dialogue.line.text}</p>
          <ol className="rpg-dialogue-choices">
            {dialogue.choices.map((c, i) => (
              <li key={`${i}-${c.label}`}>
                <button type="button" onClick={c.action}>
                  <span className="rpg-choice-n">{i + 1}.</span> {c.label}
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}

      {!started && (
        <div className="rpg-overlay">
          <h2>{t.title}</h2>
          <p>{t.intro}</p>
          <ul className="rpg-controls">
            <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> {t.move}</li>
            <li><kbd>Shift</kbd> {t.run}</li>
            <li>{t.mouse}</li>
            <li><kbd>LMB</kbd> {t.attack}</li>
            <li><kbd>E</kbd> {t.interact}</li>
          </ul>
          <p className="rpg-source">
            {generating ? t.writing : source === 'static' ? t.staticQuest : t.aiQuest(source)}
            {!generating && source === 'static' && (
              <>
                {' '}
                <a href={lang === 'pl' ? '/pl/account/' : '/account/'}>{t.addKey}</a>
              </>
            )}
          </p>
          <button type="button" className="rpg-start" disabled={generating || !quest} onClick={begin}>
            {generating ? t.wait : t.start}
          </button>
        </div>
      )}

      {started && questState === 'done' && !dialogue && (
        <div className="rpg-overlay">
          <h2>{t.questComplete}</h2>
          {quest && <p>{quest.title}</p>}
          <button type="button" className="rpg-start" disabled={generating} onClick={() => void newQuest()}>
            {generating ? t.writing : t.newQuest}
          </button>
        </div>
      )}

      {started && generating && <div className="rpg-toast">{t.writing}</div>}

      <button type="button" className="rpg-fullscreen" onClick={fullscreen} title={t.fullscreen}>
        ⛶
      </button>
    </div>
  );
}
