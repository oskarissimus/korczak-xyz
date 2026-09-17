/*
 * What a slop video is made of, from the settings down to the blobs.
 *
 * Carried over from sloper's `frontend/src/types/index.ts` with two changes:
 *
 *  - `apiKeys` is a plain record of nullable strings rather than three nullables and one
 *    required string. The ElevenLabs key was the odd one out only because its input had no
 *    "not set" state; here every key is missing the same way, which is what lets one
 *    `KeyField` and one Firestore round-trip handle all four.
 *  - `Asset.dataUrl` stays, but see `src/utils/sloper/storage.ts`: none of this is persisted.
 *    Images and audio are megabytes of `Blob` and live for one sitting only.
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

export interface TokenUsage {
  prompt: number;
  completion: number;
}
