/*
 * The share tab: who else may write to this log.
 *
 * Three audiences, and they need different pages rather than one page with things disabled:
 *   - signed out, where sharing is not a thing that can be described yet;
 *   - the owner, who manages the list;
 *   - an invitee, who has nothing to manage and only needs to know whose log she is in.
 *
 * The list is read on mount and kept in local state rather than re-read after every change. There is
 * one writer — the owner, here — so the optimistic copy cannot drift from the server the way a
 * shared document could.
 */

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '../../hooks/useAuth';
import { useDataOwner } from '../../hooks/useDataOwner';
import { describeError, log } from '../../lib/logger';
import { authorLabel } from '../../utils/babySleep/format';
import { normalizeShareEmail, type ShareEmailError } from '../../utils/babySleep/shareKeys';
import { addShare, listShares, removeShare, type Share } from '../../utils/babySleep/shares';
import { fill, localeOf, translations, type Lang } from './translations';

interface BabySleepShareProps {
  lang: Lang;
}

export default function BabySleepShare({ lang }: BabySleepShareProps) {
  const t = translations[lang];
  const auth = useAuth();
  const owner = useDataOwner(auth.user);

  const [shares, setShares] = useState<Share[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const uid = auth.user?.uid ?? null;
  // Only an owner has a list. An invitee's own uid owns nothing, and asking for it would be a query
  // that returns nothing at best.
  const isOwner = owner.resolved && !owner.shared && uid != null;

  useEffect(() => {
    if (!isOwner || !uid) {
      setShares([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const found = await listShares(uid);
        if (!cancelled) setShares(found);
      } catch (e) {
        log.warn('babySleep.share.list.failed', describeError(e));
        if (!cancelled) setError(t.shareErrFailed);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOwner, uid, t.shareErrFailed]);

  const messageFor = useCallback(
    (code: ShareEmailError): string =>
      code === 'empty'
        ? t.shareErrEmpty
        : code === 'self'
          ? t.shareErrSelf
          : code === 'too-long'
            ? t.shareErrTooLong
            : t.shareErrMalformed,
    [t]
  );

  const formatDate = new Intl.DateTimeFormat(localeOf(lang), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!uid || busy) return;
    setError(null);
    setNotice(null);

    const result = normalizeShareEmail(draft, auth.user?.email);
    if (result.error) {
      setError(messageFor(result.error));
      return;
    }

    setBusy(true);
    try {
      const share = await addShare(uid, auth.user?.email ?? null, result.email);
      // Replace rather than append: re-sharing an address that is already on the list is a legal
      // thing to do and must not put it there twice.
      setShares((prev) => [...prev.filter((s) => s.email !== share.email), share]);
      setDraft('');
      setNotice(fill(t.shareAdded, { email: share.email }));
    } catch (e) {
      log.warn('babySleep.share.add.failed', describeError(e));
      setError(t.shareErrFailed);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (email: string) => {
    if (busy) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await removeShare(email);
      setShares((prev) => prev.filter((s) => s.email !== email));
      setNotice(t.shareRevoked);
    } catch (e) {
      log.warn('babySleep.share.remove.failed', describeError(e));
      setError(t.shareErrFailed);
    } finally {
      setBusy(false);
    }
  };

  // --- nothing to share with ---------------------------------------------------------------------

  /*
   * No Firebase config, so there are no accounts at all and sharing is not a thing that can be
   * offered. Distinct from being signed out, where the answer is a sign-in button — here that button
   * would lead to a form that cannot do anything.
   */
  if (!auth.enabled) {
    return (
      <div className="bs-share">
        <section className="bs-section">
          <h2 className="bs-subhead">{t.shareTitle}</h2>
          <p className="bs-note">{t.shareUnavailable}</p>
        </section>
      </div>
    );
  }

  /*
   * Still resolving. Both of these render nothing rather than a disabled form: the owner panel is
   * the branch below, and showing it before the answer is known offers a share box to somebody who
   * may turn out to be an invitee with nothing to manage.
   */
  if (auth.loading || (auth.user && !owner.resolved && !owner.error)) {
    return <div className="bs-loading" />;
  }

  // --- signed out ------------------------------------------------------------------------------

  if (!auth.user) {
    const loginPath =
      lang === 'en'
        ? '/login/?redirect=/apps/baby-sleep/share/'
        : '/pl/login/?redirect=/pl/apps/baby-sleep/share/';
    return (
      <div className="bs-share">
        <section className="bs-section">
          <h2 className="bs-subhead">{t.shareSignedOutTitle}</h2>
          <p className="bs-note">{t.shareSignedOutBody}</p>
          <a className="bs-action" href={loginPath}>
            {t.shareSignIn}
          </a>
        </section>
      </div>
    );
  }

  // --- the lookup failed -----------------------------------------------------------------------

  /*
   * Deliberately distinct from "not shared". `useDataOwner` refuses to guess when it cannot read the
   * share, because guessing wrong writes the household's entries into the wrong account — so this
   * state is real and the page has to say what it means rather than showing an empty list.
   */
  if (!owner.resolved && owner.error) {
    return (
      <div className="bs-share">
        <section className="bs-warn" role="status">
          <p className="bs-warn-title">{t.shareUnresolvedTitle}</p>
          <p>{t.shareUnresolvedBody}</p>
          <button type="button" className="bs-action" onClick={owner.retry}>
            {t.shareRetry}
          </button>
        </section>
      </div>
    );
  }

  // --- an invitee ------------------------------------------------------------------------------

  if (owner.shared) {
    const ownerName = owner.ownerEmail ? authorLabel(owner.ownerEmail) : t.shareOwnerUnknown;
    return (
      <div className="bs-share">
        <section className="bs-section">
          <h2 className="bs-subhead">{fill(t.shareGuestTitle, { owner: ownerName })}</h2>
          <p className="bs-note">{t.shareGuestBody}</p>
        </section>
      </div>
    );
  }

  // --- the owner -------------------------------------------------------------------------------

  return (
    <div className="bs-share">
      <section className="bs-section">
        <h2 className="bs-subhead">{t.shareTitle}</h2>
        <p className="bs-note">{t.shareIntro}</p>

        <form className="bs-share-form" onSubmit={submit}>
          <label className="bs-field-label" htmlFor="bs-share-email">
            {t.shareAddLabel}
          </label>
          <div className="bs-share-row">
            <input
              id="bs-share-email"
              className="bs-share-input"
              type="email"
              autoComplete="off"
              inputMode="email"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy || !owner.resolved}
            />
            <button type="submit" className="bs-action" disabled={busy || !owner.resolved}>
              {busy ? t.shareWorking : t.shareAddButton}
            </button>
          </div>
          <p className="bs-hint">{t.shareAddHint}</p>
        </form>

        {error && (
          <p className="bs-sync bs-sync--error" role="alert">
            ✕ {error}
          </p>
        )}
        {notice && (
          <p className="bs-sync bs-sync--ok" role="status">
            ✓ {notice}
          </p>
        )}
      </section>

      <section className="bs-section">
        <h3 className="bs-subhead">{t.shareListTitle}</h3>
        {shares.length === 0 ? (
          <p className="bs-hint">{loading ? '' : t.shareEmpty}</p>
        ) : (
          <ul className="bs-share-list">
            {shares.map((share) => (
              <li className="bs-share-item" key={share.email}>
                <span className="bs-share-email">{share.email}</span>
                <span className="bs-share-since">
                  {share.createdAt > 0 ? fill(t.shareSince, { date: formatDate(share.createdAt) }) : ''}
                </span>
                <button
                  type="button"
                  className="bs-link"
                  onClick={() => void revoke(share.email)}
                  disabled={busy}
                >
                  {t.shareRevoke}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
