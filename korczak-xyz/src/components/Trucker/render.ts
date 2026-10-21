/*
 * The view from the cab, drawn on a 2D canvas the old way: one horizontal strip per couple of
 * scanlines, each strip a depth `z = 1 / p` where `p` is how far below the horizon it sits. Bugs
 * use the same mapping, so a bug at depth z is drawn exactly on the strip the road puts there.
 */

import { curveAt, type GameState } from './engine';
import type { Lang } from './events';

export interface HitBox {
  id: number;
  x: number;
  y: number;
  r: number;
}

const POLE_GAP = 8;
const SIGN_GAP = 90;

const SIGNS: Record<Lang, string[]> = {
  en: [
    'PROD {km} km',
    'LEGACY ZONE',
    'NO DEPLOYS ON FRIDAY',
    'JIRA 5 km',
    'TECH DEBT AHEAD',
    'LAST STABLE RELEASE 3 km BACK',
    'STACK OVERFLOW: CLOSED',
    'PROD {km} km',
    'WORKS ON MY MACHINE',
  ],
  pl: [
    'PROD {km} km',
    'STREFA LEGACY',
    'ZAKAZ DEPLOYÓW W PIĄTEK',
    'JIRA 5 km',
    'UWAGA: DŁUG TECHNICZNY',
    'OSTATNI STABILNY RELEASE 3 km WSTECZ',
    'STACK OVERFLOW: ZAMKNIĘTY',
    'PROD {km} km',
    'U MNIE DZIAŁA',
  ],
};

/* The tablet on the dashboard. Terminal output, so English in both locales. */
const TERMINAL = [
  '✻ Thinking…',
  '● Read src/billing.ts (2,814 lines)',
  '● Edit src/billing.ts',
  '● Bash npm test',
  '  ⎿ 0 passed, 0 failed, 312 skipped',
  "● You're absolutely right!",
  '● Refactoring 214 files…',
  '● Write src/utils/utils2_final.ts',
  '✻ Pondering…',
  '● Bash rm -rf node_modules',
  '● Adding retry logic to retry logic',
  '● Bash git push --force',
  '  ⎿ Everything up-to-date',
  '✻ Synergizing…',
  '● Updated 1 file, created 37',
  '● TODO: remove this TODO',
];

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  hitBoxes: HitBox[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  resize(width: number, height: number) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = width;
    this.h = height;
  }

  draw(s: GameState, lang: Lang) {
    const { ctx, w, h } = this;
    if (!w || !h) return;
    const horizon = Math.round(h * 0.42);
    // Whole pixels: a fractional offset leaves seams between the 2px road strips.
    const shake = s.shake > 0 ? Math.round((Math.random() - 0.5) * 12 * s.shake) : 0;
    const curve = curveAt(s.travel);
    // Pulled over: the camera slides onto the hard shoulder.
    const shoulder = s.stopLeft > 0 ? 1 : Math.max(0, 1 - s.speed / 30);

    ctx.save();
    ctx.translate(shake, shake * 0.5);

    const progress = Math.min(1, s.km / s.totalKm);
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, `hsl(${215 - progress * 190}, 60%, ${30 + progress * 10}%)`);
    sky.addColorStop(1, `hsl(${30 - progress * 10}, 80%, ${70 - progress * 10}%)`);
    ctx.fillStyle = sky;
    ctx.fillRect(-20, -20, w + 40, horizon + 20);

    // The destination on the horizon: a data centre that grows as it gets closer.
    const cityX = w / 2 - curve * w * 0.25;
    const cityScale = 0.4 + progress * 1.6;
    ctx.fillStyle = 'rgba(30, 30, 50, 0.85)';
    const blocks = [-60, -42, -25, -8, 10, 28, 46];
    blocks.forEach((bx, i) => {
      const bh = (18 + ((i * 37) % 30)) * cityScale;
      ctx.fillRect(cityX + bx * cityScale, horizon - bh, 15 * cityScale, bh);
    });
    ctx.fillStyle = '#ffd34d';
    ctx.font = `bold ${Math.round(9 * cityScale)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('PROD', cityX, horizon - 52 * cityScale);

    const centerAt = (p: number) =>
      w / 2 + curve * w * 0.4 * (1 - p) * (1 - p) - shoulder * w * 0.45 * p;
    const halfAt = (p: number) => w * 0.85 * p;

    for (let y = horizon; y < h; y += 2) {
      const p = (y - horizon + 1) / (h - horizon);
      const z = 1 / p;
      const band = Math.floor((z + s.travel) / 3) % 2 === 0;
      const cx = centerAt(p);
      const hw = halfAt(p);
      ctx.fillStyle = band ? '#4a8a3a' : '#437f34';
      ctx.fillRect(0, y, w, 2);
      ctx.fillStyle = band ? '#c33' : '#eee';
      ctx.fillRect(cx - hw * 1.12, y, hw * 2.24, 2);
      ctx.fillStyle = band ? '#5b5b5b' : '#575757';
      ctx.fillRect(cx - hw, y, hw * 2, 2);
      if (band) {
        ctx.fillStyle = '#e8e8e8';
        ctx.fillRect(cx - hw * 0.025, y, hw * 0.05, 2);
      }
    }

    // Roadside: poles every POLE_GAP units, a sign every SIGN_GAP.
    for (let k = 12; k >= 0; k--) {
      const z = POLE_GAP - (s.travel % POLE_GAP) + k * POLE_GAP;
      if (z < 1.1) continue;
      const p = 1 / z;
      const y = horizon + p * (h - horizon);
      const ph = h * 0.9 * p;
      for (const side of [-1, 1]) {
        const x = centerAt(p) + side * halfAt(p) * 1.35;
        ctx.fillStyle = '#ddd';
        ctx.fillRect(x - 3 * p * 4, y - ph, 6 * p * 4, ph);
        ctx.fillStyle = '#222';
        ctx.fillRect(x - 3 * p * 4, y - ph, 6 * p * 4, ph * 0.15);
      }
    }
    const signZ = SIGN_GAP - (s.travel % SIGN_GAP);
    if (signZ > 1.1 && signZ < 70) {
      const p = 1 / signZ;
      const y = horizon + p * (h - horizon);
      const x = centerAt(p) + halfAt(p) * 1.7;
      const list = SIGNS[lang];
      const label = list[Math.floor(s.travel / SIGN_GAP) % list.length].replace(
        '{km}',
        String(Math.max(0, Math.round(s.totalKm - s.km))),
      );
      const sw = w * 0.9 * p;
      const sh = sw * 0.35;
      ctx.fillStyle = '#666';
      ctx.fillRect(x - sw * 0.02, y - h * 1.1 * p, sw * 0.04, h * 1.1 * p);
      ctx.fillStyle = '#1d6b3a';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(1, sw * 0.02);
      ctx.fillRect(x - sw / 2, y - h * 1.1 * p - sh, sw, sh);
      ctx.strokeRect(x - sw / 2, y - h * 1.1 * p - sh, sw, sh);
      ctx.fillStyle = '#fff';
      const fs = Math.max(4, Math.min(sh * 0.4, (sw * 1.6) / label.length));
      ctx.font = `bold ${fs}px sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x, y - h * 1.1 * p - sh / 2);
      ctx.textBaseline = 'alphabetic';
    }

    // Bugs, far to near so the near ones draw on top.
    this.hitBoxes = [];
    const bugs = [...s.bugs].sort((a, b) => b.z - a.z);
    for (const bug of bugs) {
      if (bug.z < 1) continue;
      const p = 1 / bug.z;
      const y = horizon + p * (h - horizon);
      const x = centerAt(p) + bug.x * halfAt(p);
      // Sized off a floor width, or on a phone a bug is a speck until it is too late.
      const size = Math.max(9, Math.max(w, 700) * 0.18 * p);
      if (bug.fixedAt === null) {
        ctx.fillStyle = 'rgba(20, 15, 10, 0.6)';
        ctx.beginPath();
        ctx.ellipse(x, y, size * 0.7, size * 0.22, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = `${size}px serif`;
        ctx.textAlign = 'center';
        ctx.fillText('🐛', x, y - size * 0.05);
        // Generous on small targets: far away a bug is a few pixels wide.
        this.hitBoxes.push({ id: bug.id, x, y: y - size * 0.4, r: Math.max(22, size * 0.8) });
      } else {
        const age = s.time - bug.fixedAt;
        ctx.globalAlpha = Math.max(0, 1 - age / 0.8);
        ctx.font = `${size}px serif`;
        ctx.textAlign = 'center';
        ctx.fillText('✅', x, y - size * 0.2 - age * 40);
        ctx.globalAlpha = 1;
      }
    }

    this.drawCab(s, curve);

    // Eyelids: from 55% drowsy they start to close.
    const lid = Math.max(0, (s.drowsy - 55) / 45);
    if (lid > 0) {
      const lh = (h / 2) * Math.min(1, lid * 0.95);
      ctx.fillStyle = '#000';
      ctx.fillRect(-20, -20, w + 40, lh + 20);
      ctx.fillRect(-20, h - lh, w + 40, lh + 20);
    }

    ctx.restore();
  }

  private drawCab(s: GameState, curve: number) {
    const { ctx, w, h } = this;
    // Windscreen frame: the roof and the two A-pillars.
    ctx.fillStyle = '#1c1c22';
    ctx.fillRect(-20, -20, w + 40, h * 0.06 + 20);
    ctx.beginPath();
    ctx.moveTo(-20, 0);
    ctx.lineTo(w * 0.07, 0);
    ctx.lineTo(w * 0.02, h);
    ctx.lineTo(-20, h);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(w + 20, 0);
    ctx.lineTo(w * 0.93, 0);
    ctx.lineTo(w * 0.98, h);
    ctx.lineTo(w + 20, h);
    ctx.fill();

    // Dashboard.
    const top = h * 0.76;
    const dash = ctx.createLinearGradient(0, top, 0, h);
    dash.addColorStop(0, '#3a3a44');
    dash.addColorStop(1, '#202026');
    ctx.fillStyle = dash;
    ctx.beginPath();
    ctx.moveTo(0, top + h * 0.03);
    ctx.quadraticCurveTo(w / 2, top - h * 0.03, w, top + h * 0.03);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.fill();

    // The steering wheel turns by itself. That is the whole job.
    const wx = w * 0.27;
    const wy = h * 1.0;
    const wr = Math.min(w * 0.17, h * 0.26);
    ctx.save();
    ctx.translate(wx, wy);
    ctx.rotate(curve * 0.9 + Math.sin(s.time * 1.7) * 0.03);
    ctx.strokeStyle = '#111';
    ctx.lineWidth = wr * 0.16;
    ctx.beginPath();
    ctx.arc(0, 0, wr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = wr * 0.1;
    for (const a of [Math.PI, 0, -Math.PI / 2]) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * wr, Math.sin(a) * wr);
      ctx.stroke();
    }
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(0, 0, wr * 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // The tablet: Claude Code, working.
    const tw = Math.min(w * 0.34, 300);
    const th = h * 0.2;
    const tx = w * 0.6;
    const ty = h - th - h * 0.02;
    ctx.fillStyle = '#0b0b0b';
    ctx.fillRect(tx - 4, ty - 4, tw + 8, th + 8);
    ctx.fillStyle = '#101a10';
    ctx.fillRect(tx, ty, tw, th);
    const lineH = Math.max(9, th / 7);
    const fs = Math.max(7, Math.min(12, lineH * 0.8));
    ctx.font = `${fs}px monospace`;
    ctx.textAlign = 'left';
    const first = Math.floor(s.time / 1.4);
    const rows = Math.floor(th / lineH) - 1;
    ctx.save();
    ctx.beginPath();
    ctx.rect(tx, ty, tw, th);
    ctx.clip();
    for (let i = 0; i < rows; i++) {
      const line = TERMINAL[(first + i) % TERMINAL.length];
      ctx.fillStyle = line.startsWith('✻') ? '#e08a5a' : '#7cd67c';
      ctx.fillText(line, tx + 6, ty + lineH * (i + 1));
    }
    if (Math.floor(s.time * 2) % 2 === 0) {
      ctx.fillStyle = '#7cd67c';
      ctx.fillRect(tx + 6, ty + lineH * rows + 3, fs * 0.6, fs);
    }
    ctx.restore();

    // Speedometer, as a number: it is a truck from the future.
    ctx.fillStyle = '#ffb000';
    ctx.font = `bold ${Math.max(14, h * 0.05)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(s.speed)} km/h`, w * 0.47, h * 0.9);
    ctx.fillStyle = s.active ? (Math.floor(s.time * 4) % 2 ? '#f33' : '#600') : '#300';
    ctx.beginPath();
    ctx.arc(w * 0.47, h * 0.95, Math.max(4, h * 0.012), 0, Math.PI * 2);
    ctx.fill();
  }
}
