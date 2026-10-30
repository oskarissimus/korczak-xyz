/*
 * The browser's side of the server's jobs (`jobs.ts` says why, `functions/src/rpg/jobs.ts` runs
 * them): queue one, or take the one already there for the same work, and watch its document until
 * it ends. What the job writes as it goes — the stream, each model tried, fal.ai's queue — is handed
 * to the caller, which puts it in the developer console as if the browser had asked itself.
 *
 * `runServerJob` answers null whenever the browser should ask on its own instead: no account, keys
 * not yet on it, a job nobody picked up, a runner that died, the account missing the key, or
 * Firestore saying no. Nothing here is the only way to a beat or a model.
 */

import { doc, getDocFromServer, onSnapshot, runTransaction, Timestamp, type DocumentSnapshot } from 'firebase/firestore';
import { getDb } from '../../lib/firebase';
import { describeError, log } from '../../lib/logger';
import { DEAD_MS, JOBS, KEEP_MS, reuse, UNCLAIMED_MS, type JobDoc, type JobSpec } from './jobs';

let account: string | null = null;


/**
 * Who the jobs are for: a signed-in reader whose keys the account has (the key sync `synced`), or
 * nobody. `Rpg.tsx` says so whenever either changes.
 */
export function setJobAccount(uid: string | null): void {
  account = uid;
}

/** Whether the server can be asked: there is an account and a database to write the job into. */
export function jobsOn(): boolean {
  return account !== null && typeof window !== 'undefined' && getDb() !== null;
}

/** When the page last came to the front: a frozen page's clock says nothing about a job's runner. */
let visibleSince = Date.now();
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') visibleSince = Date.now();
  });
}
const lookedLongEnough = () =>
  typeof document === 'undefined' || (document.visibilityState === 'visible' && Date.now() - visibleSince > 8000);

/**
 * Queues `spec` under `id`, or takes the job already there for it (`reuse`), and resolves with the
 * finished document — or null for the browser to ask itself. `onDoc` sees every version as it comes.
 */
export async function runServerJob(id: string, spec: JobSpec, onDoc: (job: JobDoc) => void): Promise<JobDoc | null> {
  const uid = account;
  const db = getDb();
  if (!uid || !db) return null;
  const ref = doc(db, 'users', uid, JOBS, id);
  let createdAt: number;
  try {
    createdAt = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const now = Date.now();
      const there = snap.exists() ? (snap.data() as JobDoc) : null;
      if (there && reuse(there, now) === 'take') return there.createdAt;
      tx.set(ref, {
        spec,
        status: 'queued',
        createdAt: now,
        heartbeat: null,
        finishedAt: null,
        error: null,
        expireAt: Timestamp.fromMillis(now + KEEP_MS),
      });
      return now;
    });
  } catch (e) {
    log.warn('rpg.job.queue-failed', { id, ...describeError(e) });
    return null;
  }

  return new Promise<JobDoc | null>((resolve) => {
    let last: JobDoc | null = null;
    let fresh = false;
    let settled = false;
    const finish = (value: JobDoc | null) => {
      if (settled) return;
      settled = true;
      off();
      clearInterval(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
      resolve(value);
    };
    const seen = (snap: DocumentSnapshot) => {
      if (settled || !snap.exists()) return;
      const job = snap.data() as JobDoc;
      last = job;
      fresh = !snap.metadata.fromCache;
      onDoc(job);
      if (job.status === 'done') finish(job);
      else if (job.status === 'failed') finish(job.noKey || job.crashed ? null : job);
      else if (job.status === 'abandoned' || job.createdAt !== createdAt) {
        // Abandoned, or replaced by another tab's or the server's newer one: follow that instead.
        if (job.status === 'abandoned') finish(null);
        else createdAt = job.createdAt;
      }
    };
    const off = onSnapshot(ref, { includeMetadataChanges: true }, seen, (e) => {
      log.warn('rpg.job.watch-failed', { id, ...describeError(e) });
      finish(null);
    });
    /*
     * The listener alone is not enough (owner, 30 Oct 2026: "I came back after a long while and it
     * was still generating"). iOS freezes a backgrounded page, and on return its listener can sit on
     * the last version it heard for a long time without delivering the `done` the server wrote
     * meanwhile. So the document is also read from the server itself: the moment the page comes back
     * to the front, and every few seconds while waiting. A failed read changes nothing.
     */
    const reread = () => {
      if (settled || (typeof document !== 'undefined' && document.visibilityState !== 'visible')) return;
      void getDocFromServer(ref).then(seen, () => undefined);
    };
    const onVisible = () => reread();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    let ticks = 0;
    // A job nobody picked up, or whose runner stopped writing, is given up on — but only judged on
    // a page that has been in front long enough to have heard from the server since.
    const timer = setInterval(() => {
      if (++ticks % 3 === 0) reread();
      if (!last || !fresh || !lookedLongEnough()) return;
      const now = Date.now();
      const unclaimed = last.status === 'queued' && now - last.createdAt > UNCLAIMED_MS;
      const dead = last.status === 'running' && now - (last.heartbeat ?? last.createdAt) > DEAD_MS;
      if (!unclaimed && !dead) return;
      const judged = last.createdAt;
      void runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const now2 = snap.data() as JobDoc | undefined;
        if (now2 && now2.createdAt === judged && (now2.status === 'queued' || now2.status === 'running')) {
          tx.update(ref, { status: 'abandoned', error: unclaimed ? 'nobody picked it up' : 'its runner went quiet' });
        }
      })
        .catch(() => undefined)
        .finally(() => {
          log.warn('rpg.job.abandoned', { id, unclaimed });
          finish(null);
        });
    }, 3000);
  });
}
