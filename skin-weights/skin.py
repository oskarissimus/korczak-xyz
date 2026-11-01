"""
Skin weights for a mesh and a skeleton we already have, from SkinTokens (VAST-AI-Research, MIT;
ONNX export by QtMeshEditor, `fernandotonon/QtMeshEditor-skintokens-onnx`, MIT).

The model is Qwen3-0.6B reading a point cloud of the mesh and the skeleton as tokens, then writing
four tokens per bone, each bone's four decoded by a small VAE into a weight for every sampled
point. We give it the skeleton (teacher forcing) instead of letting it draw one, so the bones stay
the donor's 24 the game's clips were made on; the model decides only who moves which part of the
mesh. See `.claude/rules/rpg.md`, *the weights from SkinTokens*, for why.

The contract, from the reference code (`src/model/tokenrig.py` in the VAST-AI/SkinTokens Space) and
the export's README:
  - the mesh in Blender's frame (+z up, facing -y), since the training data came through bpy;
  - mesh and joints fitted together into [-1, 1] about their joint box's centre;
  - 8192 surface samples with their normals;
  - skeleton tokens: bos, cls `articulation`, then each bone in depth-first order as its joint's
    xyz in 256 bins - preceded by `branch` and its parent's xyz when its parent is not the bone
    just before it - then eos;
  - greedy decode of 4 tokens per bone from the FSQ range;
  - each bone's 4 tokens -> a weight per sample; samples -> vertices by 8 nearest, by inverse
    distance; the four heaviest bones per vertex, summing to 1.
"""
import os
import time

import numpy as np
import onnxruntime as ort
from scipy.spatial import cKDTree

N = 8192
BOS, EOS, BRANCH, CLS = 257, 258, 256, 266
SKIN0, SKIN1 = 267, 33035
LAYERS = 28


class SkinTokens:
    def __init__(self, folder: str):
        opt = ort.SessionOptions()
        opt.intra_op_num_threads = int(os.environ.get('THREADS', '0')) or os.cpu_count() or 4
        self.s = {
            k: ort.InferenceSession(os.path.join(folder, k + '.onnx'), opt, providers=['CPUExecutionProvider'])
            for k in ('mesh_cond', 'vae_cond', 'embed', 'skin_decode', 'decoder')
        }

    def weights(self, positions, index, joints, parents, seed=0):
        """positions (n,3) and joints (b,3) in metres, +y up, facing +z; index (f,3); parents (b) with -1 at the root.
        Returns skin_index (n,4) uint16, skin_weight (n,4) float32 and timings."""
        t = {'start': time.time()}
        P = np.asarray(positions, np.float32).reshape(-1, 3)
        F = np.asarray(index, np.int64).reshape(-1, 3)
        J = np.asarray(joints, np.float32).reshape(-1, 3)
        b = len(parents)
        if J.shape[0] != b:
            raise ValueError('one joint per bone')
        order = depth_first(parents)

        def blender(a):
            return np.stack([a[:, 0], -a[:, 2], a[:, 1]], 1)

        Pb, Jb = blender(P), blender(J)
        lo = np.minimum(Pb.min(0), Jb.min(0))
        hi = np.maximum(Pb.max(0), Jb.max(0))
        c, s = (lo + hi) / 2, max(float((hi - lo).max()) / 2, 1e-6)
        Pn, Jn = (Pb - c) / s, (Jb - c) / s

        pts, nrm = surface_samples(Pn, F, N, seed)
        cond = np.concatenate([pts, nrm], -1)[None].astype(np.float32)
        mesh_embeds = self.s['mesh_cond'].run(None, {'vertices': pts[None], 'normals': nrm[None]})[0]
        cond_lat = self.s['vae_cond'].run(None, {'cond': cond})[0]
        t['encode'] = time.time()

        tokens = [BOS, CLS]
        prev = None
        for k, bone in enumerate(order):
            p = parents[bone]
            if k > 0 and p != prev:
                tokens += [BRANCH] + bins(Jn[p]) + bins(Jn[bone])
            else:
                tokens += bins(Jn[bone])
            prev = bone
        tokens.append(EOS)
        x = np.concatenate([mesh_embeds, self.embed(tokens)], 1).astype(np.float32)
        past = {f'past.{l}.{kv}': np.zeros((1, 8, 0, 128), np.float32) for l in range(LAYERS) for kv in ('key', 'value')}
        ids = []
        for _ in range(b * 4):
            r = self.s['decoder'].run(None, {'inputs_embeds': x, **past})
            past = {f'past.{l}.{kv}': r[1 + 2 * l + (kv == 'value')] for l in range(LAYERS) for kv in ('key', 'value')}
            nxt = SKIN0 + int(np.argmax(r[0][0, -1, SKIN0:SKIN1]))
            ids.append(nxt)
            x = self.embed([nxt])
        t['decode'] = time.time()

        W = np.zeros((N, b), np.float32)
        for k, bone in enumerate(order):
            four = np.array([ids[k * 4:(k + 1) * 4]], np.int64) - SKIN0
            W[:, bone] = self.s['skin_decode'].run(None, {'skin_ids': four, 'cond': cond, 'cond_latents': cond_lat})[0][0]
        W = np.clip(W, 0, None)
        t['skin'] = time.time()

        d, near = cKDTree(pts).query(Pn, k=8)
        w = 1 / np.maximum(d, 1e-6)
        w /= w.sum(1, keepdims=True)
        V = (W[near] * w[..., None]).sum(1)
        top = np.argsort(-V, axis=1)[:, :4]
        tw = np.take_along_axis(V, top, 1)
        tw /= np.maximum(tw.sum(1, keepdims=True), 1e-8)
        t['transfer'] = time.time()
        timings = {k: round(t[k] - t['start'], 2) for k in ('encode', 'decode', 'skin', 'transfer')}
        return top.astype(np.uint16), tw.astype(np.float32), timings

    def embed(self, ids):
        return self.s['embed'].run(None, {'input_ids': np.array([ids], np.int64)})[0]


def bins(v):
    return np.clip(np.round((v + 1) / 2 * 256), 0, 255).astype(np.int64).tolist()


def depth_first(parents):
    kids = {i: [] for i in range(len(parents))}
    roots = [i for i, p in enumerate(parents) if p < 0]
    if len(roots) != 1:
        raise ValueError('one root')
    for i, p in enumerate(parents):
        if p >= 0:
            kids[p].append(i)
    out, stack = [], [roots[0]]
    while stack:
        i = stack.pop()
        out.append(i)
        stack.extend(reversed(kids[i]))
    if len(out) != len(parents):
        raise ValueError('bones not connected to the root')
    return out


def surface_samples(P, F, n, seed):
    """n points on the triangles, by area, each with its triangle's normal."""
    a, b, c = P[F[:, 0]], P[F[:, 1]], P[F[:, 2]]
    cross = np.cross(b - a, c - a)
    area = np.linalg.norm(cross, axis=1)
    rng = np.random.default_rng(seed)
    f = rng.choice(len(F), size=n, p=area / area.sum())
    u, v = rng.random(n), rng.random(n)
    flip = u + v > 1
    u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
    pts = a[f] + (b[f] - a[f]) * u[:, None] + (c[f] - a[f]) * v[:, None]
    nrm = cross[f] / np.maximum(area[f][:, None], 1e-12)
    return pts.astype(np.float32), nrm.astype(np.float32)
