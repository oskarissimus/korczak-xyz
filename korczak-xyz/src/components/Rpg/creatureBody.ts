/*
 * A creature's body in the scene: its TRELLIS model (`loadHubModel`), moved as `utils/rpg/creature.ts`
 * says. The legs are swung in the vertex shader, from an attribute worked out once per model
 * (`prepareCreature`): for each vertex how much of a leg it is and which diagonal pair it belongs
 * to, in the creature's own frame. Each creature clones the materials, so each has its own stride;
 * the geometry and textures stay the template's.
 *
 *   enemy.mesh (placed, turned to the hero, sized)  →  body (the pose)  →  the model's clone
 */

import * as THREE from 'three';

import { LEG_TOP, newCreature, pose, step, type CreatureShape, type CreatureState } from '../../utils/rpg/creature';

interface Uniforms {
  creaturePhase: { value: number };
  creatureStride: { value: number };
}

export interface CreatureBody {
  body: THREE.Group;
  state: CreatureState;
  shape: CreatureShape;
  height: number;
  uniforms: Uniforms;
  materials: THREE.Material[];
}

/**
 * Gives every mesh of a freshly loaded model its `creatureLeg` attribute (weight, pair) and the
 * directions forward and up in its own geometry's units, which the shader moves it along.
 */
export function prepareCreature(template: THREE.Group, shape: CreatureShape): number {
  template.updateMatrixWorld(true);
  const root = new THREE.Matrix4().copy(template.matrixWorld).invert();
  const box = new THREE.Box3().setFromObject(template);
  const height = Math.max(0.01, box.max.y - box.min.y);
  const legTop = box.min.y + height * LEG_TOP;
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  const v = new THREE.Vector3();
  template.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const toRoot = new THREE.Matrix4().multiplyMatrices(root, mesh.matrixWorld);
    const pos = mesh.geometry.getAttribute('position');
    const leg = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(toRoot);
      const w = shape === 'blob' ? 0 : Math.max(0, Math.min(1, (legTop - v.y) / (legTop - box.min.y)));
      // Linear in the height, as a stiff leg turning at the hip would be.
      leg[i * 2] = w;
      // Front-left with back-right, front-right with back-left: a trot.
      leg[i * 2 + 1] = (v.x - cx) * (v.z - cz) >= 0 ? 0 : 1;
    }
    mesh.geometry.setAttribute('creatureLeg', new THREE.BufferAttribute(leg, 2));
    // The creature's metres, in this geometry's units and axes: the linear part of the inverse.
    const back = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().copy(toRoot).invert());
    mesh.userData.creatureFwd = new THREE.Vector3(0, 0, height).applyMatrix3(back);
    mesh.userData.creatureUp = new THREE.Vector3(0, height, 0).applyMatrix3(back);
  });
  return height;
}

/** One creature from a prepared template. */
export function dressCreature(template: THREE.Group, shape: CreatureShape, height: number, seed: number): CreatureBody {
  const uniforms: Uniforms = {
    creaturePhase: { value: 0 },
    creatureStride: { value: 0 },
  };
  const materials: THREE.Material[] = [];
  const model = template.clone();
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const fwd = mesh.userData.creatureFwd as THREE.Vector3 | undefined;
    const up = mesh.userData.creatureUp as THREE.Vector3 | undefined;
    if (!fwd || !up) return;
    const own = (m: THREE.Material) => {
      const c = m.clone();
      c.onBeforeCompile = (shader) => {
        shader.uniforms.creaturePhase = uniforms.creaturePhase;
        shader.uniforms.creatureStride = uniforms.creatureStride;
        shader.uniforms.creatureFwd = { value: fwd };
        shader.uniforms.creatureUp = { value: up };
        shader.vertexShader =
          'attribute vec2 creatureLeg;\nuniform float creaturePhase;\nuniform float creatureStride;\nuniform vec3 creatureFwd;\nuniform vec3 creatureUp;\n' +
          shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            {
              float legPhase = creaturePhase + creatureLeg.y * 3.14159265;
              float swing = creatureStride * creatureLeg.x;
              transformed += creatureFwd * swing * sin(legPhase);
              // Up while it swings forward, flat on the ground while it pushes back.
              transformed += creatureUp * swing * 0.45 * max(0.0, cos(legPhase));
            }`,
          );
      };
      c.customProgramCacheKey = () => 'creature';
      materials.push(c);
      return c;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(own) : own(mesh.material);
  });
  const body = new THREE.Group();
  body.add(model);
  return { body, state: newCreature(seed), shape, height, uniforms, materials };
}

/** Moves it on by `dt` at `speed` and puts the body in the pose. */
export function moveCreature(c: CreatureBody, dt: number, speed: number): void {
  step(c.state, dt, speed, c.height);
  const p = pose(c.state, c.shape, c.height);
  c.body.position.set(0, p.lift - p.sink, p.lunge);
  c.body.rotation.set(p.pitch, 0, p.roll);
  const wide = 1 / Math.sqrt(p.squash);
  c.body.scale.set(wide, p.squash, wide);
  c.uniforms.creaturePhase.value = c.state.phase;
  c.uniforms.creatureStride.value = p.stride;
}

/** Its own materials; the geometry and textures are the template's, which goes with the beat. */
export function disposeCreature(c: CreatureBody): void {
  for (const m of c.materials) m.dispose();
}
