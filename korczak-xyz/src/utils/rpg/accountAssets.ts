/*
 * The page's side of the account's kept assets (`assetStore.ts`): whether the account already has
 * what a button would pay for, and the rigs the browser works out itself, kept on the account so
 * another device does not work them out again.
 *
 * Every answer here is a convenience: signed out, offline, or with Firestore slow, it says "not
 * kept" and the caller asks the provider as before — where the gateway would still answer from the
 * bucket if the account had it.
 */

import { doc, getDoc } from 'firebase/firestore';

import { ASSET_ROOT, MESHY_RIG_MODEL, meshyRigBody, requestFingerprint, selfRigId } from './assetStore';
import { gatewayUrl } from './gateway';

async function signedIn(): Promise<{ uid: string; token: () => Promise<string | null> } | null> {
  const { auth } = await import('../../lib/firebase');
  const user = auth?.currentUser;
  if (!user) return null;
  return { uid: user.uid, token: () => user.getIdToken().catch(() => null) };
}

/** Whether the account has kept the answer to this provider request: asking it again would cost nothing. */
export async function accountHasKept(host: string, path: string, body: Record<string, unknown>): Promise<boolean> {
  try {
    const who = await signedIn();
    if (!who) return false;
    const { getDb } = await import('../../lib/firebase');
    const db = getDb();
    if (!db) return false;
    const fp = await requestFingerprint(host, path, body);
    return (await getDoc(doc(db, ASSET_ROOT, who.uid, 'requests', fp))).exists();
  } catch {
    return false;
  }
}

/** Whether Meshy's rig of `glb` at `height` is kept on the account: made in the game, in the lab, or on another device. */
export function accountHasMeshyRig(glb: string, height: number): Promise<boolean> {
  return accountHasKept('queue.fal.run', `/${MESHY_RIG_MODEL}`, meshyRigBody(glb, height));
}

/** A rig this browser worked out (`people.ts`, packed), from the account; null when it has none. */
export async function fetchSelfRig(cacheKey: string): Promise<ArrayBuffer | null> {
  try {
    const who = await signedIn();
    const token = await who?.token();
    if (!token) return null;
    const res = await fetch(`${gatewayUrl()}/_assets/self-rig/${await selfRigId(cacheKey)}`, {
      headers: { Authorization: `Bearer ${token}` },
      // Working a rig out takes a few seconds; a slow answer is no better than that.
      signal: AbortSignal.timeout(3000),
    });
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}

/** Keeps a rig on the account. Not awaited by anyone: a rig not kept is only worked out again elsewhere. */
export async function keepSelfRig(cacheKey: string, bytes: ArrayBuffer, meta: Record<string, unknown>): Promise<void> {
  try {
    const who = await signedIn();
    const token = await who?.token();
    if (!token) return;
    await fetch(`${gatewayUrl()}/_assets/self-rig/${await selfRigId(cacheKey)}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream', 'X-Rpg-Asset-Meta': JSON.stringify(meta).slice(0, 4000) },
      body: bytes,
    });
  } catch {
    /* worked out again on the next device */
  }
}
