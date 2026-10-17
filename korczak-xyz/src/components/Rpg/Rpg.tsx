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
import { primeVoice, speakLines, stopVoice, type SpokenLine } from '../../utils/rpg/voice';
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
  // The game's language is asked on the intro screen; the page's is only where it starts.
  const [gameLang, setGameLang] = useState<Lang>(lang);
  const t = translations[gameLang];
  const tRef = useRef(t);
  tRef.current = t;
  const auth = useAuth();
  const account = useAccountKeys(auth.user);
  // A signed-in reader's keys may be in the account and not yet in this browser, so nothing decides
  // "no key" before the account has answered — or failed to.
  const keysReady =
    account.ready &&
    !auth.loading &&
    (!auth.user || account.sync === 'synced' || account.sync === 'error');
  const storyProvider: QuestSource = account.keys.google ? 'google' : account.keys.openai ? 'openai' : 'static';
  const voiceKey = account.keys.elevenLabs;
  const [voiceOn, setVoiceOn] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<RpgScene | null>(null);

  const [quest, setQuest] = useState<Quest | null>(null);
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
  /** Every line already heard in this quest, by voice and text: each one is spoken once. */
  const spokenRef = useRef(new Set<string>());
  /** What the hunter just chose, to be said before the answer to it. */
  const chosenRef = useRef<string | null>(null);

  const flash = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast((current) => (current === text ? null : current)), 2600);
  }, []);

  // --- the quest ----------------------------------------------------------------------------------

  const loadQuest = useCallback(async () => {
    setGenerating(true);
    spokenRef.current.clear();
    const keys = { google: account.keys.google, openai: account.keys.openai };
    let next: Quest = staticQuest(gameLang);
    let from: QuestSource = 'static';
    try {
      const generated = await generateQuest(keys, gameLang);
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
    setQuestState('available');
    setProgress(0);
    sceneRef.current?.clearObjective();
    sceneRef.current?.setMarker('npc');
    setGenerating(false);
    if (from === 'static' && (keys.google || keys.openai)) flash(tRef.current.storyFailed);
  }, [account.keys.google, account.keys.openai, flash, gameLang]);

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
      onDeath: () => flash(tRef.current.died),
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
  }, [flash]);

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

  const choose = useCallback((choice: Choice) => {
    chosenRef.current = choice.label;
    choice.action();
  }, []);

  // Escape closes a dialogue; number keys pick an option, as in every RPG since the nineties.
  useEffect(() => {
    if (!dialogue) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      const n = Number(e.key);
      if (n >= 1 && n <= dialogue.choices.length) choose(dialogue.choices[n - 1]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [choose, close, dialogue]);

  // Both sides speak, when there is an ElevenLabs key: the hunter's choice, then the answer. A line
  // heard once in this quest is not read again, so going back to a menu is silent.
  useEffect(() => {
    const chosen = chosenRef.current;
    chosenRef.current = null;
    if (!voiceOn || !voiceKey || !quest) {
      stopVoice();
      return;
    }
    const wanted: SpokenLine[] = [];
    if (chosen) wanted.push({ text: chosen, voice: 'player' });
    if (dialogue) wanted.push({ text: dialogue.line.text, voice: quest.npcGender });
    const fresh = wanted.filter((line) => !spokenRef.current.has(`${line.voice}:${line.text}`));
    if (fresh.length === 0) {
      // Closed with nothing left to say (Esc, walking off): silence. Otherwise let it finish.
      if (!dialogue) stopVoice();
      return;
    }
    for (const line of fresh) spokenRef.current.add(`${line.voice}:${line.text}`);
    speakLines(voiceKey, fresh, gameLang).catch((e) => {
      log.warn('rpg.voice.failed', describeError(e));
      flash(tRef.current.voiceFailed);
    });
  }, [dialogue, flash, gameLang, quest, voiceKey, voiceOn]);
  useEffect(() => stopVoice, []);

  const begin = () => {
    // Inside the click: iOS lets only an element a gesture touched play audio later.
    primeVoice();
    setStarted(true);
    void loadQuest();
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
                <button type="button" onClick={() => choose(c)}>
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
          <div className="rpg-lang" role="group" aria-label={t.language}>
            <span>{t.language}:</span>
            {(['pl', 'en'] as const).map((l) => (
              <button
                key={l}
                type="button"
                className={l === gameLang ? 'rpg-lang-on' : ''}
                aria-pressed={l === gameLang}
                onClick={() => setGameLang(l)}
              >
                {l === 'pl' ? 'Polski' : 'English'}
              </button>
            ))}
          </div>
          {keysReady ? (
            <ul className="rpg-source">
              <li>{storyProvider === 'static' ? t.staticQuest : t.aiQuest(storyProvider)}</li>
              <li>{voiceKey ? t.voiceOn : t.voiceOff}</li>
              {(storyProvider === 'static' || !voiceKey) && (
                <li>
                  <a href={lang === 'pl' ? '/pl/account/' : '/account/'}>{t.addKey}</a>
                </li>
              )}
            </ul>
          ) : (
            <p className="rpg-source">{t.readingKeys}</p>
          )}
          <button type="button" className="rpg-start" disabled={!keysReady} onClick={begin}>
            {keysReady ? t.start : t.wait}
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

      {started && generating && (
        <div className="rpg-overlay">
          <p>{t.writing}</p>
        </div>
      )}

      {started && voiceKey && (
        <button
          type="button"
          className="rpg-voice"
          onClick={() => setVoiceOn((on) => !on)}
          title={voiceOn ? t.mute : t.unmute}
          aria-pressed={voiceOn}
        >
          {voiceOn ? '🔊' : '🔇'}
        </button>
      )}

      <button type="button" className="rpg-fullscreen" onClick={fullscreen} title={t.fullscreen}>
        ⛶
      </button>
    </div>
  );
}
