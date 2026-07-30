import React from 'react';
import { useAuth } from '../../hooks/useAuth';

interface NavAuthProps {
  lang: 'en' | 'pl';
  // 'control': Login/Logout button in the nav row.
  // 'identity': logged-in user's email, for the status bar.
  variant?: 'control' | 'identity';
}

const translations = {
  en: { login: 'Login', logout: 'Logout' },
  pl: { login: 'Zaloguj', logout: 'Wyloguj' },
};

// Shorten an email to fit a narrow status bar. Elides the local part rather than the
// tail, since the domain identifies the account better than the last few characters of
// the name: oskar.jan.korczak@gmail.com -> oskar…@gmail.com
export function foldEmail(email: string, maxLen: number): string {
  if (email.length <= maxLen) return email;

  const at = email.lastIndexOf('@');
  if (at > 0) {
    const domain = email.slice(at);
    const head = maxLen - domain.length - 1; // -1 for the ellipsis
    if (head >= 2) return `${email.slice(0, head)}…${domain}`;
  }

  return `${email.slice(0, Math.max(1, maxLen - 1))}…`;
}

export default function NavAuth({ lang, variant = 'control' }: NavAuthProps) {
  const { enabled, user, loading, signOut } = useAuth();
  const t = translations[lang];
  const loginPath = lang === 'en' ? '/login/' : '/pl/login/';

  // Nothing to show until Firebase is configured and auth state resolves.
  if (!enabled || loading) return null;

  // Identity variant: just the email (for the status bar); nothing when logged out.
  if (variant === 'identity') {
    if (!user) return null;
    const email = user.email ?? '';
    return (
      <span className="nav-auth-email" title={email}>
        <span className="nav-auth-email--full">{email}</span>
        <span className="nav-auth-email--short">{foldEmail(email, 15)}</span>
      </span>
    );
  }

  // Control variant: Login link or Logout button in the nav row.
  if (user) {
    const handleLogout = async () => {
      await signOut();
      window.location.reload();
    };
    return (
      <button className="nav-auth-btn" onClick={handleLogout}>
        {t.logout}
      </button>
    );
  }

  return (
    <a href={loginPath} className="nav-auth nav-auth-login">
      <span className="nav-icon">⚿</span>
      <span>{t.login}</span>
    </a>
  );
}
