/*
 * Whether the practice reached the account.
 *
 * Shows the outcome of the last attempt and nothing else — the same rule the typing and fretboard
 * trainers' indicators follow, and for the same reason: work in flight is transient, nobody acts on
 * it, and a spinner on the start screen is motion to ignore. A failure is what persists and what
 * can be clicked to retry.
 */

import { fill, type Translation } from './translations';
import type { SyncState } from '../../hooks/useTransposeData';

interface SyncBadgeProps {
  sync: SyncState;
  onRetry: () => void;
  t: Translation;
}

export default function SyncBadge({ sync, onRetry, t }: SyncBadgeProps) {
  if (sync.status === 'off') {
    return <p className="tp-sync tp-sync--quiet">{t.syncSignedOut}</p>;
  }

  if (sync.status === 'error') {
    return (
      <p className="tp-sync tp-sync--error">
        <span>✕ {t.syncError}</span>{' '}
        <button type="button" className="tp-link" onClick={onRetry}>
          {t.syncRetry}
        </button>
      </p>
    );
  }

  if (sync.pending > 0) {
    return <p className="tp-sync tp-sync--quiet">{fill(t.syncPending, { count: sync.pending })}</p>;
  }

  return <p className="tp-sync tp-sync--ok">✓ {t.syncSynced}</p>;
}
