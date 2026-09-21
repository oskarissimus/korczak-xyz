/*
 * One `<audio>` element for the whole app, and the reason is iOS.
 *
 * Safari will not play a media element that was never started inside a user gesture. A `new
 * Audio(url)` created when a fetch resolves - twenty seconds after the tap that asked for it -
 * is not inside one, and `play()` rejects with `NotAllowedError`: the narration arrives, the
 * player appears, and nothing is ever heard. Worse, it fails silently on a phone, where there is
 * no console to see the rejection in.
 *
 * So the element is created and played ONCE, during the tap, on a fraction of a second of silence
 * - and from then on it is unlocked for the life of the page. Every later narration is a new
 * `src` on that same element, which needs no gesture of its own. This is why it is a module
 * singleton rather than a React ref: it must outlive any component that renders a player, and
 * there is exactly one thing playing at a time anyway.
 *
 * The AudioContext unlock that this replaced does not do the same job. Resuming an AudioContext
 * unlocks the Web Audio graph; an `<audio>` element is a different permission on iOS and stays
 * locked. That is the bug this file exists to fix.
 */

import { describeError, log } from '../../lib/logger';

/**
 * 44 bytes: a WAV header describing zero samples. Silent, instant, and no network - which matters,
 * because this has to finish inside the gesture and a fetch would not.
 */
const SILENCE =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

let element: HTMLAudioElement | null = null;
let unlocked = false;

/** The shared element, created on first use. */
function audio(): HTMLAudioElement {
  if (!element) {
    element = new Audio();
    // The narration is speech, not music: nothing here wants a preloaded buffer before there is
    // a src, and iOS treats `auto` as permission to start fetching on assignment.
    element.preload = 'auto';
  }
  return element;
}

/**
 * Unlock playback. MUST be called synchronously from a user gesture - no `await` before it.
 *
 * Resolves either way. A refusal is logged and not thrown: on a browser that never needed the
 * unlock, `play()` on a data URI may still reject for reasons that have nothing to do with
 * permission, and failing the tap over it would break the app everywhere to fix nothing.
 */
export async function unlock(): Promise<void> {
  if (unlocked) return;
  unlocked = true;

  const el = audio();
  try {
    el.src = SILENCE;
    await el.play();
    el.pause();
    el.currentTime = 0;
  } catch (e) {
    log.warn('audioGuide.unlock.refused', describeError(e));
  }
}

export function isUnlocked(): boolean {
  return unlocked;
}

/**
 * Point the shared element at a narration.
 *
 * The caller owns the object URL and revokes it; this only stops whatever was playing and swaps
 * the source, because an element left playing the previous attraction while the next one loads is
 * two guides at once.
 */
export function load(url: string): HTMLAudioElement {
  const el = audio();
  el.pause();
  el.src = url;
  el.load();
  return el;
}

/** Stop and detach, so nothing holds a revoked object URL. */
export function release(): void {
  if (!element) return;
  element.pause();
  element.removeAttribute('src');
  element.load();
}

/** Test seam: forget the element and the unlock between cases. */
export function resetForTests(): void {
  element = null;
  unlocked = false;
}
