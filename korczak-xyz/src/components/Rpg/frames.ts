/*
 * What a frame costs (owner, Oct 2026: "I have the feeling the fps dropped — add an fps counter so I
 * can measure what it seems, and logs to diagnose it"). The scene records every frame here; the
 * developer console's performance tab and the badge read the last two seconds, and the game sends
 * Sentry one summary of each minute played (`Rpg.tsx`, `rpg.frames`), so a phone's numbers can be
 * read without the phone.
 *
 * `frameMs` is the time between two frames as the browser shows them, which is what a player feels.
 * `cpuMs` is the script's share of it (moving, animating, and handing the scene to WebGL); the rest
 * is the GPU, so a frame far slower than its CPU time is one the phone's graphics are drawing.
 * Draw calls and triangles include the shadow pass, which draws every shadow caster a second time.
 *
 * The quality switches exist to answer "which of these is it" on the phone itself: each can be
 * turned off in the console and the badge shows what that bought. Kept in this browser.
 */

export interface FrameStats {
  /** Frames a second over the last two seconds. */
  fps: number;
  /** The median and the 95th-percentile time between frames, ms. */
  frameMs: number;
  slowMs: number;
  /** The script's part of a frame, ms. */
  cpuMs: number;
  calls: number;
  triangles: number;
  points: number;
  /** The canvas in device pixels, and the pixel ratio it was drawn at. */
  width: number;
  height: number;
  pixelRatio: number;
}

/** A minute of play, for Sentry: how many frames were slow, and the worst of them. */
export interface FrameWindow {
  frames: number;
  fps: number;
  /** Share of frames slower than 33 ms (below 30 fps) and slower than 50 ms (below 20). */
  below30: number;
  below20: number;
  worstMs: number;
  cpuMs: number;
  calls: number;
  triangles: number;
}

const RING = 120;

export class FrameRecorder {
  private intervals = new Float32Array(RING);
  private cpu = new Float32Array(RING);
  private n = 0;
  private last = 0;
  private draw = { calls: 0, triangles: 0, points: 0 };
  private win = { frames: 0, ms: 0, below30: 0, below20: 0, worst: 0, cpu: 0, calls: 0, triangles: 0 };

  /** At the start of a frame; returns its start for `end`. */
  begin(): number {
    const now = performance.now();
    const gap = now - this.last;
    // A hidden tab stops the loop; the gap when it comes back is not a frame anybody saw.
    if (this.last && gap < 1000) {
      this.intervals[this.n % RING] = gap;
      this.n += 1;
    }
    this.last = now;
    return now;
  }

  /** At the end of a frame; `playing` when the world is moving rather than paused behind a screen. */
  end(start: number, render: { calls: number; triangles: number; points: number }, playing: boolean): void {
    const cpu = performance.now() - start;
    this.cpu[(this.n + RING - 1) % RING] = cpu;
    this.draw = { calls: render.calls, triangles: render.triangles, points: render.points };
    if (!playing || this.n === 0) return;
    const gap = this.intervals[(this.n - 1) % RING];
    const w = this.win;
    w.frames += 1;
    w.ms += gap;
    if (gap > 33.4) w.below30 += 1;
    if (gap > 50) w.below20 += 1;
    w.worst = Math.max(w.worst, gap);
    w.cpu += cpu;
    w.calls = Math.max(w.calls, render.calls);
    w.triangles = Math.max(w.triangles, render.triangles);
  }

  stats(canvas: { width: number; height: number }, pixelRatio: number): FrameStats {
    const count = Math.min(this.n, RING);
    const gaps = Array.from(this.intervals.subarray(0, count)).sort((a, b) => a - b);
    const cpus = Array.from(this.cpu.subarray(0, count)).sort((a, b) => a - b);
    const sum = gaps.reduce((a, b) => a + b, 0);
    const at = (list: number[], q: number) => (list.length ? list[Math.min(list.length - 1, Math.floor(list.length * q))] : 0);
    return {
      fps: sum > 0 ? (count * 1000) / sum : 0,
      frameMs: at(gaps, 0.5),
      slowMs: at(gaps, 0.95),
      cpuMs: at(cpus, 0.5),
      ...this.draw,
      width: canvas.width,
      height: canvas.height,
      pixelRatio,
    };
  }

  /** The play since the last call, and starts the next. Null when nothing was played. */
  takeWindow(): FrameWindow | null {
    const w = this.win;
    this.win = { frames: 0, ms: 0, below30: 0, below20: 0, worst: 0, cpu: 0, calls: 0, triangles: 0 };
    if (w.frames < 30) return null;
    return {
      frames: w.frames,
      fps: Math.round(((w.frames * 1000) / w.ms) * 10) / 10,
      below30: Math.round((w.below30 / w.frames) * 1000) / 1000,
      below20: Math.round((w.below20 / w.frames) * 1000) / 1000,
      worstMs: Math.round(w.worst),
      cpuMs: Math.round((w.cpu / w.frames) * 10) / 10,
      calls: w.calls,
      triangles: w.triangles,
    };
  }
}

export interface Quality {
  /** Null: the device's own, up to 2. */
  pixelRatio: number | null;
  shadows: boolean;
  weather: boolean;
}

export const DEFAULT_QUALITY: Quality = { pixelRatio: null, shadows: true, weather: true };
export const PIXEL_RATIOS = [null, 2, 1.5, 1, 0.75] as const;

const QUALITY_KEY = 'rpg-quality';
const BADGE_KEY = 'rpg-fps-badge';

export function loadQuality(): Quality {
  try {
    const raw = JSON.parse(localStorage.getItem(QUALITY_KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return DEFAULT_QUALITY;
    return {
      pixelRatio: (PIXEL_RATIOS as readonly (number | null)[]).includes(raw.pixelRatio) ? raw.pixelRatio : null,
      shadows: raw.shadows !== false,
      weather: raw.weather !== false,
    };
  } catch {
    return DEFAULT_QUALITY;
  }
}

export function saveQuality(q: Quality): void {
  try {
    localStorage.setItem(QUALITY_KEY, JSON.stringify(q));
  } catch {
    /* this session only */
  }
}

export function loadBadge(): boolean {
  try {
    return localStorage.getItem(BADGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveBadge(on: boolean): void {
  try {
    localStorage.setItem(BADGE_KEY, on ? '1' : '0');
  } catch {
    /* this session only */
  }
}
