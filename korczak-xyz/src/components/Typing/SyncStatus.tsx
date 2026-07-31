import React from 'react';
import type { AuthApi } from '../../hooks/useAuth';

interface SyncStatusProps {
  auth: AuthApi;
  lang: 'en' | 'pl';
}

const translations = {
  en: { signInPrompt: 'Sign in to sync your progress' },
  pl: { signInPrompt: 'Zaloguj się, aby synchronizować postęp' },
};

/* Signed-in state renders nothing: the status bar already shows the account's
   email, so a second banner here only cost the trainer a row. */
export default function SyncStatus({ auth, lang }: SyncStatusProps) {
  const { enabled, user, loading } = auth;
  const t = translations[lang];

  if (!enabled || loading || user) return null;

  const loginPath =
    lang === 'en' ? '/login/?redirect=/games/typing/' : '/pl/login/?redirect=/pl/games/typing/';
  return (
    <a className="typing-sync typing-sync-link" href={loginPath}>
      {t.signInPrompt} →
    </a>
  );
}
