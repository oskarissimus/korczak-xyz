/*
 * Whether the list reached the account.
 *
 * Shows the outcome of the last attempt and nothing else — the same rule the sleep log and the
 * trainers follow, and for the same reason: work in flight is transient, nobody acts on it, and a
 * spinner is motion to ignore. A failure is what persists and what can be clicked to retry.
 *
 * A near-copy of `BabySleep/SyncBadge.tsx` rather than an import of it: that component's `bs-*`
 * classes live in `babySleep.css`, so reusing it would mean pulling another app's whole stylesheet
 * into these pages to style forty lines.
 */

import type { SyncState } from '../../utils/flashcards/sync';
import { fill } from './translations';
import type { Translation } from './translations';

interface SyncBadgeProps {
  sync: SyncState;
  onRetry: () => void;
  t: Translation;
}

export default function SyncBadge({ sync, onRetry, t }: SyncBadgeProps) {
  if (sync.status === 'off') {
    return <p className="sl-sync sl-sync--quiet">{t.syncSignedOut}</p>;
  }

  if (sync.status === 'error') {
    return (
      <p className="sl-sync sl-sync--error">
        <span>✕ {t.syncError}</span>{' '}
        <button type="button" className="sl-link" onClick={onRetry}>
          {t.syncRetry}
        </button>
      </p>
    );
  }

  if (sync.pending > 0) {
    return <p className="sl-sync sl-sync--quiet">{fill(t.syncPending, { count: sync.pending })}</p>;
  }

  return <p className="sl-sync sl-sync--ok">✓ {t.syncSynced}</p>;
}
