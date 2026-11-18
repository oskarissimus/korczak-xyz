/*
 * Which Paddle account the shop opens: the client-side token and the four price ids, from the build's
 * env (`PUBLIC_PADDLE_*`), falling back to the sandbox objects when a variable is unset.
 *
 * BROWSER ONLY. `paddle.ts` is compiled into the functions as well, where `import.meta.env` does not
 * exist, so the env read lives here and nothing on the server imports this file. The server needs
 * none of it: it only receives signed webhooks, and checks them against `rpgPaddle/config`.
 *
 * THE TOKEN DECIDES THE ENVIRONMENT. A `live_` token is production, anything else is sandbox, so
 * the build cannot open a sandbox checkout with a live token or the reverse, and there is no
 * `Paddle.Environment.set('sandbox')` to forget: it is called only for a sandbox token.
 *
 * GOING LIVE is `.env.rpg` alone: the live token and the four live price ids (the commented block
 * there). korczak.xyz builds from `.env.production`, which sets none of these, and stays sandbox.
 * Do not fill that block in before Paddle has verified the account and approved
 * everyrpg.korczak.xyz — every push to main deploys that build.
 *
 * Every value here is public by design: a client-side token can only open a checkout, and the
 * litres a price pours are its `custom_data.litres` inside Paddle, not anything the page says.
 */

import type { Canister } from './diesel';

/** The sandbox account (`slr_01m7b8bqq036zw1smfsy6f3w0x`): product "Diesel" `pro_01m7daxkazw506xzkp27r7ynq4`, "Diesel — monthly delivery" `pro_01m7dfqz9y0tgqhkdcnwvnh45d`. */
const SANDBOX = {
  token: 'test_a6f1d7ba50e4f6e6de42e33bf37',
  can: 'pri_01m7daxkc4b6w327j494v88pyr',
  barrel: 'pri_01m7daxkda4nmg96q4r6eq8y8v',
  tank: 'pri_01m7daxke7fw2e6fmhvj4kyqgw',
  monthly: 'pri_01m7dfqzb598m25cr5r2ze7hh5',
};

const env = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim() : fallback);

const token = env(import.meta.env.PUBLIC_PADDLE_CLIENT_TOKEN, SANDBOX.token);

export const PADDLE = {
  environment: (token.startsWith('live_') ? 'production' : 'sandbox') as 'sandbox' | 'production',
  token,
  prices: {
    can: env(import.meta.env.PUBLIC_PADDLE_PRICE_CAN, SANDBOX.can),
    barrel: env(import.meta.env.PUBLIC_PADDLE_PRICE_BARREL, SANDBOX.barrel),
    tank: env(import.meta.env.PUBLIC_PADDLE_PRICE_TANK, SANDBOX.tank),
  } satisfies Record<Canister['id'], string>,
  /** The monthly delivery (`SUBSCRIPTION`). */
  subscription: env(import.meta.env.PUBLIC_PADDLE_PRICE_MONTHLY, SANDBOX.monthly),
};
