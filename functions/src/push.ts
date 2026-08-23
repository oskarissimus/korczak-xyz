/*
 * Sending one notification, and pruning what is no longer reachable.
 *
 * Raw Web Push over VAPID, not FCM: there is exactly one service worker on this origin (iOS shares
 * a single registration across every installed app), and FCM's web SDK wants its own worker file
 * plus an importScripts of the compat bundle. This is forty lines and adds nothing to the browser.
 */

import type { Firestore } from 'firebase-admin/firestore';
import webpush from 'web-push';
import type { NoticeKind, PushSub } from '../../korczak-xyz/src/utils/events/types';

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
  kind: NoticeKind | 'test' | 'summary' | 'source-health';
}

/**
 * The wire format.
 *
 * A Declarative Web Push envelope (`web_push: 8030`) with our own flat fields alongside. On Safari
 * 18.4+ the OS renders `notification` itself even if the worker's JS throws, *and* still dispatches
 * the push event — so the same object serves both paths, and older Safari simply ignores the magic
 * key and takes the classic route. Belt and braces at no cost.
 *
 * The flat copy is not redundant: `parsePushPayload` prefers the nested object when present, but a
 * future sender or an older worker may only understand one of the two.
 */
export function buildPayload(payload: PushPayload): string {
  return JSON.stringify({
    web_push: 8030,
    notification: {
      title: payload.title,
      body: payload.body,
      navigate: payload.url,
      tag: payload.tag,
      lang: 'pl',
    },
    title: payload.title,
    body: payload.body,
    url: payload.url,
    tag: payload.tag,
    kind: payload.kind,
  });
}

/**
 * How long the push service should hold an undelivered message.
 *
 * A `soon` reminder is worthless once its day has passed; an announcement keeps for a week.
 */
export function ttlFor(kind: PushPayload['kind']): number {
  return kind === 'soon' ? 86400 : 604800;
}

export interface SendOutcome {
  ok: boolean;
  statusCode?: number;
  error?: string;
  /** True when the subscription was deleted because the endpoint is permanently gone. */
  pruned?: boolean;
}

export function configureWebPush(subject: string, publicKey: string, privateKey: string): void {
  // Apple rejects a `sub` that is not mailto: or https:, with a 400 that names no field.
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

export async function sendTo(
  db: Firestore,
  uid: string,
  sub: PushSub,
  payload: PushPayload,
): Promise<SendOutcome> {
  const body = buildPayload(payload);
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.authKey } },
      body,
      { TTL: ttlFor(payload.kind), urgency: 'normal' },
    );
    await db
      .collection('users').doc(uid).collection('pushSubs').doc(sub.id)
      .set({ lastPushAt: Date.now(), lastError: null }, { merge: true });
    return { ok: true, statusCode: 201 };
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    const message = e instanceof Error ? e.message : String(e);

    /*
     * 404 and 410 are the ONLY codes that delete a subscription. They mean the endpoint is
     * permanently gone.
     *
     * A 403 is a VAPID key mismatch — deleting on that would wipe every subscription on the account
     * the first time a secret is fumbled, and there would be nothing left to re-arm from. A 429 or
     * 503 is the push service asking us to come back later. Both leave the row alone.
     */
    if (status === 404 || status === 410) {
      await db.collection('users').doc(uid).collection('pushSubs').doc(sub.id).delete();
      return { ok: false, statusCode: status, error: message, pruned: true };
    }

    await db
      .collection('users').doc(uid).collection('pushSubs').doc(sub.id)
      .set({ lastError: `${status ?? '?'}: ${message}`.slice(0, 300) }, { merge: true });
    return { ok: false, statusCode: status, error: message };
  }
}

/** Sends to every device on the account. Succeeds if any one of them took it. */
export async function sendToAll(
  db: Firestore,
  uid: string,
  subs: PushSub[],
  payload: PushPayload,
): Promise<{ delivered: number; pruned: number; lastError?: string }> {
  let delivered = 0;
  let pruned = 0;
  let lastError: string | undefined;
  for (const sub of subs) {
    const outcome = await sendTo(db, uid, sub, payload);
    if (outcome.ok) delivered += 1;
    else {
      if (outcome.pruned) pruned += 1;
      lastError = `${outcome.statusCode ?? '?'}: ${outcome.error ?? 'failed'}`;
    }
  }
  return { delivered, pruned, lastError };
}
