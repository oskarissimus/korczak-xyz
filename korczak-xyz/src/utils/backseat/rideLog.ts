/*
 * Every round of a ride, kept in the account's bucket for reading afterwards.
 *
 * Added Oct 2026, at the owner's request, when the passenger moved off OpenAI and its remarks
 * came back correct but flat: whether a remark is dull because of the model, the prompt or the
 * frame is a question only the three side by side can answer. So each round writes two objects,
 * `users/{uid}/backseat/rides/{rideId}/{n}-{at}.jpg` (the frame exactly as the model got it) and
 * `.json` beside it (the model, the persona, the full system and user prompts, the raw answer,
 * what was spoken, and what became of it).
 *
 * The bucket is the passenger's own, `korczak-xyz-501720-backseat` (terraform/storage.tf). It
 * shares `storage.rules` with sloper's, which give every approved account its own `users/{uid}/`
 * subtree and nothing else. Signed out there is nowhere to put it, and nothing is written.
 *
 * It never fails a round, and it is never awaited by one: an upload is fire-and-forget, a refusal
 * is a log line, and the passenger goes on talking. The keys are never in it.
 */

import { ref, uploadBytes, uploadString } from 'firebase/storage';

import { getBackseatStorageClient } from '../../lib/firebase';
import { describeError, log } from '../../lib/logger';
import { BACKSEAT, type Flavour } from './flavour';
import type { Frame } from './types';

declare const __COMMIT_HASH__: string;
export const RELEASE = typeof __COMMIT_HASH__ === 'string' ? __COMMIT_HASH__ : 'dev';

export type RoundOutcome = 'spoken' | 'unspoken' | 'dropped_empty' | 'dropped_repeat' | 'failed';

export interface RoundRecord {
  rideId: string;
  /** Position in the ride, from 1. */
  n: number;
  /** When the frame was taken. */
  at: number;
  provider: string;
  model: string;
  persona: string;
  intensity: string;
  /** The comic device drawn for this round (`ANGLES` in remarks.ts). */
  angle: string;
  lang: string;
  system: string;
  user: string;
  /** What the model sent back, before `sanitizeRemark`. Null when it never answered. */
  raw: string | null;
  /** What was put on the screen, if anything. */
  text: string | null;
  outcome: RoundOutcome;
  error: string | null;
  /** The commit the page was built from, so a record can be read against the prompt of its day. */
  release: string;
  /** The voice engine (and ElevenLabs model) that read it, for reading the timings. */
  voice?: string;
  /**
   * Where the wait went, in ms from the snapshot: `visionMs` when the model answered,
   * `firstSoundMs` when the voice was first heard, `doneMs` when it finished. Absent stages never
   * happened.
   */
  timings?: { visionMs?: number; firstSoundMs?: number; doneMs?: number };
  /**
   * Every stage of the round, in ms from `at`, first occurrence only: `frame` (captured),
   * `vision.sent`/`.headers`/`.body`, `tts.sent`/`.headers`/`.body`, `audio.play`, `firstSound`,
   * and for Gemini Live `live.ready`, `live.sent`, `live.firstMessage`, `live.firstAudio`,
   * `live.firstText`, `live.turnComplete`, `live.closed`, `live.retry`. `done` ends it.
   */
  trace?: Record<string, number>;
  /** Gemini Live only: each server message's kinds (`messageKinds`), as [ms from `at`, kind]. */
  events?: [number, string][];
  /** Gemini Live only: the session this round used, and how it ended. */
  live?: {
    /** Opened during the previous remark, rather than for this one. */
    prepared: boolean;
    /** From the session being made to this round starting. Negative when made for this round. */
    sessionAgeMs: number;
    /** From the session being made to `setupComplete`. */
    setupMs: number | null;
    /** Messages that arrived between setup and the frame being sent. */
    early: string[];
    close: { code: number; reason: string; ms: number } | null;
    usage: unknown;
    /** The first session answered with no sound, and a fresh one was asked instead. */
    retried?: boolean;
    /** Why: `empty` (nothing at all) or `textOnly` (a transcript and no audio). */
    retryReason?: 'empty' | 'textOnly';
    /** The answer that was retried: its transcript, usage and messages, as on the retry below. */
    firstAttempt?: { text: string | null; usage: unknown; messages: [number, unknown][] };
    /** Had words but no sound even after the retry, and the phone's synthesiser read them. */
    deviceFallback?: boolean;
    /** How the frame went: `clientContent` (the only channel in which the model sees it). */
    input?: string;
    /** Whether `setup` carried `thinkingBudget: 0`. */
    thinkingOff?: boolean;
    audioChunks?: number;
    audioSeconds?: number;
    /**
     * Every server message but the plain audio chunks, whole, with audio data elided
     * (`LiveSession.messages`): [ms from the frame being sent, message].
     */
    messages?: [number, unknown][];
  };
  /** `navigator.connection.effectiveType` where the browser has it. */
  network?: string;
}

/** A ride's id: its start time, sortable and readable in a bucket listing. */
export function rideIdFor(startedAt: number): string {
  return new Date(startedAt).toISOString().replace(/[:.]/g, '-');
}

/**
 * The roaster's rounds go to `users/{uid}/roaster/rides/` in the same bucket: the storage rule is
 * `users/{uid}/**`, so a second app needed no rule, no bucket and no Terraform.
 */
export function roundPath(
  uid: string,
  record: Pick<RoundRecord, 'rideId' | 'n' | 'at'>,
  flavour: Flavour = BACKSEAT,
): string {
  const n = String(record.n).padStart(4, '0');
  return `users/${uid}/${flavour.folder}/rides/${record.rideId}/${n}-${record.at}`;
}

function frameBlob(frame: Frame): Blob {
  const bytes = Uint8Array.from(atob(frame.base64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: frame.mimeType });
}

/** Writes the round down, and never throws or makes the caller wait. */
export function saveRound(
  uid: string | null,
  record: RoundRecord,
  frame: Frame,
  flavour: Flavour = BACKSEAT,
): void {
  if (!uid) return;
  const storage = getBackseatStorageClient();
  if (!storage) return;

  const base = roundPath(uid, record, flavour);
  const metadata = { cacheControl: 'private, max-age=31536000' };
  void Promise.all([
    uploadBytes(ref(storage, `${base}.jpg`), frameBlob(frame), metadata),
    uploadString(ref(storage, `${base}.json`), JSON.stringify(record, null, 2), 'raw', {
      ...metadata,
      contentType: 'application/json',
    }),
  ]).catch((e) => log.warn(`${flavour.id}.ride.save.failed`, describeError(e)));
}
