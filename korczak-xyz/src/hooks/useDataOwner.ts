/*
 * Which account's baby sleep log this session is looking at.
 *
 * Usually your own. But a log can be shared, and the share is recorded against the *invitee's*
 * address (`shares/{email}` → `ownerUid`), so the answer is not in the auth token — it takes a read.
 * Everything that touches Firestore therefore has to wait for this hook before it does anything, and
 * `dataUid` is what it must use in place of `user.uid`.
 *
 * The failure mode this exists to prevent: a failed lookup **must not** fall back to the user's own
 * uid. "I could not tell" and "you have no share" look identical from the fallback's side, and
 * getting it wrong means the invitee's device decides it owns a private log, then pushes the
 * household's entries into her own subtree where nobody will ever see them again. So a failure
 * leaves `resolved` false — sync stays off, the log stays local, and the UI can offer a retry.
 */

import { useCallback, useEffect, useState } from 'react';

import { describeError, log } from '../lib/logger';
import { loadShare } from '../utils/babySleep/shares';
import type { AuthUser } from './useAuth';

export interface DataOwner {
  /** False until the question is settled. Nothing may read or write the cloud before it is true. */
  resolved: boolean;
  /** The uid whose subtree holds the log, or null when signed out. */
  dataUid: string | null;
  /** Whether that uid belongs to somebody else. */
  shared: boolean;
  /** The owner's address, when reading a shared log — for "you are logging into X's log". */
  ownerEmail: string | null;
  error: string | null;
  retry: () => void;
}

const SIGNED_OUT: Omit<DataOwner, 'retry'> = {
  resolved: true,
  dataUid: null,
  shared: false,
  ownerEmail: null,
  error: null,
};

export function useDataOwner(user: AuthUser | null): DataOwner {
  const [state, setState] = useState<Omit<DataOwner, 'retry'>>(SIGNED_OUT);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!user) {
      setState(SIGNED_OUT);
      return;
    }

    // A stale resolution belongs to the previous account and must not be acted on: the effect can
    // be re-entered by a sign-out and sign-in before the first read comes back.
    let cancelled = false;
    setState((s) => ({ ...s, resolved: false, error: null }));

    void (async () => {
      try {
        const share = await loadShare(user.email);
        if (cancelled) return;
        setState({
          resolved: true,
          dataUid: share ? share.ownerUid : user.uid,
          shared: share != null,
          ownerEmail: share?.ownerEmail ?? null,
          error: null,
        });
        if (share) log.info('babySleep.owner.shared', { ownerUid: share.ownerUid });
      } catch (e) {
        if (cancelled) return;
        log.warn('babySleep.owner.failed', describeError(e));
        setState({
          resolved: false,
          dataUid: null,
          shared: false,
          ownerEmail: null,
          error: String(describeError(e).message ?? 'could not resolve the log owner'),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, attempt]);

  return { ...state, retry };
}
