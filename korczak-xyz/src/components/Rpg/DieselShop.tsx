/*
 * The diesel page behind the badge (owner, 23 Nov 2026: "this page is from the old days — make it fit
 * the game and the other screens"; variant B of the mockups in `rpg/dizel-redesign/` in the project
 * files, with the tabs, the notes and the links struck out and the subscription on the same page).
 *
 * In the settings' look: the tank as one card — what is in it, about how many quests that is, and the
 * plant drawn in white lines beside it, smoking and blinking while it runs, dark when it is empty —
 * then the subscription, the page's call to action (or its state, once the account has one), with the
 * three canisters under it — each a button that opens the checkout for it at once (no separate Pay button). The legal pages
 * are in the page's footer, so they are not repeated here.
 *
 * The checkout is the old plant's (`DieselPlant.tsx`): Paddle's overlay through `onBuy`/`onSubscribe`;
 * the litres arrive by webhook and the tank's snapshot raises the number. The plant on the main menu
 * (when empty) and on the ending screen is still `DieselPlant`.
 */

import { useEffect, useRef, useState } from 'react';
import { CANISTERS, SUBSCRIPTION, formatLitres, plantState, type Canister } from '../../utils/rpg/diesel';
import { type SubscriptionView } from '../../utils/rpg/paddle';
import { PADDLE } from '../../utils/rpg/paddleConfig';
import type { CheckoutOutcome } from '../../utils/rpg/paddleCheckout';
import type { Lang } from '../../utils/rpg/quest';
import { ui } from './ui';

/** How long the refuel glow lasts after a payment. */
const REFUEL_MS = 3600;
/** How long a checkout's outcome stays said before the line goes back to the tank. */
const HOLD_MS = 5000;

type Pick = Canister['id'] | 'monthly';

/** "14 grudnia" / "14 December": the day a delivery renews or ends. */
function dayOf(iso: string, lang: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(lang === 'pl' ? 'pl-PL' : 'en-GB', { day: 'numeric', month: 'long' });
}

/** The plant in white lines: a generator with its exhaust, a cable and one rack. */
function PlantLines() {
  return (
    <svg viewBox="0 0 150 110" className="rpg-dzs-art" aria-hidden="true">
      <g className="rpg-dzs-smoke">
        <circle cx="48" cy="18" r="3.5" />
        <circle cx="48" cy="18" r="3.5" />
        <circle cx="48" cy="18" r="3.5" />
      </g>
      <g fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
        <path d="M44 26v22M40 26h8" />
        <rect x="4" y="48" width="70" height="38" rx="4" />
        <path d="M36 56v22M43 56v22M50 56v22M57 56v22M64 56v22" />
        <rect x="11" y="56" width="16" height="22" rx="1" />
        <circle cx="14" cy="90" r="4" />
        <circle cx="64" cy="90" r="4" />
        <path className="rpg-dzs-cable" d="M74 76 C86 96 96 96 106 76" strokeDasharray="3 3" />
        <rect x="106" y="32" width="34" height="62" rx="2" />
        <path d="M110 42h26M110 52h26M110 62h26M110 72h26M110 82h26" />
      </g>
      <rect className="rpg-dzs-gauge" x="13" y="65" width="12" height="11" />
      <g className="rpg-dzs-leds">
        <circle cx="113" cy="37" r="1.4" />
        <circle cx="117" cy="47" r="1.4" />
        <circle cx="113" cy="57" r="1.4" />
        <circle cx="117" cy="67" r="1.4" />
        <circle cx="113" cy="77" r="1.4" />
      </g>
    </svg>
  );
}

export default function DieselShop({
  lang,
  litres,
  questLitres,
  onBuy,
  onSubscribe,
  subscription = null,
  subLitres = 0,
}: {
  lang: Lang;
  litres: number;
  /** What a quest costs on the chosen model, for "about N quests"; null when it cannot be said. */
  questLitres: number | null;
  onBuy?: (c: Canister) => Promise<CheckoutOutcome>;
  onSubscribe?: () => Promise<CheckoutOutcome>;
  subscription?: SubscriptionView | null;
  subLitres?: number;
}) {
  const t = ui(lang);
  const stopped = plantState(litres) === 'stopped';
  const [refuel, setRefuel] = useState(false);
  /** A checkout open (`null` outcome) or just finished, and which offer opened it. */
  const [bought, setBought] = useState<{ id: Pick; litres: number; outcome: CheckoutOutcome | null } | null>(null);
  const timers = useRef<number[]>([]);
  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };
  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);

  const offerMonthly = Boolean(onSubscribe) && !subscription;
  const busy = refuel || (bought !== null && bought.outcome === null);

  /** Each offer is its own button straight into Paddle's checkout (owner, 23 Nov 2026: no Pay button). */
  const pay = (id: Pick) => {
    if (busy) return;
    const canister = CANISTERS.find((c) => c.id === id);
    const amount = canister ? canister.litres : SUBSCRIPTION.litres;
    const open = canister ? onBuy && (() => onBuy(canister)) : onSubscribe;
    if (!open) return;
    setBought({ id, litres: amount, outcome: null });
    void open().then((outcome) => {
      setBought(outcome === 'closed' ? null : { id, litres: amount, outcome });
      if (outcome === 'paid') {
        setRefuel(true);
        later(() => setRefuel(false), REFUEL_MS);
      }
      if (outcome !== 'closed') later(() => setBought(null), outcome === 'paid' ? REFUEL_MS + HOLD_MS : HOLD_MS);
    });
  };

  const quests = questLitres && questLitres > 0 ? Math.floor(litres / questLitres) : null;
  const status = bought
    ? bought.outcome === null
      ? t.dieselCheckout
      : bought.outcome === 'paid'
        ? t.dieselPaid(formatLitres(bought.litres, lang))
        : bought.outcome === 'discount-used'
          ? t.dieselDiscountUsed
          : t.dieselCheckoutFailed
    : refuel
      ? t.dieselRefuel
      : null;

  return (
    <div className={`rpg-dzs rpg-dzs-${refuel ? 'refuel' : stopped ? 'stopped' : 'running'}`}>
      <section className="rpg-dzs-tank" aria-label={stopped ? t.dieselStopped : t.dieselRunning}>
        <div className="rpg-dzs-tank-text">
          <h4>{t.dieselInTank}</h4>
          <p className="rpg-dzs-litres">
            {Math.round(litres).toLocaleString(lang === 'pl' ? 'pl-PL' : 'en-GB')}
            <small>L</small>
          </p>
          <p className="rpg-dzs-line" role="status">
            {status ?? (stopped ? t.dieselOut : quests !== null ? t.dieselQuestsLeft(quests) : '')}
          </p>
        </div>
        <PlantLines />
      </section>

      {offerMonthly && (
        <button
          type="button"
          className="rpg-dzs-offer rpg-dzs-monthly"
          aria-busy={bought?.id === 'monthly' && bought.outcome === null}
          disabled={busy}
          onClick={() => pay('monthly')}
        >
          <span className="rpg-dzs-monthly-head">
            <strong>{t.dieselSubTitle}</strong>
            <b>{t.dieselSubPrice(SUBSCRIPTION.pln)}</b>
          </span>
          <span className="rpg-dzs-monthly-litres">{t.dieselSubLitres(formatLitres(SUBSCRIPTION.litres, lang))}</span>
        </button>
      )}
      {subscription && (
        <div className="rpg-dzs-sub">
          <strong>{t.dieselSubTitle}</strong>
          <span className="rpg-dzs-monthly-litres">{t.dieselSubLitres(formatLitres(SUBSCRIPTION.litres, lang))}</span>
          <p>
            {subscription.endsAt
              ? t.dieselSubEnding(formatLitres(subLitres, lang), dayOf(subscription.endsAt, lang))
              : t.dieselSubActive(formatLitres(subLitres, lang), subscription.nextBilledAt ? dayOf(subscription.nextBilledAt, lang) : '—')}
          </p>
          {subscription.cancelUrl && !subscription.endsAt && (
            <a href={subscription.cancelUrl} target="_blank" rel="noopener noreferrer">
              {t.dieselSubCancel}
            </a>
          )}
        </div>
      )}
      <div className="rpg-dzs-offers">
        {CANISTERS.map((c) => (
          <button
            type="button"
            key={c.id}
            className="rpg-dzs-offer"
            aria-busy={bought?.id === c.id && bought.outcome === null}
            disabled={!onBuy || busy}
            onClick={() => pay(c.id)}
          >
            <strong>{t.dieselCanister[c.id]}</strong>
            <span>{formatLitres(c.litres, lang)}</span>
            <b>{c.pln} zł</b>
          </button>
        ))}
      </div>

      {!onBuy && <p className="rpg-dzs-note">{t.dieselTankSoon}</p>}
      {PADDLE.environment === 'sandbox' && <p className="rpg-dzs-note">{t.dieselSandboxNote}</p>}
    </div>
  );
}
