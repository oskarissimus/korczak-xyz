/*
 * The browser's half of the site's gateway (born as the RPG's; every app's since 31 Oct 2026 — see
 * the top of `functions/src/rpg/gateway.ts`, and `gatewayRoutes.ts`): every request an app makes to
 * Google, OpenAI, DeepSeek, ElevenLabs or fal.ai, and the audio guide's to its own function, goes
 * through `apiFetch`, which sends it to the server instead, without the account's key.
 *
 * The call sites still build the provider's own request, key and all, and hand it here in place of
 * `fetch`: what the key IS decides how it travels.
 * - `ACCOUNT_KEY` (what `useAccountKeys` hands a signed-in reader for a key the account holds) is not a key at
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

import {
  ACCOUNT_STATUS_PATH,
  AUDIO_GUIDE_KEY_HEADERS,
  BYOK_HEADER,
  COST_HEADER,
  GATEWAY_HOSTS,
  LIVE_TOKEN_PATH,
  QUEST_HEADER,
  WORLD_HEADER,
} from './gatewayRoutes';
import { ACCOUNT_KEY } from '../accountKeys/keys';
import { ADMIN_PATH, type AdminPatch, type AdminStatus } from './adminConfig';
import { ADMIN_WALLETS_PATH, type WalletPatch, type WalletsPage } from './wallets';
import {
  ADMIN_REQUEST_PATH,
  ADMIN_REQUESTS_PATH,
  type RequestBodies,
  type RequestLogEntry,
  type RequestsPage,
} from './requestLog';
import { KEEP_HEADER, keepsAssets } from './assetStore';
import { REFUEL_PATH, WALLET_PATH, type WalletStatus } from './wallet';

export { ACCOUNT_KEY };

/** The site's own project when the build names none (a local `astro dev` without `.env`, the tests), as `functions/src/runtime.ts` does. */
const DEFAULT_PROJECT = 'korczak-xyz-501720';

export function gatewayUrl(): string {
  const override = import.meta.env.PUBLIC_RPG_API_URL as string | undefined;
  if (override) return override.replace(/\/$/, '');
  const project = (import.meta.env.PUBLIC_FIREBASE_PROJECT_ID as string | undefined) || DEFAULT_PROJECT;
  return `https://europe-central2-${project}.cloudfunctions.net/rpgApi`;
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
  // The page may know the reader from the sign-in cache (`authCache.ts`) before Firebase has restored
  // them: wait for that once rather than calling them signed out. The diesel tank was asked in that
  // window and never again, so a signed-in reader got the hand-written quest (9 Nov 2026).
  if (auth && !auth.currentUser) await auth.authStateReady().catch(() => {});
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
  // The audio guide's function takes its keys in its own headers; the gateway fills a handle in any
  // of them from the account, so only the ID token has to be added for those.
  const handleInOwnHeader =
    GATEWAY_HOSTS[url.host] === 'audioguide' &&
    Object.keys(AUDIO_GUIDE_KEY_HEADERS).some((h) => headers.get(h) === ACCOUNT_KEY);
  if (key === ACCOUNT_KEY || handleInOwnHeader) {
    const token = await idToken();
    if (!token) throw new Error('rpg gateway: signed out — sign in again to use the account\'s keys');
    headers.set('Authorization', `Bearer ${token}`);
  } else if (key) {
    headers.set(BYOK_HEADER, key);
  }
  const { world, quest } = context();
  if (world) headers.set(WORLD_HEADER, world.slice(0, 120));
  if (quest) headers.set(QUEST_HEADER, quest.slice(0, 120));
  // The RPG's pages keep what they generate, and are answered from it (`assetStore.ts`); no other app's
  // are. The mark is also what lets diesel pay (`wallet.ts`). The game's own build (`astro build
  // --mode rpg`, everyrpg.korczak.xyz) is nothing but the game, at `/` rather than `/apps/rpg/`.
  if (typeof location !== 'undefined' && (import.meta.env.MODE === 'rpg' || keepsAssets(location.pathname))) headers.set(KEEP_HEADER, '1');
  return fetch(`${base}/${url.host}${url.pathname}${url.search}`, { ...init, headers });
}

async function signedInCall(path: string, method: string, signal?: AbortSignal, body?: unknown): Promise<Response> {
  const token = await idToken();
  if (!token) throw new Error('gateway: signed out');
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`${gatewayUrl()}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
}

/** The reader's diesel tank (`wallet.ts`), granting the first one; null signed out or unreachable. */
export async function fetchWallet(signal?: AbortSignal): Promise<WalletStatus | null> {
  try {
    const response = await signedInCall(WALLET_PATH, 'GET', signal);
    if (!response.ok) return null;
    const body = (await response.json()) as WalletStatus;
    return typeof body?.balanceUsd === 'number' && body.server ? body : null;
  } catch {
    return null;
  }
}

/** An admin's free canister (`/wallet/refuel`): the tank after it, or null when refused. */
export async function refuelWallet(canister: string): Promise<WalletStatus | null> {
  try {
    const response = await signedInCall(REFUEL_PATH, 'POST', undefined, { canister });
    if (!response.ok) return null;
    return (await response.json()) as WalletStatus;
  } catch {
    return null;
  }
}

/** The game's admin panel (`adminConfig.ts`): every section, or — with a patch — saved, then every section. */
export async function adminConfig(patch?: AdminPatch, signal?: AbortSignal): Promise<AdminStatus> {
  const response = await signedInCall(ADMIN_PATH, patch ? 'POST' : 'GET', signal, patch);
  const body = (await response.json().catch(() => null)) as (AdminStatus & { reason?: string; error?: { message?: string } }) | null;
  if (!response.ok || !body) {
    throw Object.assign(new Error(body?.error?.message ?? `gateway: admin ${response.status}`), {
      status: response.status,
      reason: body?.reason ?? null,
    });
  }
  return body;
}

async function adminGet<T>(path: string, signal?: AbortSignal, patch?: unknown): Promise<T> {
  const response = await signedInCall(path, patch ? 'POST' : 'GET', signal, patch);
  const body = (await response.json().catch(() => null)) as (T & { reason?: string; error?: { message?: string } }) | null;
  if (!response.ok || !body) throw new Error(body?.error?.message ?? `gateway: admin ${response.status}`);
  return body;
}

/** The request log of a range (`requestLog.ts`), newest first; admins only. */
export function adminRequests(from: number, to: number, signal?: AbortSignal): Promise<RequestsPage> {
  return adminGet<RequestsPage>(`${ADMIN_REQUESTS_PATH}?from=${Math.floor(from)}&to=${Math.ceil(to)}`, signal);
}

/** One logged request with what was sent and what came back; admins only. */
export function adminRequest(id: string, signal?: AbortSignal): Promise<{ entry: RequestLogEntry; bodies: RequestBodies | null }> {
  return adminGet(`${ADMIN_REQUEST_PATH}?id=${encodeURIComponent(id)}`, signal);
}

/** What the gateway says of the account's keys — never a key, only which exist and their last four characters. */
export interface AccountKeyStatus {
  keys: Record<string, string | null>;
  openaiCredit: { amount: number; at: number } | null;
  audioGuideWriter: string;
  updatedAt: number;
}

export async function fetchAccountKeyStatus(signal?: AbortSignal): Promise<AccountKeyStatus> {
  const response = await signedInCall(ACCOUNT_STATUS_PATH, 'GET', signal);
  if (!response.ok) throw new Error(`gateway: account keys ${response.status}`);
  return (await response.json()) as AccountKeyStatus;
}

/** A single-use Gemini Live token minted from the account's Google key (a socket cannot go through the gateway). */
export async function fetchLiveToken(): Promise<string> {
  const response = await signedInCall(LIVE_TOKEN_PATH, 'POST');
  const body = (await response.json().catch(() => null)) as { token?: string; error?: { message?: string } } | null;
  if (!response.ok || !body?.token) throw new Error(body?.error?.message ?? `gateway: live token ${response.status}`);
  return body.token;
}

/** What the server said a request cost, or null (no header: unpriced, or not through the gateway). */
export function serverCost(response: Response): number | null {
  const v = response.headers.get(COST_HEADER);
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** The providers' wallets beside the log's estimate (`wallets.ts`); with a patch, applied first. Admins only. */
export function adminWallets(patch?: WalletPatch, signal?: AbortSignal): Promise<WalletsPage> {
  return adminGet<WalletsPage>(ADMIN_WALLETS_PATH, signal, patch);
}
