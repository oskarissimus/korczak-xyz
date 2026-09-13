/*
 * The share tab: who else may write to this list.
 *
 * Three audiences, and they need different pages rather than one page with things disabled:
 *   - signed out, where sharing is not a thing that can be described yet;
 *   - the owner, who manages the list of people;
 *   - an invitee, who has nothing to manage and only needs to know whose list they are in.
 *
 * **The grant is the household's, not this app's.** `shares/{email}` is one top-level document per
 * invited address, and `firestore.rules` names it from every shared collection — the sleep log's and
 * this one's — so adding somebody here gives them both, and revoking takes both away. That is the
 * deliberate shape: a household is a household, and two lists of the same two people that can
 * silently disagree is a worse thing to own than one grant that is honest about its reach. It is
 * also why this tab can work on the day it ships with nobody re-invited. `shareScope` says so on the
 * screen, because a grant that reaches further than the page you granted it on must never be a
 * surprise.
 *
 * A near-copy of `BabySleep/BabySleepShare.tsx` rather than a shared component: that one's `bs-*`
 * classes live in `babySleep.css`, and the two differ in every noun. What is genuinely common — the
 * share document, its key, the rules — is `utils/babySleep/shares.ts` and is imported.
 */

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '../../hooks/useAuth';
import { useDataOwner } from '../../hooks/useDataOwner';
import { describeError, log } from '../../lib/logger';
import { authorLabel } from '../../utils/babySleep/format';
import { normalizeShareEmail, type ShareEmailError } from '../../utils/babySleep/shareKeys';
import { addShare, listShares, removeShare, type Share } from '../../utils/babySleep/shares';
import { fill, localeOf, translations, type Lang } from './translations';

interface ShoppingShareProps {
  lang: Lang;
}

export default function ShoppingShare({ lang }: ShoppingShareProps) {
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
        log.warn('shopping.share.list.failed', describeError(e));
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
      log.warn('shopping.share.add.failed', describeError(e));
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
      log.warn('shopping.share.remove.failed', describeError(e));
      setError(t.shareErrFailed);
    } finally {
      setBusy(false);
    }
  };

  // --- nothing to share with ---------------------------------------------------------------

  /*
   * No Firebase config, so there are no accounts at all and sharing is not a thing that can be
   * offered. Distinct from being signed out, where the answer is a sign-in button — here that button
   * would lead to a form that cannot do anything.
   */
  if (!auth.enabled) {
    return (
      <div className="sl-share">
        <section className="sl-section">
          <h2 className="sl-subhead">{t.shareTitle}</h2>
          <p className="sl-note">{t.shareUnavailable}</p>
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
    return <div className="sl-loading" />;
  }

  // --- signed out --------------------------------------------------------------------------

  if (!auth.user) {
    const loginPath =
      lang === 'en'
        ? '/login/?redirect=/apps/shopping/share/'
        : '/pl/login/?redirect=/pl/apps/shopping/share/';
    return (
      <div className="sl-share">
        <section className="sl-section">
          <h2 className="sl-subhead">{t.shareSignedOutTitle}</h2>
          <p className="sl-note">{t.shareSignedOutBody}</p>
          <a className="sl-action" href={loginPath}>
            {t.shareSignIn}
          </a>
        </section>
      </div>
    );
  }

  // --- the lookup failed -------------------------------------------------------------------

  /*
   * Deliberately distinct from "not shared". `useDataOwner` refuses to guess when it cannot read the
   * share, because guessing wrong writes the household's list into the wrong account — so this state
   * is real and the page has to say what it means rather than showing an empty list.
   */
  if (!owner.resolved && owner.error) {
    return (
      <div className="sl-share">
        <section className="sl-warn" role="status">
          <p className="sl-warn-title">{t.shareUnresolvedTitle}</p>
          <p>{t.shareUnresolvedBody}</p>
          <button type="button" className="sl-action" onClick={owner.retry}>
            {t.shareRetry}
          </button>
        </section>
      </div>
    );
  }

  // --- an invitee --------------------------------------------------------------------------

  if (owner.shared) {
    const ownerName = owner.ownerEmail ? authorLabel(owner.ownerEmail) : t.shareOwnerUnknown;
    return (
      <div className="sl-share">
        <section className="sl-section">
          <h2 className="sl-subhead">{fill(t.shareGuestTitle, { owner: ownerName })}</h2>
          <p className="sl-note">{t.shareGuestBody}</p>
        </section>
      </div>
    );
  }

  // --- the owner ---------------------------------------------------------------------------

  return (
    <div className="sl-share">
      <section className="sl-section">
        <h2 className="sl-subhead">{t.shareTitle}</h2>
        <p className="sl-note">{t.shareIntro}</p>
        <p className="sl-note">{t.shareScope}</p>

        <form className="sl-share-form" onSubmit={submit}>
          <label className="sl-field-label" htmlFor="sl-share-email">
            {t.shareAddLabel}
          </label>
          <div className="sl-share-row">
            <input
              id="sl-share-email"
              className="sl-input"
              type="email"
              autoComplete="off"
              inputMode="email"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy || !owner.resolved}
            />
            <button type="submit" className="sl-action" disabled={busy || !owner.resolved}>
              {busy ? t.shareWorking : t.shareAddButton}
            </button>
          </div>
          <p className="sl-hint">{t.shareAddHint}</p>
        </form>

        {error && (
          <p className="sl-sync sl-sync--error" role="alert">
            ✕ {error}
          </p>
        )}
        {notice && (
          <p className="sl-sync sl-sync--ok" role="status">
            ✓ {notice}
          </p>
        )}
      </section>

      <section className="sl-section">
        <h3 className="sl-subhead">{t.shareListTitle}</h3>
        {shares.length === 0 ? (
          <p className="sl-hint">{loading ? '' : t.shareEmpty}</p>
        ) : (
          <ul className="sl-share-list">
            {shares.map((share) => (
              <li className="sl-share-item" key={share.email}>
                <span className="sl-share-email">{share.email}</span>
                <span className="sl-share-since">
                  {share.createdAt > 0 ? fill(t.shareSince, { date: formatDate(share.createdAt) }) : ''}
                </span>
                <button
                  type="button"
                  className="sl-link"
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
