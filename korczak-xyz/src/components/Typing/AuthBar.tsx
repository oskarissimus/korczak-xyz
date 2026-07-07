import React, { useState } from 'react';
import type { AuthApi } from '../../hooks/useAuth';

interface AuthBarLabels {
  signIn: string;
  signOut: string;
  email: string;
  password: string;
  signedInAs: string;
  synced: string;
  signInPrompt: string;
}

interface AuthBarProps {
  auth: AuthApi;
  labels: AuthBarLabels;
}

export function AuthBar({ auth, labels }: AuthBarProps) {
  const { enabled, user, loading, error, signIn, signOut } = auth;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  // Firebase not configured: no auth UI at all.
  if (!enabled) return null;

  if (loading) {
    return <div className="typing-auth typing-auth--muted">…</div>;
  }

  if (user) {
    return (
      <div className="typing-auth">
        <span className="typing-auth-status">
          <span className="typing-auth-synced" title={labels.synced}>
            ☁
          </span>{' '}
          {labels.signedInAs} <strong>{user.email}</strong>
        </span>
        <button className="retro-btn typing-auth-btn" onClick={() => void signOut()}>
          {labels.signOut}
        </button>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await signIn(email, password);
    } catch {
      // error surfaced via auth.error
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="typing-auth">
        <button className="retro-btn typing-auth-btn" onClick={() => setOpen(true)}>
          {labels.signIn}
        </button>
      </div>
    );
  }

  return (
    <form className="typing-auth typing-auth--form" onSubmit={submit}>
      <input
        className="typing-auth-input"
        type="email"
        placeholder={labels.email}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="username"
        required
      />
      <input
        className="typing-auth-input"
        type="password"
        placeholder={labels.password}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        required
      />
      <button className="retro-btn typing-auth-btn" type="submit" disabled={busy}>
        {labels.signIn}
      </button>
      {error && <span className="typing-auth-error">{error}</span>}
    </form>
  );
}
