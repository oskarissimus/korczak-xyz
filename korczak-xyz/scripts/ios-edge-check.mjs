#!/usr/bin/env node
// What iOS 26 will draw under the status bar of an installed app, worked out in Chromium.
//
// No emulator on Linux draws Liquid Glass, but the blur is not a rendering question: WebKit decides
// it in `LocalFrameView::fixedContainerEdges` from the DOM, and that decision can be replayed. It
// hit-tests the midpoint 4px inside the top of the fixed-position rect, ignoring `pointer-events`,
// walks up to the first `position: fixed`/`sticky` box at least 90% of the viewport wide, and takes
// the first plain `background-color` on the way from a box over 10px in both dimensions. A colour
// is a hard edge; a `backdrop-filter`, or no colour (the pixels then sampled), is the blur; no fixed
// container at all is the blur too.
//
// Where that rect starts is the one thing the source does not settle from outside: at the top of
// the screen, or below the status bar. So both are probed, and a page is only clear if both are.
//
//   node scripts/ios-edge-check.mjs [url] [--immersive] [--safe-top=20] [--shot=file.png]
//
// Playwright is not a dependency of the site; this takes whichever one `require` finds (a global
// install, NODE_PATH), which is why it is loaded through createRequire rather than imported.
//
// --safe-top is the inset the phone reports (20 on a home-button iPhone, 47-62 on a notched one),
// applied through Chromium's safe-area override so `env()` itself returns it. --immersive adds the
// RPG's playing-state classes, which otherwise need a model to have written a quest.

import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:4321/apps/rpg/';
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const safeTop = Number(opt('safe-top', '20'));
const shot = opt('shot', '');
const immersive = args.includes('--immersive');

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 375, height: 667 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Emulation.setSafeAreaInsetsOverride', {
  insets: { top: safeTop, topMax: safeTop, left: 0, leftMax: 0, right: 0, rightMax: 0, bottom: 0, bottomMax: 0 },
});
await page.emulateMedia({ media: 'screen' });
await page.goto(url, { waitUntil: 'networkidle' });

if (immersive) {
  await page.evaluate(() => {
    document.querySelector('.rpg-container')?.classList.add('rpg-touch', 'rpg-immersive');
    document.querySelector('.rpg-overlay')?.remove();
  });
}

const report = await page.evaluate((safeTop) => {
  const style = document.createElement('style');
  style.textContent = '* { pointer-events: auto !important; }';
  document.head.append(style);
  const vw = innerWidth;
  const vh = innerHeight;
  const opaque = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return 0;
    const parts = m[1].split(/[ ,/]+/).filter(Boolean);
    return parts.length > 3 ? Number(parts[3]) : 1;
  };
  const describe = (el) =>
    el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + [...el.classList].map((c) => `.${c}`).join('');

  const probe = (y) => {
    const hit = document.elementFromPoint(vw / 2, y);
    if (!hit) return { y, verdict: 'BLUR', why: 'nothing hit' };
    let color = null;
    let backdrop = false;
    for (let el = hit; el; el = el.parentElement) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const wide = r.width >= vw * 0.9;
      if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.1) continue;
      if (cs.backdropFilter && cs.backdropFilter !== 'none') backdrop = true;
      else if (!color && wide && r.width > 10 && r.height > 10 && opaque(cs.backgroundColor) > 0) {
        color = cs.backgroundColor;
      }
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
      if (!wide) continue;
      if (r.height > vh * 1.05) continue;
      const container = `${describe(el)} ${Math.round(r.width)}x${Math.round(r.height)} at ${Math.round(r.top)}`;
      if (backdrop) return { y, verdict: 'BLUR', why: `backdrop-filter under ${container}`, hit: describe(hit) };
      if (color) return { y, verdict: 'SOLID', why: `${color} from ${container}`, hit: describe(hit) };
      return { y, verdict: 'BLUR', why: `no plain colour, pixels sampled, ${container}`, hit: describe(hit) };
    }
    return { y, verdict: 'BLUR', why: 'no fixed or sticky container', hit: describe(hit) };
  };

  const top = getComputedStyle(document.documentElement).getPropertyValue('--safe-top');
  const result = { safeTopVar: top.trim(), probes: [probe(4), probe(safeTop + 4)] };
  style.remove();
  return result;
}, safeTop);

if (shot) await page.screenshot({ path: shot });
await browser.close();

console.log(`${url}${immersive ? ' (immersive)' : ''}  safe-area-inset-top=${safeTop}  --safe-top=${report.safeTopVar}`);
for (const p of report.probes) console.log(`  y=${p.y}: ${p.verdict}  ${p.why}${p.hit ? `  [hit ${p.hit}]` : ''}`);
process.exit(report.probes.every((p) => p.verdict === 'SOLID') ? 0 : 1);
