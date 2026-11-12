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

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { useAccountKeys } from '../../hooks/useAccountKeys';
import { ACCOUNT_KEY, refuelWallet, setGatewayContext } from '../../utils/rpg/gateway';
import { useDieselWallet } from '../../hooks/useDieselWallet';
import { fuelKeys } from '../../utils/rpg/wallet';
import { useAuth } from '../../hooks/useAuth';
import { describeError, log } from '../../lib/logger';
import { addToChronicle, clearChronicle, loadChronicle } from '../../utils/rpg/chronicle';
import type { PlaceAsset, PlaceSpec } from '../../utils/rpg/place';
import {
  isDead,
  jobDone,
  drawMood,
  heardAside,
  planDecisions,
  SITUATION_MAX,
  seedFor,
  SEEDS,
  slainBy,
  staticBeat,
  type Beat,
  type BeatJob,
  type Character,
  type QuestMood,
  type ChronicleEntry,
  type Decision,
  type DialogueOption,
  type Job,
  type Lang,
  type StepRecord,
  type Tone,
} from '../../utils/rpg/quest';
import { drawPersonas } from '../../utils/rpg/persona';
import { DEMO_VOICE_KEY, fetchRpgDemoStatus, type RpgDemoStatus } from '../../utils/rpg/demo';
import { DEMO_MODELS } from '../../utils/rpg/demoLimits';
import {
  addGenerationTime,
  beginQuestSpend,
  beginTimeline,
  markStage,
  NO_SPEND,
  onRequestEnd,
  questSpend,
  resetDevlog,
  timeline,
  triesSpend,
  validSpend,
} from '../../utils/rpg/devlog';
import { outOfFunds } from '../../utils/rpg/funds';
import { addModelSpend, clampExotic, classicWorld, DEFAULT_EXOTIC, drawLight, WISH_MAX, type GroundTexture, type LandmarkModel, type WorldBible } from '../../utils/rpg/genesis';
import { ensureGroundTexture, groundState } from '../../utils/rpg/groundTexture';
import { coverState, ensureGroundCover, hasCover } from '../../utils/rpg/groundCover';
import { EMPTY_LAYOUT, hubLayout } from '../../utils/rpg/hubLayout';
import {
  cluePrompt,
  creaturePrompt,
  ensureClueModel,
  ensureHubModels,
  DEFAULT_MESHER,
  DEFAULT_PAINTER,
  PERSON_PAINTERS,
  setPersonPainter,
  setGoogleImageKey,
  setPersonPose,
  DEFAULT_POSE,
  PERSON_POSES,
  type PersonPose,
  type PersonPainter,
  ensureCreatureModel,
  ensurePersonModel,
  ensureWeaponModel,
  weaponModelMayCome,
  personModelMayCome,
  personCostNow,
  personMakersNow,
  setPersonMesher,
  type Mesher,
  ensurePlaceModel,
  falPending,
  falPiecesEnded,
  heroLook,
  personLook,
  personPrompt,
  hubSlotFailed,
  placeAssetPrompt,
  FOREST_SLOTS,
  HUB_SLOTS,
  hubModel,
  hubSlots,
  type HubSlot,
} from '../../utils/rpg/landmark3d';
import { recordQuest, recordWorld, watchBeat } from '../../utils/rpg/questLog';
import { rememberTiming, type Task } from '../../utils/rpg/progress';
import { moving, rigsOfStart } from '../../utils/rpg/rigging';
import { clearGame, deadInSave, loadGame, loadGameFor, mendSave, saveGame, type SavedGame } from '../../utils/rpg/save';
import { cleanSlate, fetchWorld, questsInProgress, startSync } from '../../utils/rpg/cloud';
import { LANGUAGES, guessLang, nativeName, startingLang, storeLangChoice } from '../../utils/rpg/language';
import { pushLangChoice, syncLangChoice } from '../../utils/rpg/langSync';
import { countSpend, flushStats, reportLaunch, reportPlay } from '../../utils/rpg/stats';
import { formatMs, formatUsd } from '../../utils/rpg/cost';
import { drawSeeds } from '../../utils/rpg/seedWords';
import { loadWish, NO_WISH, saveWish, wished, type Wish } from '../../utils/rpg/wish';
import WorldWish from './WorldWish';
import WorldProposals from './WorldProposals';
import { ensureProposals, pickedProposal } from '../../utils/rpg/proposals';
import type { PoolItem } from '../../utils/rpg/proposalPool';
import { PROPOSAL_EXOTIC, proposalWish, type Proposal } from '../../utils/rpg/proposalScript';
import WorldLibrary, { type LibraryRow } from './WorldLibrary';
import WorldTrash from './WorldTrash';
import { biggestKeys, onStorageFull, storageFull } from '../../utils/rpg/storage';
import { setJobAccount } from '../../utils/rpg/serverJobs';
import { FAST_MODEL, generateBeat, generateFree, generateHubSizes, generateWorld, MODEL_CHOICES, modelChain, quick, type QuestSource } from '../../utils/rpg/storyteller';
import { FREE_MAX, freeDecision } from '../../utils/rpg/freeLine';
import { decisionOpen, knownBefore } from '../../utils/rpg/unlock';
import {
  addToAtlas,
  clearPendingGenesis,
  currentIds,
  findWorld,
  isTrashed,
  libraryWorlds,
  restoreWorld,
  trashedWorlds,
  trashWorld,
  loadAtlas,
  loadPendingGenesis,
  loadWorld,
  pastWorlds,
  playedWorld,
  savePendingGenesis,
  saveWorld,
  addWorldSpend,
  setWorldCover,
  setWorldGround,
  setWorldHero,
  setWorldWeapon,
  setWorldModel,
  setWorldSizes,
  updateAtlasPerson,
  updateAtlasPlace,
  withModel,
  type PendingGenesis,
} from '../../utils/rpg/worldSave';
import { recordLine, resetTranscript, transcript } from '../../utils/rpg/transcript';
import { shownText } from '../../utils/rpg/audioTags';
import {
  duckMusic,
  forgetMusicState,
  loadMusicOn,
  musicFor,
  musicId,
  musicState,
  musicUnplayable,
  pauseMusic,
  playMusic,
  playingMusic,
  primeMusic,
  saveMusicOn,
  stopMusic,
  subscribeMusic,
} from '../../utils/rpg/music';
import { prefetchLine, prefetchVoices, primeVoice, setVoiceWorld, speakLines, warmVoices, stopVoice, type LineTiming, type SpokenLine, type VoiceName } from '../../utils/rpg/voice';
import { recordVoiceLag } from '../../utils/rpg/voiceLag';
import { DevConsole, FpsBadge, FundsBanner, QuestSummary, StreamLine, WorldProgress, type RemakeOffer } from './DevConsole';
import { FAL_PRICES, type PersonSlot } from '../../utils/rpg/falPrompts';
import { loadBadge, loadQuality, saveBadge } from './frames';
import { recordMeasurement } from '../../lib/sentry';
import { introSketch, introView, shownImage, startIntro, stopIntro, subscribeIntro } from '../../utils/rpg/intro';
import { DEFAULT_RIGGER, type Rigger } from './people';
import { heroBody, RpgScene, type PersonBody, type Prompt } from './RpgScene';
import { TouchControls } from './TouchControls';
import { weaponLength, weaponLook, weaponPrompt } from '../../utils/rpg/weapon';

/** The fal.ai pieces a quest and its world make beyond the hub, for the start's progress (`progressTasks`). */
const PIECE_LABELS = new Set(['clue', 'place', 'person', 'hero', 'enemy', 'creature', 'weapon']);
import { uiPending, useUi } from './ui';
import DieselPlant, { DieselBadge, dieselTag } from './DieselPlant';
import { beatLitres, questLitres, EMPTY_LITRES, formatLitres, lineLitres, litres, plantState, worldLitres } from '../../utils/rpg/diesel';

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
  /** Where the hero's own typed line goes (`freeLine.ts`), when this dialogue takes one. */
  free?: (said: string) => void;
  /**
   * The hero's typed line on screen while it is read and answered: who is answering. No choices;
   * the answer replaces it once the hero has finished and the answer's voice is in hand.
   */
  hero?: string;
}

/** How long a typed line's answer waits for its clip, after the hero's line and the answer are both in. */
const FREE_CLIP_WAIT_MS = 4000;

/** A key pressed while writing in a field, which is the field's and not a shortcut's. */
function typing(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  return Boolean(target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
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
        mood: QuestMood | undefined;
        dead: string[];
        busy: boolean;
      };
    };
  }
}

/** The menu's languages, each by its own name, in alphabetical order. */
const languageOptions: [string, string][] = LANGUAGES.map((l): [string, string] => [l, nativeName(l)]).sort((a, b) =>
  a[1].localeCompare(b[1]),
);

const MODEL_KEY = 'rpg-model';
/** Whether the world and the opening are written quickly (`quick` in `storyteller.ts`); on unless '0'. */
const FAST_KEY = 'rpg-fast-start';
/** Whether a new world is told as a story while it is made (`utils/rpg/intro.ts`); on unless '0'. */
const INTRO_KEY = 'rpg-intro';
/** `text` cut to `n` characters, with an ellipsis when it was longer. */
function clip(text: string, n: number): string {
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
}

/** The exotic slider's last position (`GenesisContext.exotic`). */
const EXOTIC_KEY = 'rpg-exotic';
/**
 * Who rigs the generated people (`Rigger` in `people.ts`); ours (`skin`) unless 'meshy', 'voxel' or 'fit'; the
 * 'self' and 'pose' of before 1 Nov 2026 read as 'fit'. Absent meant Meshy until 11 Nov 2026, so nobody who
 * never chose is left on Meshy's $0.20 a person.
 */
const RIGGER_KEY = 'rpg-rigger';
/** Whether the hero can jump (Space, the ⇧ button); off unless '1' (owner, 30 Oct 2026). */
const JUMP_KEY = 'rpg-jump';
/** What makes the generated people's models (`Mesher` in `landmark3d.ts`); TRELLIS unless 'meshy'. */
const MESHER_KEY = 'rpg-mesher';
/** What draws the generated people's pictures (`PersonPainter` in `landmark3d.ts`); Nano Banana Lite when absent. */
const PAINTER_KEY = 'rpg-painter';
const POSE_KEY = 'rpg-pose';

/**
 * A line as the dialogue shows it: only what is said. Audio tags ("[coughs]") and any other bracket
 * are for the voice or nobody, never the page (`shownText` in `audioTags.ts`).
 */
function LineText({ text }: { text: string }) {
  return <>{shownText(text)}</>;
}

/** What fal.ai made for a world before it was saved (`earlyRef` in `Rpg`). */
interface EarlyMade {
  models: [HubSlot, LandmarkModel][];
  ground?: GroundTexture;
  cover?: GroundTexture[];
  hero?: LandmarkModel;
  weapon?: LandmarkModel;
}

/** `w` with what was made for it early put on it. */
function withMade(w: WorldBible, kept: EarlyMade | undefined): WorldBible {
  if (!kept) return w;
  let next = kept.models.reduce((acc, [slot, model]) => withModel(acc, slot, model), w);
  if (kept.ground) next = { ...next, groundTexture: kept.ground };
  if (kept.cover) next = { ...next, coverSprites: kept.cover };
  if (kept.hero) next = { ...next, heroModel: kept.hero };
  if (kept.weapon) next = { ...next, weaponModel: kept.weapon };
  return next;
}

/**
 * `standalone` is everyrpg.korczak.xyz, where no navbar sits above the game: the main menu then
 * carries sign-in and sign-up itself (owner, Nov 2026: "nie ma takiej opcji"). On korczak.xyz the
 * navbar already does, so the menu stays as it was.
 */
export default function Rpg({ lang, standalone = false }: { lang: Lang; standalone?: boolean }) {
  /** The content rules (`components/Rpg/RpgRules.astro`), at the root of everyrpg and under the game here. */
  const rulesHref = `${lang === 'pl' ? '/pl' : ''}${standalone ? '' : '/apps/rpg'}/rules/`;
  // The game's language, any language (`utils/rpg/language.ts`): chosen on the menu and kept in this
  // browser and on the account; until somebody chooses, guessed from the browser, English failing that.
  // The page's own locale only says where `/pl/` starts.
  const [gameLang, setGameLang] = useState<Lang>(() => startingLang(lang, loadGame(isTrashed)?.lang ?? null));
  const t = useUi(gameLang);
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
  /** The world being invented, as far as its stream has said (`previewWorld`), and a count of what fal.ai made for it so far. */
  const [preview, setPreview] = useState<WorldBible | null>(null);
  const [earlyMade, setEarlyMade] = useState(0);
  const auth = useAuth();
  const account = useAccountKeys(auth.user);
  const uidRef = useRef<string | null>(null);
  uidRef.current = auth.user?.uid ?? null;
  // The server writes the quest and the world for any signed-in reader (`utils/rpg/jobs.ts`). Not
  // only once the key sync says `synced`: it goes back to `syncing` whenever the account is read
  // again and to `error` on a flaky connection, and on 29 Oct 2026 a beat asked in one of those
  // windows went to the browser and died in the background. The server says when the account
  // has no key (`noKey`), and then the browser asks, so nothing is lost by asking it first.
  setJobAccount(auth.user?.uid ?? null);
  // A signed-in reader's keys may be in the account and not yet in this browser, so nothing decides
  // "no key" before the account has answered — or failed to.
  const keysReady =
    account.ready &&
    !auth.loading &&
    (!auth.user || account.sync === 'synced' || account.sync === 'error');
  // Every provider request goes through the server (`utils/rpg/gateway.ts`). Signed in, the keys
  // `useAccountKeys` hands over are handles — the account's keys never reach the page — and the
  // server reads the key itself; the page sends only the reader's ID token. Signed out, the key in
  // this browser goes with each request, the reader's own and kept nowhere.
  // A signed-in reader with no story key of their own plays on the server's keys, paid out of their
  // diesel tank (`wallet.ts`, `useDieselWallet`): the keys they lack become the account's handle, and
  // the gateway pays each request from the tank. Their own keys stay theirs and cost no diesel. An
  // empty tank hands back only their own keys — the hand-written quest, not the demo: signed in,
  // diesel is the gate (owner, 9 Nov 2026).
  const wallet = useDieselWallet(auth.user);
  const onDiesel = Boolean(
    auth.user && wallet && (wallet.server.google || wallet.server.openai) && !account.keys.google && !account.keys.openai,
  );
  const fueled = onDiesel && litres(wallet!.balanceUsd) >= EMPTY_LITRES;
  const apiKeys = useMemo(
    () => (fueled ? fuelKeys(account.keys, wallet!.server, ACCOUNT_KEY) : account.keys),
    [fueled, account.keys, wallet],
  );
  // What the server's ledger counts each request under: this world, and this quest once there is one.
  setGatewayContext(() => ({ world: worldRef.current?.createdAt ? worldRef.current.id : null, quest: questIdRef.current }));
  const ownStory = Boolean(apiKeys.google || apiKeys.openai);
  const ownStoryRef = useRef(ownStory);
  ownStoryRef.current = ownStory;
  // With no key of the reader's own, the demo on the owner's (`utils/rpg/demo.ts`), while it is open.
  const [demo, setDemo] = useState<RpgDemoStatus | null>(null);
  const storyProvider: QuestSource = apiKeys.google
    ? 'google'
    : apiKeys.openai
      ? 'openai'
      : demo?.available && !onDiesel
        ? 'demo'
        : 'static';
  const voiceKey = apiKeys.elevenLabs ?? (storyProvider === 'demo' && demo?.voice ? DEMO_VOICE_KEY : null);
  const [voiceOn, setVoiceOn] = useState(true);
  // The library searches for the reader's own key, so no character's first line waits on one
  // (`voice.ts`); the demo voice picks on the function's side and needs nothing here.
  useEffect(() => {
    if (voiceOn && voiceKey && voiceKey !== DEMO_VOICE_KEY) prefetchVoices(gameLang);
  }, [gameLang, voiceKey, voiceOn]);
  const voiceRef = useRef<string | null>(null);
  voiceRef.current = voiceOn ? voiceKey : null;
  // The score (`utils/rpg/music.ts`): composed on the reader's own ElevenLabs key only, never the
  // demo's, for the world and tone of the quest being played. Its switch is remembered.
  const musicKey = apiKeys.elevenLabs ?? null;
  const [musicOn, setMusicOn] = useState(loadMusicOn);
  const [score, setScore] = useState<{ world: WorldBible; tone: Tone | null } | null>(null);
  // Where the score is: its bar beside 🎵, its row in the start's progress, the retry when it failed.
  const music = useSyncExternalStore(subscribeMusic, musicState, musicState);
  const [musicTry, setMusicTry] = useState(0);

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
  /** The world and the opening on the fast model, thinking little; the later beats keep the chosen one. */
  const [fastStart, setFastStart] = useState(true);
  const [rigger, setRigger] = useState<Rigger>(DEFAULT_RIGGER);
  const [jumping, setJumping] = useState(false);
  const jumpingRef = useRef(jumping);
  jumpingRef.current = jumping;
  const riggerRef = useRef(rigger);
  riggerRef.current = rigger;
  const [mesher, setMesher] = useState<Mesher>(DEFAULT_MESHER);
  setPersonMesher(mesher);
  const [painter, setPainter] = useState<PersonPainter>(DEFAULT_PAINTER);
  setPersonPainter(painter);
  setGoogleImageKey(apiKeys.google);
  const [pose, setPose] = useState<PersonPose>(DEFAULT_POSE);
  setPersonPose(pose);
  const fastStartRef = useRef(true);
  fastStartRef.current = fastStart;
  /** The story intro on the loading screen of a new world (`intro.ts`): a feature flag in Settings, on by default. */
  const [introOn, setIntroOn] = useState(true);
  const introOnRef = useRef(true);
  introOnRef.current = introOn;
  const intro = useSyncExternalStore(subscribeIntro, introView, introView);
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
  /** A proposed world picked on the menu (`WorldProposals`): the next `createWorld` is made from it, once. */
  const proposalRef = useRef<Proposal | null>(null);
  /** A proposal tapped while the keys were still on their way: picked the moment they are ready. */
  const [queuedPick, setQueuedPick] = useState<PoolItem | null>(null);
  /** The description the world being born is made of, for its waiting screen. */
  const [creatingWish, setCreatingWish] = useState('');
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  /** The witcher's senses are on (`senses.ts`): the screen's edge darkens and 👁 stays pressed. */
  const [senses, setSenses] = useState(false);
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
  /**
   * Everyone dead in this world, by name: kept in its atlas, told to every beat, and never stood up
   * in the scene again (owner, Oct 2026: the ronin he had killed was back, and talking).
   */
  const deadRef = useRef<string[]>([]);
  /** This quest's tone and how it touches the world's past, drawn at its start (`drawMood`). */
  const moodRef = useRef<QuestMood | undefined>(undefined);
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
  /** What the hero said in their own words at the current beat, and what they were answered. */
  const freeTalkRef = useRef<DialogueOption[]>([]);
  /**
   * Typed talk with anyone while no step can take it (the opening still being written, a decision
   * made and the next step on its way): handed to the next step as heard there, so it reaches the story.
   */
  const carryTalkRef = useRef<DialogueOption[]>([]);
  /** How many parts of the step's story the hero has heard, for a typed line before the whole of it. */
  const toldRef = useRef(0);
  /** Bumped when a dialogue closes, so an answer to a typed line arriving after it is dropped. */
  const freeAskRef = useRef(0);
  /** A typed line being answered (`busy`), or why its answer failed. */
  // 'busy': the hero's typed line is being read and answered; 'waiting': read, answer not in yet.
  const [freeState, setFreeState] = useState<null | 'busy' | 'waiting' | { error: string }>(null);
  const freeBusy = freeState === 'busy' || freeState === 'waiting';
  /** When the hero finished reading a typed line, for the answer's `afterHeroMs` (`voiceLag.ts`). */
  const freeHeroEndRef = useRef<number | null>(null);
  const dialogueRef = useRef(dialogue);
  dialogueRef.current = dialogue;
  const speechRef = useRef({ on: voiceOn, key: voiceKey });
  speechRef.current = { on: voiceOn, key: voiceKey };

  /**
   * A character's line heard: how long its text was on screen before the sound (`voiceLag.ts`), into
   * the console and Sentry Logs (`rpg.voice.lag`, numbers only). A line after the hero's own in the
   * same call was shown when it started (the held dialogue lets go then); a first line when it was
   * asked to speak, a frame after it was drawn.
   */
  const measureVoice = useCallback((timing: LineTiming) => {
    if (timing.line.voice === 'player') return;
    const afterPick = timing.index > 0;
    const free = !afterPick && freeHeroEndRef.current !== null;
    const heroEnd = afterPick ? timing.turnAt : freeHeroEndRef.current;
    freeHeroEndRef.current = null;
    const shownAt = afterPick ? timing.startAt : timing.t0;
    const lag = {
      lagMs: Math.round(timing.playingAt - shownAt),
      fetchMs: Math.round(Math.max(0, timing.readyAt - timing.t0)),
      startMs: Math.round(timing.playingAt - timing.startAt),
      afterHeroMs: heroEnd === null ? null : Math.round(timing.playingAt - heroEnd),
    };
    recordVoiceLag({ at: Date.now(), who: timing.line.who?.name ?? timing.line.voice, text: timing.line.text, ...lag, cached: timing.cached, free });
    recordMeasurement('rpg.voice.lag', {
      ...lag,
      cached: timing.cached,
      after: afterPick ? 'pick' : free ? 'free' : 'none',
      chars: timing.line.text.length,
    });
  }, []);
  const [freeText, setFreeText] = useState('');
  /** The current beat has been decided; its character has nothing more to offer. */
  const decidedRef = useRef(false);
  /** The opening could not be written, so the whole quest is the hand-written one. */
  const staticRef = useRef(false);
  const seedRef = useRef(SEEDS[0]);
  /** The quest in progress, by an id of its own: what the server's ledger counts its spend under. */
  const questIdRef = useRef<string | null>(null);
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
  /** When the opening began to be written, for the start's progress and its usual time. */
  const writingSinceRef = useRef(0);
  /** The world as the genesis stream first described it, whose ground and hub fal.ai is already making. */
  const previewRef = useRef<WorldBible | null>(null);

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

  // A quest left half way is offered on the intro screen when it is in the game's language (the
  // language it was played in is where a visit starts before anything was chosen, `startingLang`).
  useEffect(() => {
    const game = loadGame(isTrashed);
    if (!game) return;
    setSaved(game);
  }, []);

  /** The player's choice of language: kept here and on the account, and the game switches to it. */
  const chooseLang = useCallback((next: Lang) => {
    const at = Date.now();
    storeLangChoice(next, at);
    if (uidRef.current) void pushLangChoice(uidRef.current, next, at);
    setGameLang(next);
  }, []);
  // The page says its language, for a screen reader and the browser's own translate offer.
  useEffect(() => {
    document.documentElement.lang = gameLang;
  }, [gameLang]);

  /** Bumped whenever the library may have changed, so the intro reads it again. */
  const [libraryTick, setLibraryTick] = useState(0);
  /** Which screen of the intro's menu is showing. */
  const [logOpen, setLogOpen] = useState(false);
  const [menu, setMenu] = useState<'main' | 'world' | 'library' | 'settings' | 'language' | 'controls' | 'trash' | 'diesel'>('main');
  /** The home screen's sheet behind ⋯: everything but the field and the proposals. */
  const [sheet, setSheet] = useState(false);
  /** The home screen's field, which a proposal's idea is put into. */
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  // The field grows with its text (max-height in rpg-theme.css caps it, then it scrolls), and the
  // pill becomes a rounded box once it holds more than one line.
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    // Empty, it is the stylesheet's one line: a placeholder too long for the width would count.
    field.style.height = '';
    if (field.value) {
      field.style.height = 'auto';
      field.style.height = `${field.scrollHeight}px`;
    }
    field.parentElement?.toggleAttribute('data-tall', field.offsetHeight > 52);
  }, [wish.text, menu, started]);
  // Any screen the sheet leads to closes it, so Back returns to the home screen as it was first seen.
  useEffect(() => setSheet(false), [menu, started]);
  useEffect(() => {
    if (!sheet) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setSheet(false);
      }
    };
    window.addEventListener('keydown', close, true);
    return () => window.removeEventListener('keydown', close, true);
  }, [sheet]);
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
    setSaved(loadGame(isTrashed));
    setLibraryTick((n) => n + 1);
  }, []);
  // The account's copy of the game (`cloud.ts`): pulled now and whenever the page comes back to the
  // front, pushed after every change. A pull never swaps the world under a quest being played.
  const uid = auth.user?.uid ?? null;
  // Signed in, the account's language wins over a guess, and the later of two choices wins (`langSync.ts`).
  useEffect(() => {
    if (!uid) return;
    let live = true;
    void syncLangChoice(uid).then((chosen) => {
      if (live && chosen && !startedRef.current) setGameLang(chosen);
    });
    return () => {
      live = false;
    };
  }, [uid]);
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
      dead: deadRef.current,
    });
  }, []);

  /**
   * Adds to the dead and takes them out of the scene, all but `spare`: the one speaking now, whose
   * death in an ending is told while they are still on screen.
   */
  const bury = useCallback((names: (string | null | undefined)[], spare: string[] = []) => {
    for (const name of names) {
      if (!name || deadRef.current.some((d) => d.toLowerCase() === name.toLowerCase())) continue;
      deadRef.current = [...deadRef.current, name];
    }
    for (const c of charactersRef.current) {
      if (spare.includes(c.name) || !isDead(c.name, deadRef.current)) continue;
      sceneRef.current?.removeNpc(c.name);
      whereRef.current.delete(c.name);
    }
  }, []);

  /**
   * A place into the scene, and in an invented world its fal.ai pieces after it (owner, 27 Oct 2026:
   * "no procedural assets, only fal.ai's in the locations"): each made once from the English the beat
   * wrote (`PlaceAsset`), kept with the place wherever it is stored, and put up as it loads. A place
   * from before `assets` gets its landmark from its name and the world's way of building.
   */
  const falKeyRef = useRef<string | null>(null);
  /**
   * How a beat's things to gather are shown: their fal.ai model once made, and in an invented world
   * nothing until then (owner, 27 Oct 2026: "the things to pick up should be generated assets too");
   * the block only where no model will come.
   */
  const itemFor = useCallback((job: BeatJob): { url?: string; picture?: string; wait: boolean } => {
    const invented = (worldRef.current?.createdAt ?? 0) > 0;
    return { url: job.model?.glb, picture: job.model?.image, wait: invented && (!!job.model || !!falKeyRef.current) };
  }, []);
  const persistRef = useRef<() => void>(() => {});
  const putPlace = useCallback((given: PlaceSpec) => {
    const scene = sceneRef.current;
    const world = worldRef.current;
    const invented = !!world && world.createdAt > 0;
    const place: PlaceSpec =
      invented && !given.assets?.length && given.landmark?.name
        ? {
            ...given,
            assets: [
              {
                role: 'landmark',
                what: `${given.landmark.name}, built like this: ${world!.architecture || world!.pitch}`.slice(0, 140),
                size: { height: 8, width: 8 },
              },
            ],
          }
        : given;
    scene?.addPlace(place);
    if (!scene || !world || !invented) return;
    (place.assets ?? []).forEach((asset, i) => {
      const show = (glb: string) =>
        scene.setPlaceModel(place.name, i, glb, asset.size).catch((e) => log.warn('rpg.place.load.failed', { place: place.name, ...describeError(e) }));
      if (asset.model) {
        void show(asset.model.glb);
        return;
      }
      const key = falKeyRef.current;
      if (!key) return;
      ensurePlaceModel(
        key,
        `${world.id}/${place.name}/${i}`,
        placeAssetPrompt(asset.what, asset.role, world.look),
        (model) => {
          const assets = (place.assets ?? []).map((a, j): PlaceAsset => (j === i ? { ...a, model } : a));
          // Every copy of the place takes it: the quest's list, its beats, the atlas.
          const keep = (p: PlaceSpec): PlaceSpec => {
            if (p.name !== place.name) return p;
            const had = p.assets?.length ? p.assets : assets;
            return { ...p, assets: had.map((a, j) => (j === i ? { ...a, model } : a)) };
          };
          placesRef.current = placesRef.current.map(keep);
          const keepBeat = (b: Beat): Beat => (b.place ? { ...b, place: keep(b.place) } : b);
          beatsRef.current = beatsRef.current.map(keepBeat);
          if (beatRef.current) beatRef.current = keepBeat(beatRef.current);
          const stored = placesRef.current.find((p) => p.name === place.name);
          if (stored) updateAtlasPlace(world.id, stored);
          persistRef.current();
          if (worldRef.current?.id === world.id) void show(model.glb);
        },
        (e) => log.warn('rpg.place.failed', { place: place.name, ...describeError(e) }),
      );
    });
  }, []);

  /**
   * How a character is drawn: their fal.ai model once made, and in an invented world nothing until
   * then (owner, 28 Oct 2026: "no Quaternius characters; nothing until it is generated, then it is
   * there"); the kit's people only where no model will ever come — the classic world, no fal.ai key.
   * Until the keys have loaded a key is assumed, so the kit does not flash up first.
   */
  const keysReadyRef = useRef(false);
  const modelOf = useCallback((c: Character) => c.model ?? charactersRef.current.find((k) => k.name === c.name)?.model, []);
  const bodyFor = useCallback(
    (c: Character): PersonBody => {
      const world = worldRef.current;
      const invented = (world?.createdAt ?? 0) > 0;
      const model = modelOf(c);
      // A model that failed, or a key fal.ai refused, is never coming: waiting would leave them unseen
      // for good (Malina, 30 Oct 2026).
      const coming = !!world && personModelMayCome('person', `${world.id}/${c.name}`);
      return { url: model?.glb, picture: model?.image, wait: invented && (!!model || !keysReadyRef.current || (!!falKeyRef.current && coming)) };
    },
    [modelOf],
  );

  /**
   * Someone a beat brings in, into the quest's people: added if new; someone met before their type
   * was drawn takes the one `parseBeat` gave them now, and keeps it (`persona.ts`).
   */
  const meetPerson = useCallback((person: Character) => {
    const known = charactersRef.current.find((c) => c.name === person.name);
    if (!known) charactersRef.current = [...charactersRef.current, person];
    else if (!known.persona && person.persona) {
      charactersRef.current = charactersRef.current.map((c) => (c === known ? { ...c, persona: person.persona } : c));
    }
  }, []);

  /** A character's model has come: on every copy of them — the quest's people, its beats, the atlas. */
  const keepPerson = useCallback((worldId: string, name: string, model: LandmarkModel) => {
    if (worldRef.current?.id !== worldId) return;
    const keep = (c: Character): Character => (c.name === name ? { ...c, model } : c);
    charactersRef.current = charactersRef.current.map(keep);
    const keepBeat = (b: Beat): Beat => ({ ...b, npc: keep(b.npc), ...(b.witness ? { witness: { ...b.witness, npc: keep(b.witness.npc) } } : {}) });
    beatsRef.current = beatsRef.current.map(keepBeat);
    if (beatRef.current) beatRef.current = keepBeat(beatRef.current);
    const person = charactersRef.current.find((c) => c.name === name);
    if (person) updateAtlasPerson(worldId, person);
    persistRef.current();
  }, []);

  /** Asks fal.ai for a character's model if they have none: once, from how the beat said they look. */
  const ensureNpcModel = useCallback(
    (c: Character) => {
      const world = worldRef.current;
      const key = falKeyRef.current;
      if (!world || world.createdAt === 0 || !key || modelOf(c)) return;
      ensurePersonModel(
        key,
        'person',
        `${world.id}/${c.name}`,
        personPrompt(personLook(c, world), c, world.look.light),
        (model) => {
          keepPerson(world.id, c.name, model);
          if (worldRef.current?.id === world.id)
            void sceneRef.current?.setNpcBody(c.name, { url: model.glb, picture: model.image }).catch((e) => log.warn('rpg.person.load.failed', { name: c.name, ...describeError(e) }));
        },
        (e) => {
          log.warn('rpg.person.failed', { name: c.name, ...describeError(e) });
          // Nothing would ever stand there: the kit's look, so they can still be talked to.
          if (worldRef.current?.id === world.id) void sceneRef.current?.setNpcBody(c.name, {});
        },
      );
    },
    [keepPerson, modelOf],
  );

  /** A character into the scene, drawn as `bodyFor` says, and their model asked for if it is missing. */
  const putNpc = useCallback(
    (c: Character, at: string | null, nth: number) => {
      sceneRef.current?.placeNpc(c.name, c.color, at, nth, c.gender, bodyFor(c), `${c.appearance ?? ''}\n${c.voice ?? ''}`, c.craft ?? null);
      ensureNpcModel(c);
    },
    [bodyFor, ensureNpcModel],
  );

  /**
   * Puts the world's atlas into the scene and the quest's memory: every place built so far and
   * everyone met, standing where they were left (`worldSave.ts`). A new quest starts in a world
   * that already has a history.
   */
  const restoreAtlas = useCallback(() => {
    const scene = sceneRef.current;
    const atlas = loadAtlas(worldRef.current?.id ?? gameLangRef.current);
    deadRef.current = atlas.dead ?? [];
    for (const place of atlas.places) {
      putPlace(place);
      if (!placesRef.current.some((p) => p.name === place.name)) placesRef.current = [...placesRef.current, place];
    }
    const crowd = new Map<string, number>();
    for (const { character, at, line } of atlas.people) {
      if (isDead(character.name, deadRef.current)) continue;
      const where = at && placesRef.current.some((p) => p.name === at) ? at : null;
      // Spots 0 and 1 at a place are its beat's character and witness.
      const nth = where ? (crowd.get(where) ?? 2) : 0;
      if (where) crowd.set(where, nth + 1);
      putNpc(character, where, nth);
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
      freeTalk: freeTalkRef.current,
      decision: decisionRef.current,
      playMs: playedNow(),
      transcript: [...transcript()],
      worldId: worldRef.current?.id ?? gameLangRef.current,
      dead: deadRef.current,
      ...(moodRef.current && { mood: moodRef.current }),
      spent: questSpend(),
      ...(questIdRef.current && { questId: questIdRef.current }),
    });
  }, []);
  persistRef.current = persist;

  // A clip or a clue paid for between two of the quest's steps is in the autosave too, so the
  // closing screen of a quest finished another day still counts it. A beat's arrival saves anyway;
  // this catches the rest, a few at a time.
  useEffect(() => {
    let timer: number | null = null;
    const off = onRequestEnd((entry) => {
      if (entry.scope !== 'quest' || timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        persist();
      }, 2000);
    });
    return () => {
      off();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [persist]);

  // --- the story ----------------------------------------------------------------------------------

  /** Asks for beat `index`, which `job` (the decision before it) leads into. */
  const writeBeat = useCallback(
    async (index: number, job: Job | null, steps: StepRecord[], title: string | null): Promise<Written> => {
      if (staticRef.current) return { beat: staticBeat(gameLang, index), failure: null };
      const keys = { google: apiKeys.google, openai: apiKeys.openai, demo: storyProvider === 'demo' };
      const chosen = chosenModelRef.current;
      const done = watchBeat(index, gameLang, chosen);
      try {
        const attempt = await generateBeat(keys, {
          lang: gameLang,
          index,
          seed: seedRef.current,
          job,
          plan: planDecisions(index),
          personas: drawPersonas(),
          title,
          history: steps,
          chronicle: chronicleRef.current,
          places: placesRef.current,
          characters: charactersRef.current,
          world: worldRef.current ?? undefined,
          dead: deadRef.current,
          ...(moodRef.current && { mood: moodRef.current }),
        }, chosen, quick(index === 0 && fastStartRef.current));
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
    [apiKeys.google, apiKeys.openai, gameLang, storyProvider],
  );

  const writeBeatRef = useRef(writeBeat);
  writeBeatRef.current = writeBeat;

  /** Puts a beat into the world: its place, its character, its job, and the marker. */
  const setupBeat = useCallback(
    (b: Beat, announce = true) => {
      const scene = sceneRef.current;
      if (b.place) {
        putPlace(b.place);
        if (!placesRef.current.some((p) => p.name === b.place!.name)) placesRef.current = [...placesRef.current, b.place];
      }
      putNpc(b.npc, b.place?.name ?? null, 0);
      whereRef.current.set(b.npc.name, b.place?.name ?? null);
      meetPerson(b.npc);
      scene?.clearClues();
      b.clues.forEach((clue, i) => scene?.placeClue(`clue-${b.index}-${i}`, clue.look, b.npc.name));
      seenRef.current = new Set();
      setSeenCount(0);
      heardRef.current = false;
      witnessHeardRef.current = false;
      askedTalkRef.current = new Set();
      freeTalkRef.current = carryTalkRef.current;
      carryTalkRef.current = [];
      toldRef.current = 0;
      if (b.witness) {
        const w = b.witness;
        putNpc(w.npc, b.place?.name ?? null, 1);
        whereRef.current.set(w.npc.name, b.place?.name ?? null);
        meetPerson(w.npc);
      }
      // Each character's voice speaks once before they do (`voice.ts`, `warmVoices`).
      if (voiceRef.current) {
        // With what each of them says first, which a designed voice is made speaking.
        const who = [{ ...b.npc, sample: [b.greeting, ...b.story.map((p) => p.say)].join(' ') }];
        if (b.witness) who.push({ ...b.witness.npc, sample: [b.witness.greeting, ...b.witness.talk.map((t) => t.reply)].join(' ') });
        setVoiceWorld(worldRef.current?.id ?? gameLangRef.current);
        warmVoices(voiceRef.current, who, gameLangRef.current);
      }
      if (b.job) scene?.spawnObjective(b.job.kind, b.job.count, b.job.look, b.place?.name ?? null, itemFor(b.job));
      else scene?.clearObjective();
      progressRef.current = 0;
      setProgress(0);
      decidedRef.current = false;
      scene?.setMarker(b.job && b.place ? { place: b.place.name } : { npc: b.npc.name });
      beatRef.current = b;
      setBeat(b);
      beatsRef.current = [...beatsRef.current.filter((x) => x.index < b.index), b];
      decisionRef.current = null;
      // Who this beat says is dead, and anyone a decision before it killed, leave the scene now.
      bury(b.dead ?? [], [b.npc.name, ...(b.witness ? [b.witness.npc.name] : [])]);
      recordLine({ kind: 'beat', beat: b.index, speaker: b.title, text: b.objectiveText });
      persist();
      if (!announce) return;
      const tt = tRef.current;
      if (b.index === 0) notify(tt.noticeQuest, b.title, b.job ? b.objectiveText : tt.talkTo(b.npc.name));
      else notify(tt.nextStep, b.objectiveText);
    },
    [bury, meetPerson, notify, persist],
  );

  /** Makes `w` the world being played: the beats are written in it and the scene drawn from it. */
  const enterWorld = useCallback((w: WorldBible) => {
    worldRef.current = w;
    setWorld(w);
    sceneRef.current?.applyWorld(w.look, w.id);
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
    carryTalkRef.current = [];
    whereRef.current.clear();
    spokenRef.current.clear();
    askedRef.current.clear();
    // A world invented just before this quest stays in the console with it, and so does its start.
    if (!keepLog) {
      resetDevlog();
      beginTimeline('quest');
    }
    beginQuestSpend();
    resetTranscript();
    beatsRef.current = [];
    decisionRef.current = null;
    // A new quest in this world abandons the one in progress here; other worlds keep theirs.
    clearGame(worldRef.current?.id ?? gameLangRef.current);
    setSaved(null);
    staticRef.current = false;
    pendingRef.current = null;
    const scene = sceneRef.current;
    scene?.clearObjective();
    scene?.clearPlaces();
    scene?.clearNpcs();
    scene?.setMarker(null);
    scene?.teleport('spawn');
    restoreAtlas();
    // Drawn against what the world already has: a quest can only cross a past there is.
    const mood = drawMood({ places: placesRef.current.length, people: charactersRef.current.length });
    moodRef.current = mood;
    if (worldRef.current) setScore({ world: worldRef.current, tone: mood.tone });
    seedRef.current = seedFor(mood.tone);
    questIdRef.current = `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    log.info('rpg.quest.mood', { ...mood, seed: seedRef.current });

    // A world just invented is still being built around the hero; an old one only waits for its quest.
    flash(keepLog ? tRef.current.buildingWorld : tRef.current.writingBackground, 5000);
    const writeOpening = async (): Promise<void> => {
      setGenerating(true);
      writingSinceRef.current = Date.now();
      const { beat: opening, failure } = await writeBeat(0, null, [], null);
      if (token !== questTokenRef.current) return;
      setGenerating(false);
      if (opening) {
        markStage('quest');
        if (!staticRef.current) rememberTiming('quest', Date.now() - writingSinceRef.current);
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
   * What fal.ai made for a world before the world existed to keep it (`previewWorld`): held here
   * by its id until the world is born and saved with it (`withEarly`).
   */
  const earlyRef = useRef(new Map<string, EarlyMade>());
  const earlyFor = (id: string) => {
    let kept = earlyRef.current.get(id);
    if (!kept) earlyRef.current.set(id, (kept = { models: [] }));
    return kept;
  };

  /** One of the hub's models has come: kept on the world, wherever it is by now, and in the scene. */
  const keepModel = useCallback((id: string, slot: HubSlot, model: LandmarkModel) => {
    rememberTiming('model', model.ms - (model.queuedMs ?? 0));
    if (slot === 'landmark') markStage('landmark');
    markStage('firstModel');
    if (!findWorld(id)) {
      earlyFor(id).models.push([slot, model]);
      setEarlyMade((n) => n + 1);
      return;
    }
    setWorldModel(id, slot, model);
    if (worldRef.current?.id === id) worldRef.current = withModel(worldRef.current, slot, model);
    setWorld((now) => {
      const next = now?.id === id ? withModel(now, slot, model) : now;
      if (next && next.id === id && hubSlots(next).every((s) => hubModel(next, s))) markStage('hub');
      return next;
    });
  }, []);

  /** The world's ground has been painted: the same, for the texture. */
  const keepGround = useCallback((id: string, texture: GroundTexture) => {
    rememberTiming('ground', texture.ms);
    markStage('ground');
    if (!findWorld(id)) {
      earlyFor(id).ground = texture;
      setEarlyMade((n) => n + 1);
      return;
    }
    setWorldGround(id, texture);
    if (worldRef.current?.id === id) worldRef.current = { ...worldRef.current, groundTexture: texture };
    setWorld((now) => (now?.id === id ? { ...now, groundTexture: texture } : now));
  }, []);

  /** The hero's model: the same, kept on the world. */
  const keepHero = useCallback((id: string, model: LandmarkModel) => {
    if (!findWorld(id)) {
      earlyFor(id).hero = model;
      setEarlyMade((n) => n + 1);
      return;
    }
    setWorldHero(id, model);
    if (worldRef.current?.id === id) worldRef.current = { ...worldRef.current, heroModel: model };
    setWorld((now) => (now?.id === id ? { ...now, heroModel: model } : now));
  }, []);

  /** And what the hero holds (`utils/rpg/weapon.ts`). */
  const keepWeapon = useCallback((id: string, model: LandmarkModel) => {
    if (!findWorld(id)) {
      earlyFor(id).weapon = model;
      setEarlyMade((n) => n + 1);
      return;
    }
    setWorldWeapon(id, model);
    if (worldRef.current?.id === id) worldRef.current = { ...worldRef.current, weaponModel: model };
    setWorld((now) => (now?.id === id ? { ...now, weaponModel: model } : now));
  }, []);

  /** And what grows on it. */
  const keepCover = useCallback((id: string, sprites: GroundTexture[]) => {
    markStage('cover');
    if (!findWorld(id)) {
      earlyFor(id).cover = sprites;
      setEarlyMade((n) => n + 1);
      return;
    }
    setWorldCover(id, sprites);
    if (worldRef.current?.id === id) worldRef.current = { ...worldRef.current, coverSprites: sprites };
    setWorld((now) => (now?.id === id ? { ...now, coverSprites: sprites } : now));
  }, []);

  /** A world just born, with whatever was made for it while it was still being written. */
  const withEarly = useCallback((w: WorldBible): WorldBible => {
    const kept = earlyRef.current.get(w.id);
    earlyRef.current.delete(w.id);
    return withMade(w, kept);
  }, []);

  /** Asks fal.ai for whatever of the world's ground and hub it lacks; each piece once, however often asked. */
  const startWorldAssets = useCallback(
    (w: WorldBible) => {
      const key = falKeyRef.current;
      if (!key || w.createdAt === 0) return;
      ensureGroundTexture(key, w, (texture) => keepGround(w.id, texture), (e) => log.warn('rpg.ground.failed', describeError(e)));
      ensureGroundCover(key, w, (sprites) => keepCover(w.id, sprites), (e) => log.warn('rpg.cover.failed', describeError(e)));
      ensureHubModels(
        key,
        w,
        (slot, model) => keepModel(w.id, slot, model),
        (slot, e) => log.warn('rpg.landmark.failed', { slot, ...describeError(e) }),
      );
      // The hero (`people.ts`): a world from before `hero` is described from who the player is.
      if (!w.heroModel)
        ensurePersonModel(
          key,
          'hero',
          w.id,
          personPrompt(heroLook(w), { gender: heroBody(heroLook(w)) }, w.look.light),
          (model) => keepHero(w.id, model),
          (e) => {
            log.warn('rpg.hero.failed', describeError(e));
            if (worldRef.current?.id === w.id) void sceneRef.current?.setHero({});
          },
        );
      // What the hero holds, once per world like the hero; a world from before `weapon` gets one
      // guessed from who the player is. Failing, the hero holds the kit's sword.
      if (!w.weaponModel)
        ensureWeaponModel(
          key,
          w.id,
          weaponPrompt(weaponLook(w), w.look),
          (model) => keepWeapon(w.id, model),
          (e) => {
            log.warn('rpg.weapon.failed', describeError(e));
            if (worldRef.current?.id === w.id || previewRef.current?.id === w.id) void sceneRef.current?.setWeapon({});
          },
        );
    },
    [keepCover, keepGround, keepHero, keepModel, keepWeapon],
  );

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
    beginTimeline('world');
    previewRef.current = null;
    setPreview(null);
    setCreating([]);
    setPendingGenesis(null);
    // The story intro starts talking at once, before the seeds are even drawn (`intro.ts`): it needs
    // the reader's own Google key for the words; the voice and the pictures come where there are keys.
    // A proposal picked on the menu is the player's description, as if typed (`proposalWish`).
    const picked = again ? null : proposalRef.current;
    proposalRef.current = null;
    const askedNow: Wish = picked ? { words: [], text: proposalWish(picked, gameLang) } : wishRef.current;
    if (introOnRef.current && storyProvider === 'google' && apiKeys.google) {
      startIntro({
        lang: gameLang,
        google: apiKeys.google,
        fal: falKeyRef.current,
        voice: voiceRef.current && voiceRef.current !== DEMO_VOICE_KEY ? voiceRef.current : null,
        wish: (again ? again.wish : wished(askedNow) ? askedNow.text.trim() : '') || undefined,
      });
    } else {
      stopIntro();
    }
    // The last world goes at once: its places, its people and its quest's marks. The board stays
    // empty until the new world's own pieces come (`shown`).
    const scene = sceneRef.current;
    scene?.clearObjective();
    scene?.clearClues();
    scene?.clearPlaces();
    scene?.clearNpcs();
    scene?.setMarker(null);
    scene?.teleport('spawn');
    // The player's own words and description when they gave any (`WorldWish`), the dice otherwise.
    const asked = askedNow;
    const own = !again && wished(asked);
    const seeds = again?.seeds ?? (own ? asked.words : await drawSeeds());
    const chosenSeeds = again ? again.chosen === true : own && asked.words.length > 0;
    const wishText = (again ? again.wish : own ? asked.text.trim() : '') || undefined;
    const exoticNow = again?.exotic ?? (picked ? PROPOSAL_EXOTIC : exoticRef.current);
    if (token !== questTokenRef.current) return;
    setCreating(seeds);
    setCreatingWish(wishText ?? '');
    const nth: 1 | 2 = again?.nth ?? (Math.random() < 0.5 ? 1 : 2);
    const avoid = again?.avoid ?? pastWorlds();
    const light = again ? again.light : drawLight();
    const pending = { lang: gameLang, seeds, exotic: exoticNow, chosen: chosenSeeds, wish: wishText, nth, avoid, light };
    savePendingGenesis({ ...pending, at: Date.now() });
    const keys = { google: apiKeys.google, openai: apiKeys.openai, demo: storyProvider === 'demo' };
    const chosen = chosenModelRef.current;
    // The hub's models start from the stream, the moment what they are made of has been written,
    // rather than a minute later when the whole bible has (`previewWorld`).
    const early = (preview: WorldBible) => {
      if (token !== questTokenRef.current) return;
      markStage('assets');
      previewRef.current = preview;
      setPreview(preview);
      // Its sky and light at once, the first thing about it there is to see.
      sceneRef.current?.applyWorld(preview.look, preview.id);
      startWorldAssets(preview);
    };
    let attempt;
    try {
      attempt = await generateWorld(
        keys,
        {
          lang: gameLang,
          seeds,
          avoid,
          exotic: exoticNow,
          chosen: chosenSeeds,
          wish: wishText,
          nth,
          light,
        },
        chosen,
        quick(fastStartRef.current),
        early,
        (sketch) => {
          if (token === questTokenRef.current) introSketch(sketch);
        },
      );
    } catch (e) {
      log.error('rpg.world.crashed', describeError(e));
      attempt = null;
    }
    if (token !== questTokenRef.current) return;
    setCreating(null);
    // Answered, one way or the other: a reload now has nothing to finish.
    clearPendingGenesis();
    previewRef.current = null;
    setPreview(null);
    if (attempt) {
      addGenerationTime(attempt.ms, 'world');
      if (attempt.world) rememberTiming('world', attempt.ms);
      recordWorld(uidRef.current, attempt, gameLang, chosen);
    }
    // What the genesis cost is the world's, kept on it for every quest's closing screen.
    const born = attempt?.world ? withEarly({ ...attempt.world, spent: triesSpend(attempt.tries, attempt.ms) }) : null;
    if (born) {
      markStage('world');
      // A stream that never let the world be named early (an old answer's shape) names it now.
      introSketch({ name: born.name, pitch: born.pitch });
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
    stopIntro();
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
  }, [apiKeys.google, apiKeys.openai, enterWorld, flash, gameLang, startQuest, startWorldAssets, storyProvider, withEarly]);
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
      onSenses: setSenses,
    });
    sceneRef.current = scene;
    scene.setRigger(riggerRef.current, falKeyRef.current);
    scene.setJumping(jumpingRef.current);
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
        mood: moodRef.current,
        dead: deadRef.current,
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

  // The hub (`utils/rpg/landmark3d.ts`): an invented world's own landmark, houses, tree and the
  // things in its square, from fal.ai, each made once and kept on the world, and the forest's trees
  // across the map; each stands the moment it has loaded, and nothing stands in for it before.
  const falKey = keysReady ? apiKeys.fal : null;

  /**
   * Everything the start is making, for the progress in the corner (`WorldProgress`): the world and
   * the opening, then the ground and every hub model of the world being made (its preview while the
   * genesis still streams, every slot assumed until even that has come), and the quest's own pieces.
   */
  /** What the console's Dialogi tab reads: the beats so far and the decisions taken in them. */
  const questView = useCallback(
    () => ({ beats: beatsRef.current, history: historyRef.current, people: charactersRef.current }),
    [],
  );

  /**
   * The console's remake (owner, 29 Oct 2026: "a button in the developer console to generate new
   * characters, picture, model and rig, during the game by the new settings, so I can compare how it
   * looks in the game"): whoever stands here as a generated model is made again as the switches now
   * stand, and replaces their old model where it was kept (the character, the world's hero, the beat's
   * enemy). Each is a new piece, so `ensurePiece`'s made-once does not stop it.
   */
  const remakingRef = useRef(0);
  const remakePeople = useCallback(
    (who: 'nearest' | 'hero' | 'all') => {
      const world = worldRef.current;
      const key = falKeyRef.current;
      const scene = sceneRef.current;
      if (!world || world.createdAt === 0 || !key || !scene) return;
      const here = scene.generatedPeople();
      const stamp = `#${Date.now().toString(36)}`;
      const ask = (label: PersonSlot, id: string, prompt: string, onModel: (model: LandmarkModel) => void) => {
        remakingRef.current++;
        const done = () => remakingRef.current--;
        const asked = ensurePersonModel(
          key,
          label,
          id + stamp,
          prompt,
          (model) => {
            done();
            onModel(model);
          },
          (e) => {
            done();
            log.warn('rpg.remake.failed', { label, ...describeError(e) });
          },
        );
        if (!asked) done();
      };
      for (const name of who === 'nearest' ? here.people.slice(0, 1) : who === 'hero' ? [] : here.people) {
        const c = charactersRef.current.find((k) => k.name === name);
        if (!c) continue;
        ask('person', `${world.id}/${c.name}`, personPrompt(personLook(c, world), c, world.look.light), (model) => {
          keepPerson(world.id, c.name, model);
          if (worldRef.current?.id === world.id)
            void sceneRef.current?.setNpcBody(c.name, { url: model.glb, picture: model.image }).catch((e) => log.warn('rpg.person.load.failed', { name: c.name, ...describeError(e) }));
        });
      }
      if (who === 'nearest') return;
      if (here.hero || who === 'hero') ask('hero', world.id, personPrompt(heroLook(world), { gender: heroBody(heroLook(world)) }, world.look.light), (model) => keepHero(world.id, model));
      if (who === 'hero') return;
      const beat = beatRef.current;
      const job = beat?.job;
      if (here.enemy && beat && job?.kind === 'slay') {
        const token = questTokenRef.current;
        ask('enemy', `${world.id}/${seedRef.current}/${beat.index}/${job.targetName}`, personPrompt(job.prop ?? job.targetName, { color: job.look.color }, world.look.light), (model) => {
          if (questTokenRef.current !== token) return;
          const keep = (b: Beat): Beat => (b.index === beat.index && b.title === beat.title && b.job ? { ...b, job: { ...b.job, model } } : b);
          beatsRef.current = beatsRef.current.map(keep);
          if (beatRef.current) beatRef.current = keep(beatRef.current);
          persistRef.current();
          if (beatRef.current?.index === beat.index)
            void sceneRef.current?.setEnemyBody({ url: model.glb, picture: model.image }).catch((e) => log.warn('rpg.enemy.load.failed', describeError(e)));
        });
      }
    },
    [keepHero, keepPerson],
  );

  /** What the console's remake button offers: how many, at what, as the switches stand. */
  const remakeOffer = useCallback((): RemakeOffer | null => {
    const scene = sceneRef.current;
    const world = worldRef.current;
    if (!scene || !world || world.createdAt === 0 || !falKeyRef.current) return null;
    const here = scene.generatedPeople();
    const { painter, mesher } = personMakersNow();
    const rig = riggerRef.current === 'meshy' ? FAL_PRICES.rig : 0;
    return {
      nearest: here.people[0] ?? null,
      hero: here.hero,
      count: here.people.length + (here.hero ? 1 : 0) + (here.enemy ? 1 : 0),
      eachUsd: personCostNow() + rig,
      makers: { painter, mesher, rigger: riggerRef.current },
      running: remakingRef.current,
      run: remakePeople,
    };
  }, [remakePeople]);

  const progressTasks = useCallback((): Task[] => {
    const line = timeline();
    const tasks: Task[] = [];
    if (creating) tasks.push({ kind: 'world', state: 'running', since: line?.what === 'world' ? line.since : null });
    else if (line?.what === 'world' && line.stages.world !== undefined) tasks.push({ kind: 'world', state: 'done', since: null });
    if (generating) tasks.push({ kind: 'quest', state: 'running', since: writingSinceRef.current || null });
    else if (creating) tasks.push({ kind: 'quest', state: 'queued', since: null });
    else if (line && line.stages.quest !== undefined) tasks.push({ kind: 'quest', state: 'done', since: null });
    // The score, once it is being composed in this start (`music.ts`): on its own line, like the ground.
    if (music.status !== 'idle' && music.since !== null && (!line || music.since >= line.since)) {
      tasks.push({
        kind: 'music',
        state: music.status === 'composing' ? 'running' : music.status === 'failed' ? 'failed' : 'done',
        since: music.since,
      });
    } else if (creating && musicKey && musicOn) {
      // Composed for the world's first quest, once the world is written.
      tasks.push({ kind: 'music', state: 'queued', since: null, afterWorld: true });
    }
    // Every generated person being rigged (`utils/rpg/rigging.ts`), until they move (owner, 2 Nov
    // 2026: "our rigging endpoint is outside the main loading bar … put it in"). They stand as a
    // stickman and then a static model before that, and SkinTokens' or Meshy's rig comes after it
    // without holding the bar (owner, 10 Nov 2026: stage by stage). A world with models kept and no
    // key rigs too, so these come before the key's check.
    for (const r of rigsOfStart(line?.since ?? null, Date.now())) {
      const going = moving(r);
      tasks.push({ kind: 'rig', state: !going ? 'running' : r.failed ? 'failed' : 'done', since: !going ? r.startedAt : null });
    }
    if (!falKey) return tasks;
    const pending = falPending();
    const aw = creating ? previewRef.current : world;
    if (creating && !aw) {
      // The ground and what grows on it, both pictures, both in the ground's row.
      tasks.push({ kind: 'ground', state: 'queued', since: null, afterWorld: true });
      tasks.push({ kind: 'ground', state: 'queued', since: null, afterWorld: true });
      for (let i = 0; i < HUB_SLOTS.length; i++) tasks.push({ kind: 'model', state: 'queued', since: null, afterWorld: true });
      // And the hero, rigged once its model has come, and what the hero holds.
      tasks.push({ kind: 'rig', state: 'queued', since: null, afterWorld: true, afterFal: true });
      tasks.push({ kind: 'piece', state: 'queued', since: null, afterWorld: true });
    } else if (aw && aw.createdAt > 0) {
      const early = earlyRef.current.get(aw.id);
      const ground = groundState(aw.id);
      tasks.push({
        kind: 'ground',
        state: aw.groundTexture || early?.ground ? 'done' : ground === 'pending' ? 'running' : ground === 'failed' ? 'failed' : 'queued',
        since: null,
      });
      if (hasCover(aw)) {
        const cover = coverState(aw.id);
        tasks.push({
          kind: 'ground',
          state: aw.coverSprites || early?.cover ? 'done' : cover === 'pending' ? 'running' : cover === 'failed' ? 'failed' : 'queued',
          since: null,
        });
      }
      for (const slot of hubSlots(aw)) {
        const asked = pending.find((p) => p.id === `${aw.id}/${slot}`);
        const state: Task['state'] =
          hubModel(aw, slot) || early?.models.some(([s]) => s === slot)
            ? 'done'
            : asked
              ? asked.since === null
                ? 'queued'
                : 'running'
              : hubSlotFailed(aw.id, slot)
                ? 'failed'
                : 'queued';
        tasks.push({ kind: 'model', state, since: asked?.since ?? null });
      }
    }
    for (const p of pending) {
      if (/^(clue|place|person|hero|enemy|creature|weapon)\//.test(p.id)) tasks.push({ kind: 'piece', state: p.since === null ? 'queued' : 'running', since: p.since });
      // A person still being made is a rig still to come, after it.
      if (/^(person|hero|enemy)\//.test(p.id)) tasks.push({ kind: 'rig', state: 'queued', since: null, afterFal: true });
    }
    // A piece counts once, by how its last try ended (`falPiecesEnded`): a try that failed and was
    // asked again, or a job the server handed back to the browser, is the console's, not the player's.
    for (const e of falPiecesEnded()) {
      if (!PIECE_LABELS.has(e.id.split('/')[0]) || (line && e.asked < line.since)) continue;
      tasks.push({ kind: 'piece', state: e.ok ? 'done' : 'failed', since: null });
    }
    return tasks;
  }, [creating, generating, falKey, world, music, musicKey, musicOn]);
  falKeyRef.current = falKey;
  // The menu's four proposed worlds (`proposals.ts`): drawn from the server's daily pool for every
  // reader, on the first frame — nothing about them waits for the keys or the account.
  const proposing = !started && menu === 'main';
  useEffect(() => {
    if (proposing) ensureProposals(gameLang);
  }, [proposing, gameLang]);
  useEffect(() => sceneRef.current?.setRigger(rigger, falKey), [rigger, falKey]);
  useEffect(() => sceneRef.current?.setJumping(jumping), [jumping]);
  // The places already standing ask again once the key is there (each piece is made once whatever happens).
  useEffect(() => {
    if (!falKey || !world || world.createdAt === 0 || creating) return;
    for (const place of placesRef.current) putPlace(place);
  }, [falKey, world, creating, putPlace]);
  keysReadyRef.current = keysReady;
  // Everyone standing is drawn again once it is known whether a key will make their models: the
  // ones waiting for it are asked for, and without one the kit's people come.
  useEffect(() => {
    if (!world || creating) return;
    for (const c of charactersRef.current) {
      if (!whereRef.current.has(c.name)) continue;
      void sceneRef.current?.setNpcBody(c.name, bodyFor(c)).catch((e) => log.warn('rpg.person.load.failed', { name: c.name, ...describeError(e) }));
      ensureNpcModel(c);
    }
  }, [falKey, keysReady, world, creating, bodyFor, ensureNpcModel]);
  const inventing = creating !== null;
  /**
   * What the scene draws: the world, or while one is invented its preview with whatever fal.ai has
   * made for it so far (`earlyRef`), and nothing before the preview. The last world is not this one
   * (owner, 30 Oct 2026: "an emptiness in which the new things appear as they are generated").
   */
  const shown = useMemo(
    () => (inventing ? (preview ? withMade(preview, earlyRef.current.get(preview.id)) : null) : world),
    [inventing, preview, earlyMade, world],
  );
  // The hero: the world's own once made, nobody while it is (a world being invented too, until its
  // own has come), the kit's ranger in the classic world and without a key.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const invented = !!world && world.createdAt > 0;
    const look = world ? heroLook(world) : '';
    const body: PersonBody =
      creating !== null
        ? { url: shown?.heroModel?.glb, picture: shown?.heroModel?.image, wait: true }
        : { url: invented ? world!.heroModel?.glb : undefined, picture: invented ? world!.heroModel?.image : undefined, wait: invented && (!!world!.heroModel || !keysReady || !!falKey) };
    void scene.setHero(body, creating !== null && shown ? heroLook(shown) : look).catch((e) => log.warn('rpg.hero.load.failed', describeError(e)));
  }, [world, creating, shown, falKey, keysReady]);
  // What the hero holds: the world's own weapon once made, nothing while it is, the kit's sword in
  // the classic world, without a key and once it cannot come this session.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const w = creating !== null ? shown : world;
    const invented = !!w && w.createdAt > 0;
    const url = invented ? w!.weaponModel?.glb : undefined;
    const wait = creating !== null ? !!falKey || !keysReady : invented && (!!w!.weaponModel || !keysReady || (!!falKey && weaponModelMayCome(w!.id)));
    void scene.setWeapon({ url, wait }, weaponLength(w)).catch((e) => log.warn('rpg.weapon.load.failed', describeError(e)));
  }, [world, creating, shown, falKey, keysReady]);
  const sizesAskedRef = useRef(new Set<string>());
  // Where it all stands is the world's own (`utils/rpg/hubLayout.ts`), and nothing stands there until
  // its model has come: an empty board, filling in. The board is empty while a world is invented,
  // the last world's village not being this one's. The kit's village only where no model will ever
  // come — the classic world, and a world with none made and no key to make them (until the keys have
  // loaded one is assumed, so the kit does not flash up first).
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (inventing) return scene.setLayout(preview ? hubLayout(preview.id, preview.sizes) : EMPTY_LAYOUT);
    if (!world) return;
    const made = world.createdAt > 0 && HUB_SLOTS.some((slot) => hubModel(world, slot)?.glb);
    const ownModels = world.createdAt > 0 && (!keysReady || !!falKey || made);
    scene.setLayout(ownModels ? hubLayout(world.id, world.sizes) : null);
  }, [world, inventing, preview, falKey, keysReady]);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || (!shown && !inventing)) return;
    // Nothing yet of a world being invented whose preview has not come.
    const made = shown && shown.createdAt > 0 ? shown : null;
    const urls: Partial<Record<HubSlot, string>> = {};
    if (made) for (const slot of HUB_SLOTS) {
      const glb = hubModel(made, slot)?.glb;
      if (glb) urls[slot] = glb;
    }
    void scene.setHubModels(urls, made?.sizes, (slot, e) => log.warn('rpg.landmark.load.failed', { slot, ...describeError(e) }));
    // The same tree, and its young and old ones, across the whole map, as big as the world says its tree is.
    const forest = FOREST_SLOTS.flatMap((slot) => (urls[slot] ? [urls[slot]] : []));
    void scene.setForest(forest, made?.sizes?.tree, (url, e) => log.warn('rpg.forest.load.failed', { url, ...describeError(e) }));
    // And the ground it all stands on, painted for the world (`utils/rpg/groundTexture.ts`).
    const groundImage = made?.groundTexture?.image ?? null;
    void scene.setGroundTexture(groundImage, (e) => log.warn('rpg.ground.load.failed', describeError(e)));
    // And what grows on it (`utils/rpg/groundCover.ts`); under a layout nothing grows until it has come.
    const cover = (made?.coverSprites ?? []).map((s) => s.image);
    void scene.setGroundCover(cover, (url, e) => log.warn('rpg.cover.load.failed', { url, ...describeError(e) }));
  }, [shown, inventing]);
  useEffect(() => {
    if (!world || inventing) return;
    // A world described before genesis gave sizes asks for them once, so its pieces stand as big as
    // what they are rather than as big as their slot (`hubFit`).
    if (keysReady && world.createdAt > 0 && !world.sizes && (world.kit || world.landmark) && !sizesAskedRef.current.has(world.id)) {
      sizesAskedRef.current.add(world.id);
      const keys = { google: apiKeys.google, openai: apiKeys.openai, demo: false };
      void generateHubSizes(keys, world, chosenModelRef.current)
        .then(({ sizes, tries, ms }) => {
          const spent = triesSpend(tries, ms);
          if (tries.length > 0) {
            addWorldSpend(world.id, spent);
            if (worldRef.current?.id === world.id) worldRef.current = { ...worldRef.current, spent: addModelSpend(worldRef.current.spent, spent) };
            setWorld((now) => (now?.id === world.id ? { ...now, spent: addModelSpend(now.spent, spent) } : now));
          }
          if (!sizes) return;
          setWorldSizes(world.id, sizes);
          if (worldRef.current?.id === world.id) worldRef.current = { ...worldRef.current, sizes };
          setWorld((now) => (now?.id === world.id ? { ...now, sizes } : now));
        })
        .catch((e) => log.warn('rpg.sizes.failed', describeError(e)));
    }
    if (!falKey || world.createdAt === 0) return;
    startWorldAssets(world);
  }, [world, inventing, falKey, keysReady, startWorldAssets]);

  // A beat's clues as real things (owner, 26 Oct 2026: "generated assets to examine"): each made
  // once by fal.ai from the English `prop` the beat wrote for it, on the reader's own key, while the
  // block stands in for it. Kept on the beat, so the autosave has it and Continue loads it.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !beat) return;
    beat.clues.forEach((clue, i) => {
      const id = `clue-${beat.index}-${i}`;
      const load = (glb: string) =>
        scene.setClueModel(id, glb).catch((e) => log.warn('rpg.clue.load.failed', describeError(e)));
      if (clue.model) {
        void load(clue.model.glb);
        return;
      }
      if (!falKey) return;
      // A beat now and then writes a clue with no `prop` (2 Nov 2026: "Porzucony flakon z żywicą"
      // stood as its block for good). Its own name and description then say what it is: in the
      // game's language, which FLUX reads well enough for a single thing, and far better than a block.
      const what = clue.prop ?? [clue.name, clue.text].filter(Boolean).join(': ');
      if (!what) return;
      if (!clue.prop) log.warn('rpg.clue.noProp', { name: clue.name });
      const token = questTokenRef.current;
      const world = worldRef.current;
      ensureClueModel(
        falKey,
        `${world?.id ?? gameLangRef.current}/${seedRef.current}/${beat.index}/${i}/${clue.name}`,
        cluePrompt(what, world?.look),
        (model) => {
          if (questTokenRef.current !== token) return;
          const keep = (b: Beat): Beat =>
            b.index === beat.index && b.title === beat.title
              ? { ...b, clues: b.clues.map((c, j) => (j === i ? { ...c, model } : c)) }
              : b;
          beatsRef.current = beatsRef.current.map(keep);
          if (beatRef.current) beatRef.current = keep(beatRef.current);
          persist();
          void load(model.glb);
        },
        (e) => log.warn('rpg.clue.failed', describeError(e)),
      );
    });
  }, [beat, falKey, persist]);

  // The beat's things to gather, made once by fal.ai from the English `prop` it wrote for them (its
  // name for a beat from before), on the reader's own key, and kept on the beat like a clue's.
  useEffect(() => {
    const scene = sceneRef.current;
    const job = beat?.job;
    if (!scene || !beat || job?.kind !== 'collect' || job.model) return;
    const world = worldRef.current;
    if (!falKey || !world || world.createdAt === 0) return;
    const token = questTokenRef.current;
    ensureClueModel(
      falKey,
      `item/${world.id}/${seedRef.current}/${beat.index}/${job.targetName}`,
      cluePrompt(job.prop ?? job.targetName, world.look),
      (model) => {
        if (questTokenRef.current !== token) return;
        const keep = (b: Beat): Beat =>
          b.index === beat.index && b.title === beat.title && b.job ? { ...b, job: { ...b.job, model } } : b;
        beatsRef.current = beatsRef.current.map(keep);
        if (beatRef.current) beatRef.current = keep(beatRef.current);
        persist();
        if (beatRef.current?.index === beat.index) void scene.setItemModel(model.glb).catch(() => scene.setItemModel(null));
      },
      (e) => {
        log.warn('rpg.item.failed', describeError(e));
        // Nothing would ever stand there: the block, so the step can still be done.
        if (beatRef.current?.index === beat.index) void scene.setItemModel(null);
      },
    );
  }, [beat, falKey, persist]);

  // The beat's enemies, when they walk on two legs: a person made once from the English `prop` the
  // beat wrote for them (their name for a beat from before), rigged as a person is, kept on the beat.
  useEffect(() => {
    const scene = sceneRef.current;
    const job = beat?.job;
    if (!scene || !beat || job?.kind !== 'slay' || job.look.shape !== 'humanoid' || job.model) return;
    const world = worldRef.current;
    if (!falKey || !world || world.createdAt === 0) return;
    const token = questTokenRef.current;
    ensurePersonModel(
      falKey,
      'enemy',
      `${world.id}/${seedRef.current}/${beat.index}/${job.targetName}`,
      personPrompt(job.prop ?? job.targetName, { color: job.look.color }, world.look.light),
      (model) => {
        if (questTokenRef.current !== token) return;
        const keep = (b: Beat): Beat =>
          b.index === beat.index && b.title === beat.title && b.job ? { ...b, job: { ...b.job, model } } : b;
        beatsRef.current = beatsRef.current.map(keep);
        if (beatRef.current) beatRef.current = keep(beatRef.current);
        persist();
        if (beatRef.current?.index === beat.index)
          void scene.setEnemyBody({ url: model.glb, picture: model.image }).catch((e) => log.warn('rpg.enemy.load.failed', describeError(e)));
      },
      (e) => {
        log.warn('rpg.enemy.failed', describeError(e));
        // Nobody would ever come: the kit's body, so the step can still be done.
        if (beatRef.current?.index === beat.index) void scene.setEnemyBody({});
      },
    );
  }, [beat, falKey, persist]);

  // The beat's enemies that do not walk on two legs, a beast or a blob: a creature made once from the
  // same English `prop`, moved by the game rather than rigged (`utils/rpg/creature.ts`), kept on the beat.
  useEffect(() => {
    const scene = sceneRef.current;
    const job = beat?.job;
    if (!scene || !beat || job?.kind !== 'slay' || job.model) return;
    const shape = job.look.shape;
    if (shape !== 'beast' && shape !== 'blob') return;
    const world = worldRef.current;
    if (!falKey || !world || world.createdAt === 0) return;
    const token = questTokenRef.current;
    ensureCreatureModel(
      falKey,
      `${world.id}/${seedRef.current}/${beat.index}/${job.targetName}`,
      creaturePrompt(job.prop ?? job.targetName, shape, job.look.color, world.look.light),
      (model) => {
        if (questTokenRef.current !== token) return;
        const keep = (b: Beat): Beat =>
          b.index === beat.index && b.title === beat.title && b.job ? { ...b, job: { ...b.job, model } } : b;
        beatsRef.current = beatsRef.current.map(keep);
        if (beatRef.current) beatRef.current = keep(beatRef.current);
        persist();
        if (beatRef.current?.index === beat.index)
          void scene.setEnemyBody({ url: model.glb, picture: model.image }).catch((e) => {
            log.warn('rpg.creature.load.failed', describeError(e));
            void scene.setEnemyBody({});
          });
      },
      (e) => {
        log.warn('rpg.creature.failed', describeError(e));
        // Nothing would ever come: the block, so the step can still be done.
        if (beatRef.current?.index === beat.index) void scene.setEnemyBody({});
      },
    );
  }, [beat, falKey, persist]);

  // A notice waits for the dialogue it arrived under to close, then shows for six seconds: a step
  // that lands while the reply is still being read must not expire unseen.
  const noticeShown = notice !== null && dialogue === null && ending === null && !intro.on;
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
    sceneRef.current?.setPaused(!started || dialogue !== null || held !== null || ending !== null || stalled !== null || logOpen);
  }, [started, dialogue, held, ending, stalled, logOpen]);

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
    freeAskRef.current += 1;
    freeHeroEndRef.current = null;
    setFreeState(null);
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
      const heard = heardAside(b, witnessHeardRef.current, askedTalkRef.current, freeTalkRef.current);
      const step: StepRecord = {
        npcName: b.npc.name,
        placeName: b.place?.name ?? null,
        situation: b.situation.slice(0, SITUATION_MAX),
        chose: d.label,
        consequence: d.consequence,
        ...(jobDone(b.job) && { done: jobDone(b.job)! }),
        ...(heard && { heard }),
        ...(b.witness && { witnessName: b.witness.npc.name }),
        ...(d.meet && { meet: d.meet }),
        ...(d.free && { own: true as const }),
        ...(d.to && { to: d.to }),
      };
      // Said to someone else (a typed line, `freeLine.ts`): they answer it.
      const by = (d.to && (b.witness?.npc.name === d.to ? b.witness.npc : charactersRef.current.find((c) => c.name === d.to))) || b.npc;
      // A job left for a course of the hero's own is not done, and its foes or things leave with it.
      const left = b.job ? progressRef.current < b.job.count : false;
      if (left) {
        delete step.done;
        step.left = true;
        sceneRef.current?.clearObjective();
      }
      // A single foe killed by name, and whoever this choice kills. The one answering stays on screen.
      bury([left ? null : slainBy(b.job), ...(d.dies ?? [])], [b.npc.name, by.name, ...(b.witness ? [b.witness.npc.name] : [])]);
      const steps = [...historyRef.current, step];
      historyRef.current = steps;
      setHistory(steps);
      lastLinesRef.current.set(by.name, d.reply);
      decidedRef.current = true;
      decisionRef.current = b.decisions.indexOf(d);
      persist();
      const line: DialogueLine = { speaker: by.name, voice: by.gender, text: d.reply, who: by };
      if (!d.next) {
        setDialogue({ line, choices: [{ label: t.theEnd, action: () => finish(b, by.name, d.reply, steps) }] });
        return;
      }
      // Asked now, so most of it is written while the answer is being read and spoken.
      // Asked now, and waited for in the background: "Onward" only goes back to the world.
      pendingRef.current = writeBeat(b.index + 1, d.next, steps, b.title);
      void proceed(b, d, steps);
      setDialogue({ line, choices: [{ label: t.onward, action: close }] });
    },
    [bury, close, finish, persist, proceed, t, writeBeat],
  );

  /**
   * What the hero typed, answered by the model as whoever they speak to (`freeLine.ts`; owner, 11 Nov
   * 2026: "with any npc there is a free-text option… at every stage you can talk with any npc, make
   * small talk or push the story"). Talk, and the conversation goes back to `back`, kept as heard so
   * the story can take it up; or, while the step can still be decided, a decision, kept on the beat
   * and carried out as a picked one, answered by whoever heard it.
   */
  const askFree = useCallback(
    async (b: Beat | null, to: Character, said: string, back: () => void, told?: number) => {
      const ask = ++freeAskRef.current;
      const token = questTokenRef.current;
      const canDecide = Boolean(b) && !decidedRef.current;
      const stale = () =>
        ask !== freeAskRef.current || token !== questTokenRef.current || (canDecide && (beatRef.current !== b || decidedRef.current));
      const previous = dialogueRef.current;
      const lang = gameLangRef.current;
      const { on, key } = speechRef.current;
      const own = Boolean(b && to.name === b.npc.name);
      const witness = Boolean(b?.witness && to.name === b.witness.npc.name);
      freeHeroEndRef.current = null;
      // The hero's line on a screen of its own at once, read in the hero's voice while the model
      // answers (owner, 10 Nov 2026); the character's answer comes only once the hero has finished.
      setFreeState('busy');
      setDialogue({ line: { speaker: tRef.current.hunter, voice: 'player', text: said }, choices: [], hero: to.name });
      let heroEnd = performance.now();
      let heroLine: Promise<void> = Promise.resolve();
      if (on && key) {
        spokenRef.current.add(`player:${said}`);
        heroLine = speakLines(key, [{ text: said, voice: 'player' }], lang).catch((e: unknown) => {
          log.warn('rpg.voice.failed', describeError(e));
        });
      }
      const heroDone = heroLine.then(() => {
        heroEnd = performance.now();
        if (ask === freeAskRef.current) setFreeState((s) => (s === 'busy' ? 'waiting' : s));
      });
      const keys = { google: apiKeys.google, openai: apiKeys.openai };
      const heard = b
        ? heardAside(b, witnessHeardRef.current, askedTalkRef.current, decidedRef.current ? [...freeTalkRef.current, ...carryTalkRef.current] : freeTalkRef.current)
        : carryTalkRef.current.map((o) => `the hero said to ${o.with} "${o.label}", ${o.with}: ${o.reply}`).join(' | ');
      const attempt = await generateFree(
        keys,
        {
          lang,
          ...(worldRef.current && { world: worldRef.current }),
          title: b?.title ?? null,
          ...(moodRef.current && { mood: moodRef.current }),
          history: historyRef.current,
          beat: b,
          to,
          ...(!own && !witness && {
            their: {
              line: lastLinesRef.current.get(to.name),
              ...(whereRef.current.has(to.name) && { place: whereRef.current.get(to.name) ?? null }),
            },
          }),
          ...(told !== undefined && { told }),
          ...(b?.job && progressRef.current < b.job.count && { jobLeft: true }),
          decide: canDecide,
          heard,
          seen: [...seenRef.current],
          characters: charactersRef.current,
          dead: deadRef.current,
          said,
        },
        chosenModelRef.current,
        fastStartRef.current ? { first: FAST_MODEL } : {},
      ).catch((e: unknown) => {
        log.error('rpg.free.crashed', describeError(e));
        return null;
      });
      if (attempt) addGenerationTime(attempt.ms);
      if (stale()) return;
      const answer = attempt?.answer;
      if (!answer) {
        const error = (attempt?.error ?? 'crashed').slice(0, 160);
        log.warn('rpg.free.failed', { error, model: attempt?.model ?? null, to: to.name });
        // Back to where it was typed, the text still in the field, with the reason under it.
        if (previous) setDialogue(previous);
        setFreeState({ error });
        return;
      }
      const d = answer.kind === 'talk' || !b ? null : freeDecision(said, answer, own ? undefined : to.name);
      const reply = answer.reply;
      // The answer's voice is asked for now, while the hero is still speaking, so it starts with its text.
      const clip = on && key && reply ? prefetchLine(key, { text: reply, voice: to.gender, who: to }, lang) : Promise.resolve(true);
      await heroDone;
      await Promise.race([clip, new Promise((resolve) => window.setTimeout(resolve, FREE_CLIP_WAIT_MS))]);
      if (stale()) return;
      setFreeState(null);
      setFreeText('');
      freeHeroEndRef.current = on && key ? heroEnd : null;
      if (!d) {
        // Heard at the step still open, or carried to the next one when none is (`carryTalkRef`).
        const open = beatRef.current && !decidedRef.current ? beatRef.current : null;
        const entry: DialogueOption = { label: said, reply, ...(!(open && to.name === open.npc.name) && { with: to.name }) };
        if (open) freeTalkRef.current = [...freeTalkRef.current, entry];
        else carryTalkRef.current = [...carryTalkRef.current, entry];
        const at = beatRef.current ?? b;
        if (at) recordLine({ kind: 'ask', beat: at.index, speaker: tRef.current.hunter, text: said });
        lastLinesRef.current.set(to.name, reply);
        persist();
        setDialogue({
          line: { speaker: to.name, voice: to.gender, text: reply, who: to },
          choices: [{ label: tRef.current.back, action: back }],
          free: (next) => void askFreeRef.current(b, to, next, back, told),
        });
        return;
      }
      recordLine({ kind: 'decision', beat: b!.index, speaker: tRef.current.hunter, text: said });
      // On the beat, so the autosave's index and every later reading of the step find it.
      const kept: Beat = { ...b!, decisions: [...b!.decisions, d] };
      beatRef.current = kept;
      beatsRef.current = beatsRef.current.map((x) => (x === b ? kept : x));
      setBeat(kept);
      decide(kept, d);
    },
    [apiKeys.google, apiKeys.openai, decide, persist],
  );
  const askFreeRef = useRef(askFree);
  askFreeRef.current = askFree;

  const openTalk = useCallback(
    (name: string) => {
      const b = beatRef.current;
      if (endingRef.current) return;
      const bye: Choice = { label: t.goodbye, action: close };
      // Anyone may be told anything, at every step, on the reader's own key: the demo's function
      // writes beats and worlds, nothing else.
      const typed = ownStoryRef.current && !staticRef.current;
      const say = (to: Character, back: () => void, told?: number): Pick<Dialogue, 'free'> =>
        typed ? { free: (said: string) => void askFree(b, to, said, back, told) } : {};
      // What the hero knows of this step's story, for whoever else they talk to.
      const known = (): number | undefined => (heardRef.current ? undefined : toldRef.current);
      const who = charactersRef.current.find((c) => c.name === name);
      const w = b?.witness;
      if (b && w && name === w.npc.name && !decidedRef.current) {
        // Somebody else at the place, with their own side of it.
        const line = (text: string): DialogueLine => ({ speaker: w.npc.name, voice: w.npc.gender, text, who: w.npc });
        const root = (): void =>
          setDialogue({
            line: line(w.greeting),
            choices: [
              ...w.talk.map((o) => ({
                label: o.label,
                kind: 'ask' as const,
                action: () =>
                  setDialogue({ line: line(o.reply), choices: [{ label: t.back, action: root }, bye], ...say(w.npc, root, known()) }),
              })),
              bye,
            ],
            ...say(w.npc, root, known()),
          });
        lastLinesRef.current.set(w.npc.name, w.greeting);
        if (!witnessHeardRef.current) {
          witnessHeardRef.current = true;
          persist();
        }
        root();
        return;
      }
      if (!b || name !== b.npc.name || decidedRef.current) {
        // Anyone else in the world: their last line, and whatever the hero wants to say to them.
        const to = who ?? (b?.npc.name === name ? b.npc : b?.witness?.npc.name === name ? b.witness.npc : undefined);
        const other = (): void => {
          const last = lastLinesRef.current.get(name);
          setDialogue({
            line: { speaker: name, voice: to?.gender ?? 'male', text: last ?? (typed && to ? t.listening : t.nothingMore), who: to },
            choices: [bye],
            ...(to && say(to, other, b ? known() : undefined)),
          });
        };
        other();
        return;
      }
      const npc = (text: string): DialogueLine => ({ speaker: b.npc.name, voice: b.npc.gender, text, who: b.npc });

      if (b.job && progressRef.current < b.job.count) {
        const waiting = (): void => setDialogue({ line: npc(b.waitingLine), choices: [bye], ...say(b.npc, waiting, known()) });
        waiting();
        return;
      }
      // The story comes out in parts, one question at a time; the decisions, the questions and
      // what the clues opened up come only after the last part. Questions offered beside the
      // greeting named a silence and a girl the hunter had not heard of yet (owner, Oct 2026), and
      // a whole story in one line read as a summary, not a person (owner, Oct 2026). A typed line
      // may be said on every screen of it, and the answer knows only the parts told so far.
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
            setDialogue({ line: npc(o.reply), choices: [{ label: t.back, action: ending }], ...say(b.npc, ending) });
          },
        })),
        ...b.clues
          .filter((_, i) => seenRef.current.has(i))
          .map((c) => ({
            label: c.ask,
            kind: 'ask' as const,
            action: () => setDialogue({ line: npc(c.reply), choices: [{ label: t.back, action: ending }], ...say(b.npc, ending) }),
          })),
      ];
      // A decision waits for what it rests on: the gate the model set, and any word of its label
      // that only something not yet heard here says (`unlock.ts`).
      const before = knownBefore(beatsRef.current, b.index);
      const open = (d: Decision): boolean =>
        decisionOpen(
          b,
          d,
          { witness: witnessHeardRef.current, seen: seenRef.current, asked: askedTalkRef.current, free: freeTalkRef.current },
          before,
        );
      const ending = (): void => {
        if (!heardRef.current) {
          heardRef.current = true;
          persist();
        }
        setDialogue({
          line: npc(b.story[last].say),
          choices: [
            ...b.decisions
              .filter((d) => !d.free && open(d))
              .map((d) => ({ label: d.label, kind: 'plot' as const, action: () => decide(b, d) })),
            ...followUps(),
            bye,
          ],
          ...say(b.npc, ending),
        });
      };
      const part = (i: number): void => {
        if (i >= last) {
          ending();
          return;
        }
        toldRef.current = Math.max(toldRef.current, i + 1);
        setDialogue({
          line: npc(b.story[i].say),
          choices: [{ label: b.story[i + 1].ask, kind: 'ask', action: () => part(i + 1) }, bye],
          ...say(b.npc, () => part(i), i + 1),
        });
      };
      if (!b.greeting) {
        if (heardRef.current) ending();
        else part(0);
        return;
      }
      const greet = (): void =>
        setDialogue({
          line: npc(b.greeting),
          choices: [
            heardRef.current ? { label: t.backToIt, action: ending } : { label: b.story[0].ask, kind: 'ask', action: () => part(0) },
            bye,
          ],
          ...say(b.npc, greet, known()),
        });
      greet();
    },
    [askFree, close, decide, persist, t],
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
    // The hero's typed line is recorded with its answer, as an ask or a decision.
    if (!dialogue || !b || dialogue.hero) return;
    const { line } = dialogue;
    recordLine({ kind: line.voice === 'player' ? 'clue' : 'npc', beat: b.index, speaker: line.speaker, text: line.text });
  }, [dialogue]);

  // Escape closes a dialogue; number keys pick an option, as in every RPG since the nineties.
  useEffect(() => {
    if (!dialogue || held) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      // A digit typed into the hero's own line is part of it, and nothing is picked while it is answered.
      if (typing(e) || freeBusy) return;
      const n = Number(e.key);
      if (n >= 1 && n <= dialogue.choices.length) choose(dialogue.choices[n - 1]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [choose, close, dialogue, freeBusy, held]);

  // J opens the quest journal, as in every RPG since the nineties; Escape or J again closes it.
  useEffect(() => {
    if (!started || dialogue) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyJ' && !e.repeat) setLogOpen((open) => !open);
      else if (e.key === 'Escape') setLogOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [started, dialogue]);

  // `~` (the key under Escape, whatever the layout prints on it) opens the developer console.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.code !== 'Backquote' && e.key !== '~' && e.key !== '`') || typing(e)) return;
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
      setFastStart(localStorage.getItem(FAST_KEY) !== '0');
      setIntroOn(localStorage.getItem(INTRO_KEY) !== '0');
      const keptRigger = localStorage.getItem(RIGGER_KEY);
      setRigger(keptRigger === 'meshy' || keptRigger === 'voxel' || keptRigger === 'fit' || keptRigger === 'skin' ? keptRigger : keptRigger === 'self' || keptRigger === 'pose' ? 'fit' : DEFAULT_RIGGER);
      setJumping(localStorage.getItem(JUMP_KEY) === '1');
      setMesher(localStorage.getItem(MESHER_KEY) === 'meshy' ? 'meshy' : DEFAULT_MESHER);
      const keptPainter = localStorage.getItem(PAINTER_KEY);
      setPainter(keptPainter && keptPainter in PERSON_PAINTERS ? (keptPainter as PersonPainter) : DEFAULT_PAINTER);
      setPose(localStorage.getItem(POSE_KEY) === 'apose' ? 'apose' : DEFAULT_POSE);
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
  const pickFastStart = (on: boolean) => {
    setFastStart(on);
    try {
      if (on) localStorage.removeItem(FAST_KEY);
      else localStorage.setItem(FAST_KEY, '0');
    } catch {
      /* forgotten on reload */
    }
  };
  const pickIntro = (on: boolean) => {
    setIntroOn(on);
    try {
      if (on) localStorage.removeItem(INTRO_KEY);
      else localStorage.setItem(INTRO_KEY, '0');
    } catch {
      /* forgotten on reload */
    }
  };
  const pickJumping = (on: boolean) => {
    setJumping(on);
    try {
      if (on) localStorage.setItem(JUMP_KEY, '1');
      else localStorage.removeItem(JUMP_KEY);
    } catch {
      /* forgotten on reload */
    }
  };
  const pickRigger = (value: Rigger) => {
    setRigger(value);
    try {
      if (value === DEFAULT_RIGGER) localStorage.removeItem(RIGGER_KEY);
      else localStorage.setItem(RIGGER_KEY, value);
    } catch {
      /* forgotten on reload */
    }
  };
  const pickPose = (value: PersonPose) => {
    setPose(value);
    try {
      if (value === DEFAULT_POSE) localStorage.removeItem(POSE_KEY);
      else localStorage.setItem(POSE_KEY, value);
    } catch {
      /* forgotten on reload */
    }
  };
  const pickPainter = (value: PersonPainter) => {
    setPainter(value);
    try {
      if (value === DEFAULT_PAINTER) localStorage.removeItem(PAINTER_KEY);
      else localStorage.setItem(PAINTER_KEY, value);
    } catch {
      /* forgotten on reload */
    }
  };
  const pickMesher = (value: Mesher) => {
    setMesher(value);
    try {
      if (value === DEFAULT_MESHER) localStorage.removeItem(MESHER_KEY);
      else localStorage.setItem(MESHER_KEY, value);
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
        ? apiKeys.google
        : !apiKeys.google && apiKeys.openai,
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
    speakLines(
      voiceKey,
      fresh,
      gameLang,
      (line) => {
        if (line.voice !== 'player') release();
      },
      (timing) => measureVoice(timing),
    )
      .catch((e) => {
        log.warn('rpg.voice.failed', describeError(e));
        // An empty account is said once, by the banner, not on every line.
        if (!outOfFunds('elevenlabs')) flash(tRef.current.voiceFailed);
      })
      .finally(release);
  }, [dialogue, flash, gameLang, measureVoice, voiceKey, voiceOn]);
  useEffect(() => stopVoice, []);

  // The score: the world and tone's track, composed once and kept (`music.ts`), fading in when it
  // is ready; nothing waits for it. Off, back at the intro or without a key of the reader's own: silence.
  useEffect(() => {
    if (!started || !musicOn || !musicKey || !score) {
      stopMusic();
      forgetMusicState();
      return;
    }
    const { world: w, tone } = score;
    const id = musicId(w.id, tone);
    if (playingMusic() === id) return;
    let stale = false;
    musicFor(musicKey, w, tone)
      .then((bytes) => {
        if (stale) return;
        return playMusic(id, bytes).catch((e) => {
          musicUnplayable(w.id, tone, e);
          throw e;
        });
      })
      .catch((e) => {
        log.warn('rpg.music.failed', describeError(e));
        if (!stale) flash(tRef.current.musicFailed(musicState().error ?? (e instanceof Error ? e.message : String(e))), 8000);
      });
    return () => {
      stale = true;
    };
  }, [flash, musicKey, musicOn, musicTry, score, started]);
  // Under a voice the score steps back; a hidden page stops it where it is.
  useEffect(() => duckMusic(Boolean(dialogue) || intro.on), [dialogue, intro.on]);
  // A conversation begun behind the intro ends it: one voice at a time.
  useEffect(() => {
    if (dialogue) stopIntro();
  }, [dialogue]);
  useEffect(() => {
    const change = () => pauseMusic(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', change);
    return () => {
      document.removeEventListener('visibilitychange', change);
      stopMusic();
    };
  }, []);

  /** Rebuilds a saved quest: its places and characters, the current beat as it was, the decision. */
  const resume = (saved: SavedGame) => {
    questTokenRef.current += 1;
    setStalled(null);
    flushPlay();
    // The world it was played in, made current again if another one is (`worldSave.ts`'s library),
    // or the classic one for a save from before there were worlds.
    const kept = saved.worldId ? findWorld(saved.worldId) : null;
    const into = kept ?? classicWorld(saved.lang);
    // A step written around someone already dead is written again (`mendSave`).
    const game = mendSave(saved, [...(loadAtlas(into.id).dead ?? []), ...deadInSave(saved)]);
    playMsRef.current = game.playMs ?? 0;
    playSinceRef.current = playSinceRef.current === null ? null : Date.now();
    playFlushedRef.current = playMsRef.current;
    reportLaunch();
    primeVoice();
    primeMusic();
    setStarted(true);
    setEnding(null);
    setDialogue(null);
    setGenerating(false);
    setUnfolding(false);
    seedRef.current = game.seed;
    questIdRef.current = game.questId ?? `q-${game.at.toString(36)}`;
    moodRef.current = game.mood;
    // A quest from before moods is written as a grim one, and scored as one.
    setScore({ world: into, tone: game.mood?.tone ?? 'grim' });
    staticRef.current = game.static;
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
    // What it cost in earlier sittings; a save from before that was kept says only that it cost something.
    beginQuestSpend(validSpend(game.spent) ?? { ...NO_SPEND, partial: true });
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
    bury(deadInSave(game));
    const history = game.history;
    for (const b of game.beats.slice(0, -1)) {
      if (b.place) {
        putPlace(b.place);
        if (!placesRef.current.some((p) => p.name === b.place!.name)) placesRef.current = [...placesRef.current, b.place];
      }
      if (!isDead(b.npc.name, deadRef.current)) putNpc(b.npc, b.place?.name ?? null, 0);
      remember(b.npc);
      if (b.witness && !isDead(b.witness.npc.name, deadRef.current)) {
        putNpc(b.witness.npc, b.place?.name ?? null, 1);
        remember(b.witness.npc);
      }
      beatsRef.current = [...beatsRef.current, b];
    }
    historyRef.current = history;
    setHistory(history);
    const current = game.beats[game.beats.length - 1];
    setupBeat(current, false);
    if (current.job && game.progress > 0) {
      const left = Math.max(0, current.job.count - game.progress);
      if (left > 0) scene?.spawnObjective(current.job.kind, left, current.job.look, current.place?.name ?? null, itemFor(current.job));
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
    freeTalkRef.current = game.freeTalk ?? [];
    const d = game.decision === null ? null : current.decisions[game.decision];
    decisionRef.current = d ? game.decision : null;
    persist();
    if (!d) return;
    // Decided before the page went: carry it out now.
    decidedRef.current = true;
    if (!d.next) {
      finish(current, current.npc.name, d.reply, history);
      return;
    }
    pendingRef.current = writeBeat(current.index + 1, d.next, history, current.title);
    void proceed(current, d, history);
  };

  /** Start, New quest or New world: a world first when there is none yet, or a new one is asked for. */
  const finishGenesis = (pending: PendingGenesis) => {
    primeVoice();
    primeMusic();
    setStarted(true);
    void createWorld(pending);
  };

  /** A proposed world tapped on the menu: a new world made from it; the next visit gets four new ones. */
  const pickProposal = (p: PoolItem) => {
    // Tapped before the keys have answered: made as soon as they have (`queuedPick` below).
    if (!keysReady) {
      setQueuedPick(p);
      return;
    }
    proposalRef.current = p;
    pickedProposal(p.id);
    begin(true);
  };

  const begin = (fresh = false) => {
    // Inside the click: iOS lets only an element a gesture touched play audio later.
    primeVoice();
    primeMusic();
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
    primeMusic();
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
    if (w.lang !== gameLangRef.current) chooseLang(w.lang);
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
    stopIntro();
    stopVoice();
    setDialogue(null);
    setHeld(null);
    setStarted(false);
    setLogOpen(false);
    setMenu('main');
    if (stalePullRef.current) {
      stalePullRef.current = false;
      reloadIntro();
    } else setSaved(loadGame(isTrashed));
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
  // A full localStorage keeps nothing the game writes (`storage.ts`): said on the menu, not swallowed.
  const [fullStore, setFullStore] = useState(storageFull);
  useEffect(() => onStorageFull(() => setFullStore(true)), []);
  const fullNote = fullStore
    ? t.storageFull(
        Object.entries(biggestKeys(3))
          .map(([k, kb]) => `${k} ${kb} KB`)
          .join(', '),
      )
    : null;
  // The trash, read again with the library.
  const trashRows = React.useMemo(() => {
    void libraryTick;
    return trashedWorlds();
  }, [libraryTick, menu, world, saved]);
  /** A world to the trash from the library; the intro is read again, since it may have been the current one. */
  const toTrash = (id: string) => {
    trashWorld(id);
    reloadIntro();
  };
  /** Back out of the trash: the atlas and quest first from the account when this browser no longer keeps them. */
  const fromTrash = async (id: string) => {
    if (uidRef.current) {
      try {
        await fetchWorld(uidRef.current, id);
      } catch (e) {
        log.warn('rpg.fetchWorld.failed', describeError(e));
      }
    }
    restoreWorld(id);
    reloadIntro();
  };
  const sweep = async () => {
    try {
      await cleanSlate(uidRef.current);
    } catch (e) {
      log.warn('rpg.cleanSlate.failed', describeError(e));
    }
    reloadIntro();
  };

  const creatable = keysReady && storyProvider !== 'static';
  // A proposal tapped before the keys answered is made once they have, or forgotten if nothing can make it.
  useEffect(() => {
    if (!queuedPick || !keysReady) return;
    setQueuedPick(null);
    if (creatable && !started) pickProposal(queuedPick);
  }, [queuedPick, keysReady, creatable, started]); // eslint-disable-line react-hooks/exhaustive-deps
  const guessed = guessLang(typeof navigator === 'undefined' ? undefined : navigator);
  const ownSave = saved && saved.lang === gameLang ? saved : null;
  /** One entry of the main menu: a label, and a line under it when there is something to say. */
  // `waiting`: the entry the menu will have once the keys have answered, there already so nothing
  // moves when they do (owner, 9 Nov 2026: no layout shift), looking as it will but not yet taking a tap.
  const item = (key: string, label: string, onClick: () => void, opts: { sub?: string; primary?: boolean; disabled?: boolean; waiting?: boolean } = {}) => (
    <button
      key={key}
      type="button"
      className={`rpg-menu-item${opts.primary ? ' rpg-menu-primary' : ''}${opts.waiting ? ' rpg-menu-waiting' : ''}`}
      data-key={key}
      disabled={opts.disabled}
      aria-disabled={opts.waiting || undefined}
      onClick={opts.waiting ? undefined : onClick}
    >
      <span>{label}</span>
      {opts.sub && <small>{opts.sub}</small>}
    </button>
  );
  // The demo's budget for today, said in litres of diesel (`DieselPlant.tsx`, `diesel.ts`).
  // A spent cap closes the demo (`available: false`), which is exactly when the dark plant must show.
  // Signed in on the server's keys, it is the account's own tank instead (`wallet.ts`).
  const diesel = onDiesel
    ? { litres: litres(wallet!.balanceUsd), capacity: litres(Math.max(wallet!.grantUsd, wallet!.balanceUsd)), tank: true }
    : demo && (storyProvider === 'demo' || (storyProvider === 'static' && (demo.reason === 'ip-cap' || demo.reason === 'all-cap')))
      ? { litres: litres(Math.min(demo.remaining.ip, demo.remaining.all)), capacity: litres(demo.perIpUsd), tank: false }
      : null;
  // An admin's canister pours real diesel into their own tank, free (`/wallet/refuel`; the server
  // checks `admins/`). The tank's live snapshot raises the gauge.
  const adminRefuel = onDiesel && auth.isAdmin ? async (c: { id: string }) => Boolean(await refuelWallet(c.id)) : undefined;
  const dieselModel = modelChain(onDiesel ? (wallet!.server.google ? 'google' : 'openai') : 'demo', chosenModel)[0] ?? null;
  // What a quest and a world cost in all, not only the model's words: the lines, the score and the
  // models are most of it (`questLitres`, measured on the ledger) — and only what is on for this reader.
  const priceParts = { voice: Boolean(voiceOn && voiceKey), music: Boolean(musicOn && musicKey), fal: Boolean(falKey) };
  const dieselPrices =
    diesel && dieselModel
      ? t.dieselPrices(
          formatLitres(worldLitres(dieselModel, priceParts) ?? 0, gameLang),
          formatLitres(questLitres(dieselModel, priceParts) ?? 0, gameLang),
          formatLitres(beatLitres(dieselModel) ?? 0, gameLang),
          formatLitres(lineLitres(), gameLang),
        )
      : null;
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
      {keysReady && storyProvider === 'static' && item('start', t.start, () => begin(), { primary: !ownSave })}
      {(creatable || !keysReady) && world && item('quest', t.menuNewQuest, () => begin(), { waiting: !keysReady, sub: [t.menuInWorld(world.name), diesel && dieselModel ? dieselTag(gameLang, questLitres(dieselModel, priceParts)) : undefined].filter(Boolean).join(' · ') })}
      {(creatable || !keysReady) && item('world', t.homeMore, () => setMenu('world'), { sub: wish.words.length ? wish.words.join(', ') : undefined, waiting: !keysReady })}
      {item('language', `🌐 ${t.language}`, () => setMenu('language'), { sub: nativeName(gameLang) })}
      {item('settings', t.menuSettings, () => setMenu('settings'))}
      {item('controls', t.menuControls, () => setMenu('controls'))}
    </nav>
  );

  // The one way back into play, top right (the home screen's layout, Nov 2026): the world being born
  // if there is one, else the quest in progress, with the world's cover-like colour and its name.
  const resumeEntry = pendingGenesis && (creatable || !keysReady)
    ? { key: 'finish', label: t.menuFinishWorld, sub: pendingGenesis.seeds.join(', ') || clip(pendingGenesis.wish ?? '', 40), go: () => finishGenesis(pendingGenesis) }
    : ownSave
      ? { key: 'continue', label: t.menuContinue, sub: world?.name ?? ownSave.beats[ownSave.beats.length - 1].title, go: () => resume(ownSave) }
      : null;
  // Sign-in and the keys are their own pages on the standalone site (`src-rpg/pages`).
  const accountRoot = gameLang === 'pl' ? '/pl/' : '/';
  // The sheet behind ⋯ on the home screen (owner, 10 Nov 2026, from the accepted mockup): the way back
  // into play first, as the one white button, then the account, the library and the rest of the menu.
  const sheetAccount = !standalone || auth.loading
    ? null
    : auth.user
      ? [
          <a key="account" className="rpg-menu-item" href={`${accountRoot}account/`}>
            <span>{t.menuAccount}</span>
            <small>{auth.user.email ?? ''}</small>
          </a>,
          item('signout', t.menuSignOut, () => void auth.signOut()),
        ]
      : auth.identity
        ? [
            <a key="pending" className="rpg-menu-item" href={`${accountRoot}login/`}>
              <span>{t.menuPending}</span>
            </a>,
          ]
        : [
            <a key="signin" className="rpg-menu-item rpg-home-sheet-strong" href={`${accountRoot}login/`}>
              <span>{t.menuSignIn}</span>
            </a>,
            <a key="signup" className="rpg-menu-item" href={`${accountRoot}login/?mode=up`}>
              <span>{t.menuSignUp}</span>
            </a>,
          ];
  const homeSheet = (
    <div className="rpg-home-sheet-layer">
      <div className="rpg-home-scrim" aria-hidden="true" onClick={() => setSheet(false)} />
      <nav id="rpg-home-sheet" className="rpg-home-sheet rpg-menu" aria-label={t.homeMenu}>
        {resumeEntry && (
          <button
            type="button"
            className={`rpg-home-resume${keysReady ? '' : ' rpg-menu-waiting'}`}
            data-key={resumeEntry.key}
            aria-disabled={!keysReady || undefined}
            onClick={keysReady ? resumeEntry.go : undefined}
          >
            <span>▶ {resumeEntry.label}</span>
            {resumeEntry.sub && <small>{resumeEntry.sub}</small>}
          </button>
        )}
        {keysReady && storyProvider === 'static' && item('start', t.start, () => begin())}
        {sheetAccount}
        {item('library', t.homeWorlds(libraryRows.length), () => setMenu('library'), { disabled: libraryRows.length === 0 })}
        {(creatable || !keysReady) && world && item('quest', t.menuNewQuest, () => begin(), { waiting: !keysReady, sub: [t.menuInWorld(world.name), diesel && dieselModel ? dieselTag(gameLang, questLitres(dieselModel, priceParts)) : undefined].filter(Boolean).join(' · ') })}
        {(creatable || !keysReady) && item('world', t.homeMore, () => setMenu('world'), { sub: wish.words.length ? wish.words.join(', ') : undefined, waiting: !keysReady })}
        {diesel && <DieselBadge lang={gameLang} litres={diesel.litres} capacity={diesel.capacity} onClick={() => setMenu('diesel')} />}
        {item('language', t.language, () => setMenu('language'), { sub: nativeName(gameLang) })}
        {item('settings', t.menuSettings, () => setMenu('settings'))}
        {item('controls', t.menuControls, () => setMenu('controls'))}
      </nav>
    </div>
  );
  // A proposal's idea goes into the field, to be made as it is or changed first (owner, 10 Nov 2026).
  const pickIdea = (p: PoolItem) => {
    pickedProposal(p.id);
    pickWish({ ...wish, text: p.idea.slice(0, WISH_MAX) });
    fieldRef.current?.focus({ preventScroll: true });
  };
  const createFromField = () => {
    if (!keysReady || !creatable) return;
    begin(true);
  };

  const worldMenu = (
    <div className="rpg-panel">
      <h3>{t.menuNewWorld}</h3>
      {exoticSlider}
      <WorldWish lang={gameLang} wish={wish} onChange={pickWish} open />
      {diesel && dieselModel && (
        <DieselBadge lang={gameLang} litres={diesel.litres} capacity={diesel.capacity} onClick={() => setMenu('diesel')} />
      )}
      <div className="rpg-panel-actions">
        <button type="button" className="rpg-start" disabled={!creatable} onClick={() => begin(true)}>
          {t.menuCreate}
          {diesel && dieselModel && <small className="rpg-dz-tag"> {dieselTag(gameLang, worldLitres(dieselModel, priceParts))}</small>}
        </button>
        {back}
      </div>
    </div>
  );

  // Every language on the list, by its own name (owner, 9 Nov 2026: "change language in main menu to
  // any language"). English and Polish are written by hand; any other is translated on the server the
  // first time somebody picks it, and the menu says so while it is.
  const languagePicker = (
    <div className="rpg-lang">
      <label>
        {t.language}:{' '}
        <select value={gameLang} onChange={(e) => chooseLang(e.target.value)}>
          {languageOptions.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
      </label>
      {uiPending(gameLang) && <small className="rpg-lang-note">{t.languageTranslating}</small>}
      {guessed !== gameLang && (
        <button type="button" className="rpg-lang-guess" onClick={() => chooseLang(guessed)}>
          {t.languageBrowser(nativeName(guessed))}
        </button>
      )}
      <small className="rpg-lang-note">{t.languageHint}</small>
    </div>
  );
  const languageMenu = (
    <div className="rpg-panel">
      <h3>🌐 {t.language}</h3>
      {languagePicker}
      <div className="rpg-panel-actions">{back}</div>
    </div>
  );

  // Settings in groups, every row left-aligned, one font and one kind of control (owner, 11 Nov 2026,
  // from the accepted iPhone SE mockup, rpg/ustawienia/ in the project files: "on a small screen the
  // boxes are cut off, everything centred, no groups, every line a different font").
  const settingSelect = (label: string, control: React.ReactNode, extra?: React.ReactNode) => (
    <div className="rpg-set-row">
      <label className="rpg-set-field">
        <span className="rpg-set-label">{label}</span>
        <span className="rpg-set-select">{control}</span>
      </label>
      {extra}
    </div>
  );
  const settingSwitch = (title: string, note: string, checked: boolean, onChange: (on: boolean) => void) => (
    <label className="rpg-set-row rpg-set-toggle">
      <span className="rpg-set-text">
        <span className="rpg-set-label">{title}</span>
        <span className="rpg-set-note">{note}</span>
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
  const settingGroup = (title: string, rows: React.ReactNode) => (
    <section className="rpg-set-group">
      <h4>{title}</h4>
      <div className="rpg-set-card">{rows}</div>
    </section>
  );
  const peopleSettings = keysReady && falKey;
  const settingsMenu = (
    <div className="rpg-settings">
      <header className="rpg-settings-bar">
        <button type="button" className="rpg-settings-back" aria-label={t.menuBack} title={t.menuBack} onClick={() => setMenu('main')}>
          ←
        </button>
        <h3>{t.menuSettings}</h3>
      </header>

      {settingGroup(
        t.settingsGame,
        <>
          {settingSelect(
            t.language,
            <select value={gameLang} onChange={(e) => chooseLang(e.target.value)}>
              {languageOptions.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>,
            <>
              {uiPending(gameLang) && <p className="rpg-set-note">{t.languageTranslating}</p>}
              {guessed !== gameLang && (
                <button type="button" className="rpg-set-button" onClick={() => chooseLang(guessed)}>
                  {t.languageBrowser(nativeName(guessed))}
                </button>
              )}
              <p className="rpg-set-note">{t.languageHint}</p>
            </>,
          )}
          {settingSwitch(t.jumpTitle, t.jumpNote, jumping, pickJumping)}
        </>,
      )}

      {keysReady &&
        (models.length > 0 || storyProvider === 'google' || storyProvider === 'demo') &&
        settingGroup(
          t.settingsStory,
          <>
            {models.length > 0 &&
              settingSelect(
                t.model,
                <select value={models.some((m) => m.id === chosenModel) ? chosenModel! : ''} onChange={(e) => pickModel(e.target.value)}>
                  <option value="">{t.modelDefault(modelChain(storyProvider === 'openai' ? 'openai' : storyProvider === 'demo' ? 'demo' : 'google', null)[0])}</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id}
                    </option>
                  ))}
                </select>,
              )}
            {storyProvider !== 'static' && storyProvider !== 'openai' && settingSwitch(t.fastStartTitle, t.fastStartNote(FAST_MODEL), fastStart, pickFastStart)}
            {storyProvider === 'google' && settingSwitch(t.introTitle, t.introNote, introOn, pickIntro)}
          </>,
        )}

      {peopleSettings &&
        settingGroup(
          t.settingsPeople,
          <>
            {settingSelect(
              t.painter,
              <select value={painter} onChange={(e) => pickPainter(e.target.value as PersonPainter)}>
                {(Object.keys(PERSON_PAINTERS) as PersonPainter[]).map((p) => (
                  <option key={p} value={p}>
                    {t.painters[p]}
                  </option>
                ))}
              </select>,
            )}
            {settingSelect(
              t.mesher,
              <select value={mesher} onChange={(e) => pickMesher(e.target.value === 'meshy' ? 'meshy' : 'trellis')}>
                <option value="trellis">{t.mesherTrellis}</option>
                <option value="meshy">{t.mesherMeshy}</option>
              </select>,
            )}
            {settingSelect(
              t.rigger,
              <select value={rigger} onChange={(e) => pickRigger(e.target.value === 'meshy' || e.target.value === 'voxel' || e.target.value === 'fit' ? e.target.value : 'skin')}>
                <option value="skin">{t.riggerSkin}</option>
                <option value="fit">{t.riggerFit}</option>
                <option value="voxel">{t.riggerVoxel}</option>
                <option value="meshy">{t.riggerMeshy}</option>
              </select>,
            )}
            {settingSelect(
              t.pose,
              <select value={pose} onChange={(e) => pickPose(e.target.value === 'apose' ? 'apose' : 'tpose')}>
                <option value="tpose">{t.poses.tpose}</option>
                <option value="apose">{t.poses.apose}</option>
              </select>,
              (['tpose', 'apose'] as const).map((p) => (
                <details key={p} className="rpg-set-fold">
                  <summary>{t.posePrompt(t.poses[p])}</summary>
                  <p>{PERSON_POSES[p]}</p>
                </details>
              )),
            )}
            <div className="rpg-set-row">
              <p className="rpg-set-note">{t.mesherNote}</p>
            </div>
          </>,
        )}

      {settingGroup(
        t.settingsAccount,
        <>
          <div className="rpg-set-row">
            {keysReady ? (
              <ul className="rpg-set-status">
                <li>
                  {onDiesel && fueled
                    ? t.dieselQuest(formatLitres(diesel?.litres ?? 0, gameLang))
                    : onDiesel
                      ? t.dieselTankEmpty
                      : storyProvider === 'static'
                        ? t.staticQuest
                        : storyProvider === 'demo' && demo
                          ? t.demoQuest(formatLitres(diesel?.litres ?? 0, gameLang), formatLitres(diesel?.capacity ?? 0, gameLang))
                          : t.aiQuest(storyProvider)}
                </li>
                {storyProvider === 'static' && demo && !demo.available && demo.reason && <li>{t.demoClosed(demo.reason)}</li>}
                <li>{voiceKey === DEMO_VOICE_KEY ? t.demoVoice : voiceKey === ACCOUNT_KEY && !account.keys.elevenLabs ? t.dieselVoice : voiceKey ? t.voiceOn : t.voiceOff}</li>
                {(storyProvider === 'static' || storyProvider === 'demo' || !voiceKey) && (
                  <li className="rpg-set-note">{storyProvider === 'demo' ? t.ownKey : t.addKey}</li>
                )}
                {demo?.today && <li className="rpg-set-note">{t.todayStats(demo.today.launches, formatUsd(demo.today.usd), hoursMinutes(demo.today.playMs))}</li>}
              </ul>
            ) : (
              <p className="rpg-set-note">{t.readingKeys}</p>
            )}
          </div>
          <a className="rpg-set-row rpg-set-link" href={lang === 'pl' ? '/pl/account/' : '/account/'}>
            {t.keysLink}
          </a>
          <a className="rpg-set-row rpg-set-link" href={rulesHref}>
            {t.rulesLink}
          </a>
          {/* Also here: on a phone the home screen's top bar has room for the account's initial only. */}
          {standalone && auth.user && (
            <div className="rpg-set-row rpg-set-line">
              <span className="rpg-set-text">
                <span className="rpg-set-label">{t.signedInAs}</span>
                <span className="rpg-set-note">{auth.user.email}</span>
              </span>
              <button type="button" className="rpg-set-button" onClick={() => void auth.signOut()}>
                {t.menuSignOut}
              </button>
            </div>
          )}
        </>,
      )}

      {settingGroup(
        t.settingsData,
        <>
          {chronicle.length > 0 && (
            <div className="rpg-set-row rpg-set-line">
              <span className="rpg-set-text">
                <span className="rpg-set-label">{t.chronicleTitle}</span>
                <span className="rpg-set-note">{t.chronicle(chronicle.length)}</span>
              </span>
              <button
                type="button"
                className="rpg-set-button"
                title={t.forget}
                onClick={() => {
                  clearChronicle(worldId);
                  setChronicle([]);
                }}
              >
                {t.forgetShort}
              </button>
            </div>
          )}
          <button type="button" className="rpg-set-row rpg-set-link" onClick={() => setMenu('trash')}>
            🗑 {t.menuTrash} · {t.menuTrashCount(trashRows.length)}
          </button>
          {!touch && (
            <div className="rpg-set-row">
              <p className="rpg-set-note">{t.devHint}</p>
            </div>
          )}
        </>,
      )}
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
          {jumping && <li>{t.touchJump}</li>}
          <li>{t.touchSenses}</li>
          <li>{t.touchJournal}</li>
        </ul>
      ) : (
        <ul className="rpg-controls">
          <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> {t.move}</li>
          <li><kbd>Shift</kbd> {t.run}</li>
          <li>{t.mouse}</li>
          <li><kbd>LMB</kbd> {t.attack}</li>
          {jumping && <li><kbd>Space</kbd> {t.jumpHelp}</li>}
          <li><kbd>E</kbd> {t.interact}</li>
          <li><kbd>Q</kbd> {t.sensesHelp}</li>
          <li><kbd>J</kbd> {t.journal}</li>
        </ul>
      )}
      <p className="rpg-panel-note">{t.intro}</p>
      <div className="rpg-panel-actions">{back}</div>
    </div>
  );

  // The world the next quest is played in: its name and who you are there, the pitch a tap away.
  const dieselMenu = diesel && (
    <div className="rpg-panel">
      <h3>⛽ {t.dieselPlantTitle}</h3>
      <DieselPlant lang={gameLang} litres={diesel.litres} capacity={diesel.capacity} tank={diesel.tank} onRefuel={adminRefuel} showCanisters />
      {dieselPrices && <p className="rpg-dz-note">{dieselPrices}</p>}
      <p className="rpg-dz-note">{t.dieselNote}</p>
      <p className="rpg-dz-note">
        <a href={rulesHref}>{t.rulesLink}</a>
      </p>
      <div className="rpg-panel-actions">{back}</div>
    </div>
  );

  return (
    <div className={`rpg-container${touch ? ' rpg-touch' : ''}${immersive ? ' rpg-immersive' : ''}${devOpen ? ' rpg-dev-open' : ''}`} ref={containerRef}>
      <canvas ref={canvasRef} className="rpg-canvas" />

      {started && (
        <>
          {/* Only what to do now (owner, Oct 2026: the whole log in the corner covered a third of an
              iPhone screen). The quest so far is a tap away, in the journal. A div acting as a button: the
              stream line inside it is a block, which a <button> may not hold. */}
          <div
            role="button"
            tabIndex={0}
            className={`rpg-journal${noticeShown ? ' rpg-journal-fresh' : ''}`}
            onClick={() => setLogOpen(true)}
            title={t.journal}
          >
            {!creating && <WorldProgress lang={gameLang} tasks={progressTasks} since={timeline()?.since ?? null} />}
            {objective && <div className="rpg-journal-objective">◆ {objective}</div>}
            {/* The opening is a row of the progress above; a later step is still "the story unfolds". */}
            {unfolding && <div className="rpg-journal-objective">⏳ {t.fate}</div>}
            {(generating || unfolding) && <StreamLine />}
            {ending && <div className="rpg-journal-objective">✓ {t.completed}</div>}
          </div>

          {logOpen && !dialogue && !ending && (
            <div className="rpg-overlay rpg-log" role="dialog" aria-label={t.journal} onClick={() => setLogOpen(false)}>
              <div className="rpg-log-page" onClick={(e) => e.stopPropagation()}>
                <h3>📜 {t.journal}</h3>
                {beat && <p className="rpg-log-title">{beat.title}</p>}
                {objective && <p className="rpg-log-objective">◆ {objective}</p>}
                {beat?.place && !unfolding && <p className="rpg-log-place">{beat.place.name}</p>}
                {beat && beat.clues.length > 0 && !unfolding && <p className="rpg-log-place">{t.clues(seenCount, beat.clues.length)}</p>}
                <h4>{t.yourDecisions}</h4>
                {history.length > 0 ? (
                  <ol className="rpg-ending-steps">
                    {history.map((step, i) => (
                      <li key={`${i}-${step.chose}`}>
                        <strong>{step.chose}</strong> {step.consequence}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="rpg-ending-note">{t.noDecisions}</p>
                )}
                <button type="button" className="rpg-start" onClick={() => setLogOpen(false)}>
                  {t.close}
                </button>
              </div>
            </div>
          )}

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

          {senses && !dialogue && !ending && <div className="rpg-senses" aria-hidden="true" />}

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
              <WorldProgress lang={gameLang} tasks={progressTasks} since={timeline()?.since ?? null} />
            </div>
          )}

          {intro.on && (
            <div className="rpg-intro" role="region" aria-label={intro.name ?? t.creatingWorld}>
              {shownImage(intro) && <img key={shownImage(intro)!} className="rpg-intro-picture" src={shownImage(intro)!} alt="" />}
              <div className="rpg-intro-top">
                <h2>{intro.name ?? t.creatingWorld}</h2>
                {!intro.name && creating && creating.length > 0 && <p className="rpg-genesis-seeds">{t.worldSeeds(creating.join(' · '))}</p>}
              </div>
              <p key={intro.current} className="rpg-intro-text">
                {intro.frames[intro.current]?.text ?? t.introWaiting}
              </p>
              <div className="rpg-intro-bottom">
                <div className="rpg-intro-dots" aria-hidden="true">
                  {intro.frames.slice(1).map((_, i) => (
                    <span key={i} className={i + 1 === intro.current ? 'rpg-intro-dot-on' : i + 1 < intro.current ? 'rpg-intro-dot-past' : ''}>
                      {i + 1 === intro.current ? '●' : '○'}
                    </span>
                  ))}
                </div>
                <WorldProgress lang={gameLang} tasks={progressTasks} since={timeline()?.since ?? null} />
                <button type="button" className={creating ? '' : 'rpg-start'} onClick={() => stopIntro()}>
                  {creating ? t.introSkip : t.introPlay}
                </button>
              </div>
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

          {touch && !dialogue && !held && !ending && !logOpen && (
            <TouchControls
              prompt={prompt}
              promptLabel={prompt === 'talk' ? t.talk : prompt === 'examine' ? t.examine : prompt ? t.pickUp : null}
              attackLabel={t.strike}
              jumpLabel={jumping ? t.jump : null}
              sensesLabel={t.senses}
              sensesOn={senses}
              onSenses={() => sceneRef.current?.toggleSenses()}
              onStick={(x, y) => sceneRef.current?.setStick(x, y)}
              onAttack={() => sceneRef.current?.attack()}
              onJump={() => sceneRef.current?.jump()}
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
            <p className="rpg-dialogue-text">
              <LineText text={shown.line.text} />
            </p>
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
                      disabled={held !== null || freeBusy}
                      onClick={() => choose(c)}
                    >
                      <span className="rpg-choice-n">{i + 1}.</span> <LineText text={c.label} />
                    </button>
                  </li>
                );
              })}
            </ol>
            {shown.free && !held && (
              <form
                className="rpg-dialogue-free"
                onSubmit={(e) => {
                  e.preventDefault();
                  const said = freeText.trim();
                  if (said && !freeBusy) shown.free!(said);
                }}
              >
                <input
                  type="text"
                  value={freeText}
                  maxLength={FREE_MAX}
                  placeholder={t.freePlaceholder}
                  aria-label={t.freePlaceholder}
                  disabled={freeBusy}
                  enterKeyHint="send"
                  onChange={(e) => setFreeText(e.target.value)}
                />
                <button type="submit" disabled={freeBusy || !freeText.trim()} aria-label={t.freeSend}>
                  ↵
                </button>
              </form>
            )}
            {shown.hero && freeState === 'waiting' && (
              <div className="rpg-dialogue-free-status">
                ⏳ {t.freeThinking(shown.hero)}
                <StreamLine />
              </div>
            )}
            {shown.free && freeState !== null && typeof freeState === 'object' && (
              <div className="rpg-dialogue-free-status rpg-dialogue-free-error">⚠ {t.freeFailed(freeState.error)}</div>
            )}
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
              onTrash={toTrash}
              onOpenTrash={() => setMenu('trash')}
              trashCount={trashRows.length}
              onBack={() => setMenu('main')}
            />
          ) : menu === 'trash' ? (
            <WorldTrash
              lang={gameLang}
              entries={trashRows}
              canSweep={libraryRows.length > 0}
              onRestore={(id) => void fromTrash(id)}
              onSweep={() => void sweep()}
              onBack={() => setMenu(libraryRows.length > 0 ? 'library' : 'settings')}
            />
          ) : (
            <>
              {menu === 'main' && (
                <div className="rpg-home">
                  {/* Only the field and the proposals on the screen (owner, 10 Nov 2026: "this front page has too
                      many things on it — only the main prompt box and a carousel of proposed worlds, the rest
                      hidden under three dots"); everything else is in the sheet behind ⋯ (`homeSheet`). */}
                  <header className="rpg-home-bar">
                    <span className="rpg-home-logo">{t.title}</span>
                    <button
                      type="button"
                      className={`rpg-home-more${sheet ? ' rpg-home-more-on' : ''}`}
                      aria-label={t.homeMenu}
                      title={t.homeMenu}
                      aria-expanded={sheet}
                      aria-controls="rpg-home-sheet"
                      onClick={() => setSheet((on) => !on)}
                    >
                      <span aria-hidden="true">•••</span>
                    </button>
                  </header>
                  <section className="rpg-home-hero">
                    <h2 className="rpg-menu-title">{t.homeAsk}</h2>
                    <form
                      className="rpg-home-field"
                      onSubmit={(e) => {
                        e.preventDefault();
                        createFromField();
                      }}
                    >
                      {/* Wraps and grows with the text, up to five lines (owner, 11 Nov 2026: "multiline,
                          and it should grow, it fits too little"). Enter still creates: a world is one
                          wish, so a line break would only be noise in the prompt. */}
                      <textarea
                        ref={fieldRef}
                        rows={1}
                        value={wish.text}
                        maxLength={WISH_MAX}
                        placeholder={t.homePlaceholder}
                        aria-label={t.homePlaceholder}
                        enterKeyHint="go"
                        onKeyDown={(e) => {
                          // The game's keys must not walk the hero while a world is typed.
                          e.stopPropagation();
                          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            e.currentTarget.form?.requestSubmit();
                          }
                        }}
                        onChange={(e) => pickWish({ ...wish, text: e.target.value.replace(/\s*\n\s*/g, ' ').slice(0, WISH_MAX) })}
                      />
                      <button
                        type="submit"
                        className="rpg-home-create"
                        disabled={keysReady && !creatable}
                        aria-disabled={!keysReady || undefined}
                        aria-label={t.homeCreate}
                        title={diesel && dieselModel ? `${t.homeCreate} · ${dieselTag(gameLang, worldLitres(dieselModel, priceParts))}` : t.homeCreate}
                      >
                        {/* Drawn, not a glyph: ✦ sat off centre in the round button (owner, 10 Nov 2026). */}
                        <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
                        </svg>
                      </button>
                    </form>
                    {fullNote && <p className="rpg-storage-full" role="alert">{fullNote}</p>}
                    {/* A dark plant is the one thing about the diesel the screen must say: nothing can be made. */}
                    {diesel && plantState(diesel.litres) === 'stopped' && (
                      <DieselPlant lang={gameLang} litres={diesel.litres} capacity={diesel.capacity} tank={diesel.tank} onRefuel={adminRefuel} />
                    )}
                  </section>
                  <WorldProposals
                    lang={gameLang}
                    disabled={keysReady && !creatable}
                    onPick={pickProposal}
                    onIdea={pickIdea}
                  />
                  {sheet && homeSheet}
                </div>
              )}
              {menu === 'diesel' && (dieselMenu || mainMenu)}
              {menu === 'world' && worldMenu}
              {menu === 'settings' && settingsMenu}
              {menu === 'language' && languageMenu}
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
          {diesel && <DieselPlant lang={gameLang} litres={diesel.litres} capacity={diesel.capacity} tank={diesel.tank} onRefuel={adminRefuel} />}
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
              <QuestSummary lang={gameLang} world={world} />
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

      {/* The bottom-right corner, one row (owner, 30 Oct 2026, a screenshot: senses, ~, the note and ⛶
          on top of one another, each placed by a hand-counted `right:`). On a phone the row dissolves
          (`display: contents`) and the small buttons go to the top, where they always were. */}
      <div className="rpg-corner">
      {started && !touch && !dialogue && !ending && (
        <button
          type="button"
          className={`rpg-senses-key${senses ? ' rpg-senses-key-on' : ''}`}
          aria-pressed={senses}
          onClick={() => sceneRef.current?.toggleSenses()}
        >
          <kbd>Q</kbd> 👁 {t.senses}
        </button>
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

      {started && musicKey && (
        <button
          type="button"
          className="rpg-music"
          onClick={() => {
            primeMusic();
            // A track that failed is asked for again; otherwise the switch.
            if (musicOn && music.status === 'failed') {
              setMusicTry((n) => n + 1);
              return;
            }
            setMusicOn((on) => {
              saveMusicOn(!on);
              return !on;
            });
          }}
          title={
            !musicOn
              ? t.musicOn
              : music.status === 'failed'
                ? `${t.musicRetry} (${music.error ?? '?'})`
                : music.status === 'composing'
                  ? t.musicComposing(Math.round((music.seconds / music.total) * 100))
                  : t.musicOff
          }
          aria-pressed={musicOn}
        >
          {!musicOn ? '🎵✕' : music.status === 'failed' ? '🎵↻' : music.status === 'composing' ? '🎵⏳' : '🎵'}
          {musicOn && music.status === 'composing' && (
            <span className="rpg-music-bar" aria-hidden="true">
              <span style={{ width: `${Math.max(4, Math.round((music.seconds / music.total) * 100))}%` }} />
            </span>
          )}
        </button>
      )}

      {(!touch || started) && (
        <button type="button" className="rpg-devtoggle" onClick={() => setDevOpen((open) => !open)} title={t.devConsole}>
          ~
        </button>
      )}

      {/* Not on the home screen (owner, 10 Nov 2026: "remove that button from the bottom-right corner"). */}
      {!immersive && started && (
        <button type="button" className="rpg-fullscreen" onClick={fullscreen} title={t.fullscreen}>
          ⛶
        </button>
      )}
      </div>

      <FundsBanner lang={gameLang} />

      {devOpen && (
        <DevConsole
          lang={gameLang}
          tasks={progressTasks}
          quest={questView}
          remake={remakeOffer}
          tankLitres={diesel?.litres ?? null}
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
    </div>
  );
}
