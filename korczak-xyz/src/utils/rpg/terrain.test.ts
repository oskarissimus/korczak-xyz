import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PLACE_FLAT, RELIEF_HEIGHT, RELIEFS, Terrain, VILLAGE_FLAT, heightField, reliefFor, terrainSeed, type Clearing } from './terrain';
import { placePosition } from './place';
import { PLACE_RADIUS } from '../../components/Rpg/placeBuilder';
import { roadPoints } from './trail';

// Three places of a world, one in each ring, and the road to each.
const PLACES = [
  { name: 'Bagno', direction: 'north', distance: 'near' },
  { name: 'Stara Kuźnia', direction: 'east', distance: 'far' },
  { name: 'The Drowned Mill', direction: 'southwest', distance: 'distant' },
] as const;
const clearing: Clearing = {
  spots: [{ x: 0, z: 0, r: VILLAGE_FLAT }, ...PLACES.map((p) => ({ ...placePosition(p), r: PLACE_FLAT }))],
  roads: PLACES.map((p) => {
    const { x, z } = placePosition(p);
    return roadPoints(x, z, terrainSeed(p.name), PLACE_RADIUS);
  }),
};
const hilly = new Terrain(terrainSeed('w-test'), 'hilly', clearing);

describe('terrain', () => {
  it('keeps the village and every place flat at 0', () => {
    for (const s of clearing.spots) {
      for (let a = 0; a < Math.PI * 2; a += 0.4) {
        for (const r of [0, s.r * 0.5, s.r - 1]) {
          expect(hilly.heightAt(s.x + Math.sin(a) * r, s.z + Math.cos(a) * r)).toBe(0);
        }
      }
    }
  });

  it('keeps everything a place builds inside its flat', () => {
    expect(PLACE_FLAT).toBeGreaterThanOrEqual(PLACE_RADIUS);
  });

  it('keeps every road flat, its whole width', () => {
    for (const road of clearing.roads) {
      for (let i = 1; i < road.length; i++) {
        const a = road[i - 1];
        const b = road[i];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const nx = -(b.z - a.z) / len;
        const nz = (b.x - a.x) / len;
        for (const t of [0, 0.5]) {
          for (const off of [-1.5, 0, 1.5]) {
            const x = a.x + (b.x - a.x) * t + nx * off;
            const z = a.z + (b.z - a.z) * t + nz * off;
            expect(hilly.heightAt(x, z)).toBe(0);
          }
        }
      }
    }
  });

  it('only ever comes down under a place added later', () => {
    const before = new Terrain(terrainSeed('w-test'), 'hilly', { spots: clearing.spots.slice(0, 2), roads: clearing.roads.slice(0, 1) });
    for (let i = 0; i < hilly.heights.length; i++) expect(hilly.heights[i]).toBeLessThanOrEqual(before.heights[i] + 1e-6);
  });

  it('raises hills right outside the village where no place stands', () => {
    const lone = new Terrain(terrainSeed('w-test'), 'hilly');
    let raised = 0;
    let n = 0;
    for (let a = 0; a < Math.PI * 2; a += 0.1) {
      for (const r of [70, 90]) {
        n++;
        if (lone.heightAt(Math.sin(a) * r, Math.cos(a) * r) > 1) raised++;
      }
    }
    expect(raised / n).toBeGreaterThan(0.4);
  });

  it('never goes below 0 and has real hills between the places', () => {
    let low = Infinity;
    for (const h of hilly.heights) low = Math.min(low, h);
    expect(low).toBeGreaterThanOrEqual(0);
    expect(hilly.info.max).toBeGreaterThan(RELIEF_HEIGHT.hilly.hills * 0.6);
    expect(hilly.info.hilly).toBeGreaterThan(0.1);
  });

  it('grows taller hills for a rougher relief', () => {
    const seed = terrainSeed('same world');
    const max = RELIEFS.map((r) => new Terrain(seed, r).info.max);
    for (let i = 1; i < max.length; i++) expect(max[i]).toBeGreaterThan(max[i - 1]);
  });

  it('is the same land for the same world and another for another', () => {
    const again = new Terrain(terrainSeed('w-test'), 'hilly', clearing);
    expect(again.heights).toEqual(hilly.heights);
    const other = new Terrain(terrainSeed('w-other'), 'hilly', clearing);
    expect(other.heights).not.toEqual(hilly.heights);
  });

  it('answers the grid exactly at its points, and between them stays continuous', () => {
    const field = heightField(terrainSeed('w-test'), 'hilly', clearing);
    for (const [x, z] of [[100, 30], [-140, 160], [62, -110]]) {
      expect(hilly.heightAt(x, z)).toBeCloseTo(field(x, z), 4);
    }
    for (let x = 90; x < 110; x += 0.13) {
      expect(Math.abs(hilly.heightAt(x + 0.01, 31.3) - hilly.heightAt(x, 31.3))).toBeLessThan(0.05);
    }
  });

  it('lies on the triangles of the PlaneGeometry the scene draws', () => {
    const t = new Terrain(terrainSeed('w-plane'), 'rugged', { spots: [], roads: [] }, 20, 2);
    const geo = new THREE.PlaneGeometry(t.half * 2, t.half * 2, t.n, t.n);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) pos.setY(i, t.heights[i]);
    // Every vertex where the grid says it is.
    for (let i = 0; i < pos.count; i++) {
      const ix = i % (t.n + 1);
      const iz = Math.floor(i / (t.n + 1));
      expect(pos.getX(i)).toBeCloseTo(ix * t.step - t.half, 5);
      expect(pos.getZ(i)).toBeCloseTo(iz * t.step - t.half, 5);
    }
    // And a ray straight down meets the mesh at `heightAt`, inside a cell's both triangles.
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const ray = new THREE.Raycaster();
    for (const [x, z] of [[3.3, 4.1], [3.9, 5.7], [-11.2, 0.4], [7.05, -7.9]]) {
      ray.set(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObject(mesh)[0];
      expect(hit.point.y).toBeCloseTo(t.heightAt(x, z), 4);
    }
  });

  it('is flat everywhere when flat', () => {
    const flat = Terrain.flat();
    expect(flat.heightAt(120, -90)).toBe(0);
    expect(flat.slopeAt(120, -90)).toBe(0);
  });

  it('gives a world kept without a relief one from its id', () => {
    expect(reliefFor('w1', 'rugged')).toBe('rugged');
    expect(['rolling', 'hilly']).toContain(reliefFor('w1', undefined));
    expect(reliefFor('w1', undefined)).toBe(reliefFor('w1', undefined));
  });
});
