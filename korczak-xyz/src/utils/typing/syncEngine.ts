/*
 * Cloud sync for one book's progress, as an explicit state machine.
 *
 * What this replaces was a set of loose refs and timers inside useTypingSession, and it had a
 * failure mode worth recording. Cloud writes were gated on a `cloudReadyRef` that the initial
 * reconcile set in a `finally` - but only `if (!cancelled)`. Since `useAuth` seeds its user
 * from a cache and then re-sets it from Firebase as a *new object with the same uid*, the
 * effect re-ran, cancelled the in-flight reconcile, and early-returned on a uid check. The
 * flag stayed false for the rest of the visit, so nothing reached Firestore while local
 * progress kept advancing - and nothing said so.
 *
 * The lessons are built into the shape here:
 *
 *  - Readiness is engine state with exactly one owner, not a ref an effect cleanup can orphan.
 *  - The engine is keyed by uid *string* and book id, so a new user object is not a new engine.
 *  - Writes are single-flight and coalescing: at most one in flight, later progress supersedes
 *    what is queued, so writes cannot land out of order.
 *  - Nothing fails silently. Every transition is logged and surfaced through `getState()`.
 */

import { describeError, log } from '../../lib/logger';
import {
  loadCloudProgress,
  saveCloudProgress,
  saveCloudProgressChecked,
} from './cloudStorage';
import { mergeWinner, reconcile, type Decision, type SyncBookmark } from './reconcile';
import { clearBookmark, loadBookmark, saveBookmark } from './syncBookmark';
import { createDefaultProgress, normalizeProgress, type TypingProgress } from './types';

export type SyncStatus =
  | 'disabled' // no signed-in user; local-only
  | 'starting' // initial reconcile in flight
  | 'synced' // cloud matches local
  | 'syncing' // a write is in flight
  | 'pending' // local changes waiting on a debounce or a retry
  | 'offline' // browser reports no connection
  | 'error' // writes are failing
  | 'conflict'; // branched; waiting on the user

export interface SyncConflict {
  local: TypingProgress;
  cloud: TypingProgress;
  suggested: 'local' | 'cloud';
}

export interface SyncState {
  status: SyncStatus;
  lastSyncedAt: number | null;
  /** When the most recent attempt failed. Paired with `error`, which says whether it is the
   *  most recent attempt: `status` cannot say, because it is a precedence ladder in which a
   *  retry in flight ('syncing') outranks the failure it is retrying. */
  lastFailedAt: number | null;
  error: string | null;
  /** Whether a write is queued, debouncing, or waiting on a retry - the same fact the ladder
   *  reports as 'pending' only when nothing above it applies. */
  pendingWork: boolean;
  conflict: SyncConflict | null;
}

export interface SyncEngineOptions {
  uid: string;
  bookId: string;
  /** The authoritative current local progress, read at write time rather than passed in. */
  getLocal: () => TypingProgress;
  /** Adopt cloud progress into React state and localStorage. */
  applyRemote: (progress: TypingProgress) => void;
  onState: (state: SyncState) => void;
}

// Trailing debounce after the last keystroke, plus a ceiling so continuous typing still
// checkpoints. Carried over from the previous implementation, which had the timings right.
const DEBOUNCE_MS = 1500;
const MAX_WAIT_MS = 3000;
// Retry backoff for failed writes: 2s, 6s, 18s, … capped.
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 60_000;
// A rejected checked-write is re-attempted after reconciling, but a repeatedly-moving
// document must not spin.
const MAX_REJECT_RETRIES = 3;

function identityOf(p: TypingProgress): SyncBookmark {
  return { rev: p.rev, writerId: p.writerId };
}

// Cloud documents predating a field arrive without it; merging over defaults is what keeps
// them readable. (The previous code did this too, at the reconcile site.)
function hydrate(bookId: string, raw: TypingProgress | null): TypingProgress | null {
  if (!raw) return null;
  return normalizeProgress({ ...createDefaultProgress(bookId), ...raw });
}

export class ProgressSyncEngine {
  private readonly opts: SyncEngineOptions;

  private state: SyncState = {
    status: 'starting',
    lastSyncedAt: null,
    lastFailedAt: null,
    error: null,
    pendingWork: false,
    conflict: null,
  };

  // Set once the initial reconcile has settled. Until then a push would risk uploading local
  // progress over a cloud copy we have not looked at yet.
  private ready = false;
  private stopped = false;

  private writeInFlight = false;
  private writeQueued = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private firstPendingAt = 0;
  private consecutiveFailures = 0;

  private readonly onOnline = () => {
    log.info('net.online', { bookId: this.opts.bookId });
    this.consecutiveFailures = 0;
    if (this.hasPendingWork()) this.push('reconnect');
    else this.emit();
  };

  private readonly onOffline = () => {
    log.warn('net.offline', { bookId: this.opts.bookId });
    this.emit();
  };

  constructor(opts: SyncEngineOptions) {
    this.opts = opts;
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onOnline);
      window.addEventListener('offline', this.onOffline);
    }
  }

  getState(): SyncState {
    return this.state;
  }

  // Only notifies when something actually changed. `notifyLocalChange` runs on every
  // keystroke, and a subscriber that is a React setState would otherwise be handed a new
  // object each time - re-rendering the typing view to say precisely the same thing.
  private setState(patch: Partial<SyncState>): void {
    const next = { ...this.state, ...patch };
    if (
      next.status === this.state.status &&
      next.lastSyncedAt === this.state.lastSyncedAt &&
      next.lastFailedAt === this.state.lastFailedAt &&
      next.error === this.state.error &&
      next.pendingWork === this.state.pendingWork &&
      next.conflict === this.state.conflict
    ) {
      return;
    }
    this.state = next;
    this.opts.onState(next);
  }

  /** Record a failed attempt. The timestamp is what lets the indicator age a failure the way
   *  it ages a success; `error` is cleared by the next write that lands. */
  private fail(code: string): void {
    this.setState({ error: code, lastFailedAt: Date.now() });
  }

  private emit(): void {
    this.setState({ status: this.deriveStatus(), pendingWork: this.hasPendingWork() });
  }

  private deriveStatus(): SyncStatus {
    if (this.state.conflict) return 'conflict';
    if (!this.ready) return 'starting';
    if (this.writeInFlight) return 'syncing';
    if (typeof navigator !== 'undefined' && !navigator.onLine && this.hasPendingWork()) {
      return 'offline';
    }
    if (this.state.error) return 'error';
    if (this.hasPendingWork()) return 'pending';
    return 'synced';
  }

  private hasPendingWork(): boolean {
    return this.writeQueued || this.debounceTimer != null || this.retryTimer != null;
  }

  /** Initial reconcile. Always settles `ready`, on every path. */
  async start(): Promise<void> {
    const { uid, bookId } = this.opts;
    const startedAt = Date.now();
    log.info('sync.reconcile.start', { bookId, uid });
    let decision: Decision | null = null;
    try {
      const cloud = hydrate(bookId, await loadCloudProgress(uid, bookId));
      if (this.stopped) return;
      // Read local *after* the await: anything typed while the fetch was in flight is part
      // of the comparison, so a slow network cannot cause a pull over fresh keystrokes.
      const local = normalizeProgress(this.opts.getLocal());
      const base = loadBookmark(bookId);
      decision = reconcile(local, cloud, base);
      log.info('sync.reconcile.decision', {
        bookId,
        kind: decision.kind,
        reason: decision.reason,
        ms: Date.now() - startedAt,
        local: summarize(local),
        cloud: cloud ? summarize(cloud) : null,
        base,
      });
      await this.applyDecision(decision, local, cloud);
    } catch (e) {
      log.error('sync.reconcile.fail', { bookId, ...describeError(e) });
      this.fail('reconcile-failed');
    } finally {
      // Unconditional, and the whole point. There is no interleaving - cancellation, a
      // second effect run, a thrown error - that can leave this engine permanently unable
      // to write, which is exactly what the previous implementation allowed.
      this.ready = true;
      if (!this.stopped) this.emit();
    }
  }

  private async applyDecision(
    decision: Decision,
    local: TypingProgress,
    cloud: TypingProgress | null
  ): Promise<void> {
    const { bookId, uid } = this.opts;
    switch (decision.kind) {
      case 'in-sync':
        if (cloud) saveBookmark(bookId, identityOf(cloud));
        this.setState({ lastSyncedAt: Date.now(), error: null });
        return;

      case 'seed-cloud':
        // No cloud document at all: an unconditional write is correct, there is nothing to
        // race with, and it is how a first sign-in migrates what is already on the device.
        await saveCloudProgress(uid, local);
        saveBookmark(bookId, identityOf(local));
        log.info('sync.seed.ok', { bookId, ...summarize(local) });
        this.setState({ lastSyncedAt: Date.now(), error: null });
        return;

      case 'push':
        this.ready = true; // pushNow checks it; the reconcile that authorised this is done
        await this.pushNow('reconcile');
        return;

      case 'pull':
      case 'adopt-cloud': {
        if (!cloud) return;
        const adopted = mergeWinner(cloud, local);
        this.opts.applyRemote(adopted);
        saveBookmark(bookId, identityOf(cloud));
        log.info('sync.pull.ok', { bookId, from: summarize(local), to: summarize(adopted) });
        this.setState({ lastSyncedAt: Date.now(), error: null });
        return;
      }

      case 'conflict':
        if (!cloud) return;
        this.raiseConflict(local, cloud, decision.suggested ?? 'local', decision.reason);
        return;
    }
  }

  private raiseConflict(
    local: TypingProgress,
    cloud: TypingProgress,
    suggested: 'local' | 'cloud',
    reason: string
  ): void {
    log.warn('sync.conflict.shown', {
      bookId: this.opts.bookId,
      reason,
      suggested,
      local: summarize(local),
      cloud: summarize(cloud),
    });
    this.clearTimers();
    // A conflict is an attempt that did not complete, so it dates the last-sync readout too.
    this.setState({
      conflict: { local, cloud, suggested },
      status: 'conflict',
      lastFailedAt: Date.now(),
      pendingWork: false,
    });
  }

  /**
   * The user picked a side. The winner is written to both places and becomes the new common
   * revision; the loser is gone from the app, which is why the UI exports it first.
   */
  async resolveConflict(choice: 'local' | 'cloud'): Promise<void> {
    const conflict = this.state.conflict;
    if (!conflict) return;
    const { bookId, uid } = this.opts;
    const winnerSide = choice === 'local' ? conflict.local : conflict.cloud;
    const loserSide = choice === 'local' ? conflict.cloud : conflict.local;
    // A fresh revision either way: the resolution is itself an edit, and stamping it means
    // neither device can later mistake the result for the branch it started from.
    const winner = mergeWinner(winnerSide, loserSide);
    const resolved: TypingProgress = {
      ...winner,
      rev: Math.max(conflict.local.rev, conflict.cloud.rev) + 1,
      writerId: winner.writerId,
      updatedAt: Date.now(),
    };

    log.warn('sync.conflict.resolved', { bookId, choice, resolved: summarize(resolved) });
    this.setState({ conflict: null, error: null });
    this.opts.applyRemote(resolved); // also correct for 'local': it re-stamps the revision

    try {
      // Unconditional: the user has just adjudicated this document, so the check the
      // transaction would perform has already been answered by a human.
      await saveCloudProgress(uid, resolved);
      saveBookmark(bookId, identityOf(resolved));
      this.setState({ lastSyncedAt: Date.now() });
      log.info('sync.conflict.write.ok', { bookId });
    } catch (e) {
      log.error('sync.conflict.write.fail', { bookId, ...describeError(e) });
      this.fail('write-failed');
      this.scheduleRetry();
    }
    this.emit();
  }

  /** A local edit happened. Coalesces into the debounce, with a ceiling. */
  notifyLocalChange(): void {
    if (this.stopped || this.state.conflict) return;
    const now = Date.now();
    if (this.firstPendingAt === 0) this.firstPendingAt = now;

    if (now - this.firstPendingAt >= MAX_WAIT_MS) {
      this.push('max-wait');
      return;
    }
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.push('debounce');
    }, DEBOUNCE_MS);
    this.emit();
  }

  /** Write now: page teardown, pause, unmount, or an explicit retry. */
  flush(trigger = 'flush'): void {
    if (this.stopped || this.state.conflict) return;
    this.push(trigger);
  }

  // `error` is deliberately left standing: it is what the indicator's last-sync cell reads, and
  // a retry does not change how the previous attempt ended. The write that lands clears it.
  retry(): void {
    this.consecutiveFailures = 0;
    this.push('manual-retry');
  }

  private clearTimers(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.firstPendingAt = 0;
  }

  private push(trigger: string): void {
    this.clearTimers();
    if (!this.ready) {
      // The initial reconcile decides what to do with these changes; it reads local state
      // at decision time, so nothing is lost by not writing yet.
      this.writeQueued = true;
      this.emit();
      return;
    }
    void this.pushNow(trigger);
  }

  private scheduleRetry(): void {
    if (this.retryTimer || this.stopped) return;
    const delay = Math.min(
      RETRY_BASE_MS * 3 ** Math.max(0, this.consecutiveFailures - 1),
      RETRY_MAX_MS
    );
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.pushNow('retry');
    }, delay);
  }

  /**
   * Single-flight write loop. A change arriving mid-write sets `writeQueued`, and the loop
   * runs once more with whatever local progress is current by then - so N edits during one
   * round trip cost one extra write, not N, and always in order.
   */
  private async pushNow(trigger: string): Promise<void> {
    if (this.stopped || this.state.conflict) return;
    if (this.writeInFlight) {
      this.writeQueued = true;
      return;
    }
    this.writeInFlight = true;
    this.writeQueued = false;
    this.emit();

    const { bookId, uid } = this.opts;
    try {
      let attempt = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const local = normalizeProgress(this.opts.getLocal());
        const base = loadBookmark(bookId);
        const startedAt = Date.now();
        log.debug('sync.push.start', { bookId, trigger, rev: local.rev, base });

        const result = await saveCloudProgressChecked(uid, local, base);
        if (this.stopped) return;

        if (result.ok) {
          saveBookmark(bookId, identityOf(local));
          this.consecutiveFailures = 0;
          this.firstPendingAt = 0;
          this.setState({ lastSyncedAt: Date.now(), error: null });
          log.info('sync.push.ok', {
            bookId,
            trigger,
            ms: Date.now() - startedAt,
            ...summarize(local),
          });
        } else {
          // The document moved. Work out whether that is recoverable before giving up.
          const remote = hydrate(bookId, result.conflict)!;
          attempt += 1;
          log.warn('sync.push.rejected', {
            bookId,
            attempt,
            local: summarize(local),
            remote: summarize(remote),
          });
          const outcome = this.handleRejection(local, remote);
          if (outcome === 'retry' && attempt < MAX_REJECT_RETRIES) continue;
          if (outcome === 'retry') {
            this.raiseConflict(local, remote, 'local', 'reject-retry-exhausted');
          }
          break;
        }

        if (!this.writeQueued) break;
        this.writeQueued = false; // one more pass, with whatever is current now
      }
    } catch (e) {
      this.consecutiveFailures += 1;
      log.warn('sync.push.fail', {
        bookId,
        trigger,
        attempt: this.consecutiveFailures,
        ...describeError(e),
      });
      this.fail('write-failed');
      this.scheduleRetry();
    } finally {
      this.writeInFlight = false;
      if (!this.stopped) this.emit();
    }
  }

  /** Decide what a rejected checked-write means. */
  private handleRejection(
    local: TypingProgress,
    remote: TypingProgress
  ): 'retry' | 'done' | 'conflict' {
    const { bookId } = this.opts;
    const decision = reconcile(local, remote, loadBookmark(bookId));
    log.info('sync.reject.decision', { bookId, kind: decision.kind, reason: decision.reason });

    switch (decision.kind) {
      case 'push':
      case 'seed-cloud':
        // Local still descends from what is actually up there - our bookmark was just stale
        // (a write that landed but whose bookmark did not). Adopt the real identity and
        // write again; this time the transaction's check will pass.
        saveBookmark(bookId, identityOf(remote));
        return 'retry';

      case 'in-sync':
        saveBookmark(bookId, identityOf(remote));
        this.setState({ lastSyncedAt: Date.now(), error: null });
        return 'done';

      case 'pull':
      case 'adopt-cloud': {
        const adopted = mergeWinner(remote, local);
        this.opts.applyRemote(adopted);
        saveBookmark(bookId, identityOf(remote));
        this.setState({ lastSyncedAt: Date.now(), error: null });
        log.info('sync.pull.ok', { bookId, reason: 'push-rejected', to: summarize(adopted) });
        return 'done';
      }

      case 'conflict':
      default:
        this.raiseConflict(local, remote, decision.suggested ?? 'local', decision.reason);
        return 'conflict';
    }
  }

  /** Forget the sync relationship for this book - used when progress is reset. */
  forgetBookmark(): void {
    clearBookmark(this.opts.bookId);
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline);
      window.removeEventListener('offline', this.onOffline);
    }
  }
}

// Compact progress description for logs: enough to reconstruct what happened without
// shipping the whole typedHistory on every entry.
export function summarize(p: TypingProgress) {
  return {
    rev: p.rev,
    writerId: p.writerId ? p.writerId.slice(0, 8) : '',
    passageIndex: p.passageIndex,
    typedLen: p.typed.length,
    totalKeystrokes: p.totalKeystrokes,
    lastPlayedAt: p.lastPlayedAt,
  };
}
