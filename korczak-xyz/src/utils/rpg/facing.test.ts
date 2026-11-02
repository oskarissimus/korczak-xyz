import { describe, expect, it } from 'vitest';

import { facing, figure, turnGlb, view, type Pixels, type TexturedMesh } from './facing';

/**
 * A flat "person": a front sheet at z = +0.1 wound toward +Z and a back sheet at z = −0.1 wound
 * toward −Z, each a grid of quads, the front's top half textured red and its bottom half blue, the
 * back all green. The texture is 2×1: red on the left, blue on the right; green below as a second row.
 */
function sheetPerson(): { mesh: TexturedMesh; texture: Pixels } {
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  const N = 24;
  const sheet = (z: number, out: 1 | -1, uvOf: (y: number) => [number, number]) => {
    const base = positions.length / 3;
    for (let j = 0; j <= N; j++)
      for (let i = 0; i <= N; i++) {
        const x = i / N - 0.5;
        const y = j / N;
        positions.push(x, y, z);
        uvs.push(...uvOf(y));
      }
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const a = base + j * (N + 1) + i;
        const b = a + 1;
        const c = a + N + 1;
        const d = c + 1;
        // Counter-clockwise seen from the side it faces.
        if (out > 0) index.push(a, b, d, a, d, c);
        else index.push(a, d, b, a, c, d);
      }
  };
  sheet(0.1, 1, (y) => (y > 0.5 ? [0.25, 0.25] : [0.75, 0.25]));
  sheet(-0.1, -1, () => [0.5, 0.75]);
  const texture: Pixels = {
    width: 2,
    height: 2,
    data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255, 0, 200, 0, 255, 0, 200, 0, 255]),
  };
  return { mesh: { positions, uvs, index }, texture };
}

/** A picture on white: a figure in its middle, its top half `top` and its bottom half `bottom`. */
function picture(top: [number, number, number], bottom: [number, number, number]): Pixels {
  const S = 64;
  const data = new Uint8ClampedArray(S * S * 4).fill(255);
  for (let y = 8; y < 56; y++)
    for (let x = 16; x < 48; x++) {
      const c = y < 32 ? top : bottom;
      data.set([...c, 255], (y * S + x) * 4);
    }
  return { data, width: S, height: S };
}

describe('view', () => {
  it('sees the side wound toward it, the nearest triangle winning', () => {
    const { mesh, texture } = sheetPerson();
    const front = view(mesh, texture, 1, 8);
    const back = view(mesh, texture, -1, 8);
    // Top row of the grid is the top of the body.
    expect(Array.from(front.slice(0, 3))).toEqual([255, 0, 0]);
    expect(Array.from(front.slice(7 * 8 * 3, 7 * 8 * 3 + 3))).toEqual([0, 0, 255]);
    expect(Array.from(back.slice(0, 3))).toEqual([0, 200, 0]);
  });
});

describe('figure', () => {
  it('cuts the picture to its figure and leaves the white out', () => {
    const fig = figure(picture([255, 0, 0], [0, 0, 255]), 4)!;
    expect(Array.from(fig.slice(0, 3))).toEqual([255, 0, 0]);
    expect(Array.from(fig.slice(15 * 3, 15 * 3 + 3))).toEqual([0, 0, 255]);
  });

  it('is null for a blank picture', () => {
    const blank = { data: new Uint8ClampedArray(16 * 16 * 4).fill(255), width: 16, height: 16 };
    expect(figure(blank)).toBeNull();
  });
});

describe('facing', () => {
  it('keeps a model whose front is the picture', () => {
    const { mesh, texture } = sheetPerson();
    expect(facing(mesh, texture, picture([255, 0, 0], [0, 0, 255]))?.turned).toBe(false);
  });

  it('turns a model whose back is the picture (Mila, 2 Nov 2026)', () => {
    const { mesh, texture } = sheetPerson();
    const seen = facing(mesh, texture, picture([0, 200, 0], [0, 200, 0]))!;
    expect(seen.turned).toBe(true);
    expect(seen.back).toBeLessThan(seen.front);
  });
});

/** The smallest GLB with one mesh: three positions, their normals, and no images. */
function tinyGlb(nodes: object[] = [{ mesh: 0 }]): ArrayBuffer {
  const floats = new Float32Array([1, 2, 3, -4, 5, 6, 0.5, 0, -0.25, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const json = {
    asset: { version: '2.0' },
    nodes,
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 } }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-4, 0, -0.25], max: [1, 5, 6] },
      { bufferView: 0, byteOffset: 36, componentType: 5126, count: 3, type: 'VEC3' },
    ],
    bufferViews: [{ buffer: 0, byteLength: 72 }],
    buffers: [{ byteLength: 72 }],
  };
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const out = new Uint8Array(20 + text.length + 8 + 72);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, out.length, true);
  v.setUint32(12, text.length, true);
  v.setUint32(16, 0x4e4f534a, true);
  out.set(new TextEncoder().encode(text), 20);
  v.setUint32(20 + text.length, 72, true);
  v.setUint32(24 + text.length, 0x004e4942, true);
  out.set(new Uint8Array(floats.buffer), 28 + text.length);
  return out.buffer;
}

function read(glb: ArrayBuffer) {
  const v = new DataView(glb);
  const length = v.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, length)));
  const floats = new Float32Array(glb.slice(20 + length + 8, 20 + length + 8 + 72));
  return { json, floats: Array.from(floats), total: v.getUint32(8, true), size: glb.byteLength };
}

describe('turnGlb', () => {
  it('turns positions and normals 180° about Y, the bounds with them', () => {
    const turned = read(turnGlb(tinyGlb()));
    expect(turned.floats).toEqual([-1, 2, -3, 4, 5, -6, -0.5, 0, 0.25, -0, 0, -1, -0, 0, -1, -0, 0, -1]);
    expect(turned.json.accessors[0].min).toEqual([-1, 0, -6]);
    expect(turned.json.accessors[0].max).toEqual([4, 5, 0.25]);
    expect(turned.total).toBe(turned.size);
  });

  it('refuses a file whose nodes move themselves', () => {
    expect(() => turnGlb(tinyGlb([{ mesh: 0, rotation: [0, 1, 0, 0] }]))).toThrow(/transform/);
  });
});
