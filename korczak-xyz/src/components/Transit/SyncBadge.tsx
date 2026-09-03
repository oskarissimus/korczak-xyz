/**
 * The outcome of the last sync attempt, and nothing else.
 *
 * The events app's badge, with this app's strings. Work in flight is deliberately not shown: it is
 * transient, nobody acts on it, and a spinner beside a list you are reading is motion to ignore.
 * What persists — and what can be retried — is a failure.
 */
import type { SyncState } from '../../utils/flashcards/sync';
import { fill, translations, type Lang } from './translations';

interface Props {
  sync: SyncState;
  lang: Lang;
  onRetry?: () => void;
}

export default function SyncBadge({ sync, lang, onRetry }: Props) {
  const t = translations[lang];

  if (sync.status === 'off') return <p className="ev-sync">{t.syncOff}</p>;

  if (sync.status === 'error') {
    return (
      <p className="ev-sync ev-sync--bad">
        ✕ {t.syncFailed}
        {onRetry ? (
          <>
            {' · '}
            <button type="button" className="ev-link" onClick={onRetry}>
              {t.retry}
            </button>
          </>
        ) : null}
      </p>
    );
  }

  if (sync.pending > 0) return <p className="ev-sync">{fill(t.syncPending, { count: sync.pending })}</p>;

  return <p className="ev-sync">✓ {t.syncSynced}</p>;
}
