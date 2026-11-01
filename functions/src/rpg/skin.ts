/*
 * `/_skin`: skin weights from SkinTokens for a character the page has already given a skeleton
 * (owner, 1 Nov 2026: "do 1 from the report"; `.claude/rules/rpg.md`, *the weights from
 * SkinTokens*). The model is 2.3 GB and ~35 s of four vCPUs, so it runs in its own private Cloud Run
 * service (`skin-weights/`), which only this function's identity may invoke. This route is the
 * gate in front of it: a signed-in, approved account, a body of a sane size, then the request passed
 * on with a Google identity token for that service.
 *
 * About half a cent a call, paid by the project rather than by a reader's key: there is no provider
 * to bill, and a character is rigged once and kept on the account (`/_assets/self-rig`).
 */
import type { Response } from 'express';

import { db } from '../runtime';

export const SKIN_PATH = '/_skin';
export const SKIN_URL = process.env.SKIN_WEIGHTS_URL || 'https://skin-weights-1068962621574.europe-central2.run.app';
/** ~100k vertices as base64 float32 and triangles as uint32: generous for a TRELLIS model (~10k). */
export const SKIN_MAX_BYTES = 8 * 1024 * 1024;

export class SkinRefusal extends Error {
  constructor(readonly status: number, readonly reason: string, message: string) {
    super(message);
  }
}

async function approved(uid: string): Promise<boolean> {
  const snap = await db.doc(`accounts/${uid}`).get();
  return snap.data()?.approved === true;
}

/** An identity token for the service, from the metadata server (the function's own identity). */
async function identityToken(audience: string): Promise<string> {
  const res = await fetch(
    `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}`,
    { headers: { 'Metadata-Flavor': 'Google' } },
  );
  if (!res.ok) throw new Error(`metadata identity: ${res.status}`);
  return res.text();
}

export async function handleSkin(uid: string | null, body: Buffer | undefined, res: Response): Promise<void> {
  if (!uid) throw new SkinRefusal(401, 'auth', 'skin weights: sign in first');
  if (!body?.length || body.length > SKIN_MAX_BYTES) throw new SkinRefusal(413, 'size', 'skin weights: the mesh is empty or too big');
  if (!(await approved(uid))) throw new SkinRefusal(403, 'approval', 'skin weights: an approved account only');
  const answer = await fetch(SKIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await identityToken(SKIN_URL)}` },
    body: new Uint8Array(body),
    signal: AbortSignal.timeout(280_000),
  });
  res.status(answer.status).set('Content-Type', 'application/json').send(Buffer.from(await answer.arrayBuffer()));
}
