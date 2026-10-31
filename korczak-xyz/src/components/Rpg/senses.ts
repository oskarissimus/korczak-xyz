/*
 * The witcher's senses (owner, 26 Oct 2026: "a button for a hint, like witcher senses, to light up
 * the things to examine — and the path should light up the same way"). Q, or 👁 on a phone,
 * sharpens them for `SENSES_SECONDS`: every clue, and every thing the job wants found or killed,
 * gets a beam and a pulsing ring that show through walls and fog, and footprints glow along the
 * trail to wherever the marker points (`utils/rpg/trail.ts`), lit outward from the hunter's feet
 * like a wave.
 *
 * All of it is light, not hue: additive, bright on whatever is behind it, and pulsing, so it reads
 * on the owner's black-and-white phone as well as in colour. The screen's edge darkens too (a CSS
 * vignette in `Rpg.tsx`), which is the cue that the senses are on and the rest of the world is not
 * the point for a moment.
 *
 * Cheap: one instanced mesh for the footprints, a pool of a dozen halos, nothing allocated per
 * frame, everything hidden while the senses are off.
 */

import * as THREE from 'three';

import type { Footprint } from '../../utils/rpg/trail';

export const SENSES_SECONDS = 12;
const MAX_PRINTS = 200;
const HALOS = 12;
/** How fast the footprints light up from the hunter outward, metres a second. */
const WAVE = 30;
const GLOW = new THREE.Color(0xff7a3d);

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (g) draw(g);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A sole and a heel, soft-edged, white on black: additive, the black adds nothing. */
function footTexture(): THREE.Texture {
  return canvasTexture(64, 128, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, 64, 128);
    const blob = (x: number, y: number, rx: number, ry: number) => {
      g.save();
      g.translate(x, y);
      g.scale(rx / ry, 1);
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, ry);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.6, 'rgba(255,255,255,0.75)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(0, 0, ry, 0, Math.PI * 2);
      g.fill();
      g.restore();
    };
    blob(32, 40, 20, 34);
    blob(32, 102, 15, 20);
  });
}

/** Bright at the foot of the beam, gone at its top. */
function beamTexture(): THREE.Texture {
  return canvasTexture(4, 64, (g) => {
    const grad = g.createLinearGradient(0, 64, 0, 0);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 64);
  });
}

function glowMaterial(map: THREE.Texture | null, throughWalls: boolean): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: GLOW,
    map,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: !throughWalls,
    fog: false,
    side: THREE.DoubleSide,
  });
}

interface Halo {
  group: THREE.Group;
  beam: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
}

/** What the senses light: where it stands, and whether it is a clue (brighter) or the job's. */
export interface SenseTarget {
  position: THREE.Vector3;
  clue: boolean;
}

export class SensesView {
  private scene: THREE.Scene;
  private prints: THREE.InstancedMesh;
  private printList: Footprint[] = [];
  private halos: Halo[] = [];
  /** 0 off, 1 fully on; eased so the world changes over a third of a second rather than at once. */
  private level = 0;
  private on = false;
  /** When the wave started, in the scene's clock. */
  private since = 0;
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();

  /** The height of the ground at (x, z): the prints and the halos lie on the hills (`terrain.ts`). */
  private groundAt: (x: number, z: number) => number;

  constructor(scene: THREE.Scene, groundAt: (x: number, z: number) => number = () => 0) {
    this.scene = scene;
    this.groundAt = groundAt;
    const foot = new THREE.PlaneGeometry(0.24, 0.46);
    foot.rotateX(-Math.PI / 2);
    // Footprints lie on the ground and are hidden by what stands on it: depth-tested, unlike the halos.
    const mat = glowMaterial(footTexture(), false);
    mat.color.set(0xffffff);
    this.prints = new THREE.InstancedMesh(foot, mat, MAX_PRINTS);
    this.prints.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.prints.count = 0;
    this.prints.frustumCulled = false;
    this.prints.renderOrder = 5;
    this.prints.visible = false;
    for (let i = 0; i < MAX_PRINTS; i++) this.prints.setColorAt(i, this.color.setRGB(0, 0, 0));
    scene.add(this.prints);

    const beamGeo = new THREE.CylinderGeometry(0.22, 0.45, 9, 12, 1, true);
    beamGeo.translate(0, 4.5, 0);
    const ringGeo = new THREE.RingGeometry(0.75, 1, 40);
    ringGeo.rotateX(-Math.PI / 2);
    const beamMap = beamTexture();
    for (let i = 0; i < HALOS; i++) {
      const beam = new THREE.Mesh(beamGeo, glowMaterial(beamMap, true));
      const ring = new THREE.Mesh(ringGeo, glowMaterial(null, true));
      ring.position.y = 0.05;
      const group = new THREE.Group();
      group.add(beam, ring);
      group.visible = false;
      group.renderOrder = 6;
      beam.renderOrder = 6;
      ring.renderOrder = 6;
      scene.add(group);
      this.halos.push({ group, beam, ring });
    }
  }

  get active(): boolean {
    return this.on;
  }

  setActive(on: boolean, now: number) {
    if (on && !this.on) this.since = now;
    this.on = on;
  }

  /** The trail to light, from the hunter's feet. */
  setTrail(prints: Footprint[]) {
    this.printList = prints.slice(0, MAX_PRINTS);
    this.prints.count = this.printList.length;
    for (let i = 0; i < this.printList.length; i++) {
      const p = this.printList[i];
      this.dummy.position.set(p.x, this.groundAt(p.x, p.z) + 0.12, p.z);
      this.dummy.rotation.set(0, p.angle, 0);
      this.dummy.updateMatrix();
      this.prints.setMatrixAt(i, this.dummy.matrix);
    }
    this.prints.instanceMatrix.needsUpdate = true;
  }

  update(dt: number, now: number, targets: SenseTarget[]) {
    this.level += ((this.on ? 1 : 0) - this.level) * Math.min(1, dt * 6);
    if (!this.on && this.level < 0.01) this.level = 0;
    const level = this.level;
    const visible = level > 0;

    this.prints.visible = visible && this.printList.length > 0;
    if (this.prints.visible) {
      const front = (now - this.since) * WAVE;
      for (let i = 0; i < this.printList.length; i++) {
        const along = this.printList[i].along;
        const lit = Math.max(0, Math.min(1, (front - along) / 4));
        // A slow ripple travelling outward along the track, so it reads as a direction.
        const ripple = 0.55 + 0.45 * Math.sin(along * 0.45 - now * 5);
        // Fainter far off, and never brighter than the ground needs to show it.
        const far = 1 - Math.min(0.6, along / 260);
        this.prints.setColorAt(i, this.color.copy(GLOW).multiplyScalar(level * lit * ripple * far * 2));
      }
      if (this.prints.instanceColor) this.prints.instanceColor.needsUpdate = true;
    }

    for (let i = 0; i < this.halos.length; i++) {
      const halo = this.halos[i];
      const target = visible ? targets[i] : undefined;
      halo.group.visible = !!target;
      if (!target) continue;
      halo.group.position.set(target.position.x, this.groundAt(target.position.x, target.position.z), target.position.z);
      const pulse = (now * 0.9 + i * 0.37) % 1;
      const strength = target.clue ? 1 : 0.6;
      halo.ring.scale.setScalar(0.8 + pulse * 1.4);
      halo.ring.material.opacity = level * strength * (1 - pulse);
      halo.beam.material.opacity = level * strength * (0.55 + 0.25 * Math.sin(now * 3 + i));
    }
  }

  dispose() {
    this.scene.remove(this.prints);
    this.prints.geometry.dispose();
    const mat = this.prints.material as THREE.MeshBasicMaterial;
    mat.map?.dispose();
    mat.dispose();
    for (const halo of this.halos) {
      this.scene.remove(halo.group);
      halo.beam.material.dispose();
      halo.ring.material.dispose();
    }
    this.halos[0]?.beam.geometry.dispose();
    this.halos[0]?.ring.geometry.dispose();
    this.halos[0]?.beam.material.map?.dispose();
  }
}
