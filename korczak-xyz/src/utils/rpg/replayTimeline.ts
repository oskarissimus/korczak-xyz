/*
 * A recorded session read back for the admin's *Replay* tab (`replay.ts` has the events). Pure:
 * events in, the lanes of the timeline, the assets' delays and the state at any moment out —
 * tested in `replayTimeline.test.ts`, drawn by `AdminReplay.tsx`.
 */

import type { ReplayEvent } from './replay';

export interface Span {
  from: number;
  to: number;
  label: string;
  /** Still open when the recording ends. */
  open?: boolean;
  /** Ended badly: a request that failed, an asset that would not stand. */
  bad?: boolean;
}

/** One generated asset, from being asked for to standing in front of the player. */
export interface AssetRow {
  what: string;
  name: string;
  /** When its request began (the latest one with its label before it was shown), if one is known. */
  askedAt: number | null;
  /** When that request ended. */
  madeAt: number | null;
  /** When the scene was handed it, and when it stood. */
  showAt: number;
  shownAt: number | null;
  ok: boolean;
  /** Asked → standing, or hand-over → standing when nothing was asked in this session (it was kept). */
  totalMs: number | null;
  /** What the player was doing while it came: the beat on screen when it was shown. */
  beat: number | null;
  /** The asset was made earlier (kept on the world, or reused): nothing was asked for it here. */
  kept: boolean;
}

export interface Marker {
  t: number;
  kind: 'choice' | 'free' | 'stall' | 'death' | 'ending' | 'error' | 'progress';
  label: string;
}

export interface Timeline {
  ms: number;
  screens: Span[];
  beats: Span[];
  waits: Span[];
  idle: Span[];
  hidden: Span[];
  requests: Span[];
  assets: AssetRow[];
  markers: Marker[];
  /** The hero's way, in order. */
  path: { t: number; x: number; z: number }[];
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Spans from "this began" events, each lasting until the next one, the last until the end. */
function runs(events: readonly ReplayEvent[], kind: string, label: (e: ReplayEvent) => string, end: number): Span[] {
  const out: Span[] = [];
  for (const e of events) {
    if (e.k !== kind) continue;
    const prev = out[out.length - 1];
    const text = label(e);
    if (prev) {
      if (prev.label === text) continue;
      prev.to = e.t;
    }
    out.push({ from: e.t, to: end, label: text });
  }
  return out;
}

export function buildTimeline(events: readonly ReplayEvent[]): Timeline {
  const ms = events.length ? Math.max(...events.map((e) => e.t)) : 0;
  const screens = runs(events, 'screen', (e) => str(e.s, '?'), ms);
  const beats = runs(events, 'beat', (e) => `${(num(e.n) ?? 0) + 1}. ${str(e.title)}`, ms);
  // A new quest ends the last beat of the one before; leaving the game ends it too.
  for (const b of beats) {
    const cut = events.find((e) => e.t > b.from && e.t < b.to && (e.k === 'quest' || e.k === 'ending' || (e.k === 'screen' && e.s !== 'game')));
    if (cut) b.to = cut.t;
  }

  const waits: Span[] = [];
  const openWaits = new Map<string, number>();
  const hidden: Span[] = [];
  let hiddenSince: number | null = null;
  const idle: Span[] = [];
  const requests: Span[] = [];
  const reqs = new Map<number, { t: number; label: string; kind: string; model: string }>();
  const reqEnds = new Map<number, { t: number; ok: boolean }>();
  const markers: Marker[] = [];
  const path: Timeline['path'] = [];
  const shows = new Map<string, { t: number; what: string; name: string }>();
  const shownAt = new Map<string, { t: number; ok: boolean }>();

  for (const e of events) {
    switch (e.k) {
      case 'wait':
        if (!openWaits.has(str(e.r))) openWaits.set(str(e.r), e.t);
        break;
      case 'waited': {
        const since = openWaits.get(str(e.r));
        if (since !== undefined) {
          waits.push({ from: since, to: e.t, label: str(e.r) });
          openWaits.delete(str(e.r));
        }
        break;
      }
      case 'hide':
        if (hiddenSince === null) hiddenSince = e.t;
        break;
      case 'back':
        if (hiddenSince !== null) hidden.push({ from: hiddenSince, to: e.t, label: 'hidden' });
        hiddenSince = null;
        break;
      case 'idle': {
        const gap = num(e.ms) ?? 0;
        idle.push({ from: Math.max(0, e.t - gap), to: e.t, label: 'idle' });
        break;
      }
      case 'req':
        if (num(e.id) !== null) reqs.set(num(e.id)!, { t: e.t, label: str(e.label), kind: str(e.kind), model: str(e.model) });
        break;
      case 'res':
        if (num(e.id) !== null) reqEnds.set(num(e.id)!, { t: e.t, ok: e.ok !== false });
        break;
      case 'show':
        shows.set(str(e.id), { t: e.t, what: str(e.what), name: str(e.name) });
        break;
      case 'shown':
        shownAt.set(str(e.id), { t: e.t, ok: e.ok !== false });
        break;
      case 'pos': {
        const x = num(e.x);
        const z = num(e.z);
        if (x !== null && z !== null) path.push({ t: e.t, x, z });
        break;
      }
      case 'choice':
        markers.push({ t: e.t, kind: 'choice', label: str(e.label) });
        break;
      case 'free':
        markers.push({ t: e.t, kind: 'free', label: str(e.text) });
        break;
      case 'stall':
        markers.push({ t: e.t, kind: 'stall', label: str(e.why) });
        break;
      case 'death':
        markers.push({ t: e.t, kind: 'death', label: '' });
        break;
      case 'ending':
        markers.push({ t: e.t, kind: 'ending', label: str(e.title) });
        break;
      case 'error':
        markers.push({ t: e.t, kind: 'error', label: str(e.text ?? e.why) });
        break;
      case 'progress':
        markers.push({ t: e.t, kind: 'progress', label: `${str(e.n)}/${str(e.of)}` });
        break;
      default:
    }
  }
  for (const [r, since] of openWaits) waits.push({ from: since, to: ms, label: r, open: true });
  if (hiddenSince !== null) hidden.push({ from: hiddenSince, to: ms, label: 'hidden', open: true });
  waits.sort((a, b) => a.from - b.from);

  for (const [id, r] of reqs) {
    const end = reqEnds.get(id);
    const label = [r.kind, r.label || r.model].filter(Boolean).join(' · ');
    requests.push({ from: r.t, to: end?.t ?? ms, label, open: !end, bad: end ? !end.ok : false });
  }
  requests.sort((a, b) => a.from - b.from);

  const beatAt = (t: number): number | null => {
    let n: number | null = null;
    for (const e of events) {
      if (e.t > t) break;
      if (e.k === 'beat') n = num(e.n);
    }
    return n;
  };

  const assets: AssetRow[] = [];
  for (const [id, s] of shows) {
    const end = shownAt.get(id);
    // The request it most likely came from: the latest one labelled with its slot or its name.
    let asked: { t: number; id: number } | null = null;
    for (const [rid, r] of reqs) {
      if (r.t > s.t) continue;
      if (r.label && (r.label === s.what || r.label === s.name) && (!asked || r.t > asked.t)) asked = { t: r.t, id: rid };
    }
    const made = asked ? reqEnds.get(asked.id) ?? null : null;
    const standing = end?.t ?? null;
    const from = asked?.t ?? s.t;
    assets.push({
      what: s.what,
      name: s.name,
      askedAt: asked?.t ?? null,
      madeAt: made?.t ?? null,
      showAt: s.t,
      shownAt: standing,
      ok: end ? end.ok : false,
      totalMs: standing === null ? null : standing - from,
      beat: beatAt(s.t),
      kept: asked === null,
    });
  }
  assets.sort((a, b) => a.showAt - b.showAt);

  return { ms, screens, beats, waits, idle, hidden, requests, assets, markers, path };
}

/** What the player saw and was held by at `t`: the timeline's readout. */
export interface StateAt {
  screen: string;
  beat: { n: number; title: string; goal: string; npc: string; place: string } | null;
  /** The last line said, and the last thing the player did. */
  line: { who: string; text: string } | null;
  act: { kind: string; label: string; t: number } | null;
  waiting: string[];
  /** Requests in flight. */
  pending: string[];
  /** Assets handed to the scene and not standing yet. */
  loading: string[];
  at: { x: number; z: number } | null;
}

export function stateAt(events: readonly ReplayEvent[], t: number): StateAt {
  const state: StateAt = { screen: '', beat: null, line: null, act: null, waiting: [], pending: [], loading: [], at: null };
  const waits = new Set<string>();
  const pending = new Map<number, string>();
  const loading = new Map<string, string>();
  for (const e of events) {
    if (e.t > t) break;
    switch (e.k) {
      case 'screen':
        state.screen = str(e.s);
        break;
      case 'quest':
        state.beat = null;
        state.line = null;
        break;
      case 'beat':
        state.beat = { n: num(e.n) ?? 0, title: str(e.title), goal: str(e.goal), npc: str(e.npc), place: str(e.place) };
        break;
      case 'line':
        state.line = { who: str(e.who), text: str(e.text) };
        break;
      case 'choice':
        state.act = { kind: 'choice', label: str(e.label), t: e.t };
        break;
      case 'free':
        state.act = { kind: 'free', label: str(e.text), t: e.t };
        break;
      case 'wait':
        waits.add(str(e.r));
        break;
      case 'waited':
        waits.delete(str(e.r));
        break;
      case 'req':
        if (num(e.id) !== null) pending.set(num(e.id)!, [str(e.kind), str(e.label) || str(e.model)].filter(Boolean).join(' · '));
        break;
      case 'res':
        if (num(e.id) !== null) pending.delete(num(e.id)!);
        break;
      case 'show':
        loading.set(str(e.id), `${str(e.what)}${e.name && e.name !== e.what ? ` · ${str(e.name)}` : ''}`);
        break;
      case 'shown':
        loading.delete(str(e.id));
        break;
      case 'pos':
        if (num(e.x) !== null && num(e.z) !== null) state.at = { x: num(e.x)!, z: num(e.z)! };
        break;
      default:
    }
  }
  state.waiting = [...waits];
  state.pending = [...pending.values()];
  state.loading = [...loading.values()];
  return state;
}

/** "1:05", "12:40", "1:02:03" — a moment in a session, or a length. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** "850 ms", "4.2 s", "1:05" — a delay. */
export function delay(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return clock(ms);
}
