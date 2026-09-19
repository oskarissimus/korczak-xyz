/*
 * The login page, which is four pages in a trench coat.
 *
 * Signed out it offers two things rather than one: signing in, and creating an account — the
 * second of which was impossible until September 2026, when sign-up stopped being switched off at
 * the Identity Platform level and started being gated by a decision the owner makes.
 *
 * The state worth thinking about is the third one. An account that has been created and not yet
 * approved is *signed in*: the token is real, Firebase is happy, and every single read and write
 * to Firestore or Storage is refused. Without a screen that says so, the site that account sees is
 * one where nothing saves and nothing explains why — so `status === 'pending'` gets a page of its
 * own, and `useAuth` deliberately reports `user: null` to every app so none of them try.
 */

import React, { useState } from 'react';
import { useAuth, type AuthErrorCode } from '../../hooks/useAuth';

interface LoginFormProps {
  lang: 'en' | 'pl';
}

const translations = {
  en: {
    heading: 'Login',
    subtitle: 'Sign in to sync your progress across devices.',
    email: 'Email',
    password: 'Password',
    repeat: 'Repeat password',
    signIn: 'Sign in',
    signingIn: 'Signing in…',
    signOut: 'Sign out',
    signedInAs: 'Signed in as',
    home: 'Home',
    typing: 'Typing Trainer',
    admin: 'Accounts',
    unavailable: 'Login is not configured.',
    tabSignIn: 'Sign in',
    tabSignUp: 'Create account',
    signUpSubtitle:
      'Anyone can make an account here. Nothing works until Oskar approves it by hand — that is on purpose.',
    createAccount: 'Create account',
    creating: 'Creating…',
    mismatch: 'The two passwords are different.',
    pendingHeading: 'Waiting for approval',
    pendingBody:
      'Your account exists and you are signed in. It cannot read or write anything until Oskar approves it — this page will change by itself the moment he does.',
    pendingVerified: 'Email address confirmed.',
    pendingUnverified: 'Check your inbox and confirm your address — approval usually waits for it.',
    resend: 'Send that email again',
    resent: 'Sent. Check your inbox.',
    resendFailed: 'Could not send it. Try again in a minute.',
    accountUnreadable: 'Could not check your account just now. Reload the page in a moment.',
    errors: {
      'invalid-credential': 'Invalid email or password.',
      'too-many-requests': 'Too many attempts. Try again later.',
      'email-in-use': 'That address already has an account. Sign in instead.',
      'weak-password': 'Password too short — use at least six characters.',
      'invalid-email': 'That does not look like an email address.',
      'signup-disabled': 'New accounts are switched off at the moment.',
      failed: 'That did not work.',
    } satisfies Record<AuthErrorCode, string>,
  },
  pl: {
    heading: 'Logowanie',
    subtitle: 'Zaloguj się, aby synchronizować postęp między urządzeniami.',
    email: 'E-mail',
    password: 'Hasło',
    repeat: 'Powtórz hasło',
    signIn: 'Zaloguj się',
    signingIn: 'Logowanie…',
    signOut: 'Wyloguj',
    signedInAs: 'Zalogowano jako',
    home: 'Strona główna',
    typing: 'Trening Pisania',
    admin: 'Konta',
    unavailable: 'Logowanie nie jest skonfigurowane.',
    tabSignIn: 'Logowanie',
    tabSignUp: 'Nowe konto',
    signUpSubtitle:
      'Konto może założyć każdy. Nic nie działa, dopóki Oskar go ręcznie nie zatwierdzi — i tak ma być.',
    createAccount: 'Załóż konto',
    creating: 'Zakładam…',
    mismatch: 'Hasła się różnią.',
    pendingHeading: 'Czeka na zatwierdzenie',
    pendingBody:
      'Konto istnieje i jesteś zalogowany. Nic nie odczyta ani nie zapisze, dopóki Oskar go nie zatwierdzi — ta strona zmieni się sama, gdy to zrobi.',
    pendingVerified: 'Adres e-mail potwierdzony.',
    pendingUnverified: 'Sprawdź skrzynkę i potwierdź adres — zwykle to warunek zatwierdzenia.',
    resend: 'Wyślij ten e-mail jeszcze raz',
    resent: 'Wysłane. Sprawdź skrzynkę.',
    resendFailed: 'Nie udało się wysłać. Spróbuj za chwilę.',
    accountUnreadable: 'Nie udało się teraz sprawdzić konta. Odśwież stronę za moment.',
    errors: {
      'invalid-credential': 'Nieprawidłowy e-mail lub hasło.',
      'too-many-requests': 'Za dużo prób. Spróbuj później.',
      'email-in-use': 'Na ten adres jest już konto. Zaloguj się.',
      'weak-password': 'Hasło za krótkie — użyj co najmniej sześciu znaków.',
      'invalid-email': 'To nie wygląda na adres e-mail.',
      'signup-disabled': 'Zakładanie kont jest teraz wyłączone.',
      failed: 'Nie udało się.',
    } satisfies Record<AuthErrorCode, string>,
  },
};

// Only allow same-origin path redirects (must start with a single slash).
function safeRedirect(): string | null {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('redirect');
  if (raw && /^\/(?!\/)/.test(raw)) return raw;
  return null;
}

export default function LoginForm({ lang }: LoginFormProps) {
  const {
    enabled,
    user,
    identity,
    status,
    account,
    accountError,
    isAdmin,
    loading,
    error,
    signIn,
    signUp,
    signOut,
    resendVerification,
  } = useAuth();
  const t = translations[lang];
  const homePath = lang === 'en' ? '/' : '/pl/';
  const typingPath = lang === 'en' ? '/apps/typing/' : '/pl/apps/typing/';
  const adminPath = lang === 'en' ? '/apps/admin/' : '/pl/apps/admin/';

  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [resendNote, setResendNote] = useState<string | null>(null);

  if (!enabled) {
    return <p className="auth-note">{t.unavailable}</p>;
  }

  if (loading) {
    return <p className="auth-note">…</p>;
  }

  if (user) {
    return (
      <div className="auth-card">
        <p className="auth-signedin">
          <span className="auth-cloud">☁</span> {t.signedInAs} <strong>{user.email}</strong>
        </p>
        <div className="auth-links">
          <a className="retro-btn" href={homePath}>
            {t.home}
          </a>
          <a className="retro-btn" href={typingPath}>
            {t.typing}
          </a>
          {/* Only an admin has anywhere to go, and only an admin is told the page exists. The
              page itself does not take this on trust — see AdminAccounts. */}
          {isAdmin && (
            <a className="retro-btn" href={adminPath}>
              {t.admin}
            </a>
          )}
          <button className="retro-btn" onClick={() => void signOut()}>
            {t.signOut}
          </button>
        </div>
      </div>
    );
  }

  if (status === 'pending' && identity) {
    const resend = async () => {
      setResendNote(null);
      const sent = await resendVerification();
      setResendNote(sent ? t.resent : t.resendFailed);
    };

    return (
      <div className="auth-card">
        <p className="auth-signedin">
          <strong>⏳ {t.pendingHeading}</strong>
        </p>
        <p className="auth-subtitle">{t.pendingBody}</p>
        <p className="auth-signedin">{identity.email}</p>
        {accountError && <p className="auth-error">{t.accountUnreadable}</p>}
        <p className="auth-subtitle">
          {account?.emailVerified ? `✓ ${t.pendingVerified}` : t.pendingUnverified}
        </p>
        <div className="auth-links">
          {!account?.emailVerified && (
            <button className="retro-btn" onClick={() => void resend()}>
              {t.resend}
            </button>
          )}
          <button className="retro-btn" onClick={() => void signOut()}>
            {t.signOut}
          </button>
        </div>
        {resendNote && <p className="auth-note">{resendNote}</p>}
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (mode === 'up' && password !== repeat) {
      setLocalError(t.mismatch);
      return;
    }
    setBusy(true);
    try {
      if (mode === 'up') {
        // No redirect: creating an account signs it in, and where it lands is the waiting screen
        // above rather than wherever the person was trying to get to.
        await signUp(email, password);
        setBusy(false);
      } else {
        await signIn(email, password);
        window.location.href = safeRedirect() ?? homePath;
      }
    } catch {
      setBusy(false); // error surfaced via auth.error
    }
  };

  const switchTo = (next: 'in' | 'up') => {
    setMode(next);
    setLocalError(null);
    setRepeat('');
  };

  return (
    <form className="auth-card auth-form" onSubmit={submit}>
      <div className="auth-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'in'}
          className={`auth-tab${mode === 'in' ? ' auth-tab--on' : ''}`}
          onClick={() => switchTo('in')}
        >
          {t.tabSignIn}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'up'}
          className={`auth-tab${mode === 'up' ? ' auth-tab--on' : ''}`}
          onClick={() => switchTo('up')}
        >
          {t.tabSignUp}
        </button>
      </div>
      <p className="auth-subtitle">{mode === 'up' ? t.signUpSubtitle : t.subtitle}</p>
      <label className="auth-field">
        <span>{t.email}</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
          autoFocus
        />
      </label>
      <label className="auth-field">
        <span>{t.password}</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
          required
        />
      </label>
      {mode === 'up' && (
        <label className="auth-field">
          <span>{t.repeat}</span>
          {/* There is no password reset on this site. A typo that nobody catches here is an
              account that can never be signed into again, so the second field earns its place. */}
          <input
            type="password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            autoComplete="new-password"
            required
          />
        </label>
      )}
      <button className="retro-btn auth-submit" type="submit" disabled={busy}>
        {mode === 'up' ? (busy ? t.creating : t.createAccount) : busy ? t.signingIn : t.signIn}
      </button>
      {(localError || error) && <p className="auth-error">{localError ?? t.errors[error!]}</p>}
    </form>
  );
}
