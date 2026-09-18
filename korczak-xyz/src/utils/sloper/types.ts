/*
 * What a slop video is made of, from the settings down to the blobs.
 *
 * Carried over from sloper's `frontend/src/types/index.ts` with two changes:
 *
 *  - `apiKeys` is a plain record of nullable strings rather than three nullables and one
 *    required string. The ElevenLabs key was the odd one out only because its input had no
 *    "not set" state; here every key is missing the same way, which is what lets one
 *    `KeyField` and one Firestore round-trip handle all four.
 *  - `Asset.dataUrl` stays, and it now has two possible origins. During a run it is an object URL
 *    over the `Blob` the provider just returned; on a sitting reopened from the account it is a
 *    Cloud Storage download URL and `data` is null until something needs the bytes. Both draw in
 *    an `<img>` and both play in an `<audio>`, which is why the stages did not have to learn the
 *    difference — see `projects.ts` for where the bytes actually live.
 */

export type LlmProvider = 'openai' | 'deepseek';
export type ImageProvider = 'openai' | 'google';
export type ImageQuality = 'low' | 'medium' | 'high';
export type TtsPlan = 'free' | 'starter' | 'creator' | 'pro' | 'scale' | 'business';

/** The four providers a sitting can need a key for. */
export type KeyName = 'openai' | 'deepseek' | 'google' | 'elevenLabs';

export type ApiKeys = Record<KeyName, string | null>;

export interface SloperConfig {
  apiKeys: ApiKeys;
  llm: {
    provider: LlmProvider;
    /** Empty until a key has been entered and the model list has come back. */
    model: string;
  };
  video: {
    resolution: { width: number; height: number };
    frameRate: number;
    numScenes: number;
    targetDuration: number;
  };
  image: {
    provider: ImageProvider;
    model: string;
    quality: ImageQuality;
    /** Google only. Unset means "derive it from the video resolution". */
    aspectRatio?: string;
  };
  tts: {
    model: string;
    voiceId: string;
    speed: number;
    concurrency: number;
    /** Estimation only — it buys nothing at generation time. */
    plan: TtsPlan;
  };
  temperature: number;
}

export interface Scene {
  id: string;
  index: number;
  script: string;
  imageDescription: string;
  isEdited: boolean;
}

export type AssetStatus = 'pending' | 'generating' | 'complete' | 'failed';
export type AssetType = 'image' | 'audio';

export interface Asset {
  id: string;
  sceneId: string;
  type: AssetType;
  status: AssetStatus;
  data: Blob | null;
  dataUrl: string | null;
  /**
   * Where the bytes were saved, and a URL that fetches them back. Both null during a run until
   * the upload lands, and both null for ever when there is no account to save to — which is the
   * state the whole app was in before projects existed.
   */
  path: string | null;
  remoteUrl: string | null;
  /** Audio only, in seconds. It is also how long the scene's image is held on screen. */
  duration: number | null;
  error: string | null;
}

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

export interface AudioTiming {
  assetId: string;
  words: WordTiming[];
  totalDuration: number;
}

/** Where the wizard is. Linear, and every step forward is one the page can do again. */
export type Stage = 'config' | 'scenes' | 'assets' | 'assembly' | 'output';

/*
 * A saved sitting.
 *
 * One Firestore document per project under `users/{uid}/sloperProjects/{id}`, holding everything
 * about a run that is small — the scenes, where the wizard got to, and one row per asset saying
 * where its bytes are. The bytes themselves are in Cloud Storage; a scene's script is a few
 * hundred characters and a scene's picture is a few hundred kilobytes, and only one of those two
 * belongs in a document with a 1 MiB ceiling.
 *
 * NO API KEYS LIVE HERE. `settings` is a `SloperConfig` with `apiKeys` taken off, and that is not
 * tidiness: the keys have exactly one home per account (`users/{uid}/sloper/config`) and a second
 * copy per project would be a second place to miss when somebody revokes one. See
 * `.claude/rules/sloper.md` on why clearing a key has to propagate.
 */
export type ProjectSettings = Omit<SloperConfig, 'apiKeys'>;

/** An asset as it is written down: status, where the bytes are, and nothing binary. */
export interface StoredAsset {
  id: string;
  sceneId: string;
  type: AssetType;
  status: AssetStatus;
  /** Where in the bucket. Null when the upload failed — see `hydrateAssets`. */
  path: string | null;
  /** A download URL for it, so reopening does not have to mint one per asset. */
  url: string | null;
  duration: number | null;
  error: string | null;
}

export interface StoredVideo {
  path: string;
  url: string;
  bytes: number;
  duration: number;
}

export interface SloperProject {
  id: string;
  /** Two words, minted with the id. See `projectId.ts` for why it is not the topic. */
  name: string;
  createdAt: number;
  updatedAt: number;
  stage: Stage;
  /** The topic that was typed on the script step, so reopening does not start from an empty box. */
  prompt: string;
  scenes: Scene[];
  assets: StoredAsset[];
  /**
   * Narration lengths by asset id. Only the total is kept: the word-level alignment is thousands
   * of entries per scene and the only thing read back out of it is how long to hold the picture.
   */
  timings: Record<string, number>;
  video: StoredVideo | null;
  settings: ProjectSettings | null;
}

/** What the Open window shows: enough to pick one out of a list, and nothing more. */
export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  stage: Stage;
  prompt: string;
  scenes: number;
  hasVideo: boolean;
}

export interface TokenUsage {
  prompt: number;
  completion: number;
}
