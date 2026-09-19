/*
 * The admissions panel: every account there is, and the one decision that matters about each.
 *
 * It exists because the alternative is the Firebase console, and the Firebase console does not
 * know what `approved` means — it would be a hand-edited document in a list of collections, at
 * two in the morning, on a phone. This is that edit with the reasoning written next to it.
 *
 * WHAT IT IS NOT: a security boundary. Anyone can open /admin/ and anyone can call these functions
 * from a console; what stops them is `firestore.rules`, where every write here is refused to
 * anybody without a row in `admins/`. The `isAdmin` check below decides what to *draw* — showing a
 * queue of other people's addresses to a stranger would be a leak in itself — and nothing else.
 *
 * Two decisions per account, and they are not the same decision:
 *
 *   APPROVE       lets the account in. Nothing at all works before it, and revoking it takes
 *                 effect on that account's very next query — no token to expire, no hour to wait.
 *   TRUST ADDRESS says the address is really theirs although the provider never verified it. It
 *                 is consulted by exactly one thing, the household share, which is keyed by
 *                 address rather than by uid. Leave it off for anybody who signed up through the
 *                 site: their verification mail is the better evidence, and this flag is here for
 *                 the two accounts that predate all of it.
 */

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '../../hooks/useAuth';
import {
  listAccounts,
  removeAccount,
  setApproved,
  setEmailTrusted,
  type AccountRecord,
} from '../../lib/account';
import { describeError, log } from '../../lib/logger';

interface AdminAccountsProps {
  lang: 'en' | 'pl';
}

const translations = {
  en: {
    intro:
      'Every account that has ever signed in. An account can read and write nothing at all until it is approved here.',
    signedOut: 'Sign in first.',
    notAdmin: 'This page is not for this account.',
    loading: 'Reading…',
    empty: 'No accounts yet.',
    refresh: 'Refresh',
    failed: 'That did not work. Try again.',
    pendingHeading: 'Waiting',
    approvedHeading: 'Approved',
    you: 'you',
    verified: 'address confirmed',
    unverified: 'address not confirmed',
    trusted: 'address trusted by you',
    created: 'signed up',
    lastSeen: 'last seen',
    never: 'never',
    beforePanel: 'before this panel existed',
    approve: 'Approve',
    revoke: 'Revoke',
    trust: 'Trust address',
    untrust: 'Stop trusting',
    remove: 'Forget',
    removeConfirm:
      'Forget this account? They can sign in again and will show up here as waiting. Their data stays where it is.',
    revokeConfirm: 'Revoke access? Their next click stops working.',
    locale: 'en-GB',
  },
  pl: {
    intro:
      'Wszystkie konta, które kiedykolwiek się zalogowały. Konto nie odczyta ani nie zapisze niczego, dopóki go tu nie zatwierdzisz.',
    signedOut: 'Najpierw się zaloguj.',
    notAdmin: 'Ta strona nie jest dla tego konta.',
    loading: 'Czytam…',
    empty: 'Jeszcze nie ma kont.',
    refresh: 'Odśwież',
    failed: 'Nie udało się. Spróbuj jeszcze raz.',
    pendingHeading: 'Czekają',
    approvedHeading: 'Zatwierdzone',
    you: 'ty',
    verified: 'adres potwierdzony',
    unverified: 'adres niepotwierdzony',
    trusted: 'adres zaufany przez ciebie',
    created: 'założone',
    lastSeen: 'ostatnio',
    never: 'nigdy',
    beforePanel: 'sprzed tego panelu',
    approve: 'Zatwierdź',
    revoke: 'Cofnij',
    trust: 'Zaufaj adresowi',
    untrust: 'Przestań ufać',
    remove: 'Zapomnij',
    removeConfirm:
      'Zapomnieć to konto? Będzie mogło zalogować się znowu i pojawi się tu jako czekające. Jego dane zostają.',
    revokeConfirm: 'Cofnąć dostęp? Następne kliknięcie przestanie działać.',
    locale: 'pl-PL',
  },
};

export default function AdminAccounts({ lang }: AdminAccountsProps) {
  const t = translations[lang];
  const { identity, isAdmin, loading: authLoading } = useAuth();

  const [accounts, setAccounts] = useState<AccountRecord[] | null>(null);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      setAccounts(await listAccounts());
    } catch (e) {
      log.warn('account.list.failed', describeError(e));
      setError(t.failed);
      setAccounts([]);
    }
  }, [t.failed]);

  useEffect(() => {
    if (isAdmin) void reload();
  }, [isAdmin, reload]);

  if (authLoading) return <p className="auth-note">{t.loading}</p>;
  if (!identity) return <p className="auth-note">{t.signedOut}</p>;
  if (!isAdmin) return <p className="auth-note">{t.notAdmin}</p>;

  const act = async (uid: string, work: () => Promise<void>) => {
    setBusyUid(uid);
    setError(null);
    try {
      await work();
      await reload();
    } catch (e) {
      log.warn('account.action.failed', describeError(e));
      setError(t.failed);
    } finally {
      setBusyUid(null);
    }
  };

  const date = new Intl.DateTimeFormat(t.locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const when = (ms: number | null) => (ms ? date.format(new Date(ms)) : t.never);
  // The two accounts that existed before any of this was written carry `createdAt: 0` — there is
  // no record of when they were made, and inventing one would be worse than saying so.
  const signedUp = (ms: number) => (ms ? date.format(new Date(ms)) : t.beforePanel);

  const waiting = (accounts ?? []).filter((a) => !a.approved);
  const admitted = (accounts ?? []).filter((a) => a.approved);

  const row = (account: AccountRecord) => {
    const self = account.uid === identity.uid;
    const busy = busyUid === account.uid;
    return (
      <li className="admin-account" key={account.uid}>
        <div className="admin-account-head">
          <strong>{account.email || account.uid}</strong>
          {self && <span className="admin-account-tag">{t.you}</span>}
        </div>
        <div className="admin-account-meta">
          <span className={account.emailVerified ? 'admin-account-ok' : 'admin-account-warn'}>
            {account.emailVerified ? `✓ ${t.verified}` : `! ${t.unverified}`}
          </span>
          {account.emailTrusted && <span className="admin-account-ok">✓ {t.trusted}</span>}
          <span>
            {t.created}: {signedUp(account.createdAt)}
          </span>
          <span>
            {t.lastSeen}: {when(account.lastSeenAt)}
          </span>
        </div>
        <div className="admin-account-actions">
          {account.approved ? (
            // Never on your own row. Revoking yourself is one click from a site that refuses you
            // everything, and the panel that could undo it is the one place it would still work —
            // which is far too subtle a rescue to rely on at the moment it is needed.
            !self && (
              <button
                className="retro-btn"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(t.revokeConfirm)) {
                    void act(account.uid, () => setApproved(account.uid, false));
                  }
                }}
              >
                {t.revoke}
              </button>
            )
          ) : (
            <button
              className="retro-btn"
              disabled={busy}
              onClick={() => void act(account.uid, () => setApproved(account.uid, true))}
            >
              {t.approve}
            </button>
          )}
          {/* Only offered where it changes anything: a verified address is already trusted by the
              rule that consults this, so the control would be a switch wired to nothing. */}
          {!account.emailVerified && (
            <button
              className="retro-btn"
              disabled={busy}
              onClick={() =>
                void act(account.uid, () => setEmailTrusted(account.uid, !account.emailTrusted))
              }
            >
              {account.emailTrusted ? t.untrust : t.trust}
            </button>
          )}
          {!self && (
            <button
              className="retro-btn"
              disabled={busy}
              onClick={() => {
                if (window.confirm(t.removeConfirm)) {
                  void act(account.uid, () => removeAccount(account.uid));
                }
              }}
            >
              {t.remove}
            </button>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="admin-accounts">
      <p className="auth-subtitle">{t.intro}</p>
      <div className="auth-links">
        <button className="retro-btn" onClick={() => void reload()}>
          {t.refresh}
        </button>
      </div>
      {error && <p className="auth-error">{error}</p>}
      {accounts === null ? (
        <p className="auth-note">{t.loading}</p>
      ) : accounts.length === 0 ? (
        <p className="auth-note">{t.empty}</p>
      ) : (
        <>
          {/* Waiting first, always. This page is opened because somebody is waiting. */}
          {waiting.length > 0 && (
            <section>
              <h2 className="admin-accounts-heading">
                {t.pendingHeading} ({waiting.length})
              </h2>
              <ul className="admin-account-list">{waiting.map(row)}</ul>
            </section>
          )}
          {admitted.length > 0 && (
            <section>
              <h2 className="admin-accounts-heading">
                {t.approvedHeading} ({admitted.length})
              </h2>
              <ul className="admin-account-list">{admitted.map(row)}</ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
