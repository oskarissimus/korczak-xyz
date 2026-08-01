import React, { useEffect, useState } from 'react';
import type { AuthApi } from '../../hooks/useAuth';
import type { SyncState } from '../../utils/typing/syncEngine';
import { translations, type Lang } from './translations';

interface SyncStatusProps {
  auth: AuthApi;
  sync: SyncState;
  lang: Lang;
  onRetry: () => void;
}

// How often the "2 min ago" text is recomputed. Deliberately not tied to renders of the
// typing session: this component sits in the same tree as the passage, and the whole point
// of a ticking clock here is that it must not cost anything per keystroke.
const RELATIVE_TIME_TICK_MS = 30_000;

// Re-render on a slow timer so "2 min ago" keeps up. No interval runs when there is no
// timestamp to age, which is every state except the settled one.
function useAgingLabel(timestamp: number | null): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (timestamp == null) return;
    const id = setInterval(() => setTick((n) => n + 1), RELATIVE_TIME_TICK_MS);
    return () => clearInterval(id);
  }, [timestamp]);
}

function formatAgo(timestamp: number, t: (typeof translations)[Lang]): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return t.syncJustNow;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} ${t.syncMinutesAgo}`;
  return `${Math.round(minutes / 60)} ${t.syncHoursAgo}`;
}

/*
 * Whether progress is actually reaching the account, shown next to the book picker.
 *
 * This used to render nothing at all while signed in, on the reasoning that the status bar's
 * email already said "you are signed in". It does - but being signed in was never the same
 * thing as being saved, and when the two came apart there was nothing on the page that said
 * so. A whole session's progress could fail to upload without a single pixel changing.
 */
export default function SyncStatus({ auth, sync, lang, onRetry }: SyncStatusProps) {
  const { enabled, user, loading } = auth;
  const t = translations[lang];
  useAgingLabel(sync.status === 'synced' ? sync.lastSyncedAt : null);

  if (!enabled) return null;

  if (!user) {
    if (loading) return null;
    const loginPath =
      lang === 'en' ? '/login/?redirect=/games/typing/' : '/pl/login/?redirect=/pl/games/typing/';
    return (
      <a className="typing-sync typing-sync-link" href={loginPath}>
        {t.syncSignIn} →
      </a>
    );
  }

  switch (sync.status) {
    case 'disabled':
      return null;

    case 'starting':
      return (
        <span className="typing-sync typing-sync-state typing-sync--busy">
          <span className="typing-sync-dot" aria-hidden="true" />
          {t.syncChecking}
        </span>
      );

    case 'syncing':
      return (
        <span className="typing-sync typing-sync-state typing-sync--busy">
          <span className="typing-sync-dot" aria-hidden="true" />
          {t.syncSyncing}
        </span>
      );

    case 'pending':
      return (
        <span className="typing-sync typing-sync-state typing-sync--pending">
          <span className="typing-sync-dot" aria-hidden="true" />
          {t.syncPending}
        </span>
      );

    case 'offline':
      return (
        <span className="typing-sync typing-sync-state typing-sync--warn">
          <span className="typing-sync-dot" aria-hidden="true" />
          {t.syncOffline}
        </span>
      );

    case 'error':
      return (
        <button
          type="button"
          className="typing-sync typing-sync-state typing-sync--error"
          onClick={onRetry}
        >
          <span className="typing-sync-dot" aria-hidden="true" />
          {t.syncFailed} · {t.syncRetry}
        </button>
      );

    // Not a button: the dialog that resolves this is already on screen and modal, so there
    // is nothing here for a click to open.
    case 'conflict':
      return (
        <span className="typing-sync typing-sync-state typing-sync--error">
          <span className="typing-sync-dot" aria-hidden="true" />
          {t.syncConflict}
        </span>
      );

    case 'synced':
    default: {
      const at = sync.lastSyncedAt;
      return (
        <span
          className="typing-sync typing-sync-state typing-sync--ok"
          // The exact time on hover: "2 min ago" is the right density for a glance, but when
          // something has gone wrong the precise moment is what you need.
          title={at ? `${t.syncTitleSynced} ${new Date(at).toLocaleTimeString()}` : undefined}
        >
          <span className="typing-sync-dot" aria-hidden="true" />
          {t.syncSynced}
          {at ? ` · ${formatAgo(at, t)}` : ''}
        </span>
      );
    }
  }
}
