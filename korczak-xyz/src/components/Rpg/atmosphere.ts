/*
 * What turns the one village into any world (`utils/rpg/genesis.ts`, `WorldLook`) without a single
 * new model: colour, light and air. The kit's leaves, walls and roofs are recoloured in the shader
 * rather than swapped, the sky, fog and sun are the world's, and weather falls around the player.
 *
 * RECOLOURING, NOT TINTING. Multiplying a colour into a texture that is already green only darkens
 * it: purple leaves came out mud. So `recolor` takes the texture's lightness and paints it in the
 * world's colour, keeping the detail and changing the hue, by `amount` — 0 is the kit as it comes,
 * which is what the classic world asks for. The uniforms live on the material, so a new world
 * changes them without recompiling anything.
 */

import * as THREE from 'three';

import type { WorldLook } from '../../utils/rpg/genesis';

interface Recolor {
  tint: { value: THREE.Color };
  amount: { value: number };
}

/**
 * Paints `material`'s texture in `color` by `amount` (0–1). Chained after whatever the material
 * already does to its map (`breakTiling` replaces the map's own sampling), by hooking the colour
 * stage that follows it.
 */
export function recolor(material: THREE.Material, color: THREE.ColorRepresentation, amount: number): void {
  const m = material as THREE.MeshStandardMaterial;
  let u = m.userData.recolor as Recolor | undefined;
  if (!u) {
    const uniforms: Recolor = { tint: { value: new THREE.Color(1, 1, 1) }, amount: { value: 0 } };
    u = uniforms;
    m.userData.recolor = uniforms;
    const before = m.onBeforeCompile;
    const key = m.customProgramCacheKey?.bind(m);
    m.onBeforeCompile = (shader, renderer) => {
      before?.call(m, shader, renderer);
      shader.uniforms.recolorTint = uniforms.tint;
      shader.uniforms.recolorAmount = uniforms.amount;
      shader.fragmentShader =
        'uniform vec3 recolorTint;\nuniform float recolorAmount;\n' +
        shader.fragmentShader.replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            float lightness = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
            diffuseColor.rgb = mix(diffuseColor.rgb, recolorTint * min(1.0, lightness * 2.0), recolorAmount);
          }`,
        );
    };
    m.customProgramCacheKey = () => `${key ? key() : ''}|recolor`;
    m.needsUpdate = true;
  }
  u.tint.value.set(color);
  u.amount.value = amount;
}

/** How far the fog reaches, near and far, for a world's haze. */
export const HAZE: Record<WorldLook['haze'], [number, number]> = {
  clear: [70, 320],
  light: [40, 170],
  thick: [10, 75],
};

/** The light of a time of day: the sun's height (radians), its strength, and the sky's. */
export const DAYLIGHT: Record<WorldLook['time'], { elevation: number; sun: number; sky: number }> = {
  dawn: { elevation: 0.25, sun: 1.1, sky: 0.65 },
  day: { elevation: 1.0, sun: 1.6, sky: 0.9 },
  dusk: { elevation: 0.2, sun: 1.0, sky: 0.55 },
  // A night bright enough to play in: the moon is the sun, cold and low.
  night: { elevation: 0.7, sun: 0.45, sky: 0.35 },
};

const BOX = 70;
const HEIGHT = 30;

interface Fall {
  count: number;
  size: number;
  /** Metres a second: down is negative. */
  speed: number;
  drift: number;
  opacity: number;
}

const FALLS: Record<Exclude<WorldLook['weather'], 'none'>, Fall> = {
  rain: { count: 2500, size: 0.12, speed: -22, drift: 0.5, opacity: 0.55 },
  snow: { count: 2200, size: 0.18, speed: -1.6, drift: 0.9, opacity: 0.9 },
  ash: { count: 1600, size: 0.16, speed: -0.9, drift: 0.7, opacity: 0.75 },
  spores: { count: 900, size: 0.22, speed: 0.5, drift: 0.6, opacity: 0.85 },
  sparks: { count: 700, size: 0.16, speed: 2.4, drift: 0.8, opacity: 1 },
};

/** Weather around the player: a box of points that wraps, so it is everywhere and costs one draw. */
export class Weather {
  readonly points: THREE.Points;
  private fall: Fall;
  private positions: Float32Array;
  private phase: Float32Array;
  private time = 0;

  constructor(kind: Exclude<WorldLook['weather'], 'none'>, color: THREE.ColorRepresentation) {
    this.fall = FALLS[kind];
    const n = this.fall.count;
    this.positions = new Float32Array(n * 3);
    this.phase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.positions[i * 3] = (Math.random() - 0.5) * BOX;
      this.positions[i * 3 + 1] = Math.random() * HEIGHT;
      this.positions[i * 3 + 2] = (Math.random() - 0.5) * BOX;
      this.phase[i] = Math.random() * Math.PI * 2;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    const glow = kind === 'sparks' || kind === 'spores';
    this.points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color,
        size: this.fall.size,
        transparent: true,
        opacity: this.fall.opacity,
        depthWrite: false,
        blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    );
    // It follows the player, so it is never where its first bounding sphere said.
    this.points.frustumCulled = false;
  }

  /** Moves every particle; one that leaves the box around `centre` comes back in on the far side. */
  update(dt: number, centre: THREE.Vector3): void {
    this.time += dt;
    const { speed, drift } = this.fall;
    const p = this.positions;
    const half = BOX / 2;
    for (let i = 0; i < this.phase.length; i++) {
      const k = i * 3;
      p[k + 1] += speed * dt;
      p[k] += Math.sin(this.time * 0.7 + this.phase[i]) * drift * dt;
      p[k + 2] += Math.cos(this.time * 0.5 + this.phase[i]) * drift * dt;
      if (p[k + 1] < 0) p[k + 1] += HEIGHT;
      else if (p[k + 1] > HEIGHT) p[k + 1] -= HEIGHT;
      // Kept in world space, so walking leaves the weather where it falls and finds more ahead.
      if (p[k] - centre.x > half) p[k] -= BOX;
      else if (p[k] - centre.x < -half) p[k] += BOX;
      if (p[k + 2] - centre.z > half) p[k + 2] -= BOX;
      else if (p[k + 2] - centre.z < -half) p[k + 2] += BOX;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

/** A dome of stars for a night sky, beyond the fog so the fog does not eat it. */
export function stars(): THREE.Points {
  const n = 1200;
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const h = 0.08 + Math.random() * 0.92;
    const r = Math.sqrt(1 - h * h);
    positions[i * 3] = Math.cos(a) * r * 380;
    positions[i * 3 + 1] = h * 380;
    positions[i * 3 + 2] = Math.sin(a) * r * 380;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }),
  );
  points.frustumCulled = false;
  return points;
}
