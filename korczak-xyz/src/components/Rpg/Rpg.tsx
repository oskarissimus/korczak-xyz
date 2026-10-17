/*
 * The RPG: a village, the hunter, and a quest a model writes one beat at a time on the reader's own
 * key — or the hand-written one when there is no key or the opening cannot be played.
 *
 * A quest is a chain of beats (`utils/rpg/quest.ts`): a character somewhere, maybe a job there
 * first, then a situation and two or three decisions. Each decision either ends the quest or has
 * the model write the next beat, with everything decided so far; the next beat is asked for the
 * moment the hunter decides, so it is mostly written while the answer is still being read. A
 * finished quest goes into the chronicle (`chronicle.ts`), which every later quest is written
 * against. Space and time are `RpgScene`'s; the dialogue is a menu of lines the beat already
 * wrote, so talking costs no request.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

import { useAccountKeys } from '../../hooks/useAccountKeys';
import { useAuth } from '../../hooks/useAuth';
import { describeError, log } from '../../lib/logger';
import { addToChronicle, clearChronicle, loadChronicle } from '../../utils/rpg/chronicle';
import type { PlaceSpec } from '../../utils/rpg/place';
import {
  planDecisions,
  SEEDS,
  staticBeat,
  type Beat,
  type Character,
  type ChronicleEntry,
  type Decision,
  type Job,
  type Lang,
  type StepRecord,
} from '../../utils/rpg/quest';
import { recordQuest } from '../../utils/rpg/questLog';
import { generateBeat, type QuestSource } from '../../utils/rpg/storyteller';
import { primeVoice, speakLines, stopVoice, type SpokenLine } from '../../utils/rpg/voice';
import { RpgScene } from './RpgScene';
import { translations } from './translations';

interface DialogueLine {
  speaker: string;
  voice: Character['gender'];
  text: string;
}

interface Choice {
  label: string;
  action: () => void;
}

interface Ending {
  title: string;
  speaker: string;
  text: string;
  steps: StepRecord[];
}

interface Written {
  beat: Beat | null;
  failure: string | null;
}

declare global {
  interface Window {
    rpg?: {
      scene: RpgScene;
      state: () => {
        beat: Beat | null;
        progress: number;
        history: StepRecord[];
        ending: Ending | null;
        chronicle: ChronicleEntry[];
        busy: boolean;
      };
    };
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
  const uidRef = useRef<string | null>(null);
  uidRef.current = auth.user?.uid ?? null;
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

  const [beat, setBeat] = useState<Beat | null>(null);
  const [progress, setProgress] = useState(0);
  const [history, setHistory] = useState<StepRecord[]>([]);
  const [ending, setEnding] = useState<Ending | null>(null);
  const [chronicle, setChronicle] = useState<ChronicleEntry[]>([]);
  const [dialogue, setDialogue] = useState<{ line: DialogueLine; choices: Choice[] } | null>(null);
  const [prompt, setPrompt] = useState<'talk' | 'pickup' | null>(null);
  const [hp, setHp] = useState(100);
  const [compass, setCompass] = useState<{ angle: number; distance: number } | null>(null);
  const [locked, setLocked] = useState(false);
  const [started, setStarted] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  /** The opening is being written. */
  const [generating, setGenerating] = useState(false);
  /** A decision was made and its next beat is not written yet. */
  const [unfolding, setUnfolding] = useState(false);

  // The scene's callbacks are bound once; they read the story through refs.
  const beatRef = useRef<Beat | null>(null);
  const progressRef = useRef(0);
  const historyRef = useRef<StepRecord[]>([]);
  const endingRef = useRef<Ending | null>(null);
  const chronicleRef = useRef<ChronicleEntry[]>([]);
  const busyRef = useRef(false);
  beatRef.current = beat;
  progressRef.current = progress;
  endingRef.current = ending;
  chronicleRef.current = chronicle;
  busyRef.current = generating || unfolding;

  /** This quest's places and characters, which a later beat may return to. */
  const placesRef = useRef<PlaceSpec[]>([]);
  const charactersRef = useRef<Character[]>([]);
  /** What each character last said, for talking to them again after their beat. */
  const lastLinesRef = useRef(new Map<string, string>());
  /** The current beat has been decided; its character has nothing more to offer. */
  const decidedRef = useRef(false);
  /** The opening could not be written, so the whole quest is the hand-written one. */
  const staticRef = useRef(false);
  const seedRef = useRef(SEEDS[0]);
  const pendingRef = useRef<Promise<Written> | null>(null);

  const openTalkRef = useRef<(name: string) => void>(() => {});
  /** Every line already heard in this quest, by voice and text: each one is spoken once. */
  const spokenRef = useRef(new Set<string>());
  /** What the hunter just chose, to be said before the answer to it. */
  const chosenRef = useRef<string | null>(null);

  const flash = useCallback((text: string, ms = 2600) => {
    setToast(text);
    window.setTimeout(() => setToast((current) => (current === text ? null : current)), ms);
  }, []);

  useEffect(() => setChronicle(loadChronicle(gameLang)), [gameLang]);

  // --- the story ----------------------------------------------------------------------------------

  /** Asks for beat `index`, which `job` (the decision before it) leads into. */
  const writeBeat = useCallback(
    async (index: number, job: Job | null, steps: StepRecord[], title: string | null): Promise<Written> => {
      if (staticRef.current) return { beat: staticBeat(gameLang, index), failure: null };
      const keys = { google: account.keys.google, openai: account.keys.openai };
      try {
        const attempt = await generateBeat(keys, {
          lang: gameLang,
          index,
          seed: seedRef.current,
          job,
          plan: planDecisions(index),
          title,
          history: steps,
          chronicle: chronicleRef.current,
          places: placesRef.current,
          characters: charactersRef.current,
        });
        recordQuest(uidRef.current, attempt, gameLang);
        if (attempt.beat) return { beat: attempt.beat, failure: null };
        return { beat: null, failure: attempt.outcome === 'no-key' ? null : (attempt.error ?? attempt.outcome) };
      } catch (e) {
        log.warn('rpg.beat.crashed', describeError(e));
        return { beat: null, failure: e instanceof Error ? e.message : String(e) };
      }
    },
    [account.keys.google, account.keys.openai, gameLang],
  );

  /** Puts a beat into the world: its place, its character, its job, and the marker. */
  const setupBeat = useCallback(
    (b: Beat) => {
      const scene = sceneRef.current;
      if (b.place) {
        scene?.addPlace(b.place);
        if (!placesRef.current.some((p) => p.name === b.place!.name)) placesRef.current = [...placesRef.current, b.place];
      }
      scene?.placeNpc(b.npc.name, b.npc.color, b.place?.name ?? null);
      if (!charactersRef.current.some((c) => c.name === b.npc.name)) charactersRef.current = [...charactersRef.current, b.npc];
      if (b.job) scene?.spawnObjective(b.job.kind, b.job.count, b.job.look, b.place?.name ?? null);
      else scene?.clearObjective();
      progressRef.current = 0;
      setProgress(0);
      decidedRef.current = false;
      scene?.setMarker(b.job && b.place ? { place: b.place.name } : { npc: b.npc.name });
      beatRef.current = b;
      setBeat(b);
      if (b.index > 0) flash(`${tRef.current.nextStep}: ${b.objectiveText}`, 4500);
    },
    [flash],
  );

  const startQuest = useCallback(async () => {
    setGenerating(true);
    setDialogue(null);
    setEnding(null);
    setBeat(null);
    setHistory([]);
    historyRef.current = [];
    placesRef.current = [];
    charactersRef.current = [];
    lastLinesRef.current.clear();
    spokenRef.current.clear();
    staticRef.current = false;
    pendingRef.current = null;
    seedRef.current = SEEDS[Math.floor(Math.random() * SEEDS.length)];
    const scene = sceneRef.current;
    scene?.clearObjective();
    scene?.clearPlaces();
    scene?.clearNpcs();
    scene?.setMarker(null);
    scene?.teleport('spawn');

    const { beat: opening, failure } = await writeBeat(0, null, [], null);
    if (!opening) staticRef.current = true;
    setupBeat(opening ?? staticBeat(gameLang, 0));
    setGenerating(false);
    // Said on screen, with the provider's own reason: "always the drowners" with no explanation
    // is how the first version failed.
    if (failure) flash(`${tRef.current.storyFailed} (${failure.slice(0, 160)})`, 9000);
  }, [flash, gameLang, setupBeat, writeBeat]);

  const finish = useCallback(
    (b: Beat, speaker: string, text: string, steps: StepRecord[]) => {
      const entry: ChronicleEntry = { title: b.title, at: Date.now(), steps, ending: text };
      setChronicle(addToChronicle(gameLang, entry));
      setEnding({ title: b.title, speaker, text, steps });
      setDialogue(null);
      const scene = sceneRef.current;
      scene?.setMarker(null);
      scene?.clearObjective();
      scene?.heal();
    },
    [gameLang],
  );

  // --- the scene ----------------------------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const scene = new RpgScene(canvas, {
      onPrompt: setPrompt,
      onTalk: (name) => openTalkRef.current(name),
      onProgress: () => {
        const b = beatRef.current;
        if (!b?.job) return;
        const done = progressRef.current + 1;
        progressRef.current = done;
        setProgress(done);
        if (done === b.job.count) {
          scene.setMarker({ npc: b.npc.name });
          flash(tRef.current.jobDone(b.npc.name), 4000);
        }
      },
      onHealth: setHp,
      onDeath: () => flash(tRef.current.died),
      onCompass: (angle, distance) => setCompass(angle === null ? null : { angle, distance }),
      onLockChange: setLocked,
      onArrive: (name) => flash(`${tRef.current.arrived}: ${name}`, 4000),
    });
    sceneRef.current = scene;
    scene.setPaused(true);
    scene.resize(container.clientWidth, container.clientHeight);
    scene.start();
    window.rpg = {
      scene,
      state: () => ({
        beat: beatRef.current,
        progress: progressRef.current,
        history: historyRef.current,
        ending: endingRef.current,
        chronicle: chronicleRef.current,
        busy: busyRef.current,
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
    sceneRef.current?.setPaused(!started || dialogue !== null || generating || unfolding || ending !== null);
  }, [started, dialogue, generating, unfolding, ending]);

  // --- dialogue -----------------------------------------------------------------------------------

  const close = useCallback(() => {
    setDialogue(null);
    // Straight back to the world: the click that closed the dialogue is a user gesture.
    window.setTimeout(() => sceneRef.current?.requestLock(), 0);
  }, []);

  const proceed = useCallback(
    async (b: Beat, d: Decision, steps: StepRecord[]) => {
      close();
      setUnfolding(true);
      const { beat: next, failure } = (await pendingRef.current) ?? { beat: null, failure: 'nothing was asked' };
      pendingRef.current = null;
      setUnfolding(false);
      if (next) {
        setupBeat(next);
        return;
      }
      // A quest that cannot go on still ends on the decision the hunter made, not on an error.
      flash(`${tRef.current.trailCold} (${(failure ?? '').slice(0, 160)})`, 9000);
      finish(b, b.npc.name, d.reply, steps);
    },
    [close, finish, flash, setupBeat],
  );

  const decide = useCallback(
    (b: Beat, d: Decision) => {
      const step: StepRecord = {
        npcName: b.npc.name,
        placeName: b.place?.name ?? null,
        situation: b.situation.slice(0, 300),
        chose: d.label,
        consequence: d.consequence,
      };
      const steps = [...historyRef.current, step];
      historyRef.current = steps;
      setHistory(steps);
      lastLinesRef.current.set(b.npc.name, d.reply);
      decidedRef.current = true;
      const line: DialogueLine = { speaker: b.npc.name, voice: b.npc.gender, text: d.reply };
      if (!d.next) {
        setDialogue({ line, choices: [{ label: t.theEnd, action: () => finish(b, b.npc.name, d.reply, steps) }] });
        return;
      }
      // Asked now, so most of it is written while the answer is being read and spoken.
      pendingRef.current = writeBeat(b.index + 1, d.next, steps, b.title);
      setDialogue({ line, choices: [{ label: t.onward, action: () => void proceed(b, d, steps) }] });
    },
    [finish, proceed, t, writeBeat],
  );

  const openTalk = useCallback(
    (name: string) => {
      const b = beatRef.current;
      if (!b || endingRef.current) return;
      const bye: Choice = { label: t.goodbye, action: close };
      const who = charactersRef.current.find((c) => c.name === name);
      if (name !== b.npc.name || decidedRef.current) {
        setDialogue({
          line: { speaker: name, voice: who?.gender ?? 'male', text: lastLinesRef.current.get(name) ?? t.nothingMore },
          choices: [bye],
        });
        return;
      }
      const npc = (text: string): DialogueLine => ({ speaker: b.npc.name, voice: b.npc.gender, text });
      const smallTalk = (back: () => void): Choice[] =>
        b.smallTalk.map((o) => ({
          label: o.label,
          action: () => setDialogue({ line: npc(o.reply), choices: [{ label: t.back, action: back }] }),
        }));

      if (b.job && progressRef.current < b.job.count) {
        const root = () => setDialogue({ line: npc(b.waitingLine), choices: [...smallTalk(() => root()), bye] });
        root();
        return;
      }
      const situation = () =>
        setDialogue({
          line: npc(b.situation),
          choices: [...b.decisions.map((d) => ({ label: d.label, action: () => decide(b, d) })), bye],
        });
      if (!b.greeting) {
        situation();
        return;
      }
      const root = () =>
        setDialogue({
          line: npc(b.greeting),
          choices: [{ label: b.index === 0 ? t.askWork : t.askMore, action: situation }, ...smallTalk(() => root()), bye],
        });
      root();
    },
    [close, decide, t],
  );
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
    if (!voiceOn || !voiceKey) {
      stopVoice();
      return;
    }
    const wanted: SpokenLine[] = [];
    if (chosen) wanted.push({ text: chosen, voice: 'player' });
    if (dialogue) wanted.push({ text: dialogue.line.text, voice: dialogue.line.voice });
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
  }, [dialogue, flash, gameLang, voiceKey, voiceOn]);
  useEffect(() => stopVoice, []);

  const begin = () => {
    // Inside the click: iOS lets only an element a gesture touched play audio later.
    primeVoice();
    setStarted(true);
    void startQuest();
  };

  const fullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => {});
  };

  // --- render -------------------------------------------------------------------------------------

  const jobOpen = beat?.job ? progress < beat.job.count : false;
  const objective = !beat || ending
    ? null
    : jobOpen
      ? `${beat.objectiveText} (${progress}/${beat.job!.count})`
      : beat.job || beat.index === 0
        ? t.talkTo(beat.npc.name)
        : beat.objectiveText;

  return (
    <div className="rpg-container" ref={containerRef}>
      <canvas ref={canvasRef} className="rpg-canvas" />

      {started && (
        <>
          <div className="rpg-journal">
            {beat && <div className="rpg-journal-title">{beat.title}</div>}
            {objective && <div className="rpg-journal-objective">◆ {objective}</div>}
            {beat?.place && !ending && <div className="rpg-journal-place">{beat.place.name}</div>}
            {history.slice(-3).map((step, i) => (
              <div key={`${i}-${step.chose}`} className="rpg-journal-step">
                ◇ {step.chose}
              </div>
            ))}
            {ending && <div className="rpg-journal-objective">✓ {t.completed}</div>}
          </div>

          <div className="rpg-hp" aria-label={`${t.health} ${hp}`}>
            <div className="rpg-hp-fill" style={{ width: `${hp}%` }} />
          </div>

          {compass && !ending && (
            <div className="rpg-compass">
              <span className="rpg-compass-arrow" style={{ transform: `rotate(${compass.angle}rad)` }}>
                ▲
              </span>
              <span className="rpg-compass-distance">{Math.round(compass.distance)} m</span>
            </div>
          )}

          {!locked && !dialogue && !ending && <div className="rpg-hint">{t.clickToLook}</div>}

          {prompt && !dialogue && !ending && (
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
          {chronicle.length > 0 && (
            <p className="rpg-chronicle">
              {t.chronicle(chronicle.length)}{' '}
              <button
                type="button"
                onClick={() => {
                  clearChronicle(gameLang);
                  setChronicle([]);
                }}
              >
                {t.forget}
              </button>
            </p>
          )}
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

      {started && ending && !generating && (
        <div className="rpg-overlay rpg-ending">
          <h2>{t.questComplete}</h2>
          <p className="rpg-ending-title">{ending.title}</p>
          <blockquote>
            <p>{ending.text}</p>
            <footer>{ending.speaker}</footer>
          </blockquote>
          {ending.steps.length > 0 && (
            <>
              <h3>{t.yourDecisions}</h3>
              <ol className="rpg-ending-steps">
                {ending.steps.map((step, i) => (
                  <li key={`${i}-${step.chose}`}>
                    <strong>{step.chose}</strong> {step.consequence}
                  </li>
                ))}
              </ol>
            </>
          )}
          <p className="rpg-ending-note">{t.remembered}</p>
          <button type="button" className="rpg-start" onClick={() => void startQuest()}>
            {t.newQuest}
          </button>
        </div>
      )}

      {started && (generating || unfolding) && (
        <div className="rpg-overlay">
          <p>{generating ? t.writing : t.fate}</p>
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
