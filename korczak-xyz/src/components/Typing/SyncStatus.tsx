import React from 'react';
import type { AuthApi } from '../../hooks/useAuth';

interface SyncStatusProps {
  auth: AuthApi;
  lang: 'en' | 'pl';
}

const translations = {
  en: { synced: 'synced as', signInPrompt: 'Sign in to sync your progress' },
  pl: { synced: 'zsynchronizowano jako', signInPrompt: 'Zaloguj się, aby synchronizować postęp' },
};

export default function SyncStatus({ auth, lang }: SyncStatusProps) {
  const { enabled, user, loading } = auth;
  const t = translations[lang];

  if (!enabled || loading) return null;

  if (user) {
    return (
      <div className="typing-sync typing-sync--in">
        <span className="typing-sync-cloud">☁</span> {t.synced} <strong>{user.email}</strong>
      </div>
    );
  }

  const loginPath =
    lang === 'en' ? '/login/?redirect=/games/typing/' : '/pl/login/?redirect=/pl/games/typing/';
  return (
    <a className="typing-sync typing-sync-link" href={loginPath}>
      {t.signInPrompt} →
    </a>
  );
}
