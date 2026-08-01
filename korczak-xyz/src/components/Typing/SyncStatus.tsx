import React, { useEffect, useState } from 'react';
import type { AuthApi } from '../../hooks/useAuth';
import type { SyncState } from '../../utils/typing/syncEngine';
import { describeSync, type SyncDisplay } from '../../utils/typing/syncPresentation';
import { translations, type Lang } from './translations';

interface SyncStatusProps {
  auth: AuthApi;
  sync: SyncState;
  lang: Lang;
  onRetry: () => void;
}

type T = (typeof translations)[Lang];

// How often the "2 min ago" text is recomputed. Deliberately not tied to renders of the
// typing session: this component sits in the same tree as the passage, and the whole point
// of a ticking clock here is that it must not cost anything per keystroke.
const RELATIVE_TIME_TICK_MS = 30_000;

// Re-render on a slow timer so "2 min ago" keeps up. No interval runs when there is no
// timestamp to age, which is only before the first attempt settles.
function useAgingLabel(timestamp: number | null): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (timestamp == null) return;
    const id = setInterval(() => setTick((n) => n + 1), RELATIVE_TIME_TICK_MS);
    return () => clearInterval(id);
  }, [timestamp]);
}

function formatAgo(timestamp: number, t: T): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return t.syncJustNow;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} ${t.syncMinutesAgo}`;
  const hours = Math.round(minutes / 60);
  // Days, because the slot has a fixed width and "36 h ago" is where the label starts to grow
  // faster than the box it lives in.
  if (hours < 24) return `${hours} ${t.syncHoursAgo}`;
  return `${Math.round(hours / 24)} ${t.syncDaysAgo}`;
}

// What cell one is saying, in words, for anyone not looking at the icon.
function activityLabel(display: SyncDisplay, status: SyncState['status'], t: T): string {
  if (display.activity === 'busy') {
    if (display.outcome === 'fail') return t.syncRetrying;
    return status === 'starting' ? t.syncChecking : t.syncSyncing;
  }
  return display.reason === 'offline' ? t.syncOffline : t.syncPending;
}

function outcomeLabel(display: SyncDisplay, t: T): string {
  if (display.outcome === 'ok') return t.syncSynced;
  if (display.outcome === 'none') return t.syncNever;
  return display.reason === 'conflict' ? t.syncConflict : t.syncFailed;
}

/*
 * Whether progress is actually reaching the account, shown next to the book picker.
 *
 * This used to render nothing at all while signed in, on the reasoning that the status bar's
 * email already said "you are signed in". It does - but being signed in was never the same
 * thing as being saved, and when the two came apart there was nothing on the page that said
 * so. A whole session's progress could fail to upload without a single pixel changing.
 *
 * It then spent a while saying one thing at a time, which had the opposite problem: the label
 * it chose was almost always "Saving…", so a failed write being retried looked identical to a
 * healthy one, and a settled sync said nothing about when it had last happened. Now there are
 * two cells - is a sync happening, and how did the last one end - and both are always readable.
 *
 * Every state renders into a fixed-width slot, including the empty ones. An indicator that
 * changes width sits in a centred flex row and drags the book <select> sideways under the
 * cursor, which is a real cost paid by someone who is not looking at the indicator at all.
 */
export default function SyncStatus({ auth, sync, lang, onRetry }: SyncStatusProps) {
  const { enabled, user, loading } = auth;
  const t = translations[lang];
  const display = describeSync(sync);
  useAgingLabel(display.at);

  // Nothing here ever renders, so nothing here can move the row.
  if (!enabled) return null;

  if (!user) {
    // Still resolving: the slot is held open rather than filled, so the row does not jump
    // when auth settles either way.
    if (loading) return <div className="typing-sync-slot" aria-hidden="true" />;
    const loginPath =
      lang === 'en' ? '/login/?redirect=/games/typing/' : '/pl/login/?redirect=/pl/games/typing/';
    return (
      <div className="typing-sync-slot">
        <a className="typing-sync typing-sync-link" href={loginPath}>
          {t.syncSignIn} →
        </a>
      </div>
    );
  }

  const ago = display.at != null ? formatAgo(display.at, t) : null;
  const exactTime = display.at != null ? new Date(display.at).toLocaleTimeString() : null;
  const lastTitle =
    exactTime == null
      ? undefined
      : display.outcome === 'fail'
        ? `${t.syncTitleFailed} ${exactTime}${display.retryable ? ` · ${t.syncRetry}` : ''}`
        : `${t.syncTitleSynced} ${exactTime}`;

  const lastLabel = `${t.syncLastSync}: ${outcomeLabel(display, t)}${ago ? ` · ${ago}` : ''}`;

  // The icon and the abbreviated age are for the eye; the sentence next to them, unstyled and
  // off-screen, is what a screen reader gets. Reading "✕ 2 min ago" aloud says nothing.
  const lastContent = (
    <>
      <span className="typing-sync-glyph" aria-hidden="true">
        {display.outcome === 'ok' ? '✓' : display.outcome === 'fail' ? '✕' : '–'}
      </span>
      <span className="typing-sync-ago" aria-hidden="true">
        {ago ?? t.syncNever}
      </span>
    </>
  );

  const lastClass = [
    'typing-sync-cell',
    'typing-sync-cell--last',
    display.outcome === 'ok'
      ? 'typing-sync--ok'
      : display.outcome === 'fail'
        ? 'typing-sync--error'
        : 'typing-sync--none',
  ].join(' ');

  const activity = display.activity === 'idle' ? null : activityLabel(display, sync.status, t);

  // Not a live region: with a debounce of 1.5s, these cells change several times a minute while
  // someone types, and announcing each one would talk over the thing they are typing. The state
  // is readable on demand instead, from the text each cell carries.
  return (
    <div className="typing-sync typing-sync-slot">
      {/* Cell one: is a sync happening right now. Empty when nothing is - and still the same
          width, which is the point of it being its own cell. */}
      <span className="typing-sync-cell typing-sync-cell--now" title={activity ?? undefined}>
        {display.activity === 'busy' && <span className="typing-sync-spinner" aria-hidden="true" />}
        {display.activity === 'queued' && <span className="typing-sync-queued" aria-hidden="true" />}
        {activity && <span className="typing-sync-sr">{activity}</span>}
      </span>

      {/* Cell two: how the last attempt ended, and when. A button only when clicking it would
          do something - a conflict is resolved by the modal that is already on screen. */}
      {display.retryable ? (
        <button type="button" className={lastClass} title={lastTitle} onClick={onRetry}>
          {lastContent}
          <span className="typing-sync-sr">{`${lastLabel} · ${t.syncRetry}`}</span>
        </button>
      ) : (
        <span className={lastClass} title={lastTitle}>
          {lastContent}
          <span className="typing-sync-sr">{lastLabel}</span>
        </span>
      )}
    </div>
  );
}
