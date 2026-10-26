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
import { DEMO_VOICE_KEY, fetchRpgDemoStatus, type RpgDemoStatus } from '../../utils/rpg/demo';
import { DEMO_MODELS } from '../../utils/rpg/demoLimits';
import { addGenerationTime, resetDevlog } from '../../utils/rpg/devlog';
import { clampExotic, classicWorld, DEFAULT_EXOTIC, type WorldBible } from '../../utils/rpg/genesis';
import { ensureLandmark } from '../../utils/rpg/landmark3d';
import { recordQuest, recordWorld, watchBeat } from '../../utils/rpg/questLog';
import { clearGame, loadGame, loadGameFor, saveGame, type SavedGame } from '../../utils/rpg/save';
import { fetchWorld, questsInProgress, startSync } from '../../utils/rpg/cloud';
import { countSpend, flushStats, reportLaunch, reportPlay } from '../../utils/rpg/stats';
import { formatMs, formatUsd } from '../../utils/rpg/cost';
import { drawSeeds } from '../../utils/rpg/seedWords';
import { loadWish, NO_WISH, saveWish, wished, type Wish } from '../../utils/rpg/wish';
import WorldWish from './WorldWish';
import WorldLibrary, { type LibraryRow } from './WorldLibrary';
import { generateBeat, generateWorld, MODEL_CHOICES, modelChain, type QuestSource } from '../../utils/rpg/storyteller';
import {
  addToAtlas,
  clearPendingGenesis,
  currentIds,
  findWorld,
  libraryWorlds,
  loadAtlas,
  loadPendingGenesis,
  loadWorld,
  pastWorlds,
  playedWorld,
  savePendingGenesis,
  saveWorld,
  setWorldLandmark,
  type PendingGenesis,
} from '../../utils/rpg/worldSave';
import { recordLine, resetTranscript, transcript } from '../../utils/rpg/transcript';
import { prefetchVoices, primeVoice, setVoiceWorld, speakLines, warmVoices, stopVoice, type SpokenLine, type VoiceName } from '../../utils/rpg/voice';
import { DevConsole, FpsBadge, QuestSummary, StreamLine } from './DevConsole';
import { loadBadge, loadQuality, saveBadge } from './frames';
import { recordMeasurement } from '../../lib/sentry';
import { RpgScene, type Prompt } from './RpgScene';
import { TouchControls } from './TouchControls';
import { translations } from './translations';

interface DialogueLine {
  speaker: string;
  voice: VoiceName;
  text: string;
  /** A character speaking, whose own voice is looked up; absent for the hunter. */
  who?: Character;
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

/** A day's play across the site runs to hours, which `formatMs` would say in minutes. */
function hoursMinutes(ms: number): string {
  if (ms < 3_600_000) return formatMs(ms);
  return `${Math.floor(ms / 3_600_000)} h ${Math.round((ms % 3_600_000) / 60_000)} min`;
}

interface Ending {
  title: string;
  speaker: string;
  text: string;
  steps: StepRecord[];
  /** Time played on this quest, the page hidden not counted. */
  playMs: number;
  /** Why the story stopped here rather than ending, when it did: the toast is under this screen. */
  cut?: string;
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
/** `text` cut to `n` characters, with an ellipsis when it was longer. */
function clip(text: string, n: number): string {
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
}

/** The exotic slider's last position (`GenesisContext.exotic`). */
const EXOTIC_KEY = 'rpg-exotic';

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
  /**
   * The world being played (`utils/rpg/genesis.ts`), per game language; null before the first one is
   * invented. Every beat is written in it and the scene is drawn from its look.
   */
  const [world, setWorld] = useState<WorldBible | null>(null);
  const worldRef = useRef<WorldBible | null>(null);
  worldRef.current = world;
  /** A world is being invented, from these seeds (empty while they are drawn). */
  const [creating, setCreating] = useState<string[] | null>(null);
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
  const ownStory = Boolean(account.keys.google || account.keys.openai);
  // With no key of the reader's own, the demo on the owner's (`utils/rpg/demo.ts`), while it is open.
  const [demo, setDemo] = useState<RpgDemoStatus | null>(null);
  const storyProvider: QuestSource = account.keys.google
    ? 'google'
    : account.keys.openai
      ? 'openai'
      : demo?.available
        ? 'demo'
        : 'static';
  const voiceKey = account.keys.elevenLabs ?? (storyProvider === 'demo' && demo?.voice ? DEMO_VOICE_KEY : null);
  const [voiceOn, setVoiceOn] = useState(true);
  // The library searches for the reader's own key, so no character's first line waits on one
  // (`voice.ts`); the demo voice picks on the function's side and needs nothing here.
  useEffect(() => {
    if (voiceOn && voiceKey && voiceKey !== DEMO_VOICE_KEY) prefetchVoices(gameLang);
  }, [gameLang, voiceKey, voiceOn]);
  const voiceRef = useRef<string | null>(null);
  voiceRef.current = voiceOn ? voiceKey : null;

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
  const [fpsBadge, setFpsBadge] = useState(false);
  useEffect(() => setFpsBadge(loadBadge()), []);
  /** The model asked first, from the intro screen; null is the usual order. */
  const [chosenModel, setChosenModel] = useState<string | null>(null);
  const chosenModelRef = useRef<string | null>(null);
  chosenModelRef.current = chosenModel;
  /** How exotic the next world is, 0 (a classic RPG setting) to 100 (anything at all). */
  const [exotic, setExotic] = useState(DEFAULT_EXOTIC);
  const exoticRef = useRef(DEFAULT_EXOTIC);
  exoticRef.current = exotic;
  /** The words and description the next world is made of (`WorldWish`); empty, the dice decide. */
  const [wish, setWish] = useState<Wish>(NO_WISH);
  const wishRef = useRef<Wish>(NO_WISH);
  wishRef.current = wish;
  useEffect(() => setWish(loadWish()), []);
  const pickWish = (next: Wish) => {
    setWish(next);
    saveWish(next);
  };
  /** The description the world being born is made of, for its waiting screen. */
  const [creatingWish, setCreatingWish] = useState('');
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [hp, setHp] = useState(100);
  const [compass, setCompass] = useState<{ angle: number; distance: number } | null>(null);
  const [locked, setLocked] = useState(false);
  const [started, setStarted] = useState(false);
  // A phone: a stick and buttons instead of keys and a mouse, and the whole screen while playing
  // (owner, Oct 2026: an iPhone SE 3 above all). Decided once: a primary pointer that is a finger.
  const [touch] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches);
  const immersive = touch && started;
  useEffect(() => {
    if (!immersive) return;
    // The page under the game must not scroll or bounce while a thumb is on the stick.
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = before;
    };
  }, [immersive]);
  const [toast, setToast] = useState<string | null>(null);
  /** The quest-log banner: a new quest, a new step, an objective changed. */
  const [notice, setNotice] = useState<{ id: number; title: string; text: string; detail?: string } | null>(null);
  // What the demo has left today, and the whole site's day (`stats.ts`), asked on the intro screen
  // and again at a quest's end.
  const askDemo = keysReady && (!started || ending !== null);
  useEffect(() => {
    if (!askDemo) return;
    const controller = new AbortController();
    void fetchRpgDemoStatus(controller.signal).then((status) => {
      if (!controller.signal.aborted) setDemo(status);
    });
    return () => controller.abort();
  }, [askDemo]);
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
  /** Where each character stands: a place's name, or null for the hub. Kept in the world's atlas. */
  const whereRef = useRef(new Map<string, string | null>());
  /** The current beat's clues the hunter has examined, by index. */
  const seenRef = useRef(new Set<number>());
  const [seenCount, setSeenCount] = useState(0);
  /** The current beat's story has been heard to the end, so talking again goes straight to it. */
  const heardRef = useRef(false);
  /** Whether the current beat's witness has been talked to, which a decision may wait for. */
  const witnessHeardRef = useRef(false);
  /** The current beat's small-talk questions asked, by index, which a decision may wait for. */
  const askedTalkRef = useRef(new Set<number>());
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

  /**
   * Says the journal changed (owner, Oct 2026: "the player could get a notification that the
   * objective or the next steps are updated"). Since the quest is written while the hunter walks,
   * a new step arrives at a moment nobody chose, so it is a banner in the middle of the view with
   * the journal pulsing, and a buzz where the phone allows one (not iOS).
   */
  const notify = useCallback((title: string, text: string, detail?: string) => {
    const id = Date.now();
    setNotice({ id, title, text, detail });
    try {
      navigator.vibrate?.(120);
    } catch {
      // Not allowed without a gesture in some browsers; the banner is the notification.
    }
  }, []);

  /**
   * Bumped whenever the quest on screen stops being the one a request was made for (a new quest,
   * a resumed one, leaving to the intro), so an answer that arrives afterwards is dropped.
   * Needed since the hunter plays while a beat is written: before, an overlay made that impossible.
   */
  const questTokenRef = useRef(0);

  /**
   * A beat that could not be written, waiting on the reader (owner, Oct 2026: "I would like to be
   * able to retry", under a quest ended by "Load failed"): try again, or settle for what it would
   * have been before — the hand-written quest for an opening, the end here for a later step.
   */
  const [stalled, setStalled] = useState<{
    failure: string;
    opening: boolean;
    /** It is the world that could not be invented, not a beat. */
    world?: boolean;
    retry: () => void;
    giveUp: () => void;
  } | null>(null);

  /** Time played on this quest; `flushPlay` moves what has not been counted yet into today's. */
  const playMsRef = useRef(0);
  /** When the stretch of play still running began; null while paused by a hidden page. */
  const playSinceRef = useRef<number | null>(null);
  const playFlushedRef = useRef(0);
  /** Time played on this quest up to now, the stretch still running included. */
  const playedNow = () => playMsRef.current + (playSinceRef.current === null ? 0 : Date.now() - playSinceRef.current);
  const flushPlay = useCallback(() => {
    const now = playedNow();
    if (now > playFlushedRef.current) reportPlay(now - playFlushedRef.current);
    playFlushedRef.current = now;
  }, []);

  useEffect(() => setWorld(loadWorld(gameLang)), [gameLang]);
  const worldId = world?.id ?? gameLang;
  useEffect(() => setVoiceWorld(worldId), [worldId]);
  useEffect(() => setChronicle(loadChronicle(worldId)), [worldId]);

  // A quest left half way is offered on the intro screen, in its own language.
  useEffect(() => {
    const game = loadGame();
    if (!game) return;
    setSaved(game);
    setGameLang(game.lang);
  }, []);

  /** Bumped whenever the library may have changed, so the intro reads it again. */
  const [libraryTick, setLibraryTick] = useState(0);
  /** Which screen of the intro's menu is showing. */
  const [menu, setMenu] = useState<'main' | 'world' | 'library' | 'settings' | 'controls'>('main');
  const startedRef = useRef(false);
  startedRef.current = started;
  /** A pull that changed something while a quest was on screen: shown on the way back to the intro. */
  const stalePullRef = useRef(false);
  /** Reads the intro's world, save and chronicle again from this browser's storage. */
  const reloadIntro = useCallback(() => {
    const lang = gameLangRef.current;
    const w = loadWorld(lang);
    setWorld(w);
    setChronicle(loadChronicle(w?.id ?? lang));
    setSaved(loadGame());
    setLibraryTick((n) => n + 1);
  }, []);
  // The account's copy of the game (`cloud.ts`): pulled now and whenever the page comes back to the
  // front, pushed after every change. A pull never swaps the world under a quest being played.
  const uid = auth.user?.uid ?? null;
  useEffect(() => {
    if (!uid) return;
    return startSync(uid, () => {
      if (startedRef.current) stalePullRef.current = true;
      else reloadIntro();
    });
  }, [uid, reloadIntro]);

  /** The autosave, at every step that changes the quest. */
  /** Writes this quest's places and people into the world's atlas, so the next quest finds them. */
  const rememberWorld = useCallback(() => {
    if (beatsRef.current.length === 0) return;
    addToAtlas(worldRef.current?.id ?? gameLangRef.current, {
      places: placesRef.current,
      people: charactersRef.current.map((character) => ({
        character,
        at: whereRef.current.get(character.name) ?? null,
        line: lastLinesRef.current.get(character.name) ?? '',
      })),
    });
  }, []);

  /**
   * Puts the world's atlas into the scene and the quest's memory: every place built so far and
   * everyone met, standing where they were left (`worldSave.ts`). A new quest starts in a world
   * that already has a history.
   */
  const restoreAtlas = useCallback(() => {
    const scene = sceneRef.current;
    const atlas = loadAtlas(worldRef.current?.id ?? gameLangRef.current);
    for (const place of atlas.places) {
      scene?.addPlace(place);
      if (!placesRef.current.some((p) => p.name === place.name)) placesRef.current = [...placesRef.current, place];
    }
    const crowd = new Map<string, number>();
    for (const { character, at, line } of atlas.people) {
      const where = at && placesRef.current.some((p) => p.name === at) ? at : null;
      // Spots 0 and 1 at a place are its beat's character and witness.
      const nth = where ? (crowd.get(where) ?? 2) : 0;
      if (where) crowd.set(where, nth + 1);
      scene?.placeNpc(character.name, character.color, where, nth, character.gender);
      whereRef.current.set(character.name, where);
      if (!charactersRef.current.some((c) => c.name === character.name)) charactersRef.current = [...charactersRef.current, character];
      if (line && !lastLinesRef.current.has(character.name)) lastLinesRef.current.set(character.name, line);
    }
  }, []);

  const persist = useCallback(() => {
    rememberWorld();
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
      witnessHeard: witnessHeardRef.current,
      askedTalk: [...askedTalkRef.current],
      decision: decisionRef.current,
      playMs: playedNow(),
      transcript: [...transcript()],
      worldId: worldRef.current?.id ?? gameLangRef.current,
    });
  }, []);

  // --- the story ----------------------------------------------------------------------------------

  /** Asks for beat `index`, which `job` (the decision before it) leads into. */
  const writeBeat = useCallback(
    async (index: number, job: Job | null, steps: StepRecord[], title: string | null): Promise<Written> => {
      if (staticRef.current) return { beat: staticBeat(gameLang, index), failure: null };
      const keys = { google: account.keys.google, openai: account.keys.openai, demo: storyProvider === 'demo' };
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
          world: worldRef.current ?? undefined,
        }, chosen);
        addGenerationTime(attempt.ms);
        recordQuest(uidRef.current, attempt, gameLang, chosen);
        if (attempt.beat) return { beat: attempt.beat, failure: null };
        if (attempt.refusal) return { beat: null, failure: tRef.current.demoClosed(attempt.refusal) };
        return { beat: null, failure: attempt.outcome === 'no-key' ? null : (attempt.error ?? attempt.outcome) };
      } catch (e) {
        log.error('rpg.beat.crashed', describeError(e));
        return { beat: null, failure: e instanceof Error ? e.message : String(e) };
      } finally {
        done();
      }
    },
    [account.keys.google, account.keys.openai, gameLang, storyProvider],
  );

  const writeBeatRef = useRef(writeBeat);
  writeBeatRef.current = writeBeat;

  /** Puts a beat into the world: its place, its character, its job, and the marker. */
  const setupBeat = useCallback(
    (b: Beat, announce = true) => {
      const scene = sceneRef.current;
      if (b.place) {
        scene?.addPlace(b.place);
        if (!placesRef.current.some((p) => p.name === b.place!.name)) placesRef.current = [...placesRef.current, b.place];
      }
      scene?.placeNpc(b.npc.name, b.npc.color, b.place?.name ?? null, 0, b.npc.gender);
      whereRef.current.set(b.npc.name, b.place?.name ?? null);
      if (!charactersRef.current.some((c) => c.name === b.npc.name)) charactersRef.current = [...charactersRef.current, b.npc];
      scene?.clearClues();
      b.clues.forEach((clue, i) => scene?.placeClue(`clue-${b.index}-${i}`, clue.look, b.npc.name));
      seenRef.current = new Set();
      setSeenCount(0);
      heardRef.current = false;
      witnessHeardRef.current = false;
      askedTalkRef.current = new Set();
      if (b.witness) {
        const w = b.witness;
        scene?.placeNpc(w.npc.name, w.npc.color, b.place?.name ?? null, 1, w.npc.gender);
        whereRef.current.set(w.npc.name, b.place?.name ?? null);
        if (!charactersRef.current.some((c) => c.name === w.npc.name)) charactersRef.current = [...charactersRef.current, w.npc];
      }
      // Each character's voice speaks once before they do (`voice.ts`, `warmVoices`).
      if (voiceRef.current) {
        // With what each of them says first, which a designed voice is made speaking.
        const who = [{ ...b.npc, sample: [b.greeting, ...b.story.map((p) => p.say)].join(' ') }];
        if (b.witness) who.push({ ...b.witness.npc, sample: [b.witness.greeting, ...b.witness.talk.map((t) => t.reply)].join(' ') });
        setVoiceWorld(worldRef.current?.id ?? gameLangRef.current);
        warmVoices(voiceRef.current, who, gameLangRef.current);
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
      recordLine({ kind: 'beat', beat: b.index, speaker: b.title, text: b.objectiveText });
      persist();
      if (!announce) return;
      const tt = tRef.current;
      if (b.index === 0) notify(tt.noticeQuest, b.title, b.job ? b.objectiveText : tt.talkTo(b.npc.name));
      else notify(tt.nextStep, b.objectiveText);
    },
    [notify, persist],
  );

  /** Makes `w` the world being played: the beats are written in it and the scene drawn from it. */
  const enterWorld = useCallback((w: WorldBible) => {
    worldRef.current = w;
    setWorld(w);
    sceneRef.current?.applyWorld(w.look);
  }, []);

  const startQuest = useCallback(async (keepLog = false) => {
    const token = ++questTokenRef.current;
    setStalled(null);
    flushPlay();
    playMsRef.current = 0;
    playSinceRef.current = playSinceRef.current === null ? null : Date.now();
    playFlushedRef.current = 0;
    reportLaunch();
    setGenerating(true);
    setDialogue(null);
    setEnding(null);
    setBeat(null);
    setHistory([]);
    historyRef.current = [];
    placesRef.current = [];
    charactersRef.current = [];
    lastLinesRef.current.clear();
    whereRef.current.clear();
    spokenRef.current.clear();
    askedRef.current.clear();
    // A world invented just before this quest stays in the console with it.
    if (!keepLog) resetDevlog();
    resetTranscript();
    beatsRef.current = [];
    decisionRef.current = null;
    // A new quest in this world abandons the one in progress here; other worlds keep theirs.
    clearGame(worldRef.current?.id ?? gameLangRef.current);
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
    restoreAtlas();

    flash(tRef.current.writingBackground, 5000);
    const writeOpening = async (): Promise<void> => {
      setGenerating(true);
      const { beat: opening, failure } = await writeBeat(0, null, [], null);
      if (token !== questTokenRef.current) return;
      setGenerating(false);
      if (opening) {
        setupBeat(opening);
        return;
      }
      const playStatic = () => {
        staticRef.current = true;
        // The hand-written quest belongs to the classic world, wherever the reader was.
        if (worldRef.current && worldRef.current.id !== gameLang) enterWorld(classicWorld(gameLang));
        setupBeat(staticBeat(gameLang, 0));
      };
      // No key is not a failure: the hand-written quest is what there is.
      if (!failure) {
        playStatic();
        return;
      }
      // Said on screen, with the provider's own reason: "always the drowners" with no explanation
      // is how the first version failed.
      setStalled({
        failure: failure.slice(0, 160),
        opening: true,
        retry: () => {
          setStalled(null);
          void writeOpening();
        },
        giveUp: () => {
          setStalled(null);
          playStatic();
        },
      });
    };
    await writeOpening();
  }, [enterWorld, flash, flushPlay, gameLang, setupBeat, writeBeat]);

  /**
   * Invents a world and starts its first quest in it. The reader waits for this one: the village
   * cannot be drawn, nor the opening written, before there is a world to draw and write it in.
   */
  /** Invents a world and starts its first quest; `again` finishes one a reload interrupted. */
  const createWorld = useCallback(async (again: PendingGenesis | null = null): Promise<void> => {
    const token = ++questTokenRef.current;
    setStalled(null);
    setDialogue(null);
    setEnding(null);
    setBeat(null);
    resetDevlog();
    setCreating([]);
    setPendingGenesis(null);
    // The player's own words and description when they gave any (`WorldWish`), the dice otherwise.
    const asked = wishRef.current;
    const own = !again && wished(asked);
    const seeds = again?.seeds ?? (own ? asked.words : await drawSeeds());
    const chosenSeeds = again ? again.chosen === true : own && asked.words.length > 0;
    const wishText = (again ? again.wish : own ? asked.text.trim() : '') || undefined;
    const exoticNow = again?.exotic ?? exoticRef.current;
    if (token !== questTokenRef.current) return;
    setCreating(seeds);
    setCreatingWish(wishText ?? '');
    const pending = { lang: gameLang, seeds, exotic: exoticNow, chosen: chosenSeeds, wish: wishText };
    savePendingGenesis({ ...pending, at: Date.now() });
    const keys = { google: account.keys.google, openai: account.keys.openai, demo: storyProvider === 'demo' };
    const chosen = chosenModelRef.current;
    let attempt;
    try {
      attempt = await generateWorld(
        keys,
        { lang: gameLang, seeds, avoid: pastWorlds(), exotic: exoticNow, chosen: chosenSeeds, wish: wishText },
        chosen,
      );
    } catch (e) {
      log.error('rpg.world.crashed', describeError(e));
      attempt = null;
    }
    if (token !== questTokenRef.current) return;
    setCreating(null);
    // Answered, one way or the other: a reload now has nothing to finish.
    clearPendingGenesis();
    if (attempt) {
      addGenerationTime(attempt.ms);
      recordWorld(uidRef.current, attempt, gameLang, chosen);
    }
    const born = attempt?.world ?? null;
    if (born) {
      // A new world is a new game: the quest left half way belonged to the old one.
      saveWorld(born);
      setSaved(null);
      enterWorld(born);
      flash(tRef.current.worldBorn(born.name), 5000);
      await startQuest(true);
      return;
    }
    const failure = attempt?.refusal
      ? tRef.current.demoClosed(attempt.refusal)
      : (attempt?.error ?? attempt?.outcome ?? 'crashed');
    setStalled({
      failure: failure.slice(0, 160),
      opening: true,
      world: true,
      retry: () => {
        setStalled(null);
        void createWorldRef.current({ ...pending, at: Date.now() });
      },
      giveUp: () => {
        setStalled(null);
        enterWorld(classicWorld(gameLang));
        void startQuest(true);
      },
    });
  }, [account.keys.google, account.keys.openai, enterWorld, flash, gameLang, startQuest, storyProvider]);
  // A genesis a reload interrupted, offered on the intro to finish with the same seeds.
  const [pendingGenesis, setPendingGenesis] = useState<PendingGenesis | null>(null);
  useEffect(() => {
    setPendingGenesis(loadPendingGenesis(gameLang));
  }, [gameLang]);
  const createWorldRef = useRef(createWorld);
  createWorldRef.current = createWorld;

  const finish = useCallback(
    (b: Beat, speaker: string, text: string, steps: StepRecord[]) => {
      const entry: ChronicleEntry = { title: b.title, at: Date.now(), steps, ending: text };
      setChronicle(addToChronicle(worldRef.current?.id ?? gameLang, entry));
      rememberWorld();
      // Told to the end and in the chronicle: nothing left to continue.
      clearGame(worldRef.current?.id ?? gameLang);
      setSaved(null);
      flushPlay();
      setEnding({ title: b.title, speaker, text, steps, playMs: playedNow() });
      setDialogue(null);
      const scene = sceneRef.current;
      scene?.setMarker(null);
      scene?.clearObjective();
      scene?.heal();
    },
    [flushPlay, gameLang],
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
          notify(tRef.current.noticeObjective, tRef.current.jobDone(b.npc.name));
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
    scene.setQuality(loadQuality());
    scene.start();
    // A minute of play at a time, to Sentry (`frames.ts`): how the frames went on whatever device
    // this is, and what the scene held while they did. Numbers only.
    const frameLog = window.setInterval(() => {
      const w = scene.takeFrameWindow();
      if (!w) return;
      const f = scene.frameStats();
      const q = scene.getQuality();
      recordMeasurement('rpg.frames', {
        ...w,
        places: scene.placeCount(),
        width: f.width,
        height: f.height,
        pixelRatio: f.pixelRatio,
        devicePixelRatio: window.devicePixelRatio,
        shadows: q.shadows,
        weather: q.weather,
      });
    }, 60_000);
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
      window.clearInterval(frameLog);
      scene.dispose();
      sceneRef.current = null;
      delete window.rpg;
    };
  }, [flash, notify, persist]);

  // The hub's landmark (`utils/rpg/landmark3d.ts`): an invented world's own, from fal.ai, made once
  // and kept on the world; the well until it exists, and in the classic world or without a key.
  const falKey = keysReady ? account.keys.fal : null;
  const landmarkUrl = world?.landmarkModel?.glb ?? null;
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !world) return;
    const show = (url: string | null) =>
      void scene.setHubLandmark(url).catch((e) => log.warn('rpg.landmark.load.failed', describeError(e)));
    show(landmarkUrl);
    if (landmarkUrl || !falKey || world.createdAt === 0) return;
    const made = ensureLandmark(falKey, world);
    if (!made) return;
    made.then(
      (model) => {
        setWorldLandmark(world.id, model);
        if (worldRef.current?.id === world.id) worldRef.current = { ...worldRef.current, landmarkModel: model };
        setWorld((now) => (now?.id === world.id ? { ...now, landmarkModel: model } : now));
      },
      (e) => log.warn('rpg.landmark.failed', describeError(e)),
    );
  }, [world, landmarkUrl, falKey]);

  // A notice waits for the dialogue it arrived under to close, then shows for six seconds: a step
  // that lands while the reply is still being read must not expire unseen.
  const noticeShown = notice !== null && dialogue === null && ending === null;
  useEffect(() => {
    if (!noticeShown || !notice) return;
    const id = notice.id;
    const timer = window.setTimeout(() => setNotice((n) => (n?.id === id ? null : n)), 6000);
    return () => window.clearTimeout(timer);
  }, [noticeShown, notice]);

  // The world stands still whenever something other than walking has the reader's attention. A
  // beat being written is not such a thing: the hunter walks while it is (owner, Oct 2026).
  useEffect(() => {
    // A stalled beat asks a question, and on a desktop the cursor has to come back to answer it.
    sceneRef.current?.setPaused(!started || dialogue !== null || held !== null || ending !== null || stalled !== null);
  }, [started, dialogue, held, ending, stalled]);

  // The play clock: from Start or Continue to the ending, talking and reading included, a hidden
  // page not. Measured by the clock rather than counted in ticks, which a main thread busy loading
  // the models delays; moved into today's figure at the end, on leaving, or when the page goes.
  const playing = started && ending === null;
  useEffect(() => {
    if (!playing) return;
    const stop = () => {
      if (playSinceRef.current !== null) playMsRef.current += Date.now() - playSinceRef.current;
      playSinceRef.current = null;
    };
    const go = () => {
      if (document.visibilityState === 'visible' && playSinceRef.current === null) playSinceRef.current = Date.now();
    };
    const change = () => {
      if (document.visibilityState === 'hidden') {
        stop();
        flushPlay();
        flushStats(true);
        persist();
      } else go();
    };
    go();
    document.addEventListener('visibilitychange', change);
    window.addEventListener('pagehide', change);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', change);
      window.removeEventListener('pagehide', change);
      flushPlay();
    };
  }, [playing, flushPlay, persist]);

  // The demo's spend is counted by the function; only a reader's own keys are reported from here.
  useEffect(() => countSpend(storyProvider !== 'demo'), [storyProvider]);

  // --- dialogue -----------------------------------------------------------------------------------

  const close = useCallback(() => {
    setDialogue(null);
    // Straight back to the world: the click that closed the dialogue is a user gesture.
    window.setTimeout(() => sceneRef.current?.requestLock(), 0);
  }, []);

  /**
   * Waits for the beat after decision `d`, in the background: the reply can be read and the world
   * walked meanwhile, and the new step announces itself when it lands.
   */
  const proceed = useCallback(
    async (b: Beat, d: Decision, steps: StepRecord[]) => {
      const token = questTokenRef.current;
      setUnfolding(true);
      const { beat: next, failure } = (await pendingRef.current) ?? { beat: null, failure: 'nothing was asked' };
      if (token !== questTokenRef.current) return;
      pendingRef.current = null;
      setUnfolding(false);
      if (next) {
        setupBeat(next);
        return;
      }
      // Asked again on the reader's word, or ended on the decision the hunter made, not on an error.
      const reason = (failure ?? '').slice(0, 160);
      setStalled({
        failure: reason,
        opening: false,
        retry: () => {
          setStalled(null);
          pendingRef.current = writeBeatRef.current(b.index + 1, d.next, steps, b.title);
          void proceedRef.current(b, d, steps);
        },
        giveUp: () => {
          setStalled(null);
          const cut = `${tRef.current.trailCold} (${reason})`;
          finish(b, b.npc.name, d.reply, steps);
          setEnding((e) => (e ? { ...e, cut } : e));
        },
      });
    },
    [finish, setupBeat],
  );
  const proceedRef = useRef(proceed);
  proceedRef.current = proceed;

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
      const line: DialogueLine = { speaker: b.npc.name, voice: b.npc.gender, text: d.reply, who: b.npc };
      if (!d.next) {
        setDialogue({ line, choices: [{ label: t.theEnd, action: () => finish(b, b.npc.name, d.reply, steps) }] });
        return;
      }
      // Asked now, so most of it is written while the answer is being read and spoken.
      // Asked now, and waited for in the background: "Onward" only goes back to the world.
      pendingRef.current = writeBeat(b.index + 1, d.next, steps, b.title);
      void proceed(b, d, steps);
      setDialogue({ line, choices: [{ label: t.onward, action: close }] });
    },
    [close, finish, persist, proceed, t, writeBeat],
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
        const line = (text: string): DialogueLine => ({ speaker: w.npc.name, voice: w.npc.gender, text, who: w.npc });
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
        if (!witnessHeardRef.current) {
          witnessHeardRef.current = true;
          persist();
        }
        root();
        return;
      }
      if (name !== b.npc.name || decidedRef.current) {
        setDialogue({
          line: { speaker: name, voice: who?.gender ?? 'male', text: lastLinesRef.current.get(name) ?? t.nothingMore, who },
          choices: [bye],
        });
        return;
      }
      const npc = (text: string): DialogueLine => ({ speaker: b.npc.name, voice: b.npc.gender, text, who: b.npc });

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
        ...b.smallTalk.map((o, i) => ({
          label: o.label,
          kind: 'ask' as const,
          action: () => {
            if (!askedTalkRef.current.has(i)) {
              askedTalkRef.current.add(i);
              persist();
            }
            setDialogue({ line: npc(o.reply), choices: [{ label: t.back, action: ending }] });
          },
        })),
        ...b.clues
          .filter((_, i) => seenRef.current.has(i))
          .map((c) => ({
            label: c.ask,
            kind: 'ask' as const,
            action: () => setDialogue({ line: npc(c.reply), choices: [{ label: t.back, action: ending }] }),
          })),
      ];
      const heardFor = (after: Decision['after']): boolean =>
        after === undefined ||
        (after === 'witness'
          ? witnessHeardRef.current
          : typeof after === 'number'
            ? seenRef.current.has(after)
            : askedTalkRef.current.has(after.ask));
      const ending = (): void => {
        if (!heardRef.current) {
          heardRef.current = true;
          persist();
        }
        setDialogue({
          line: npc(b.story[last].say),
          choices: [
            ...b.decisions
              .filter((d) => heardFor(d.after))
              .map((d) => ({ label: d.label, kind: 'plot' as const, action: () => decide(b, d) })),
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
      // What the hunter says, not the way out of a menu ("Back", "Goodbye").
      const said = beatRef.current;
      if (choice.kind && said) {
        const kind = choice.kind === 'plot' ? 'decision' : 'ask';
        recordLine({ kind, beat: said.index, speaker: tRef.current.hunter, text: choice.label });
      }
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

  // Every line shown goes in the console's transcript: a clue's reading or a character's line.
  useEffect(() => {
    const b = beatRef.current;
    if (!dialogue || !b) return;
    const { line } = dialogue;
    recordLine({ kind: line.voice === 'player' ? 'clue' : 'npc', beat: b.index, speaker: line.speaker, text: line.text });
  }, [dialogue]);

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
      const kept = localStorage.getItem(EXOTIC_KEY);
      if (kept !== null) setExotic(clampExotic(kept));
    } catch {
      /* no storage, the usual order */
    }
  }, []);
  const pickExotic = (value: number) => {
    setExotic(clampExotic(value));
    try {
      localStorage.setItem(EXOTIC_KEY, String(clampExotic(value)));
    } catch {
      /* forgotten on reload */
    }
  };
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
  const models = MODEL_CHOICES.filter((m) =>
    storyProvider === 'demo'
      ? (DEMO_MODELS as readonly string[]).includes(m.id)
      : m.provider === 'google'
        ? account.keys.google
        : !account.keys.google && account.keys.openai,
  );

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
    if (dialogue) wanted.push({ text: dialogue.line.text, voice: dialogue.line.voice, who: dialogue.line.who });
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
    questTokenRef.current += 1;
    setStalled(null);
    flushPlay();
    playMsRef.current = game.playMs ?? 0;
    playSinceRef.current = playSinceRef.current === null ? null : Date.now();
    playFlushedRef.current = playMsRef.current;
    reportLaunch();
    primeVoice();
    setStarted(true);
    setEnding(null);
    setDialogue(null);
    setGenerating(false);
    setUnfolding(false);
    seedRef.current = game.seed;
    staticRef.current = game.static;
    // The world it was played in, made current again if another one is (`worldSave.ts`'s library),
    // or the classic one for a save from before there were worlds.
    const kept = game.worldId ? findWorld(game.worldId) : null;
    const into = kept ?? classicWorld(game.lang);
    if (kept && loadWorld(game.lang)?.id !== kept.id) saveWorld(kept);
    else playedWorld(into.id);
    enterWorld(into);
    placesRef.current = [];
    charactersRef.current = [];
    beatsRef.current = [];
    lastLinesRef.current = new Map(game.lastLines);
    whereRef.current.clear();
    spokenRef.current.clear();
    askedRef.current.clear();
    pendingRef.current = null;
    resetDevlog();
    resetTranscript(game.transcript);
    const scene = sceneRef.current;
    scene?.clearObjective();
    scene?.clearPlaces();
    scene?.clearNpcs();
    scene?.setMarker(null);
    scene?.teleport('spawn');
    restoreAtlas();
    const remember = (c: Character) => {
      if (!charactersRef.current.some((x) => x.name === c.name)) charactersRef.current = [...charactersRef.current, c];
    };
    for (const b of game.beats.slice(0, -1)) {
      if (b.place) {
        scene?.addPlace(b.place);
        if (!placesRef.current.some((p) => p.name === b.place!.name)) placesRef.current = [...placesRef.current, b.place];
      }
      scene?.placeNpc(b.npc.name, b.npc.color, b.place?.name ?? null, 0, b.npc.gender);
      remember(b.npc);
      if (b.witness) {
        scene?.placeNpc(b.witness.npc.name, b.witness.npc.color, b.place?.name ?? null, 1, b.witness.npc.gender);
        remember(b.witness.npc);
      }
      beatsRef.current = [...beatsRef.current, b];
    }
    historyRef.current = game.history;
    setHistory(game.history);
    const current = game.beats[game.beats.length - 1];
    setupBeat(current, false);
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
    witnessHeardRef.current = game.witnessHeard ?? false;
    askedTalkRef.current = new Set(game.askedTalk ?? []);
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

  /** Start, New quest or New world: a world first when there is none yet, or a new one is asked for. */
  const finishGenesis = (pending: PendingGenesis) => {
    primeVoice();
    setStarted(true);
    void createWorld(pending);
  };

  const begin = (fresh = false) => {
    // Inside the click: iOS lets only an element a gesture touched play audio later.
    primeVoice();
    setStarted(true);
    if (storyProvider === 'static') {
      // Nothing to invent a world with: the hand-written quest, in the world it was written for.
      enterWorld(classicWorld(gameLang));
      void startQuest();
      return;
    }
    if (fresh || !worldRef.current) {
      void createWorld();
      return;
    }
    enterWorld(worldRef.current);
    playedWorld(worldRef.current.id);
    void startQuest();
  };

  /**
   * A world picked from the library: made the current one of its language, its atlas and save taken
   * from the account first when this browser no longer keeps them, then its quest continued or a new
   * one started. A world in the other language switches the game's language first, and the rest
   * waits for that render (`openingRef`), since the quest is written in the language of the render.
   */
  const openingRef = useRef<{ id: string; cont: boolean } | null>(null);
  const [opening, setOpening] = useState(0);
  const openWorld = async (id: string, cont: boolean) => {
    // Inside the tap, for iOS: whatever starts after the fetch has lost the gesture.
    primeVoice();
    if (uidRef.current) {
      try {
        await fetchWorld(uidRef.current, id);
      } catch (e) {
        log.warn('rpg.fetchWorld.failed', describeError(e));
      }
    }
    const w = findWorld(id);
    if (!w) return;
    saveWorld(w);
    openingRef.current = { id, cont };
    if (w.lang !== gameLangRef.current) setGameLang(w.lang);
    setOpening((n) => n + 1);
  };
  useEffect(() => {
    const pending = openingRef.current;
    if (!pending) return;
    const w = findWorld(pending.id);
    if (!w || w.lang !== gameLang) return;
    openingRef.current = null;
    setMenu('main');
    enterWorld(w);
    setChronicle(loadChronicle(w.id));
    const game = pending.cont ? loadGameFor(w.id) : null;
    if (game) resume(game);
    else begin();
    // `resume` and `begin` are this render's; nothing else should run this again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opening, gameLang]);

  /** Back to the intro screen on a phone, which has no Esc and no page around the game. */
  const leave = () => {
    // A beat still being written is asked for again on Continue, from the save.
    questTokenRef.current += 1;
    setStalled(null);
    setGenerating(false);
    setUnfolding(false);
    setCreating(null);
    stopVoice();
    setDialogue(null);
    setHeld(null);
    setStarted(false);
    setMenu('main');
    if (stalePullRef.current) {
      stalePullRef.current = false;
      reloadIntro();
    } else setSaved(loadGame());
  };

  const fullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => {});
  };

  // --- render -------------------------------------------------------------------------------------

  const jobOpen = beat?.job ? progress < beat.job.count : false;
  const objective = !beat || ending || unfolding
    ? null
    : jobOpen
      ? `${beat.objectiveText} (${progress}/${beat.job!.count})`
      : beat.job || beat.index === 0
        ? t.talkTo(beat.npc.name)
        : beat.objectiveText;

  // How far from a classic RPG setting the next world may go. Words at both ends, and the value in
  // words too, since the owner's phone is black and white and a slider's fill says nothing there.
  const exoticSlider = (
    <label className="rpg-exotic">
      <span className="rpg-exotic-title">{t.exoticLabel(t.exoticBand(exotic))}</span>
      <span className="rpg-exotic-row">
        <span>{t.exoticLeft}</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={exotic}
          onChange={(e) => pickExotic(Number(e.target.value))}
          aria-valuetext={t.exoticBand(exotic)}
        />
        <span>{t.exoticRight}</span>
      </span>
    </label>
  );

  // The worlds played before, read again whenever the library may have changed.
  const libraryRows: LibraryRow[] = React.useMemo(() => {
    void libraryTick;
    const quests = questsInProgress();
    const current = new Set(Object.values(currentIds()));
    return libraryWorlds().map((entry) => ({
      entry,
      chronicle: loadChronicle(entry.world.id),
      quest: quests[entry.world.id] ?? null,
      current: current.has(entry.world.id),
    }));
  }, [libraryTick, menu, world, saved]);
  const canPlay = keysReady && storyProvider !== 'static';

  const creatable = keysReady && storyProvider !== 'static';
  const ownSave = saved && saved.lang === gameLang ? saved : null;
  /** One entry of the main menu: a label, and a line under it when there is something to say. */
  const item = (key: string, label: string, onClick: () => void, opts: { sub?: string; primary?: boolean; disabled?: boolean } = {}) => (
    <button
      key={key}
      type="button"
      className={`rpg-menu-item${opts.primary ? ' rpg-menu-primary' : ''}`}
      disabled={opts.disabled}
      onClick={onClick}
    >
      <span>{label}</span>
      {opts.sub && <small>{opts.sub}</small>}
    </button>
  );
  const back = (
    <button type="button" className="rpg-menu-back" onClick={() => setMenu('main')}>
      ← {t.menuBack}
    </button>
  );

  // The intro as a game's menu (owner, Oct 2026: "less slop, more substance, make it look like a game
  // menu — it cuts the options off and the new-world setup can't be seen"): a short list on the main
  // screen, and everything else one level down — the world's setup, the library, the settings, the
  // controls — each with its own Back.
  const mainMenu = (
    <nav className="rpg-menu" aria-label={t.title}>
      {pendingGenesis &&
        creatable &&
        item('finish', t.menuFinishWorld, () => finishGenesis(pendingGenesis), {
          primary: true,
          sub: pendingGenesis.seeds.join(', ') || clip(pendingGenesis.wish ?? '', 40),
        })}
      {ownSave &&
        keysReady &&
        item('continue', t.menuContinue, () => resume(ownSave), { primary: true, sub: ownSave.beats[ownSave.beats.length - 1].title })}
      {!keysReady && item('wait', t.wait, () => {}, { disabled: true })}
      {keysReady && storyProvider === 'static' && item('start', t.start, () => begin(), { primary: !ownSave })}
      {creatable && world && item('quest', t.menuNewQuest, () => begin(), { primary: !ownSave && !pendingGenesis, sub: t.menuInWorld(world.name) })}
      {creatable && item('world', t.menuNewWorld, () => setMenu('world'), { primary: !world && !ownSave })}
      {libraryRows.length > 0 && item('library', t.menuWorlds, () => setMenu('library'), { sub: t.menuWorldsCount(libraryRows.length) })}
      {item('settings', t.menuSettings, () => setMenu('settings'))}
      {item('controls', t.menuControls, () => setMenu('controls'))}
    </nav>
  );

  const worldMenu = (
    <div className="rpg-panel">
      <h3>{t.menuNewWorld}</h3>
      {exoticSlider}
      <WorldWish lang={gameLang} wish={wish} onChange={pickWish} open />
      <div className="rpg-panel-actions">
        <button type="button" className="rpg-start" disabled={!creatable} onClick={() => begin(true)}>
          {t.menuCreate}
        </button>
        {back}
      </div>
    </div>
  );

  const settingsMenu = (
    <div className="rpg-panel">
      <h3>{t.menuSettings}</h3>
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
      {keysReady && models.length > 0 && (
        <label className="rpg-model">
          {t.model}:{' '}
          <select value={models.some((m) => m.id === chosenModel) ? chosenModel! : ''} onChange={(e) => pickModel(e.target.value)}>
            <option value="">{t.modelDefault(modelChain(storyProvider === 'openai' ? 'openai' : storyProvider === 'demo' ? 'demo' : 'google', null)[0])}</option>
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
          <li>
            {storyProvider === 'static'
              ? t.staticQuest
              : storyProvider === 'demo' && demo
                ? t.demoQuest(Math.min(demo.remaining.ip, demo.remaining.all), demo.perIpUsd)
                : t.aiQuest(storyProvider)}
          </li>
          {storyProvider === 'static' && demo && !demo.available && demo.reason && <li>{t.demoClosed(demo.reason)}</li>}
          <li>{voiceKey === DEMO_VOICE_KEY ? t.demoVoice : voiceKey ? t.voiceOn : t.voiceOff}</li>
          {(storyProvider === 'static' || storyProvider === 'demo' || !voiceKey) && (
            <li>
              <a href={lang === 'pl' ? '/pl/account/' : '/account/'}>{storyProvider === 'demo' ? t.ownKey : t.addKey}</a>
            </li>
          )}
        </ul>
      ) : (
        <p className="rpg-source">{t.readingKeys}</p>
      )}
      {chronicle.length > 0 && (
        <p className="rpg-chronicle">
          {t.chronicle(chronicle.length)}{' '}
          <button
            type="button"
            onClick={() => {
              clearChronicle(worldId);
              setChronicle([]);
            }}
          >
            {t.forget}
          </button>
        </p>
      )}
      {demo?.today && (
        <p className="rpg-today">{t.todayStats(demo.today.launches, formatUsd(demo.today.usd), hoursMinutes(demo.today.playMs))}</p>
      )}
      {!touch && <p className="rpg-dev-hint">{t.devHint}</p>}
      <div className="rpg-panel-actions">{back}</div>
    </div>
  );

  const controlsMenu = (
    <div className="rpg-panel">
      <h3>{t.menuControls}</h3>
      {touch ? (
        <ul className="rpg-controls">
          <li>{t.touchMove}</li>
          <li>{t.touchLook}</li>
          <li>{t.touchAct}</li>
        </ul>
      ) : (
        <ul className="rpg-controls">
          <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> {t.move}</li>
          <li><kbd>Shift</kbd> {t.run}</li>
          <li>{t.mouse}</li>
          <li><kbd>LMB</kbd> {t.attack}</li>
          <li><kbd>E</kbd> {t.interact}</li>
        </ul>
      )}
      <p className="rpg-panel-note">{t.intro}</p>
      <div className="rpg-panel-actions">{back}</div>
    </div>
  );

  // The world the next quest is played in: its name and who you are there, the pitch a tap away.
  const worldCard = world && storyProvider !== 'static' && (
    <details className="rpg-world">
      <summary>
        <strong>{world.name}</strong>
        <span className="rpg-world-you"> · {world.player.split(/[;,.]/)[0]}</span>
      </summary>
      <p>{world.pitch}</p>
      <p className="rpg-world-you">{t.worldYou(world.player)}</p>
    </details>
  );

  return (
    <div className={`rpg-container${touch ? ' rpg-touch' : ''}${immersive ? ' rpg-immersive' : ''}`} ref={containerRef}>
      <canvas ref={canvasRef} className="rpg-canvas" />

      {started && (
        <>
          <div className={`rpg-journal${noticeShown ? ' rpg-journal-fresh' : ''}`}>
            {beat && <div className="rpg-journal-title">{beat.title}</div>}
            {objective && <div className="rpg-journal-objective">◆ {objective}</div>}
            {(generating || unfolding) && (
              <>
                <div className="rpg-journal-objective">⏳ {generating ? t.writing : t.fate}</div>
                <StreamLine />
              </>
            )}
            {beat?.place && !ending && !unfolding && <div className="rpg-journal-place">{beat.place.name}</div>}
            {beat && beat.clues.length > 0 && !ending && !unfolding && (
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

          {!touch && !locked && !dialogue && !ending && <div className="rpg-hint">{t.clickToLook}</div>}

          {!touch && prompt && !dialogue && !ending && (
            <div className="rpg-prompt">
              <kbd>E</kbd> {prompt === 'talk' ? t.talk : prompt === 'examine' ? t.examine : t.pickUp}
            </div>
          )}

          {toast && <div className="rpg-toast">{toast}</div>}

          {creating && (
            <div className="rpg-overlay rpg-genesis" role="status">
              <h2>{t.creatingWorld}</h2>
              {creatingWish && <p className="rpg-genesis-seeds">{t.worldWish(clip(creatingWish, 160))}</p>}
              {creating.length > 0 && <p className="rpg-genesis-seeds">{t.worldSeeds(creating.join(' · '))}</p>}
              <StreamLine />
            </div>
          )}

          {stalled && !dialogue && !ending && (
            <div className="rpg-stalled" role="alertdialog" aria-label={stalled.world ? t.worldFailedTitle : t.stalledTitle}>
              <div className="rpg-notice-title">✗ {stalled.world ? t.worldFailedTitle : t.stalledTitle}</div>
              <p className="rpg-stalled-why">{stalled.failure}</p>
              <div className="rpg-stalled-actions">
                <button type="button" className="rpg-start" onClick={stalled.retry}>
                  ↻ {t.retry}
                </button>
                <button type="button" onClick={stalled.giveUp}>
                  {stalled.world ? t.playClassic : stalled.opening ? t.playStatic : t.endHere}
                </button>
              </div>
            </div>
          )}

          {noticeShown && notice && !stalled && (
            <div key={notice.id} className="rpg-notice" role="status">
              <div className="rpg-notice-title">📜 {notice.title}</div>
              <div className="rpg-notice-text">{notice.text}</div>
              {notice.detail && <div className="rpg-notice-detail">◆ {notice.detail}</div>}
            </div>
          )}

          {touch && !dialogue && !held && !ending && (
            <TouchControls
              prompt={prompt}
              promptLabel={prompt === 'talk' ? t.talk : prompt === 'examine' ? t.examine : prompt ? t.pickUp : null}
              attackLabel={t.strike}
              onStick={(x, y) => sceneRef.current?.setStick(x, y)}
              onAttack={() => sceneRef.current?.attack()}
              onAct={() => sceneRef.current?.interact()}
            />
          )}

          {immersive && (
            <button type="button" className="rpg-leave" onClick={leave} aria-label={t.leave}>
              ✕
            </button>
          )}
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
        <div className="rpg-overlay rpg-menu-screen">
          {menu === 'library' ? (
            <WorldLibrary
              lang={gameLang}
              rows={libraryRows}
              signedIn={Boolean(uid)}
              canPlay={canPlay}
              onOpen={(id, cont) => void openWorld(id, cont)}
              onBack={() => setMenu('main')}
            />
          ) : (
            <>
              {menu === 'main' && (
                <>
                  <h2 className="rpg-menu-title">{t.title}</h2>
                  {worldCard}
                  {mainMenu}
                </>
              )}
              {menu === 'world' && worldMenu}
              {menu === 'settings' && settingsMenu}
              {menu === 'controls' && controlsMenu}
            </>
          )}
        </div>
      )}

      {started && ending && !generating && (
        <div className="rpg-overlay rpg-ending">
          <h2>{t.questComplete}</h2>
          <p className="rpg-ending-title">{ending.title}</p>
          {ending.cut && <p className="rpg-ending-note">{ending.cut}</p>}
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
          <p className="rpg-ending-play">
            {t.playTime}: {formatMs(ending.playMs)}
          </p>
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
          {storyProvider !== 'static' && (
            <button type="button" className="rpg-start" onClick={() => void createWorld()} title={t.newWorldHint}>
              {t.newWorld}
            </button>
          )}
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

      {devOpen && (
        <DevConsole
          lang={gameLang}
          onClose={() => setDevOpen(false)}
          scene={sceneRef.current}
          badge={fpsBadge}
          onBadge={(on) => {
            setFpsBadge(on);
            saveBadge(on);
          }}
        />
      )}
      {fpsBadge && started && <FpsBadge scene={sceneRef.current} />}

      {(!touch || started) && (
        <button type="button" className="rpg-devtoggle" onClick={() => setDevOpen((open) => !open)} title={t.devConsole}>
          ~
        </button>
      )}

      {!immersive && (
        <button type="button" className="rpg-fullscreen" onClick={fullscreen} title={t.fullscreen}>
          ⛶
        </button>
      )}
    </div>
  );
}
