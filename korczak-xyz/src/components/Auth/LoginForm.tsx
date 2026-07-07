import React, { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';

interface LoginFormProps {
  lang: 'en' | 'pl';
}

const translations = {
  en: {
    heading: 'Login',
    subtitle: 'Sign in to sync your progress across devices.',
    email: 'Email',
    password: 'Password',
    signIn: 'Sign in',
    signingIn: 'Signing in…',
    signOut: 'Sign out',
    signedInAs: 'Signed in as',
    home: 'Home',
    typing: 'Typing Trainer',
    unavailable: 'Login is not configured.',
  },
  pl: {
    heading: 'Logowanie',
    subtitle: 'Zaloguj się, aby synchronizować postęp między urządzeniami.',
    email: 'E-mail',
    password: 'Hasło',
    signIn: 'Zaloguj się',
    signingIn: 'Logowanie…',
    signOut: 'Wyloguj',
    signedInAs: 'Zalogowano jako',
    home: 'Strona główna',
    typing: 'Trening Pisania',
    unavailable: 'Logowanie nie jest skonfigurowane.',
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
  const { enabled, user, loading, error, signIn, signOut } = useAuth();
  const t = translations[lang];
  const homePath = lang === 'en' ? '/' : '/pl/';
  const typingPath = lang === 'en' ? '/games/typing/' : '/pl/games/typing/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

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
          <button className="retro-btn" onClick={() => void signOut()}>
            {t.signOut}
          </button>
        </div>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await signIn(email, password);
      window.location.href = safeRedirect() ?? homePath;
    } catch {
      setBusy(false); // error surfaced via auth.error
    }
  };

  return (
    <form className="auth-card auth-form" onSubmit={submit}>
      <p className="auth-subtitle">{t.subtitle}</p>
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
          autoComplete="current-password"
          required
        />
      </label>
      <button className="retro-btn auth-submit" type="submit" disabled={busy}>
        {busy ? t.signingIn : t.signIn}
      </button>
      {error && <p className="auth-error">{error}</p>}
    </form>
  );
}
