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
import { addGenerationTime, resetDevlog } from '../../utils/rpg/devlog';
import { recordQuest, watchBeat } from '../../utils/rpg/questLog';
import { clearGame, loadGame, saveGame, type SavedGame } from '../../utils/rpg/save';
import { generateBeat, MODEL_CHOICES, modelChain, type QuestSource } from '../../utils/rpg/storyteller';
import { primeVoice, speakLines, stopVoice, type SpokenLine, type VoiceName } from '../../utils/rpg/voice';
import { DevConsole, QuestSummary, StreamPreview } from './DevConsole';
import { RpgScene, type Prompt } from './RpgScene';
import { translations } from './translations';

interface DialogueLine {
  speaker: string;
  voice: VoiceName;
  text: string;
}

interface Choice {
  label: string;
  action: () => void;
  /**
   * `plot` moves the story (a decision), `ask` only asks something and is greyed once asked; the
   * rest (goodbye, back) is neither. Owner, Oct 2026: what was asked should look asked, and what
   * drives the plot should stand out from what is only a question.
   */
  kind?: 'plot' | 'ask';
}

interface Dialogue {
  line: DialogueLine;
  choices: Choice[];
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

const MODEL_KEY = 'rpg-model';

export default function Rpg({ lang }: { lang: Lang }) {
  // The game's language is asked on the intro screen; the page's is only where it starts.
  const [gameLang, setGameLang] = useState<Lang>(lang);
  const t = translations[gameLang];
  const tRef = useRef(t);
  tRef.current = t;
  const gameLangRef = useRef(gameLang);
  gameLangRef.current = gameLang;
  /** The autosaved quest, offered on the intro screen. */
  const [saved, setSaved] = useState<SavedGame | null>(null);
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
  const [dialogue, setDialogue] = useState<Dialogue | null>(null);
  /**
   * While the hunter's chosen line is being read: the dialogue as it was, with the choice marked
   * and the rest greyed. The answer shows when its speaker starts talking. `id` keeps a stopped
   * queue from releasing a newer hold.
   */
  const [held, setHeld] = useState<{ dialogue: Dialogue; index: number; id: number } | null>(null);
  const holdIdRef = useRef(0);
  /** Every option asked in this quest, by speaker and label. */
  const askedRef = useRef(new Set<string>());
  const [devOpen, setDevOpen] = useState(false);
  /** The model asked first, from the intro screen; null is the usual order. */
  const [chosenModel, setChosenModel] = useState<string | null>(null);
  const chosenModelRef = useRef<string | null>(null);
  chosenModelRef.current = chosenModel;
  const [prompt, setPrompt] = useState<Prompt | null>(null);
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
  /** The current beat's clues the hunter has examined, by index. */
  const seenRef = useRef(new Set<number>());
  const [seenCount, setSeenCount] = useState(0);
  /** The current beat's story has been heard to the end, so talking again goes straight to it. */
  const heardRef = useRef(false);
  /** The current beat has been decided; its character has nothing more to offer. */
  const decidedRef = useRef(false);
  /** The opening could not be written, so the whole quest is the hand-written one. */
  const staticRef = useRef(false);
  const seedRef = useRef(SEEDS[0]);
  const pendingRef = useRef<Promise<Written> | null>(null);
  /** Every beat of this quest so far, for the autosave. */
  const beatsRef = useRef<Beat[]>([]);
  /** The current beat's decision, by index, once made. */
  const decisionRef = useRef<number | null>(null);

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

  // A quest left half way is offered on the intro screen, in its own language.
  useEffect(() => {
    const game = loadGame();
    if (!game) return;
    setSaved(game);
    setGameLang(game.lang);
  }, []);

  /** The autosave, at every step that changes the quest. */
  const persist = useCallback(() => {
    if (endingRef.current || beatsRef.current.length === 0) return;
    saveGame({
      lang: gameLangRef.current,
      seed: seedRef.current,
      static: staticRef.current,
      beats: beatsRef.current,
      progress: progressRef.current,
      history: historyRef.current,
      lastLines: [...lastLinesRef.current],
      seen: [...seenRef.current],
      heard: heardRef.current,
      decision: decisionRef.current,
    });
  }, []);

  // --- the story ----------------------------------------------------------------------------------

  /** Asks for beat `index`, which `job` (the decision before it) leads into. */
  const writeBeat = useCallback(
    async (index: number, job: Job | null, steps: StepRecord[], title: string | null): Promise<Written> => {
      if (staticRef.current) return { beat: staticBeat(gameLang, index), failure: null };
      const keys = { google: account.keys.google, openai: account.keys.openai };
      const chosen = chosenModelRef.current;
      const done = watchBeat(index, gameLang, chosen);
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
        }, chosen);
        addGenerationTime(attempt.ms);
        recordQuest(uidRef.current, attempt, gameLang, chosen);
        if (attempt.beat) return { beat: attempt.beat, failure: null };
        return { beat: null, failure: attempt.outcome === 'no-key' ? null : (attempt.error ?? attempt.outcome) };
      } catch (e) {
        log.error('rpg.beat.crashed', describeError(e));
        return { beat: null, failure: e instanceof Error ? e.message : String(e) };
      } finally {
        done();
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
      scene?.clearClues();
      b.clues.forEach((clue, i) => scene?.placeClue(`clue-${b.index}-${i}`, clue.look, b.npc.name));
      seenRef.current = new Set();
      setSeenCount(0);
      heardRef.current = false;
      if (b.witness) {
        const w = b.witness;
        scene?.placeNpc(w.npc.name, w.npc.color, b.place?.name ?? null, 1);
        if (!charactersRef.current.some((c) => c.name === w.npc.name)) charactersRef.current = [...charactersRef.current, w.npc];
      }
      if (b.job) scene?.spawnObjective(b.job.kind, b.job.count, b.job.look, b.place?.name ?? null);
      else scene?.clearObjective();
      progressRef.current = 0;
      setProgress(0);
      decidedRef.current = false;
      scene?.setMarker(b.job && b.place ? { place: b.place.name } : { npc: b.npc.name });
      beatRef.current = b;
      setBeat(b);
      beatsRef.current = [...beatsRef.current.filter((x) => x.index < b.index), b];
      decisionRef.current = null;
      persist();
      if (b.index > 0) flash(`${tRef.current.nextStep}: ${b.objectiveText}`, 4500);
    },
    [flash, persist],
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
    askedRef.current.clear();
    resetDevlog();
    beatsRef.current = [];
    decisionRef.current = null;
    clearGame();
    setSaved(null);
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
      // Told to the end and in the chronicle: nothing left to continue.
      clearGame();
      setSaved(null);
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
      onExamine: (id) => examineRef.current(id),
      onProgress: () => {
        const b = beatRef.current;
        if (!b?.job) return;
        const done = progressRef.current + 1;
        progressRef.current = done;
        setProgress(done);
        persist();
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
  }, [flash, persist]);

  // The world stands still whenever something other than walking has the reader's attention.
  useEffect(() => {
    sceneRef.current?.setPaused(!started || dialogue !== null || held !== null || generating || unfolding || ending !== null);
  }, [started, dialogue, held, generating, unfolding, ending]);

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
      decisionRef.current = b.decisions.indexOf(d);
      persist();
      const line: DialogueLine = { speaker: b.npc.name, voice: b.npc.gender, text: d.reply };
      if (!d.next) {
        setDialogue({ line, choices: [{ label: t.theEnd, action: () => finish(b, b.npc.name, d.reply, steps) }] });
        return;
      }
      // Asked now, so most of it is written while the answer is being read and spoken.
      pendingRef.current = writeBeat(b.index + 1, d.next, steps, b.title);
      setDialogue({ line, choices: [{ label: t.onward, action: () => void proceed(b, d, steps) }] });
    },
    [finish, persist, proceed, t, writeBeat],
  );

  const openTalk = useCallback(
    (name: string) => {
      const b = beatRef.current;
      if (!b || endingRef.current) return;
      const bye: Choice = { label: t.goodbye, action: close };
      const who = charactersRef.current.find((c) => c.name === name);
      const w = b.witness;
      if (w && name === w.npc.name && !decidedRef.current) {
        // Somebody else at the place, with their own side of it.
        const line = (text: string): DialogueLine => ({ speaker: w.npc.name, voice: w.npc.gender, text });
        const root = (): void =>
          setDialogue({
            line: line(w.greeting),
            choices: [
              ...w.talk.map((o) => ({
                label: o.label,
                kind: 'ask' as const,
                action: () => setDialogue({ line: line(o.reply), choices: [{ label: t.back, action: root }, bye] }),
              })),
              bye,
            ],
          });
        lastLinesRef.current.set(w.npc.name, w.greeting);
        root();
        return;
      }
      if (name !== b.npc.name || decidedRef.current) {
        setDialogue({
          line: { speaker: name, voice: who?.gender ?? 'male', text: lastLinesRef.current.get(name) ?? t.nothingMore },
          choices: [bye],
        });
        return;
      }
      const npc = (text: string): DialogueLine => ({ speaker: b.npc.name, voice: b.npc.gender, text });

      if (b.job && progressRef.current < b.job.count) {
        setDialogue({ line: npc(b.waitingLine), choices: [bye] });
        return;
      }
      // The story comes out in parts, one question at a time; the decisions, the questions and
      // what the clues opened up come only after the last part. Questions offered beside the
      // greeting named a silence and a girl the hunter had not heard of yet (owner, Oct 2026), and
      // a whole story in one line read as a summary, not a person (owner, Oct 2026).
      const last = b.story.length - 1;
      const followUps = (): Choice[] => [
        ...b.smallTalk.map((o) => ({
          label: o.label,
          kind: 'ask' as const,
          action: () => setDialogue({ line: npc(o.reply), choices: [{ label: t.back, action: ending }] }),
        })),
        ...b.clues
          .filter((_, i) => seenRef.current.has(i))
          .map((c) => ({
            label: c.ask,
            kind: 'ask' as const,
            action: () => setDialogue({ line: npc(c.reply), choices: [{ label: t.back, action: ending }] }),
          })),
      ];
      const ending = (): void => {
        if (!heardRef.current) {
          heardRef.current = true;
          persist();
        }
        setDialogue({
          line: npc(b.story[last].say),
          choices: [
            ...b.decisions.map((d) => ({ label: d.label, kind: 'plot' as const, action: () => decide(b, d) })),
            ...followUps(),
            bye,
          ],
        });
      };
      const part = (i: number): void => {
        if (i >= last) {
          ending();
          return;
        }
        setDialogue({
          line: npc(b.story[i].say),
          choices: [{ label: b.story[i + 1].ask, kind: 'ask', action: () => part(i + 1) }, bye],
        });
      };
      if (!b.greeting) {
        if (heardRef.current) ending();
        else part(0);
        return;
      }
      setDialogue({
        line: npc(b.greeting),
        choices: [
          heardRef.current ? { label: t.backToIt, action: ending } : { label: b.story[0].ask, kind: 'ask', action: () => part(0) },
          bye,
        ],
      });
    },
    [close, decide, persist, t],
  );
  openTalkRef.current = openTalk;

  const examine = useCallback(
    (id: string) => {
      const b = beatRef.current;
      const i = Number(id.split('-').pop());
      const clue = b?.clues[i];
      if (!b || !clue || endingRef.current) return;
      if (!seenRef.current.has(i)) {
        seenRef.current.add(i);
        setSeenCount(seenRef.current.size);
        persist();
      }
      setDialogue({ line: { speaker: `${t.hunter}: ${clue.name}`, voice: 'player', text: clue.text }, choices: [{ label: t.moveOn, action: close }] });
    },
    [close, persist, t],
  );
  const examineRef = useRef(examine);
  examineRef.current = examine;

  const choose = useCallback(
    (choice: Choice) => {
      if (held) return;
      const current = dialogue;
      if (current) askedRef.current.add(`${current.line.speaker}|${choice.label}`);
      chosenRef.current = choice.label;
      // With a voice, the hunter's line is read first and the answer waits for its own speaker.
      if (current && voiceOn && voiceKey && !spokenRef.current.has(`player:${choice.label}`)) {
        const index = current.choices.indexOf(choice);
        holdIdRef.current += 1;
        setHeld({ dialogue: current, index, id: holdIdRef.current });
      }
      choice.action();
    },
    [dialogue, held, voiceKey, voiceOn],
  );

  // Escape closes a dialogue; number keys pick an option, as in every RPG since the nineties.
  useEffect(() => {
    if (!dialogue || held) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      const n = Number(e.key);
      if (n >= 1 && n <= dialogue.choices.length) choose(dialogue.choices[n - 1]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [choose, close, dialogue, held]);

  // `~` (the key under Escape, whatever the layout prints on it) opens the developer console.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Backquote' && e.key !== '~' && e.key !== '`') return;
      e.preventDefault();
      setDevOpen((open) => !open);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The chosen model survives a reload; one this browser has no key for is not offered.
  useEffect(() => {
    try {
      setChosenModel(localStorage.getItem(MODEL_KEY));
    } catch {
      /* no storage, the usual order */
    }
  }, []);
  const pickModel = (id: string) => {
    const value = id || null;
    setChosenModel(value);
    try {
      if (value) localStorage.setItem(MODEL_KEY, value);
      else localStorage.removeItem(MODEL_KEY);
    } catch {
      /* forgotten on reload */
    }
  };
  const models = MODEL_CHOICES.filter((m) => (m.provider === 'google' ? account.keys.google : !account.keys.google && account.keys.openai));

  // Both sides speak, when there is an ElevenLabs key: the hunter's choice, then the answer. A line
  // heard once in this quest is not read again, so going back to a menu is silent.
  useEffect(() => {
    const chosen = chosenRef.current;
    chosenRef.current = null;
    if (!voiceOn || !voiceKey) {
      stopVoice();
      setHeld(null);
      return;
    }
    const wanted: SpokenLine[] = [];
    if (chosen) wanted.push({ text: chosen, voice: 'player' });
    if (dialogue) wanted.push({ text: dialogue.line.text, voice: dialogue.line.voice });
    const fresh = wanted.filter((line) => !spokenRef.current.has(`${line.voice}:${line.text}`));
    if (fresh.length === 0) {
      // Closed with nothing left to say (Esc, walking off): silence. Otherwise let it finish.
      if (!dialogue) stopVoice();
      setHeld(null);
      return;
    }
    for (const line of fresh) spokenRef.current.add(`${line.voice}:${line.text}`);
    const holdId = holdIdRef.current;
    const release = () => setHeld((h) => (h && h.id === holdId ? null : h));
    speakLines(voiceKey, fresh, gameLang, (line) => {
      if (line.voice !== 'player') release();
    })
      .catch((e) => {
        log.warn('rpg.voice.failed', describeError(e));
        flash(tRef.current.voiceFailed);
      })
      .finally(release);
  }, [dialogue, flash, gameLang, voiceKey, voiceOn]);
  useEffect(() => stopVoice, []);

  /** Rebuilds a saved quest: its places and characters, the current beat as it was, the decision. */
  const resume = (game: SavedGame) => {
    primeVoice();
    setStarted(true);
    setEnding(null);
    setDialogue(null);
    setGenerating(false);
    seedRef.current = game.seed;
    staticRef.current = game.static;
    placesRef.current = [];
    charactersRef.current = [];
    beatsRef.current = [];
    lastLinesRef.current = new Map(game.lastLines);
    spokenRef.current.clear();
    askedRef.current.clear();
    pendingRef.current = null;
    resetDevlog();
    const scene = sceneRef.current;
    scene?.clearObjective();
    scene?.clearPlaces();
    scene?.clearNpcs();
    scene?.setMarker(null);
    scene?.teleport('spawn');
    const remember = (c: Character) => {
      if (!charactersRef.current.some((x) => x.name === c.name)) charactersRef.current = [...charactersRef.current, c];
    };
    for (const b of game.beats.slice(0, -1)) {
      if (b.place) {
        scene?.addPlace(b.place);
        if (!placesRef.current.some((p) => p.name === b.place!.name)) placesRef.current = [...placesRef.current, b.place];
      }
      scene?.placeNpc(b.npc.name, b.npc.color, b.place?.name ?? null);
      remember(b.npc);
      if (b.witness) {
        scene?.placeNpc(b.witness.npc.name, b.witness.npc.color, b.place?.name ?? null, 1);
        remember(b.witness.npc);
      }
      beatsRef.current = [...beatsRef.current, b];
    }
    historyRef.current = game.history;
    setHistory(game.history);
    const current = game.beats[game.beats.length - 1];
    setupBeat(current);
    if (current.job && game.progress > 0) {
      const left = Math.max(0, current.job.count - game.progress);
      if (left > 0) scene?.spawnObjective(current.job.kind, left, current.job.look, current.place?.name ?? null);
      else {
        scene?.clearObjective();
        scene?.setMarker({ npc: current.npc.name });
      }
      progressRef.current = game.progress;
      setProgress(game.progress);
    }
    seenRef.current = new Set(game.seen);
    setSeenCount(game.seen.length);
    heardRef.current = game.heard;
    const d = game.decision === null ? null : current.decisions[game.decision];
    decisionRef.current = d ? game.decision : null;
    persist();
    if (!d) return;
    // Decided before the page went: carry it out now.
    decidedRef.current = true;
    if (!d.next) {
      finish(current, current.npc.name, d.reply, game.history);
      return;
    }
    pendingRef.current = writeBeat(current.index + 1, d.next, game.history, current.title);
    void proceed(current, d, game.history);
  };

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
            {beat && beat.clues.length > 0 && !ending && (
              <div className="rpg-journal-step">{t.clues(seenCount, beat.clues.length)}</div>
            )}
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
              <kbd>E</kbd> {prompt === 'talk' ? t.talk : prompt === 'examine' ? t.examine : t.pickUp}
            </div>
          )}

          {toast && <div className="rpg-toast">{toast}</div>}
        </>
      )}

      {(held?.dialogue ?? dialogue) && (() => {
        const shown = held?.dialogue ?? dialogue!;
        return (
          <div className={`rpg-dialogue${held ? ' rpg-dialogue-held' : ''}`} role="dialog">
            <div className="rpg-dialogue-speaker">{shown.line.speaker}</div>
            <p className="rpg-dialogue-text">{shown.line.text}</p>
            <ol className="rpg-dialogue-choices">
              {shown.choices.map((c, i) => {
                const asked = c.kind === 'ask' && askedRef.current.has(`${shown.line.speaker}|${c.label}`);
                const classes = [
                  c.kind === 'plot' ? 'rpg-choice-plot' : '',
                  asked ? 'rpg-choice-asked' : '',
                  held ? (held.index === i ? 'rpg-choice-saying' : 'rpg-choice-muted') : '',
                ].filter(Boolean);
                return (
                  <li key={`${i}-${c.label}`}>
                    <button
                      type="button"
                      className={classes.join(' ') || undefined}
                      disabled={held !== null}
                      onClick={() => choose(c)}
                    >
                      <span className="rpg-choice-n">{i + 1}.</span> {c.label}
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })()}

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
          {keysReady && models.length > 0 && (
            <label className="rpg-model">
              {t.model}:{' '}
              <select value={models.some((m) => m.id === chosenModel) ? chosenModel! : ''} onChange={(e) => pickModel(e.target.value)}>
                <option value="">{t.modelDefault(modelChain(storyProvider === 'openai' ? 'openai' : 'google', null)[0])}</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id}
                  </option>
                ))}
              </select>
            </label>
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
          {saved && saved.lang === gameLang && keysReady && (
            <button type="button" className="rpg-start" onClick={() => resume(saved)}>
              {t.continueQuest(saved.beats[saved.beats.length - 1].title)}
            </button>
          )}
          <button type="button" className="rpg-start" disabled={!keysReady} onClick={begin}>
            {keysReady ? (saved && saved.lang === gameLang ? t.newQuest : t.start) : t.wait}
          </button>
          <p className="rpg-dev-hint">{t.devHint}</p>
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
          {storyProvider !== 'static' || voiceKey ? (
            <>
              <h3>{t.summary}</h3>
              <QuestSummary lang={gameLang} />
              <p className="rpg-ending-note">{t.costNote}</p>
            </>
          ) : null}
          <button type="button" className="rpg-start" onClick={() => void startQuest()}>
            {t.newQuest}
          </button>
        </div>
      )}

      {started && (generating || unfolding) && (
        <div className="rpg-overlay">
          <p>{generating ? t.writing : t.fate}</p>
          <StreamPreview />
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

      {devOpen && <DevConsole lang={gameLang} onClose={() => setDevOpen(false)} />}

      <button type="button" className="rpg-devtoggle" onClick={() => setDevOpen((open) => !open)} title={t.devConsole}>
        ~
      </button>

      <button type="button" className="rpg-fullscreen" onClick={fullscreen} title={t.fullscreen}>
        ⛶
      </button>
    </div>
  );
}
