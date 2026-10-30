/** Test GLBs for the shape check (`meshShape.ts`): a box, and the crossed card TRELLIS makes. */

/** A GLB of one indexed primitive, as TRELLIS writes them: float positions, uint32 indices. */
export function makeGlb(quads: number[][][]): ArrayBuffer {
  const positions = quads.flat(2);
  const index: number[] = [];
  quads.forEach((_, q) => index.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3));
  const bin = new Uint8Array(index.length * 4 + positions.length * 4);
  new Uint32Array(bin.buffer, 0, index.length).set(index);
  new Float32Array(bin.buffer, index.length * 4, positions.length).set(positions);
  const json = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: index.length * 4 },
      { buffer: 0, byteOffset: index.length * 4, byteLength: positions.length * 4 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5125, count: index.length, type: 'SCALAR' },
      { bufferView: 1, componentType: 5126, count: positions.length / 3, type: 'VEC3' },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 1 }, indices: 0 }] }],
  };
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const head = new TextEncoder().encode(text);
  const out = new ArrayBuffer(12 + 8 + head.length + 8 + bin.length);
  const v = new DataView(out);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, out.byteLength, true);
  v.setUint32(12, head.length, true);
  v.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(out, 20, head.length).set(head);
  v.setUint32(20 + head.length, bin.length, true);
  v.setUint32(24 + head.length, 0x004e4942, true);
  new Uint8Array(out, 28 + head.length).set(bin);
  return out;
}

const h = 0.5;
/** The six faces of a unit box: a house, a crate. */
export const box = [
  [[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]],
  [[-h, -h, -h], [-h, h, -h], [h, h, -h], [h, -h, -h]],
  [[h, -h, -h], [h, h, -h], [h, h, h], [h, -h, h]],
  [[-h, -h, -h], [-h, -h, h], [-h, h, h], [-h, h, -h]],
  [[-h, h, -h], [-h, h, h], [h, h, h], [h, h, -h]],
  [[-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h]],
];
/** Two sheets crossed through the middle, each painted both ways round: what TRELLIS made of an old oak. */
export const crossed = [
  [[-h, -h, 0], [h, -h, 0], [h, h, 0], [-h, h, 0]],
  [[-h, -h, 0], [-h, h, 0], [h, h, 0], [h, -h, 0]],
  [[0, -h, -h], [0, h, -h], [0, h, h], [0, -h, h]],
  [[0, -h, -h], [0, -h, h], [0, h, h], [0, h, -h]],
];
