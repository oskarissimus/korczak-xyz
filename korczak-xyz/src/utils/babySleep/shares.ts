/*
 * Who else may read and write this log.
 *
 * One document per invited address, at `shares/{email}` — top-level, not under the owner's subtree,
 * because a security rule granting the invitee access has to read it *before* it knows whose data is
 * being asked for. A document under `users/{ownerUid}/…` could only be found by already knowing the
 * uid the rule is trying to authorise.
 *
 * The document does three separate jobs, which is why it is worth one round trip:
 *   1. it is the grant itself — `firestore.rules` resolves it with `exists()` and `get()`;
 *   2. it is the pointer that tells the invitee's browser whose log to open (`useDataOwner`);
 *   3. it is the row the owner revokes.
 *
 * Unlike a sleep entry, a share is **really deleted** rather than tombstoned. The rule asks whether
 * the document exists, so a tombstone would leave access granted; and there is no merge here to
 * confuse, because only the owner ever writes these.
 *
 * Every call goes through `runCloud` and reads `getDb()` per call rather than holding it, for the
 * client-death reason in `src/lib/firestoreHealth.ts`.
 */

import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { getDb } from '../../lib/firebase';
import { runCloud } from '../../lib/firestoreHealth';
import { log } from '../../lib/logger';
import { shareKeyFor } from './shareKeys';

export interface Share {
  /** Lowercased address. Also the document id — see `shareKeys.ts` for why they must agree. */
  email: string;
  ownerUid: string;
  /** The owner's address, so the invitee's UI can say whose log this is without a second read. */
  ownerEmail: string | null;
  createdAt: number;
}

function sharesCollection() {
  return collection(getDb()!, 'shares');
}

function normalizeShare(raw: unknown): Share | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.email !== 'string' || r.email === '') return null;
  if (typeof r.ownerUid !== 'string' || r.ownerUid === '') return null;
  return {
    email: r.email,
    ownerUid: r.ownerUid,
    ownerEmail: typeof r.ownerEmail === 'string' ? r.ownerEmail : null,
    createdAt: typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : 0,
  };
}

/**
 * The share held by one address, if any.
 *
 * A missing document is the normal case — it is what "this account owns its own log" looks like —
 * so it returns null rather than throwing. A *failed* read is different and does throw, because the
 * caller must not mistake "cannot tell" for "no share" and start writing to the wrong subtree.
 */
export async function loadShare(email: string | null | undefined): Promise<Share | null> {
  const key = shareKeyFor(email);
  if (!key || !getDb()) return null;
  const snap = await runCloud('babySleep.share.load', () => getDoc(doc(sharesCollection(), key)));
  if (!snap.exists()) return null;
  const share = normalizeShare(snap.data());
  if (!share) log.warn('babySleep.share.rejected', { key });
  return share;
}

/** Every address this account has shared its log with, oldest first. */
export async function listShares(ownerUid: string): Promise<Share[]> {
  if (!getDb()) return [];
  const snap = await runCloud('babySleep.share.list', () =>
    getDocs(query(sharesCollection(), where('ownerUid', '==', ownerUid)))
  );
  const shares: Share[] = [];
  for (const document of snap.docs) {
    const share = normalizeShare(document.data());
    if (share) shares.push(share);
  }
  return shares.sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Grant an address access to this account's log.
 *
 * `email` must already have been through `normalizeShareEmail` — it is used verbatim as the
 * document id, and the rules compare it against a lowercased token address.
 */
export async function addShare(ownerUid: string, ownerEmail: string | null, email: string): Promise<Share> {
  const share: Share = { email, ownerUid, ownerEmail, createdAt: Date.now() };
  if (!getDb()) return share;
  await runCloud('babySleep.share.add', () => setDoc(doc(sharesCollection(), email), share));
  log.info('babySleep.share.added', { ownerUid });
  return share;
}

export async function removeShare(email: string): Promise<void> {
  if (!getDb()) return;
  await runCloud('babySleep.share.remove', () => deleteDoc(doc(sharesCollection(), email)));
  log.info('babySleep.share.removed', {});
}
