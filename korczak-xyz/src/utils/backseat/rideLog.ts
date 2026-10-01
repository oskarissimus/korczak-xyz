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
}

/** A ride's id: its start time, sortable and readable in a bucket listing. */
export function rideIdFor(startedAt: number): string {
  return new Date(startedAt).toISOString().replace(/[:.]/g, '-');
}

export function roundPath(uid: string, record: Pick<RoundRecord, 'rideId' | 'n' | 'at'>): string {
  const n = String(record.n).padStart(4, '0');
  return `users/${uid}/backseat/rides/${record.rideId}/${n}-${record.at}`;
}

function frameBlob(frame: Frame): Blob {
  const bytes = Uint8Array.from(atob(frame.base64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: frame.mimeType });
}

/** Writes the round down, and never throws or makes the caller wait. */
export function saveRound(uid: string | null, record: RoundRecord, frame: Frame): void {
  if (!uid) return;
  const storage = getBackseatStorageClient();
  if (!storage) return;

  const base = roundPath(uid, record);
  const metadata = { cacheControl: 'private, max-age=31536000' };
  void Promise.all([
    uploadBytes(ref(storage, `${base}.jpg`), frameBlob(frame), metadata),
    uploadString(ref(storage, `${base}.json`), JSON.stringify(record, null, 2), 'raw', {
      ...metadata,
      contentType: 'application/json',
    }),
  ]).catch((e) => log.warn('backseat.ride.save.failed', describeError(e)));
}
