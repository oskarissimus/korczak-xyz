import React, { useLayoutEffect, useRef, useState } from 'react';
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

// Shorter than this the address says nothing useful; below it the CSS ellipsis takes over.
const MIN_FOLD_LEN = 6;

// The email shown in the status bar. Folds only as much as the line actually requires,
// so a wide bar shows the whole address and a cramped one gives up characters one at a
// time. Measured rather than guessed from a breakpoint, because how much room is left
// depends on the commit hash and the timestamp beside it, which vary by locale.
function StatusBarEmail({ email }: { email: string }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const [text, setText] = useState(email);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    // The span is nowrap + overflow:hidden and is the flex item that gives way first, so
    // it is clipped exactly when the text does not fit. Candidates go straight into the
    // DOM: React state cannot be read back synchronously, and every probe is followed by
    // a write of the final string, so the two never disagree.
    const fits = (candidate: string) => {
      el.textContent = candidate;
      return el.scrollWidth <= el.clientWidth;
    };

    const commit = (final: string) => {
      el.textContent = final;
      setText(final);
    };

    const fit = () => {
      if (fits(email)) {
        commit(email);
        return;
      }

      // Largest maxLen that still fits. Folding is monotone in maxLen, so binary search
      // lands on the answer in ~5 layout reads.
      let lo = MIN_FOLD_LEN;
      let hi = email.length;
      let best = MIN_FOLD_LEN;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (fits(foldEmail(email, mid))) {
          best = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      commit(foldEmail(email, best));
    };

    fit();

    // Watch the bar, not the span: the span's size is what we are changing, and observing
    // it would feed back into the measurement.
    const bar = el.closest('.status-bar');
    const observer = bar ? new ResizeObserver(fit) : null;
    if (bar && observer) observer.observe(bar);

    // VT323 loads late; the metrics it lands with are not the fallback's.
    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) fit();
    });

    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [email]);

  // A mailto link, so a tap opens the mail app with the address already filled in. The
  // displayed text is the folded abbreviation; href always carries the full address.
  return (
    <a className="nav-auth-email" ref={ref} href={`mailto:${email}`} title={email}>
      {text}
    </a>
  );
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
    return <StatusBarEmail email={user.email ?? ''} />;
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
