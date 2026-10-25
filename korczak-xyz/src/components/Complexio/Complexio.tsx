/**
 * The Act of Complexio, a multiplayer voxel office game, embedded for approved accounts.
 *
 * The game is not part of this build: it is a Rust server (physics, bots, rooms, a WebSocket per
 * player) that also serves its own wasm client, running as the `complexio` Cloud Run service in
 * this project. The server is the gate: started with AUTH_FIREBASE_PROJECT, it lets a WebSocket
 * in only with a Firebase ID token whose account row says `approved`. This page hands the signed-in
 * account's token over in the URL fragment, which no server sees, and posts a fresh one into the
 * frame before the hour-long token runs out.
 */
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { auth as firebaseAuth } from '../../lib/firebase';

/** Firebase ID tokens last an hour; a fresh one goes into the frame well before that. */
const REFRESH_MS = 45 * 60 * 1000;

export const GAME_URL = 'https://complexio-1068962621574.europe-central2.run.app/';

type Lang = 'en' | 'pl';

const strings = {
  en: {
    unavailable: 'Sign-in is not available on this deploy.',
    signedOutTitle: 'Members only',
    signedOutBody: 'The office is open to approved accounts. Sign in to walk in.',
    signIn: 'Sign in',
    fullscreen: 'Full screen',
    newTab: 'Open in its own tab',
    title: 'The Act of Complexio',
  },
  pl: {
    unavailable: 'Logowanie nie jest dostępne w tym wdrożeniu.',
    signedOutTitle: 'Tylko dla zalogowanych',
    signedOutBody: 'Biuro jest otwarte dla zatwierdzonych kont. Zaloguj się, żeby wejść.',
    signIn: 'Zaloguj się',
    fullscreen: 'Pełny ekran',
    newTab: 'Otwórz w osobnej karcie',
    title: 'The Act of Complexio',
  },
} as const;

export default function Complexio({ lang }: { lang: Lang }) {
  const t = strings[lang];
  const auth = useAuth();
  const frame = useRef<HTMLIFrameElement>(null);
  const [token, setToken] = useState<string | null>(null);
  const uid = auth.user?.uid ?? null;

  useEffect(() => {
    if (!uid) return;
    let live = true;
    const send = async (first: boolean) => {
      const fresh = await firebaseAuth?.currentUser?.getIdToken(!first).catch(() => null);
      if (!live || !fresh) return;
      if (first) setToken(fresh);
      else frame.current?.contentWindow?.postMessage({ complexioToken: fresh }, new URL(GAME_URL).origin);
    };
    send(true);
    const timer = setInterval(() => send(false), REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [uid]);

  if (!auth.enabled) return <p className="complexio-note">{t.unavailable}</p>;
  if (auth.loading) return <div className="complexio-stage" />;

  if (!auth.user) {
    const redirect = lang === 'pl' ? '/pl/apps/complexio/' : '/apps/complexio/';
    const login = lang === 'pl' ? '/pl/login/' : '/login/';
    return (
      <section className="complexio-gate">
        <h2>{t.signedOutTitle}</h2>
        <p>{t.signedOutBody}</p>
        <p>
          <a className="complexio-action" href={`${login}?redirect=${encodeURIComponent(redirect)}`}>
            {t.signIn}
          </a>
        </p>
      </section>
    );
  }

  if (!token) return <div className="complexio-stage" />;
  const src = `${GAME_URL}#token=${encodeURIComponent(token)}`;

  return (
    <>
      <div className="complexio-stage">
        <iframe
          ref={frame}
          className="complexio-frame"
          src={src}
          title={t.title}
          allow="fullscreen; autoplay; screen-wake-lock"
          allowFullScreen
        />
      </div>
      <div className="complexio-bar">
        <button type="button" className="complexio-action" onClick={() => frame.current?.requestFullscreen?.()}>
          {t.fullscreen}
        </button>
        <a className="complexio-action" href={src} target="_blank" rel="noopener">
          {t.newTab}
        </a>
      </div>
    </>
  );
}
