/// <reference lib="webworker" />
// `selfRig` off the main thread: a few seconds of arithmetic a person, which would otherwise freeze a frame.
import { selfRig, type Donor } from '../../utils/rpg/selfRig';

self.onmessage = (e: MessageEvent<{ id: number; donor: Donor; target: Float32Array; height: number }>) => {
  const { id, donor, target, height } = e.data;
  try {
    const r = selfRig(donor, target, height);
    (self as DedicatedWorkerGlobalScope).postMessage({ id, rig: r }, [r.positions.buffer, r.skinIndex.buffer, r.skinWeight.buffer, r.joints.buffer]);
  } catch (err) {
    (self as DedicatedWorkerGlobalScope).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
