/*
 * The browser's half of the RPG's gateway (`functions/src/rpg/gateway.ts`, `gatewayRoutes.ts`):
 * every request the game makes to Google, OpenAI, ElevenLabs or fal.ai goes through `apiFetch`,
 * which sends it to the server instead, without the key.
 *
 * The call sites still build the provider's own request, key and all, and hand it here in place of
 * `fetch`: what the key IS decides how it travels.
 * - `ACCOUNT_KEY` (`gatewayKeys`, a signed-in reader whose key is on the account) is not a key at
 *   all. The request carries the reader's Firebase ID token and the server reads the key itself out
 *   of `users/{uid}/keys/config`. The account's key is never sent from the page.
 * - Anything else is a key that exists only in this browser — a signed-out reader's own, or a
 *   signed-in one whose account could not be reached — and goes in `x-rpg-key` for that one request.
 *   That is the bring-your-own-key path; the server uses it and keeps nothing.
 * A host that is not a provider's (fal's signed upload URL, a picture on fal's CDN) is fetched as
 * it is: nothing secret goes there.
 *
 * What a request cost, as the server priced it, is read back with `serverCost` (a header) or from
 * the stream's last line (`readCostEvent`), and is what the `~` console shows.
 */

import { BYOK_HEADER, COST_HEADER, GATEWAY_HOSTS, QUEST_HEADER, WORLD_HEADER } from './gatewayRoutes';
import type { ApiKeys } from '../accountKeys/keys';

/** Stands in for a key the account holds: "the server has it". Never a real key. */
export const ACCOUNT_KEY = 'account:rpg';

/** The site's own project when the build names none (a local `astro dev` without `.env`, the tests), as `functions/src/runtime.ts` does. */
const DEFAULT_PROJECT = 'korczak-xyz-501720';

export function gatewayUrl(): string {
  const override = import.meta.env.PUBLIC_RPG_API_URL as string | undefined;
  if (override) return override.replace(/\/$/, '');
  const project = (import.meta.env.PUBLIC_FIREBASE_PROJECT_ID as string | undefined) || DEFAULT_PROJECT;
  return `https://europe-central2-${project}.cloudfunctions.net/rpgApi`;
}

/**
 * The keys the game passes around, as handles: on the account → `ACCOUNT_KEY`, only here → the key.
 * `onAccount` is whether the account's copy is the one in force (signed in and synced); until then a
 * key only in this browser travels as BYOK rather than being lost.
 */
export function gatewayKeys(keys: ApiKeys, onAccount: boolean): ApiKeys {
  if (!onAccount) return keys;
  const out = { ...keys };
  for (const name of Object.keys(out) as (keyof ApiKeys)[]) if (out[name]) out[name] = ACCOUNT_KEY;
  return out;
}

const KEY_HEADERS = ['authorization', 'x-goog-api-key', 'xi-api-key'];

export interface GatewayContext {
  world: string | null;
  quest: string | null;
}
let context: () => GatewayContext = () => ({ world: null, quest: null });

/** What the game is doing, asked at each request: the server's ledger counts the spend per world and per quest. */
export function setGatewayContext(read: () => GatewayContext): void {
  context = read;
}

let tokenSource: (() => Promise<string | null>) | null = null;

/** For tests: where the ID token comes from. */
export function setTokenSource(source: (() => Promise<string | null>) | null): void {
  tokenSource = source;
}

async function idToken(): Promise<string | null> {
  if (tokenSource) return tokenSource();
  const { auth } = await import('../../lib/firebase');
  return (await auth?.currentUser?.getIdToken().catch(() => null)) ?? null;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** `fetch`, for a provider's request: through the gateway, the key turned into who pays. */
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  let url: URL;
  try {
    url = new URL(urlOf(input));
  } catch {
    return fetch(input, init);
  }
  if (!GATEWAY_HOSTS[url.host]) return fetch(input, init);

  const headers = new Headers(init.headers);
  let key = url.searchParams.get('key');
  url.searchParams.delete('key');
  for (const h of KEY_HEADERS) {
    const v = headers.get(h);
    if (v === null) continue;
    key ??= v.replace(/^(?:Bearer|Key)\s+/i, '');
    headers.delete(h);
  }

  const base = gatewayUrl();
  if (key === ACCOUNT_KEY) {
    const token = await idToken();
    if (!token) throw new Error('rpg gateway: signed out — sign in again to use the account\'s keys');
    headers.set('Authorization', `Bearer ${token}`);
  } else if (key) {
    headers.set(BYOK_HEADER, key);
  }
  const { world, quest } = context();
  if (world) headers.set(WORLD_HEADER, world.slice(0, 120));
  if (quest) headers.set(QUEST_HEADER, quest.slice(0, 120));
  return fetch(`${base}/${url.host}${url.pathname}${url.search}`, { ...init, headers });
}

/** What the server said a request cost, or null (no header: unpriced, or not through the gateway). */
export function serverCost(response: Response): number | null {
  const v = response.headers.get(COST_HEADER);
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
