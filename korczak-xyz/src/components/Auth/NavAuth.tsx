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

export default function NavAuth({ lang, variant = 'control' }: NavAuthProps) {
  const { enabled, user, loading, signOut } = useAuth();
  const t = translations[lang];
  const loginPath = lang === 'en' ? '/login/' : '/pl/login/';

  // Nothing to show until Firebase is configured and auth state resolves.
  if (!enabled || loading) return null;

  // Identity variant: just the email (for the status bar); nothing when logged out.
  if (variant === 'identity') {
    if (!user) return null;
    return (
      <span className="nav-auth-email" title={user.email ?? undefined}>
        {user.email}
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
