/*
 * Paddle's overlay checkout, in the browser (`paddleConfig.ts` holds the token and the prices).
 *
 * Paddle.js is loaded from Paddle's CDN the first time a canister is bought, not with the game: most
 * sittings never open the shop, and the script is Paddle's to version (`/paddle/v2/` is the stable
 * channel; Paddle asks for it not to be self-hosted). One load per page, shared by every buy.
 *
 * `buyCanister` resolves when the overlay is done with: `paid` once Paddle says the checkout
 * completed, `closed` when the reader shut it first, `failed` when Paddle.js would not load. A paid
 * checkout does not pour anything itself — the webhook does (`functions/src/rpg/paddle.ts`), and
 * the tank's live snapshot (`useDieselWallet`) raises the gauge when it lands, a second or two later.
 */

import { PADDLE } from './paddleConfig';
import type { Canister } from './diesel';

const SCRIPT = 'https://cdn.paddle.com/paddle/v2/paddle.js';

export type CheckoutOutcome = 'paid' | 'closed' | 'failed';

interface PaddleEventData {
  name?: string;
}

interface PaddleJs {
  Environment: { set(env: string): void };
  Initialize(options: { token: string; eventCallback?: (e: PaddleEventData) => void }): void;
  Checkout: {
    open(options: Record<string, unknown>): void;
  };
}

declare global {
  interface Window {
    Paddle?: PaddleJs;
  }
}

/** The one checkout in flight: Paddle.js has a single global callback, so the latest buy listens. */
let pending: ((outcome: CheckoutOutcome) => void) | null = null;
let ready: Promise<PaddleJs> | null = null;

function settle(outcome: CheckoutOutcome) {
  const done = pending;
  pending = null;
  done?.(outcome);
}

function load(): Promise<PaddleJs> {
  if (ready) return ready;
  ready = new Promise<PaddleJs>((resolve, reject) => {
    const init = () => {
      const paddle = window.Paddle;
      if (!paddle) return reject(new Error('paddle: script loaded without window.Paddle'));
      if (PADDLE.environment === 'sandbox') paddle.Environment.set('sandbox');
      paddle.Initialize({
        token: PADDLE.token,
        eventCallback: (e) => {
          // Completed comes before the reader closes the success screen: paid is said at once.
          if (e.name === 'checkout.completed') settle('paid');
          else if (e.name === 'checkout.closed') settle('closed');
        },
      });
      resolve(paddle);
    };
    if (window.Paddle) return init();
    const script = document.createElement('script');
    script.src = SCRIPT;
    script.async = true;
    script.onload = init;
    script.onerror = () => reject(new Error('paddle: script failed to load'));
    document.head.appendChild(script);
  }).catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

/** Opens the overlay for one canister, for the signed-in account `uid`. */
export function buyCanister(c: Canister, uid: string, email: string | null, lang: string): Promise<CheckoutOutcome> {
  return openCheckout(PADDLE.prices[c.id], { uid, canister: c.id }, email, lang);
}

/** Opens the overlay for the monthly delivery (`SUBSCRIPTION`); renewals pour by webhook with no page open. */
export function subscribeMonthly(uid: string, email: string | null, lang: string): Promise<CheckoutOutcome> {
  return openCheckout(PADDLE.subscription, { uid, canister: 'monthly' }, email, lang);
}

async function openCheckout(priceId: string, customData: Record<string, string>, email: string | null, lang: string): Promise<CheckoutOutcome> {
  let paddle: PaddleJs;
  try {
    paddle = await load();
  } catch {
    return 'failed';
  }
  settle('closed');
  return new Promise<CheckoutOutcome>((resolve) => {
    pending = resolve;
    try {
      paddle.Checkout.open({
        items: [{ priceId, quantity: 1 }],
        customData,
        ...(email ? { customer: { email } } : {}),
        settings: { displayMode: 'overlay', theme: 'dark', locale: lang === 'pl' ? 'pl' : 'en', allowLogout: false },
      });
    } catch {
      settle('failed');
    }
  });
}
