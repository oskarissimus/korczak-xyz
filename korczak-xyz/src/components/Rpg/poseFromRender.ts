/*
 * The big joints of a T-posed person, found by a pose detector in a front render of their own mesh
 * (owner, 1 Nov 2026: "ask a model to mark where the big joints are, then read them back"), for
 * `pictureJoints.ts` to lift into the mesh.
 *
 * The detector is MediaPipe's Pose Landmarker (`full`, Apache-2.0), run here in the browser on the
 * CPU: about 0.3 s a person and nothing to pay, after a one-time ~18 MB download of its WASM and
 * model, which is fetched only when this rig is asked for. Tried against hand-placed joints on a
 * blacksmith and a maid in a long dress (`/mnt/project-files/rpg/rig-v2/opcja2-stawy-z-obrazka.md`):
 * 1.5–1.7 % of the height on average, shoulders and wrists under 0.7 %, hips and knees under the dress
 * 1.6–3 %. The `heavy` model was no better here, and six times slower.
 *
 * The picture is a render rather than the one FLUX drew: the mesh is what gets rigged, and its own
 * render lines up with it by construction, where TRELLIS's framing of the drawing is 3–5 % off on
 * each axis. It is drawn flat (unlit texture) on grey, which is what the detector saw in the test.
 */
import * as THREE from 'three';
import type { JointName, Joints2D, PictureInfo } from '../../utils/rpg/pictureJoints';

const VERSION = '0.10.14';
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
/** The render's longer side, in pixels. */
const SIDE = 768;
/** Below this, a landmark is the detector guessing; the joint is measured off the mesh instead. */
const VISIBLE = 0.2;

/** MediaPipe's landmark for each joint (the person's own left and right). */
const MARKS: [JointName, number][] = [
  ['shoulderL', 11], ['shoulderR', 12], ['elbowL', 13], ['elbowR', 14], ['wristL', 15], ['wristR', 16],
  ['hipL', 23], ['hipR', 24], ['kneeL', 25], ['kneeR', 26], ['ankleL', 27], ['ankleR', 28],
];

interface Landmark { x: number; y: number; visibility?: number }
interface Detector { detect(image: HTMLCanvasElement): { landmarks: Landmark[][] } }

let detector: Promise<Detector> | null = null;

function load(): Promise<Detector> {
  detector ??= (async () => {
    // From the CDN at a pinned version, not bundled: the WASM alone is 9 MB, and only this rig needs it.
    const vision = await import(/* @vite-ignore */ `${CDN}/vision_bundle.mjs`);
    const files = await vision.FilesetResolver.forVisionTasks(`${CDN}/wasm`);
    return vision.PoseLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' },
      runningMode: 'IMAGE',
      numPoses: 1,
      minPoseDetectionConfidence: 0.1,
      minPosePresenceConfidence: 0.1,
    }) as Promise<Detector>;
  })();
  detector.catch(() => (detector = null));
  return detector;
}

export interface FoundPose extends PictureInfo {
  joints: Joints2D;
  /** How many of the twelve joints the detector was sure of. */
  found: number;
  ms: number;
}

/**
 * The joints of the person `geometry` is (+y up, facing +z, in any units), seen from the front with
 * `material`'s texture. Throws when there is no WebGL or the detector finds nobody.
 */
export async function poseFromRender(geometry: THREE.BufferGeometry, material: THREE.Material): Promise<FoundPose> {
  const started = performance.now();
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  // A margin round the figure, as in a drawing: the detector finds less of a person cut at the frame.
  const margin = Math.max(size.x, size.y) * 0.06;
  const halfW = size.x / 2 + margin;
  const halfH = size.y / 2 + margin;
  const width = Math.round(halfW >= halfH ? SIDE : SIDE * (halfW / halfH));
  const height = Math.round(halfH >= halfW ? SIDE : SIDE * (halfH / halfW));

  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  const map = (material as THREE.MeshStandardMaterial).map ?? null;
  const flat = new THREE.MeshBasicMaterial({
    map,
    color: map ? 0xffffff : ((material as THREE.MeshStandardMaterial).color ?? new THREE.Color(0xb0a090)),
    vertexColors: !map && !!geometry.attributes.color,
    side: THREE.DoubleSide,
  });
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x808080);
    scene.add(new THREE.Mesh(geometry, flat));
    const camera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.01, size.z * 4 + 10);
    camera.position.set(centre.x, centre.y, box.max.z + size.z + 1);
    camera.lookAt(centre.x, centre.y, centre.z);
    renderer.render(scene, camera);

    const result = (await load()).detect(canvas);
    const marks = result.landmarks?.[0];
    if (!marks?.length) throw new Error('the pose detector found nobody in the front render');
    const joints: Joints2D = {};
    let found = 0;
    for (const [name, i] of MARKS) {
      const m = marks[i];
      if (!m || (m.visibility ?? 1) < VISIBLE) continue;
      joints[name] = [m.x * width, m.y * height];
      found++;
    }
    // The mesh's own box in the render's pixels, for the box-to-box map back into the mesh.
    const px = (x: number) => ((x - (centre.x - halfW)) / (halfW * 2)) * width;
    const py = (y: number) => (((centre.y + halfH) - y) / (halfH * 2)) * height;
    return {
      joints,
      found,
      width,
      height,
      silhouette: { x0: px(box.min.x), x1: px(box.max.x), y0: py(box.max.y), y1: py(box.min.y) },
      ms: performance.now() - started,
    };
  } finally {
    flat.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
