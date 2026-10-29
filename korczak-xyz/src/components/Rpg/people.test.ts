import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { heads } from './people';

/** Boxes merged into one geometry, each as [x, y, width, height] with y the bottom. */
function body(...boxes: [number, number, number, number][]): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const [x, y, w, h] of boxes) {
    const g = new THREE.BoxGeometry(w, h, 0.2, 4, 8, 1).translate(x, y + h / 2, 0);
    positions.push(...(g.attributes.position.array as Float32Array));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return g;
}

const person = (x: number, h = 1.8): [number, number, number, number][] => [
  [x - 0.12, 0, 0.12, h * 0.47], // legs, wide apart
  [x + 0.12, 0, 0.12, h * 0.47],
  [x, h * 0.45, 0.4, h * 0.38], // torso
  [x, h * 0.83, 0.22, h * 0.17], // head
];

describe('heads', () => {
  it('counts one for a person, however wide the stance or the arms', () => {
    expect(heads(body(...person(0)))).toBe(1);
    const tPose: [number, number, number, number] = [0, 1.8 * 0.76, 1.8, 0.1];
    expect(heads(body(...person(0), tPose, [-0.6, 0, 0.12, 0.85], [0.6, 0, 0.12, 0.85]))).toBe(1);
  });

  it('counts two for two people side by side, even of different heights', () => {
    expect(heads(body(...person(-0.4), ...person(0.4)))).toBe(2);
    expect(heads(body(...person(-0.4), ...person(0.4, 1.65)))).toBe(2);
  });
});
