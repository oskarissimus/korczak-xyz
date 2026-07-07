import React from 'react';
import { useAuth } from '../../hooks/useAuth';

interface NavAuthProps {
  lang: 'en' | 'pl';
}

const translations = {
  en: { login: 'Login', logout: 'Logout' },
  pl: { login: 'Zaloguj', logout: 'Wyloguj' },
};

export default function NavAuth({ lang }: NavAuthProps) {
  const { enabled, user, loading, signOut } = useAuth();
  const t = translations[lang];
  const loginPath = lang === 'en' ? '/login/' : '/pl/login/';

  // Nothing to show until Firebase is configured and auth state resolves.
  if (!enabled || loading) return null;

  if (user) {
    const handleLogout = async () => {
      await signOut();
      window.location.reload();
    };
    return (
      <div className="nav-auth nav-auth--in">
        <span className="nav-auth-email" title={user.email ?? undefined}>
          {user.email}
        </span>
        <button className="nav-auth-btn" onClick={handleLogout}>
          {t.logout}
        </button>
      </div>
    );
  }

  return (
    <a href={loginPath} className="nav-auth nav-auth-login">
      <span className="nav-icon">⚿</span>
      <span>{t.login}</span>
    </a>
  );
}
