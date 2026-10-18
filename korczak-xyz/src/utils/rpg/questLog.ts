/*
 * Every beat a model was asked for, written down, so "it is always the drowners" can be answered from a
 * record rather than guessed at.
 *
 * Two places, as the backseat driver does it (`utils/backseat/rideLog.ts`):
 *
 * - **Sentry Logs**, one `rpg.quest` measurement per beat: outcome, provider, model, how long,
 *   the HTTP status of each try. Numbers and categories, never the prompt or the story — and it is
 *   sent signed out too, which is where most failures will be.
 * - **The bucket**, for a signed-in account: `users/{uid}/rpg/beats/{at}.json` in the backseat
 *   bucket (`korczak-xyz-501720-backseat`), with the prompt, the raw answer, each model tried and its
 *   error. The keys are never in it. That bucket's `storage.rules` already gives every approved
 *   account `users/{uid}/**`, so this needed no rule, bucket or Terraform; the name is the backseat
 *   driver's, and moving the RPG's records to a bucket of its own is a Terraform change for later.
 *
 * A beat that fails outright (`failed`, `unusable`) is also a Sentry *error*, `rpg.quest.failed`, so
 * it shows up in Issues and not only in a log query. And a beat still being written when the page
 * is hidden or closed is recorded then (`watchBeat`), as `pending` or `abandoned`: in Oct 2026 the
 * owner waited out a slow Pro beat, left, and Sentry had no line at all for it, because the only
 * record was made when the answer came.
 *
 * Fire and forget: nothing here is awaited by the game, and a failed upload is a breadcrumb.
 */

import { uploadString, ref } from 'firebase/storage';

import { getBackseatStorageClient } from '../../lib/firebase';
import { describeError, log } from '../../lib/logger';
import { flushTelemetry, recordMeasurement } from '../../lib/sentry';
import type { Lang } from './quest';
import type { StoryAttempt } from './storyteller';

declare const __COMMIT_HASH__: string;
const RELEASE = typeof __COMMIT_HASH__ === 'string' ? __COMMIT_HASH__ : 'dev';

function sum(attempt: StoryAttempt, key: 'input' | 'output' | 'thoughts'): number {
  return attempt.tries.reduce((total, t) => total + (t.usage?.[key] ?? 0), 0);
}

interface InFlight {
  beat: number;
  lang: Lang;
  startedAt: number;
  chosen: string | null;
}

const inFlight = new Set<InFlight>();
let listening = false;

function onHidden(outcome: 'pending' | 'abandoned') {
  if (inFlight.size === 0) return;
  for (const f of inFlight) {
    recordMeasurement('rpg.quest', {
      outcome,
      lang: f.lang,
      beat: f.beat,
      chosen: f.chosen ?? 'default',
      ms: Date.now() - f.startedAt,
    });
  }
  // The SDK queued its own flush on hide before this ran; this sends what was just recorded.
  flushTelemetry();
}

/**
 * Marks a beat as being written until `done` is called, so leaving the page while it is still
 * coming is a record too. Hidden (another tab, the phone locked) is `pending`, closed is
 * `abandoned`; a beat that later arrives is recorded again by `recordQuest` as usual.
 */
export function watchBeat(beat: number, lang: Lang, chosen: string | null): () => void {
  if (!listening && typeof window !== 'undefined') {
    listening = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') onHidden('pending');
    });
    window.addEventListener('pagehide', () => onHidden('abandoned'));
  }
  const f: InFlight = { beat, lang, startedAt: Date.now(), chosen };
  inFlight.add(f);
  return () => inFlight.delete(f);
}

export function recordQuest(uid: string | null, attempt: StoryAttempt, lang: Lang, chosen: string | null = null): void {
  recordMeasurement('rpg.quest', {
    outcome: attempt.outcome,
    provider: attempt.provider,
    model: attempt.model,
    chosen: chosen ?? 'default',
    lang,
    ms: attempt.ms,
    tries: attempt.tries.map((t) => `${t.model}:${t.status ?? 'x'}`).join(','),
    firstMs: attempt.tries.at(-1)?.firstMs ?? undefined,
    inputTokens: sum(attempt, 'input'),
    outputTokens: sum(attempt, 'output'),
    thoughtTokens: sum(attempt, 'thoughts'),
    costUsd: attempt.tries.reduce((total, t) => total + (t.cost ?? 0), 0),
    rawLength: attempt.raw?.length,
    beat: attempt.index,
    kind: attempt.job?.kind ?? 'opening',
    count: attempt.job?.count,
    plan: attempt.plan.map((j) => j?.kind ?? 'end').join(','),
    biome: attempt.beat ? (attempt.beat.place?.biome ?? 'village') : undefined,
    shape: attempt.beat?.job?.look.shape,
    parts: attempt.beat?.story.length,
    clues: attempt.beat?.clues.length,
    witness: attempt.beat ? attempt.beat.witness !== null : undefined,
  });
  if (attempt.outcome !== 'generated' && attempt.outcome !== 'no-key') {
    log.error('rpg.quest.failed', {
      outcome: attempt.outcome,
      error: attempt.error ?? '',
      beat: attempt.index,
      tries: attempt.tries.map((t) => `${t.model}:${t.status ?? 'x'} ${t.error ?? ''}`.trim()).join(' | '),
    });
  }

  if (!uid) return;
  const storage = getBackseatStorageClient();
  if (!storage) return;
  const at = Date.now();
  const record = { at, release: RELEASE, lang, chosen, ...attempt };
  void uploadString(
    ref(storage, `users/${uid}/rpg/beats/${new Date(at).toISOString().replace(/[:.]/g, '-')}.json`),
    JSON.stringify(record, null, 2),
    'raw',
    { cacheControl: 'private, max-age=31536000', contentType: 'application/json' },
  ).catch((e) => log.warn('rpg.quest.save.failed', describeError(e)));
}
