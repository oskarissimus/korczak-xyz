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
 * Fire and forget: nothing here is awaited by the game, and a failure is a breadcrumb.
 */

import { uploadString, ref } from 'firebase/storage';

import { getBackseatStorageClient } from '../../lib/firebase';
import { describeError, log } from '../../lib/logger';
import { recordMeasurement } from '../../lib/sentry';
import type { Lang } from './quest';
import type { StoryAttempt } from './storyteller';

declare const __COMMIT_HASH__: string;
const RELEASE = typeof __COMMIT_HASH__ === 'string' ? __COMMIT_HASH__ : 'dev';

export function recordQuest(uid: string | null, attempt: StoryAttempt, lang: Lang): void {
  recordMeasurement('rpg.quest', {
    outcome: attempt.outcome,
    provider: attempt.provider,
    model: attempt.model,
    lang,
    ms: attempt.ms,
    tries: attempt.tries.map((t) => `${t.model}:${t.status ?? 'x'}`).join(','),
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
    log.warn('rpg.quest.fallback', { outcome: attempt.outcome, error: attempt.error ?? '' });
  }

  if (!uid) return;
  const storage = getBackseatStorageClient();
  if (!storage) return;
  const at = Date.now();
  const record = { at, release: RELEASE, lang, ...attempt };
  void uploadString(
    ref(storage, `users/${uid}/rpg/beats/${new Date(at).toISOString().replace(/[:.]/g, '-')}.json`),
    JSON.stringify(record, null, 2),
    'raw',
    { cacheControl: 'private, max-age=31536000', contentType: 'application/json' },
  ).catch((e) => log.warn('rpg.quest.save.failed', describeError(e)));
}
