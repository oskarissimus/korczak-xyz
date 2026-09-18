/*
 * What an annoying passenger is made of.
 *
 * The shape is deliberately smaller than sloper's. That app has to describe a video; this one has
 * to describe a voice in the seat beside you, and everything it needs is a key, a model, how
 * often to speak and who to sound like. Two things are worth knowing before adding a field:
 *
 *  - `voice.engine: 'device'` is the default and it needs no key at all. The whole app works with
 *    one vision key and nothing else, because a phone already has a speech synthesiser and the
 *    alternative is a second bill for something the platform gives away.
 *  - Nothing about a ride is in here. The remarks are in memory and die with the tab — see
 *    `storage.ts` for why that is a decision rather than an omission.
 */

/** The two providers that will look at a photograph from a browser with nothing but a key. */
export type VisionProvider = 'openai' | 'google';

/** Every key the app can want. `elevenLabs` is needed only by the voice engine of the same name. */
export type KeyName = 'openai' | 'google' | 'elevenLabs';

export type ApiKeys = Record<KeyName, string | null>;

/**
 * Who is in the seat. The persona is the whole of the app's personality and it is a closed list
 * rather than a free-text box on purpose: the prompt around it is written to be hard to talk out
 * of its shape, and a box somebody types into is a box somebody types "ignore the above" into.
 */
export type Persona = 'nervous' | 'instructor' | 'parent' | 'child' | 'codriver';

/** How hard the passenger goes. The same persona at three volumes, roughly. */
export type Intensity = 'mild' | 'normal' | 'relentless';

export type VoiceEngine = 'device' | 'elevenlabs';

export type CameraFacing = 'environment' | 'user';

export interface BackseatConfig {
  apiKeys: ApiKeys;
  vision: {
    provider: VisionProvider;
    /** Empty until a key has been entered and the model list has come back. */
    model: string;
  };
  remarks: {
    /** Seconds between snapshots. The floor is not a preference — see `ride.ts`. */
    intervalSeconds: number;
    persona: Persona;
    intensity: Intensity;
  };
  voice: {
    engine: VoiceEngine;
    /** `speechSynthesis` voices are named by URI, and the list is per device. */
    deviceVoiceUri: string;
    /** ElevenLabs only. */
    voiceId: string;
    /** 0.5–2. Both engines take it, and both mean roughly the same thing by it. */
    rate: number;
  };
  camera: {
    facing: CameraFacing;
  };
}

/**
 * Where a ride is.
 *
 * `starting` is its own state and not a flag on `idle`: it spans the permission dialog, which can
 * stay open for as long as somebody takes to read it, and a Start button that looks untouched for
 * that whole time gets pressed again.
 */
export type RideStatus = 'idle' | 'starting' | 'running';

/** One thing the passenger said, and when. */
export interface Remark {
  id: string;
  text: string;
  /** When the snapshot it came from was taken, not when it was spoken. */
  at: number;
  /** Set when the remark was never spoken, and why. */
  error: string | null;
}

/** A frame on its way to a model: a data URL for the `<img>` half and the parts a provider wants. */
export interface Frame {
  dataUrl: string;
  /** The base64 payload with the `data:image/jpeg;base64,` prefix taken off. */
  base64: string;
  mimeType: string;
  width: number;
  height: number;
}
