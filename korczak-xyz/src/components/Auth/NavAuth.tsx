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

// Splits at the last '@' so the domain stays whole. A string without one — foldEmail's
// last-resort truncation produces those, and user.email is only typed as a string — comes
// back as all local part and no domain, which is exactly how it should be rendered.
function splitEmail(value: string): { local: string; domain: string | null } {
  const at = value.lastIndexOf('@');
  if (at <= 0) return { local: value, domain: null };
  return { local: value.slice(0, at), domain: value.slice(at + 1) };
}

// The email shown in the status bar. Folds only as much as the line actually requires,
// so a wide bar shows the whole address and a cramped one gives up characters one at a
// time. Measured rather than guessed from a breakpoint, because how much room is left
// depends on the commit hash and the timestamp beside it, which vary by locale.
function StatusBarEmail({ email }: { email: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const localRef = useRef<HTMLSpanElement>(null);
  const atRef = useRef<HTMLSpanElement>(null);
  const domainRef = useRef<HTMLSpanElement>(null);
  const [parts, setParts] = useState(() => splitEmail(email));

  useLayoutEffect(() => {
    const el = ref.current;
    const localEl = localRef.current;
    const atEl = atRef.current;
    const domainEl = domainRef.current;
    if (!el || !localEl || !atEl || !domainEl) return;

    // The address is written into three separate runs rather than one string (see the
    // render below for why). Nothing else about the measurement changes: the wrapper is
    // still nowrap + overflow:hidden and still the flex item that gives way first.
    const write = (candidate: string) => {
      const { local, domain } = splitEmail(candidate);
      localEl.textContent = local;
      atEl.textContent = domain === null ? '' : '@';
      domainEl.textContent = domain ?? '';
    };

    // Candidates go straight into the DOM: React state cannot be read back synchronously,
    // and every probe is followed by a write of the final string, so the two never
    // disagree.
    const fits = (candidate: string) => {
      write(candidate);
      return el.scrollWidth <= el.clientWidth;
    };

    const commit = (final: string) => {
      write(final);
      setParts(splitEmail(final));
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

  // Three runs, not one string. The address is the *logged-in* user's, so there is never a
  // reason to mail it, but iOS hands a plain email-shaped run of text to its data
  // detectors and makes it tappable — an accidental tap then launches Mail with the user
  // writing to themselves. A detector needs local@domain contiguous; the inline-block
  // around the '@' ends the text run and defeats the match. On screen it is identical:
  // VT323 is monospace and the spans are empty of styling otherwise.
  return (
    <span className="nav-auth-email" ref={ref} title={email}>
      <span ref={localRef}>{parts.local}</span>
      <span className="nav-auth-email-at" ref={atRef}>
        {parts.domain === null ? '' : '@'}
      </span>
      <span ref={domainRef}>{parts.domain ?? ''}</span>
    </span>
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
