/*
 * The diesel plant (`utils/rpg/diesel.ts`): the demo's budget for today drawn as a data centre on a
 * smoking generator. Running, the generator shakes and smokes, current runs along the cable and the
 * racks blink; empty, everything is dark and still, and the canisters to buy come up underneath.
 * When the tank goes from empty to something (a new day, later a purchase), a little man walks in
 * with a canister, pours, and the lights come back on along the cable.
 *
 * No payment provider sells the canisters yet, so a canister's button plays the refuelling as a
 * preview and says so, then the plant goes back to what is really in the tank.
 */

import { useEffect, useRef, useState } from 'react';
import { CANISTERS, formatLitres, plantState, type Canister } from '../../utils/rpg/diesel';
import type { Lang } from '../../utils/rpg/quest';
import { translations } from './translations';

/** How long the man takes: walk in, pour, walk out. Matches `rpg-dz-walk` in rpg.css. */
const REFUEL_MS = 3600;
/** How long a preview keeps the lights on before going back to the real tank. */
const PREVIEW_HOLD_MS = 2500;

type Phase = 'running' | 'stopped' | 'refuel';

/** A jerrycan, filled to `level` (0–1) — the badge, and the man's canister. */
export function CanisterIcon({ level = 1, size = 18 }: { level?: number; size?: number }) {
  const h = 16 * Math.max(0, Math.min(1, level));
  return (
    <svg width={size} height={size * 1.2} viewBox="0 0 20 24" aria-hidden="true" className="rpg-dz-canister-icon">
      <path d="M3 5h9l5 5v12H3z" fill="#5a1a14" stroke="#e8c37a" strokeWidth="1.2" />
      <rect x="4" y={22 - h} width="12" height={h} fill="#c8321f" />
      <path d="M6 2h5v3H6z" fill="#e8c37a" />
      <path d="M5 9l8 10M13 9l-8 10" stroke="#e8c37a" strokeWidth="0.8" opacity="0.6" />
    </svg>
  );
}

/** The canister and how much is in it, one line — what "how much diesel do I have" shows. */
export function DieselBadge({
  lang,
  litres,
  capacity,
  onClick,
}: {
  lang: Lang;
  litres: number;
  capacity: number;
  onClick?: () => void;
}) {
  const t = translations[lang];
  const empty = plantState(litres) === 'stopped';
  const body = (
    <>
      <CanisterIcon level={capacity > 0 ? litres / capacity : 0} />
      <span>{t.dieselLeft(formatLitres(litres, lang))}</span>
    </>
  );
  return onClick ? (
    <button type="button" className={`rpg-dz-badge${empty ? ' rpg-dz-badge-empty' : ''}`} onClick={onClick} title={t.dieselOpen}>
      {body}
    </button>
  ) : (
    <span className={`rpg-dz-badge${empty ? ' rpg-dz-badge-empty' : ''}`}>{body}</span>
  );
}

/** A price tag in diesel, for a menu entry: "⛽ ~2 L". */
export function dieselTag(lang: Lang, l: number | null): string | undefined {
  return l === null ? undefined : `⛽ ~${formatLitres(l, lang)}`;
}

export default function DieselPlant({
  lang,
  litres,
  capacity,
  showCanisters = false,
  tank = false,
}: {
  lang: Lang;
  litres: number;
  capacity: number;
  /** Show the canisters even with fuel in the tank (the panel opened from the badge). */
  showCanisters?: boolean;
  /** The account's own tank (`wallet.ts`) rather than the demo's day: nothing comes at midnight. */
  tank?: boolean;
}) {
  const t = translations[lang];
  const real = plantState(litres);
  const [phase, setPhase] = useState<Phase>(real);
  const [preview, setPreview] = useState<Canister | null>(null);
  const before = useRef(real);
  const timers = useRef<number[]>([]);

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };
  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);

  // Empty to something: the man pours before the lights come on. Anything else is shown as it is.
  useEffect(() => {
    if (preview) return;
    if (before.current === 'stopped' && real === 'running') {
      setPhase('refuel');
      later(() => setPhase('running'), REFUEL_MS);
    } else {
      setPhase(real);
    }
    before.current = real;
    // `later` only schedules; the effect is about the tank.
  }, [real, preview]);

  const buy = (c: Canister) => {
    if (phase === 'refuel') return;
    setPreview(c);
    setPhase('refuel');
    later(() => setPhase('running'), REFUEL_MS);
    later(() => {
      setPreview(null);
      setPhase(plantState(litres));
    }, REFUEL_MS + PREVIEW_HOLD_MS);
  };

  const on = phase === 'running';
  const level = phase === 'stopped' ? 0 : capacity > 0 ? Math.min(1, litres / capacity) : 0;
  const shownLevel = preview && phase === 'running' ? 1 : level;
  const canisters = showCanisters || real === 'stopped' || preview !== null;

  return (
    <div className={`rpg-dz rpg-dz-${phase}`}>
      <svg viewBox="0 0 360 170" className="rpg-dz-scene" role="img" aria-label={on ? t.dieselRunning : t.dieselStopped}>
        <rect x="0" y="150" width="360" height="20" fill="#2b2418" />
        {/* The data centre */}
        <g className="rpg-dz-dc">
          <rect x="228" y="58" width="116" height="92" fill="#3b3f46" stroke="#1d1f23" strokeWidth="2" />
          <rect x="228" y="48" width="116" height="12" fill="#2a2d33" />
          <text x="286" y="57" textAnchor="middle" className="rpg-dz-sign">
            DATA CENTER
          </text>
          {[0, 1, 2].map((i) => (
            <g key={i} transform={`translate(${240 + i * 34} 70)`}>
              <rect width="26" height="72" fill="#16181c" stroke="#555b64" />
              {[0, 1, 2, 3, 4, 5].map((r) => (
                <g key={r}>
                  <rect x="3" y={4 + r * 11} width="20" height="8" fill="#23262b" />
                  <circle
                    cx="7"
                    cy={8 + r * 11}
                    r="1.6"
                    className="rpg-dz-led"
                    style={{ animationDelay: `${((i * 6 + r) * 0.37) % 1.3}s` }}
                  />
                  <circle cx="12" cy={8 + r * 11} r="1.6" className="rpg-dz-led rpg-dz-led-blue" style={{ animationDelay: `${((i + r * 5) * 0.29) % 1.1}s` }} />
                </g>
              ))}
            </g>
          ))}
          <rect x="228" y="58" width="116" height="92" className="rpg-dz-dark" />
        </g>
        {/* The cable, and the current along it */}
        <path d="M150 138 C175 160, 205 160, 230 138" fill="none" stroke="#111" strokeWidth="5" strokeLinecap="round" />
        <path d="M150 138 C175 160, 205 160, 230 138" fill="none" className="rpg-dz-current" strokeWidth="2.5" strokeLinecap="round" />
        {/* The generator, moved right to leave the man room; the shake is CSS, so it sits inside. */}
        <g transform="translate(22 0)">
          <g className="rpg-dz-gen">
            <rect x="102" y="62" width="12" height="38" fill="#3a3a3a" />
            <rect x="99" y="58" width="18" height="6" fill="#2a2a2a" />
            <rect x="34" y="96" width="96" height="46" rx="4" fill="#d9a21b" stroke="#4a3608" strokeWidth="2" />
            {[0, 1, 2, 3, 4].map((i) => (
              <rect key={i} x={74 + i * 9} y="104" width="4" height="28" fill="#5c450d" />
            ))}
            {/* The filler neck the man pours into */}
            <rect x="26" y="111" width="9" height="7" fill="#4a3608" />
            <rect x="24" y="109" width="3" height="11" fill="#2a1f05" />
            {/* The fuel gauge */}
            <rect x="42" y="104" width="22" height="30" fill="#1a1406" stroke="#4a3608" />
            <rect x="44" y={106 + 26 * (1 - shownLevel)} width="18" height={26 * shownLevel} className="rpg-dz-fuel" />
            <circle cx="48" cy="146" r="5" fill="#1a1a1a" />
            <circle cx="116" cy="146" r="5" fill="#1a1a1a" />
          </g>
          {/* Smoke from the exhaust */}
          <g className="rpg-dz-smoke">
            {[0, 1, 2, 3].map((i) => (
              <circle key={i} cx="108" cy="56" r="7" style={{ animationDelay: `${i * 0.45}s` }} />
            ))}
          </g>
        </g>
        {/* The man with the canister: walks in to x 24, lifts and tips the can into the neck, leaves. */}
        <g className="rpg-dz-worker">
          <circle cx="0" cy="96" r="6" fill="#f0d2a8" />
          <rect x="-4" y="88" width="8" height="3" fill="#e0a526" />
          <path d="M0 102 L0 124 M0 124 L-6 146 M0 124 L6 146" stroke="#2d4a7a" strokeWidth="4" strokeLinecap="round" />
          <path d="M0 106 L6 112" className="rpg-dz-arm" stroke="#2d4a7a" strokeWidth="3.5" strokeLinecap="round" />
          <g className="rpg-dz-can">
            <path d="M6 112h12l5 5v12H6z" fill="#c8321f" stroke="#5a1a14" strokeWidth="1.2" />
            <path d="M20 114l6-5" stroke="#5a1a14" strokeWidth="2.5" />
          </g>
          <g className="rpg-dz-drops">
            <circle cx="25" cy="118" r="1.6" />
            <circle cx="25.5" cy="123" r="1.4" />
          </g>
        </g>
      </svg>
      <p className="rpg-dz-status">
        {preview && phase !== 'stopped'
          ? t.dieselPreview(formatLitres(preview.litres, lang))
          : phase === 'refuel'
            ? t.dieselRefuel
            : on
              ? t.dieselLeft(formatLitres(litres, lang))
              : tank
                ? t.dieselTankEmpty
                : t.dieselEmpty}
      </p>
      {canisters && (
        <>
          <div className="rpg-dz-shop">
            {CANISTERS.map((c) => (
              <button type="button" key={c.id} className={`rpg-dz-offer rpg-dz-offer-${c.id}`} onClick={() => buy(c)} disabled={phase === 'refuel'}>
                <CanisterIcon size={c.id === 'can' ? 18 : c.id === 'barrel' ? 22 : 26} />
                <strong>{t.dieselCanister[c.id]}</strong>
                <span>{formatLitres(c.litres, lang)}</span>
                <span className="rpg-dz-price">{c.pln} zł</span>
              </button>
            ))}
          </div>
          <p className="rpg-dz-note">{tank ? t.dieselTankSoon : t.dieselSoon}</p>
        </>
      )}
    </div>
  );
}
