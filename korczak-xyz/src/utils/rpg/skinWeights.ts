/*
 * Skin weights from SkinTokens, through the gateway (`/_skin`, `functions/src/rpg/skin.ts`) to the
 * private service in `skin-weights/` (owner, 1 Nov 2026; `.claude/rules/rpg.md`, *the weights from
 * SkinTokens*). The page sends the mesh as the rig worked it out (metres, +y up, facing +z) and the
 * skeleton it already has; the model answers the four heaviest bones of every vertex.
 *
 * Signed-in, approved accounts only, and ~35 s (a minute or so when the service is cold). Null on
 * any failure: the caller keeps the voxel weights it worked out first.
 */
import { gatewayUrl } from './gateway';

function b64(bytes: ArrayBufferView): string {
  const u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

function unb64(s: string): ArrayBuffer {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8.buffer;
}

export interface ServerSkin {
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
  ms: number;
}

/** Why the last call failed, for the console row. */
export class SkinWeightsError extends Error {}

export async function skinTokensWeights(positions: Float32Array, index: ArrayLike<number>, joints: Float32Array, parents: number[]): Promise<ServerSkin> {
  const { auth } = await import('../../lib/firebase');
  const token = await auth?.currentUser?.getIdToken().catch(() => null);
  if (!token) throw new SkinWeightsError('sign in for SkinTokens weights');
  const res = await fetch(`${gatewayUrl()}/_skin`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ positions: b64(positions), index: b64(Uint32Array.from(index)), joints: b64(joints), parents }),
    signal: AbortSignal.timeout(300_000),
  });
  const body = (await res.json().catch(() => ({}))) as { skinIndex?: string; skinWeight?: string; ms?: number; error?: { message?: string } | string };
  if (!res.ok || !body.skinIndex || !body.skinWeight) {
    const why = typeof body.error === 'string' ? body.error : body.error?.message;
    throw new SkinWeightsError(`SkinTokens: ${why ?? res.status}`);
  }
  const skinIndex = new Uint16Array(unb64(body.skinIndex));
  const skinWeight = new Float32Array(unb64(body.skinWeight));
  if (skinIndex.length !== (positions.length / 3) * 4 || skinWeight.length !== skinIndex.length) throw new SkinWeightsError('SkinTokens: answered another mesh');
  return { skinIndex, skinWeight, ms: body.ms ?? 0 };
}
