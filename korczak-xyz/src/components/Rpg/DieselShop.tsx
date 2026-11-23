/*
 * The diesel page behind the badge (owner, 23 Nov 2026: "this page is from the old days — make it fit
 * the game and the other screens"; variant B of the mockups in `rpg/dizel-redesign/` in the project
 * files, with the tabs, the notes and the links struck out and the subscription on the same page).
 *
 * In the settings' look, with pictures (owner, 23 Nov 2026: variant C of `rpg/dizel-obrazki/`, but with
 * variant B's canister, barrel and tanker, which are not cropped): what is in the tank as one line with
 * a gauge under it and about how many quests that is; then the subscription, the page's call to
 * action, as a white card with a cover picture like a world's (or its state, once the account has
 * one); then the three canisters as cards with their picture — each a button that opens the checkout
 * for it at once (no separate Pay button). Every picture has its box from the first frame. The legal
 * pages are in the page's footer, so they are not repeated here.
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
import canisterImg from '../../assets/rpg/diesel/canister.webp?url';
import barrelImg from '../../assets/rpg/diesel/barrel.webp?url';
import tankerImg from '../../assets/rpg/diesel/tanker.webp?url';
import subscriptionImg from '../../assets/rpg/diesel/subscription.webp?url';

/** How long the refuel glow lasts after a payment. */
const REFUEL_MS = 3600;
/** How long a checkout's outcome stays said before the line goes back to the tank. */
const HOLD_MS = 5000;

type Pick = Canister['id'] | 'monthly';

/** Each canister's picture, whole on black (variant B's, not cropped). */
const PICTURE: Record<Canister['id'], string> = { can: canisterImg, barrel: barrelImg, tank: tankerImg };

/** What the gauge counts as a full tank: the biggest canister and a month of the subscription. */
const FULL_TANK = Math.max(...CANISTERS.map((c) => c.litres)) + SUBSCRIPTION.litres;

/** "14 grudnia" / "14 December": the day a delivery renews or ends. */
function dayOf(iso: string, lang: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(lang === 'pl' ? 'pl-PL' : 'en-GB', { day: 'numeric', month: 'long' });
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

  const fill = Math.max(0, Math.min(1, litres / FULL_TANK));

  return (
    <div className={`rpg-dzs rpg-dzs-${refuel ? 'refuel' : stopped ? 'stopped' : 'running'}`}>
      <section className="rpg-dzs-tank" aria-label={stopped ? t.dieselStopped : t.dieselRunning}>
        <div className="rpg-dzs-tank-row">
          <h4>{t.dieselInTank}</h4>
          <p className="rpg-dzs-litres">
            {Math.round(litres).toLocaleString(lang === 'pl' ? 'pl-PL' : 'en-GB')}
            <small>L</small>
          </p>
        </div>
        <div className="rpg-dzs-gauge" aria-hidden="true">
          <i style={{ width: `${fill * 100}%` }} />
        </div>
        <p className="rpg-dzs-line" role="status">
          {status ?? (stopped ? t.dieselOut : quests !== null ? t.dieselQuestsLeft(quests) : '')}
        </p>
      </section>

      {offerMonthly && (
        <button
          type="button"
          className="rpg-dzs-offer rpg-dzs-monthly"
          aria-busy={bought?.id === 'monthly' && bought.outcome === null}
          disabled={busy}
          onClick={() => pay('monthly')}
        >
          <img className="rpg-dzs-cover" src={subscriptionImg} alt="" width={800} height={400} />
          <span className="rpg-dzs-monthly-body">
            <span className="rpg-dzs-monthly-head">
              <strong>{t.dieselSubTitle}</strong>
              <b>{t.dieselSubPrice(SUBSCRIPTION.pln)}</b>
            </span>
            <span className="rpg-dzs-monthly-litres">{t.dieselSubLitres(formatLitres(SUBSCRIPTION.litres, lang))}</span>
          </span>
        </button>
      )}
      {subscription && (
        <div className="rpg-dzs-sub">
          <img className="rpg-dzs-cover" src={subscriptionImg} alt="" width={800} height={400} />
          <div className="rpg-dzs-sub-body">
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
        </div>
      )}
      <div className="rpg-dzs-offers">
        {CANISTERS.map((c) => (
          <button
            type="button"
            key={c.id}
            className="rpg-dzs-offer rpg-dzs-can"
            aria-busy={bought?.id === c.id && bought.outcome === null}
            disabled={!onBuy || busy}
            onClick={() => pay(c.id)}
          >
            <img className="rpg-dzs-pic" src={PICTURE[c.id]} alt="" width={320} height={320} />
            <span className="rpg-dzs-can-body">
              <strong>{t.dieselCanister[c.id]}</strong>
              <span className="rpg-dzs-can-row">
                <span>{formatLitres(c.litres, lang)}</span>
                <b>{c.pln} zł</b>
              </span>
            </span>
          </button>
        ))}
      </div>

      {!onBuy && <p className="rpg-dzs-note">{t.dieselTankSoon}</p>}
      {PADDLE.environment === 'sandbox' && <p className="rpg-dzs-note">{t.dieselSandboxNote}</p>}
    </div>
  );
}
