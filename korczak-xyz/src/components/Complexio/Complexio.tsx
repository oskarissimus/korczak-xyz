/**
 * The Act of Complexio, a multiplayer voxel office game, embedded for approved accounts.
 *
 * The game is not part of this build: it is a Rust server (physics, bots, rooms, a WebSocket per
 * player) that also serves its own wasm client, running as the `complexio` Cloud Run service in
 * this project. This page is only the door to it, so the gate here is the same browser-side gate
 * every other app has — the run.app URL itself answers anyone who has it.
 */
import { useRef } from 'react';
import { useAuth } from '../../hooks/useAuth';

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

  return (
    <>
      <div className="complexio-stage">
        <iframe
          ref={frame}
          className="complexio-frame"
          src={GAME_URL}
          title={t.title}
          allow="fullscreen; autoplay; screen-wake-lock"
          allowFullScreen
        />
      </div>
      <div className="complexio-bar">
        <button type="button" className="complexio-action" onClick={() => frame.current?.requestFullscreen?.()}>
          {t.fullscreen}
        </button>
        <a className="complexio-action" href={GAME_URL} target="_blank" rel="noopener">
          {t.newTab}
        </a>
      </div>
    </>
  );
}
