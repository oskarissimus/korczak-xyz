import { useCallback, useEffect, useRef, useState } from 'react';
import { ANSWER_SECONDS, choose, drinkCoffee, fixBug, grade, newGame, score, tick, type GameState } from './engine';
import type { Lang } from './events';
import { Renderer, type HitBox } from './render';
import { strings } from './strings';

interface Props {
  lang: Lang;
}

type Phase = 'intro' | 'playing' | 'over';

/* The HUD re-renders from a copy taken a few times a second; the canvas draws every frame. */
function snapshot(s: GameState) {
  return {
    prod: s.prod,
    sanity: s.sanity,
    debt: s.debt,
    km: s.km,
    totalKm: s.totalKm,
    stopLeft: s.stopLeft,
    coffees: s.coffees,
    coffeeCooldown: s.coffeeCooldown,
    active: s.active ? { event: s.active.event, timeLeft: s.active.timeLeft } : null,
    toasts: s.toasts.slice(),
  };
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const r = Math.floor(sec % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

function Meter({ label, value, invert }: { label: string; value: number; invert?: boolean }) {
  const good = invert ? 100 - value : value;
  const tone = good > 60 ? 'ok' : good > 30 ? 'warn' : 'bad';
  return (
    <div className="trucker-meter">
      <span className="trucker-meter-label">{label}</span>
      <span className="trucker-meter-bar">
        <span className={`trucker-meter-fill trucker-${tone}`} style={{ width: `${value}%` }} />
      </span>
      <span className="trucker-meter-value">{Math.round(value)}</span>
    </div>
  );
}

export default function Trucker({ lang }: Props) {
  const t = strings[lang];
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const stateRef = useRef<GameState>(newGame());
  const pausedRef = useRef(false);
  const phaseRef = useRef<Phase>('intro');
  const [phase, setPhase] = useState<Phase>('intro');
  const [paused, setPaused] = useState(false);
  const [hud, setHud] = useState(() => snapshot(stateRef.current));

  const setPausedBoth = useCallback((p: boolean) => {
    pausedRef.current = p;
    setPaused(p);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const renderer = new Renderer(canvas);
    rendererRef.current = renderer;
    const resize = () => renderer.resize(container.clientWidth, container.clientHeight);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    let raf = 0;
    let last = performance.now();
    let lastHud = 0;
    const frame = (now: number) => {
      // The first rAF timestamp can predate the performance.now() taken before it.
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
      last = now;
      const s = stateRef.current;
      if (phaseRef.current === 'playing' && !pausedRef.current) {
        tick(s, dt);
        if (s.over) {
          setHud(snapshot(s));
          setPhase('over');
          phaseRef.current = 'over';
        }
      } else if (phaseRef.current === 'intro') {
        // The truck idles along on the title screen, nothing happening to it.
        s.speed = 60;
        s.travel += dt * 6;
        s.time += dt;
      }
      renderer.draw(s, lang);
      if (now - lastHud > 100) {
        lastHud = now;
        if (phaseRef.current === 'playing') setHud(snapshot(s));
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [lang]);

  const start = useCallback(() => {
    stateRef.current = newGame();
    phaseRef.current = 'playing';
    setPhase('playing');
    setPausedBoth(false);
    setHud(snapshot(stateRef.current));
  }, [setPausedBoth]);

  const answer = useCallback((i: number) => {
    const s = stateRef.current;
    if (phaseRef.current !== 'playing' || pausedRef.current) return;
    choose(s, i);
    setHud(snapshot(s));
  }, []);

  const coffee = useCallback(() => {
    if (phaseRef.current !== 'playing' || pausedRef.current) return;
    drinkCoffee(stateRef.current);
    setHud(snapshot(stateRef.current));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (phaseRef.current !== 'playing') return;
      if (e.key >= '1' && e.key <= '3') answer(Number(e.key) - 1);
      else if (e.key === 'c' || e.key === 'C') coffee();
      else if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') setPausedBoth(!pausedRef.current);
    };
    const onHide = () => {
      if (document.hidden && phaseRef.current === 'playing') setPausedBoth(true);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [answer, coffee, setPausedBoth]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const renderer = rendererRef.current;
    if (!renderer || phaseRef.current !== 'playing' || pausedRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // Of the bugs under the pointer, the nearest one wins: it is the one about to hit, and it
    // has the biggest hit box.
    let best: HitBox | null = null;
    for (const box of renderer.hitBoxes) {
      if (Math.hypot(box.x - x, box.y - y) <= box.r && (!best || box.r > best.r)) best = box;
    }
    if (best) fixBug(stateRef.current, best.id);
  };

  const s = stateRef.current;
  const left = Math.max(0, hud.totalKm - hud.km);

  return (
    <div className="trucker-container" ref={containerRef}>
      <canvas ref={canvasRef} className="trucker-canvas" onPointerDown={onPointerDown} />

      {phase !== 'intro' && (
        <div className="trucker-hud">
          <Meter label={t.prod} value={hud.prod} />
          <Meter label={t.sanity} value={hud.sanity} />
          <Meter label={t.debt} value={hud.debt} invert />
          <div className="trucker-km">
            <b>{left.toFixed(1)} km</b> {t.toGo}
            <span className="trucker-progress">
              <span style={{ width: `${Math.min(100, (hud.km / hud.totalKm) * 100)}%` }} />
            </span>
          </div>
        </div>
      )}

      {phase === 'playing' && (
        <>
          <div className="trucker-toasts">
            {hud.toasts.map((toast) => (
              <div key={toast.id} className={`trucker-toast trucker-toast-${toast.tone}`}>
                {toast.tone === 'auto' ? '🤖 ' : ''}
                {toast.text[lang]}
              </div>
            ))}
          </div>

          {hud.stopLeft > 0 && (
            <div className="trucker-meeting">
              📹 {t.meeting}… {Math.ceil(hud.stopLeft)}s
            </div>
          )}

          {hud.active && (
            <div className={`trucker-dialog trucker-kind-${hud.active.event.kind}`} role="dialog">
              <div className="trucker-dialog-title">{hud.active.event.title[lang]}</div>
              <div className="trucker-dialog-text">{hud.active.event.text[lang]}</div>
              <div className="trucker-dialog-options">
                {hud.active.event.options.map((o, i) => (
                  <button key={i} type="button" onClick={() => answer(i)}>
                    <kbd>{i + 1}</kbd> {o.label[lang]}
                  </button>
                ))}
              </div>
              <div className="trucker-timer" aria-label={`${t.autopilot} ${Math.ceil(hud.active.timeLeft)}s`}>
                <span style={{ width: `${(hud.active.timeLeft / ANSWER_SECONDS) * 100}%` }} />
              </div>
              <div className="trucker-timer-label">
                🤖 {t.autopilot} {Math.ceil(hud.active.timeLeft)}s
              </div>
            </div>
          )}

          <div className="trucker-controls">
            <button type="button" onClick={coffee} disabled={hud.coffees === 0 || hud.coffeeCooldown > 0}>
              ☕ {t.coffee} ({hud.coffees})
            </button>
            <button type="button" onClick={() => setPausedBoth(!paused)}>
              {paused ? `▶ ${t.resume}` : `⏸ ${t.pause}`}
            </button>
          </div>

          {paused && <div className="trucker-overlay trucker-paused">{t.paused}</div>}
        </>
      )}

      {phase === 'intro' && (
        <div className="trucker-overlay">
          <div className="trucker-card">
            <h2>🚛 {t.title}</h2>
            <p className="trucker-tagline">{t.tagline}</p>
            <p>{t.premise}</p>
            <ul>
              <li>{t.how1}</li>
              <li>{t.how2}</li>
              <li>{t.how3}</li>
              <li>{t.how4}</li>
            </ul>
            <button type="button" className="trucker-start" onClick={start}>
              {t.start}
            </button>
          </div>
        </div>
      )}

      {phase === 'over' && s.over && (
        <div className="trucker-overlay">
          <div className="trucker-card">
            <h2>
              {s.over === 'win' ? `🏁 ${t.winTitle}` : s.over === 'prod' ? `🔥 ${t.prodTitle}` : `🥐 ${t.burnoutTitle}`}
            </h2>
            <p>{s.over === 'win' ? t.winText : s.over === 'prod' ? t.prodText : t.burnoutText}</p>
            <p className="trucker-grade">
              {t.review}: <b>{t.grades[grade(score(s))]}</b>
            </p>
            <table className="trucker-stats">
              <tbody>
                <tr><td>{t.score}</td><td>{score(s)}</td></tr>
                <tr><td>{t.time}</td><td>{formatTime(s.time)}</td></tr>
                <tr><td>{t.distance}</td><td>{s.km.toFixed(1)} / {s.totalKm.toFixed(0)} km</td></tr>
                <tr><td>{t.bugsFixed}</td><td>{s.stats.bugsFixed}</td></tr>
                <tr><td>{t.bugsHit}</td><td>{s.stats.bugsHit}</td></tr>
                <tr><td>{t.answered}</td><td>{s.stats.answered}</td></tr>
                <tr><td>{t.autopiloted}</td><td>{s.stats.autopiloted}</td></tr>
                <tr><td>{t.naps}</td><td>{s.stats.naps}</td></tr>
                <tr><td>{t.meetingSec}</td><td>{Math.round(s.stats.meetingSeconds)}</td></tr>
              </tbody>
            </table>
            <button type="button" className="trucker-start" onClick={start}>
              {t.again}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
