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
  gain: { value: number };
}

/**
 * Paints `material`'s texture in `color` by `amount` (0–1). Chained after whatever the material
 * already does to its map (`breakTiling` replaces the map's own sampling), by hooking the colour
 * stage that follows it.
 */
export function recolor(material: THREE.Material, color: THREE.ColorRepresentation, amount: number, gain = 2): void {
  const m = material as THREE.MeshStandardMaterial;
  let u = m.userData.recolor as Recolor | undefined;
  if (!u) {
    const uniforms: Recolor = { tint: { value: new THREE.Color(1, 1, 1) }, amount: { value: 0 }, gain: { value: 2 } };
    u = uniforms;
    m.userData.recolor = uniforms;
    const before = m.onBeforeCompile;
    const key = m.customProgramCacheKey?.bind(m);
    m.onBeforeCompile = (shader, renderer) => {
      before?.call(m, shader, renderer);
      shader.uniforms.recolorTint = uniforms.tint;
      shader.uniforms.recolorAmount = uniforms.amount;
      shader.uniforms.recolorGain = uniforms.gain;
      shader.fragmentShader =
        'uniform vec3 recolorTint;\nuniform float recolorAmount;\nuniform float recolorGain;\n' +
        shader.fragmentShader.replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            float lightness = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
            diffuseColor.rgb = mix(diffuseColor.rgb, recolorTint * min(1.0, lightness * recolorGain), recolorAmount);
          }`,
        );
    };
    m.customProgramCacheKey = () => `${key ? key() : ''}|recolor`;
    m.needsUpdate = true;
  }
  u.tint.value.set(color);
  u.amount.value = amount;
  // How far the texture's lightness is lifted before the colour: the leaves are a dark scan, and
  // at the walls' gain a purple forest came out black.
  u.gain.value = gain;
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

/** How much of the sky is cloud, for a world's haze; weather that falls from clouds adds more. */
const COVER: Record<WorldLook['haze'], number> = { clear: 0.32, light: 0.48, thick: 0.62 };
const OVERCAST: Record<WorldLook['weather'], number> = { none: 0, rain: 0.35, snow: 0.3, ash: 0.3, spores: 0.1, sparks: 0.05 };

const SKY_RADIUS = 300;

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 sunColor;
uniform vec3 sunDir;
uniform vec3 cloudLit;
uniform vec3 cloudShade;
uniform float cover;
uniform float night;
uniform float time;
varying vec3 vDir;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 dir = normalize(vDir);
  float up = dir.y;

  // The horizon is the fog's colour, so the land fades into the sky with no seam.
  float t = pow(clamp(up, 0.0, 1.0), 0.45);
  vec3 col = mix(horizon, zenith, t);

  float facing = max(dot(dir, sunDir), 0.0);
  float disc = smoothstep(mix(0.9993, 0.9997, night), mix(0.9996, 0.99985, night), facing);
  vec3 glow = sunColor * (pow(facing, 6.0) * 0.25 + pow(facing, 64.0) * 0.45) * (1.0 - night * 0.7);
  col += glow;

  // Clouds on a ceiling above the world: the direction meets a plane, so they shrink toward the
  // horizon as real ones do, and drift with the wind.
  float cloud = 0.0;
  if (up > 0.0) {
    vec2 p = dir.xz / (up + 0.12) * 1.15 + vec2(time * 0.012, time * 0.004);
    float n = fbm(p);
    float edge = 1.0 - cover;
    cloud = smoothstep(edge - 0.08, edge + 0.22, n) * smoothstep(0.0, 0.25, up);
    // The side toward the sun is lit, the rest in its own shade.
    float lit = clamp(0.35 + 0.65 * (n - fbm(p + sunDir.xz * 0.08)) * 4.0 + facing * 0.4, 0.0, 1.0);
    vec3 cloudCol = mix(cloudShade, cloudLit, lit);
    col = mix(col, cloudCol, cloud * 0.92);
  }

  col += sunColor * disc * (1.0 - cloud) * mix(2.0, 1.1, night);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * The sky: a dome that follows the camera, painted in the shader from the world's colours rather
 * than from a picture, so every invented world has its own without a request or a download. The
 * horizon is the fog's colour (the land meets it with no seam), the zenith a deeper version of the
 * world's sky, the sun (or at night the moon) a disc with its glow where the light actually comes
 * from, and clouds that drift, more of them in thicker haze and in weather that falls.
 */
export class Sky {
  readonly mesh: THREE.Mesh;
  private uniforms: {
    zenith: { value: THREE.Color };
    horizon: { value: THREE.Color };
    sunColor: { value: THREE.Color };
    sunDir: { value: THREE.Vector3 };
    cloudLit: { value: THREE.Color };
    cloudShade: { value: THREE.Color };
    cover: { value: number };
    night: { value: number };
    time: { value: number };
  };

  constructor() {
    this.uniforms = {
      zenith: { value: new THREE.Color() },
      horizon: { value: new THREE.Color() },
      sunColor: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      cloudLit: { value: new THREE.Color() },
      cloudShade: { value: new THREE.Color() },
      cover: { value: 0.4 },
      night: { value: 0 },
      time: { value: Math.random() * 1000 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 32, 16), material);
    // Drawn before anything, behind everything, wherever the camera is.
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
  }

  /** Paints the sky for `look`, with the sun where `sunOffset` (from the player to the light) puts it. */
  set(look: WorldLook, sunOffset: THREE.Vector3): void {
    const u = this.uniforms;
    const isNight = look.time === 'night';
    u.horizon.value.set(look.fog);
    const zenith = new THREE.Color(look.sky);
    const hsl = { h: 0, s: 0, l: 0 };
    zenith.getHSL(hsl);
    // The sky overhead is deeper and more itself than at the horizon, where the haze washes it out.
    zenith.setHSL(hsl.h, Math.min(1, hsl.s * 1.35 + 0.08), hsl.l * (isNight ? 0.6 : 0.78));
    u.zenith.value.copy(zenith);
    u.sunColor.value.set(isNight ? 0xdfe8ff : look.sun);
    u.sunDir.value.copy(sunOffset).normalize();
    u.night.value = isNight ? 1 : 0;
    u.cover.value = Math.min(0.92, COVER[look.haze] + OVERCAST[look.weather]);
    const sun = new THREE.Color(look.sun);
    const fog = new THREE.Color(look.fog);
    if (isNight) {
      u.cloudLit.value.copy(zenith).lerp(new THREE.Color(0x8890a8), 0.35);
      u.cloudShade.value.copy(zenith).multiplyScalar(0.7);
    } else {
      const grey = look.weather === 'rain' || look.weather === 'ash' ? 0.45 : 0;
      u.cloudLit.value.copy(sun).lerp(new THREE.Color(0xffffff), 0.5).lerp(fog, 0.15 + grey * 0.6);
      u.cloudShade.value.copy(fog).lerp(zenith, 0.3).multiplyScalar(0.82 - grey * 0.3);
    }
  }

  /** Moves the dome with the camera and the clouds with the wind. */
  update(dt: number, camera: THREE.Vector3): void {
    this.uniforms.time.value += dt;
    this.mesh.position.copy(camera);
  }
}
