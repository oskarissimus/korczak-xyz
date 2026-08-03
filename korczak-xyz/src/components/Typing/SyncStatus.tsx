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

function failLabel(display: SyncDisplay, t: T): string {
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
 * It says one thing now: how the last attempt ended. A tick when progress is on the account,
 * and a red cross with how long it has been failing when it is not. The states in between -
 * a write in flight, keystrokes waiting on the debounce - are not shown, because they are
 * transient by construction and a spinner beside the passage is motion someone typing has to
 * ignore. A failure is the state that persists and the only one worth acting on, so it is the
 * only one that speaks.
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

  // Nothing has settled yet - the first reconcile of the session is still running. The slot is
  // held open at its width so the tick can appear without moving the picker.
  if (display.outcome === 'none') return <div className="typing-sync-slot" aria-hidden="true" />;

  const ago = display.at != null ? formatAgo(display.at, t) : null;
  const exactTime = display.at != null ? new Date(display.at).toLocaleTimeString() : null;

  const ok = display.outcome === 'ok';
  const title =
    exactTime == null
      ? undefined
      : ok
        ? `${t.syncTitleSynced} ${exactTime}`
        : `${t.syncTitleFailed} ${exactTime}${display.retryable ? ` · ${t.syncRetry}` : ''}`;

  // A tick alone when it worked: the time it happened is in the tooltip, and a green tick that
  // ages in place is noise on a row someone reads to pick a book. A failure earns its words.
  const label = ok ? null : `${failLabel(display, t)}${ago ? ` · ${ago}` : ''}`;

  // The glyph and the abbreviated label are for the eye; the sentence beside them, unstyled and
  // off-screen, is what a screen reader gets. Reading "✕ 2 min ago" aloud says nothing.
  const srLabel = ok
    ? `${t.syncSynced}${ago ? ` · ${ago}` : ''}`
    : `${label}${display.retryable ? ` · ${t.syncRetry}` : ''}`;

  const className = `typing-sync-cell ${ok ? 'typing-sync--ok' : 'typing-sync--error'}`;

  const content = (
    <>
      <span className="typing-sync-glyph" aria-hidden="true">
        {ok ? '✓' : '✕'}
      </span>
      {label && (
        <span className="typing-sync-ago" aria-hidden="true">
          {label}
        </span>
      )}
      <span className="typing-sync-sr">{srLabel}</span>
    </>
  );

  // Not a live region: with a debounce of 1.5s the engine settles several times a minute while
  // someone types, and announcing each one would talk over the thing they are typing. The state
  // is readable on demand instead, from the text the cell carries.
  //
  // A button only when clicking it would do something - a conflict is resolved by the modal
  // that is already on screen.
  return (
    <div className="typing-sync typing-sync-slot">
      {display.retryable ? (
        <button type="button" className={className} title={title} onClick={onRetry}>
          {content}
        </button>
      ) : (
        <span className={className} title={title}>
          {content}
        </span>
      )}
    </div>
  );
}
