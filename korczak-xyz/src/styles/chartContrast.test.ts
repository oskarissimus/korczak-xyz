import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Every chart on this site must be readable with the colour taken away.
 *
 * The palette they are drawn in makes that a real risk rather than a theoretical one. The site's
 * phosphor colours are nearly flat in luminance at the bright end — cyan, green and yellow convert
 * to 229, 220 and 247 out of 255 in grayscale — so a chart that separates two series by those hues
 * separates them by nothing at all on an e-ink reader, in a grayscale phone mode, or on a print.
 * Several did. The worst was the climate chart, whose `ok` and `warm` verdicts sat 1.02 apart and
 * whose whole claim is that the boundary between them *is* the answer.
 *
 * This has to be asserted on the declarations rather than on the result, and read out of the
 * stylesheets as text, for `chordAlignment.test.ts`'s reason: a rendering test cannot catch it.
 * A headless Chromium draws the colour version perfectly, and the failure only exists for a reader
 * whose display or vision removes a channel the test environment has. So the guard is on the hexes.
 *
 * What it does NOT assert is that hue separation is sufficient — it never is on its own. The
 * second channel each series carries (a dash, a marker shape, a texture) lives in the components,
 * and the textures' geometry is checked against its CSS restatement at the bottom of this file.
 */

const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');

const srsCss = read('srsCharts.css');
const babyCss = read('babySleep.css');
const typingCss = read('typing.css');
const texturesCss = read('chartTextures.css');
const texturesTsx = readFileSync(
  new URL('../components/charts/ChartTextures.tsx', import.meta.url),
  'utf8'
);

/* --- grayscale ------------------------------------------------------------- */

/** sRGB relative luminance, per WCAG. */
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** WCAG contrast ratio. On two greys of the same hue this is exactly what a monochrome reader has. */
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * The declared value of a custom property or of `property` inside the first block whose selector
 * list mentions `selector`. Comments are stripped first, so a hex quoted in the prose above a rule
 * — and this file's rationale is written in those comments — cannot be mistaken for a declaration.
 */
function declared(css: string, selector: string, property: string): string {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
  if (selector.startsWith('--')) {
    const m = body.match(new RegExp(`${selector}\\s*:\\s*([^;]+);`));
    if (!m) throw new Error(`no custom property ${selector}`);
    return m[1].trim();
  }
  for (const block of body.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const [, selectors, rules] = block;
    const named = selectors
      .split(',')
      .some((one) => one.trim().split(/\s+/).pop() === selector || one.trim() === selector);
    if (!named) continue;
    const m = rules.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`));
    if (m) return m[1].trim();
  }
  throw new Error(`no ${property} on ${selector}`);
}

/**
 * The floor. 1.5:1 is not a WCAG number — it is where two large blocks of flat colour stop being
 * tellable apart in grayscale, which is the only question here. Text has its own, higher bars, and
 * none of these values is text.
 */
const FLOOR = 1.5;

/** Every series set whose members can appear in one chart, and so must not collapse into each other. */
const SERIES: Record<string, Record<string, string>> = {
  'srs buckets (mastery bands + neck heatmap)': {
    new: declared(srsCss, '--srs-bucket-new', ''),
    learning: declared(srsCss, '--srs-bucket-learning', ''),
    young: declared(srsCss, '--srs-bucket-young', ''),
    mature: declared(srsCss, '--srs-bucket-mature', ''),
  },
  'srs trend lines': {
    accuracy: '#00ffff', // var(--retro-cyan), declared in Layout.astro
    speed: declared(srsCss, '.srs-line--speed', 'stroke'),
  },
  'climate verdicts': {
    cold: declared(babyCss, '.bs-dot--cold', 'fill'),
    ok: declared(babyCss, '.bs-dot--ok', 'fill'),
    warm: declared(babyCss, '.bs-dot--warm', 'fill'),
  },
  'sleep bars and timeline': {
    night: declared(babyCss, '.bs-bar--night', 'fill'),
    nap: declared(babyCss, '.bs-bar--nap', 'fill'),
  },
  'typing chart lines': {
    wpm: declared(typingCss, '.typing-chart-line--wpm', 'stroke'),
    accuracy: declared(typingCss, '.typing-chart-line--accuracy', 'stroke'),
    time: declared(typingCss, '.typing-chart-line--time', 'stroke'),
  },
};

describe('charts stay readable in monochrome', () => {
  it.each(Object.entries(SERIES))('%s are separable in grayscale', (_name, series) => {
    const entries = Object.entries(series);
    for (const [, hex] of entries) expect(hex).toMatch(/^#[0-9a-f]{6}$/i);

    const failures: string[] = [];
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const ratio = contrast(entries[i][1], entries[j][1]);
        if (ratio < FLOOR) {
          failures.push(
            `${entries[i][0]} (${entries[i][1]}) vs ${entries[j][0]} (${entries[j][1]}): ${ratio.toFixed(2)}`
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  /*
   * The buckets are sequential — a card walks new → learning → young → mature and never sideways —
   * so their lightness has to walk with them. A ramp that merely separates would let `young` be
   * darker than `learning` and still pass the pairwise check above, and a reader counting rungs
   * would be counting them in the wrong order.
   */
  it('orders the srs buckets by lightness, darkest first', () => {
    const ramp = ['new', 'learning', 'young', 'mature'].map(
      (b) => SERIES['srs buckets (mastery bands + neck heatmap)'][b]
    );
    const lums = ramp.map(luminance);
    expect(lums).toEqual([...lums].sort((a, b) => a - b));
  });

  /*
   * The trend fit on the typing charts is an annotation over the data, not a fourth series, and it
   * is drawn along the wpm line it fits. It went achromatic partly for that reason and partly
   * because as a hue it was yellow over green — the one pair on this site that a protanope could
   * not separate at all. Achromatic is the property worth guarding: any hue put back here has to
   * clear all three data lines, and yellow does not.
   */
  it('keeps the typing trend fit achromatic', () => {
    expect(declared(typingCss, '.typing-chart-line--trend', 'stroke')).toBe('var(--retro-gray)');
  });
});

/*
 * Each texture is declared twice — once as an SVG `<pattern>` for the chart and once as a
 * `repeating-linear-gradient` for the legend swatches, which are HTML and cannot reference one.
 * Two declarations of one texture drift, and the drift is invisible: the legend simply stops
 * matching the bars it names. So the numbers are read out of both and compared.
 */
describe('the legend textures match the chart textures', () => {
  const num = (name: string) => {
    const m = texturesTsx.match(new RegExp(`export const ${name} = (\\d+);`));
    if (!m) throw new Error(`no ${name} in ChartTextures.tsx`);
    return Number(m[1]);
  };
  const tile = num('TILE');

  it('uses the same tile and duty cycle for the diagonal', () => {
    const rule = texturesCss.match(/\.chart-swatch-tex--diagonal\s*\{([\s\S]*?)\}\s*\n/)![1];
    const stops = [...rule.matchAll(/(\d+)px/g)].map((m) => Number(m[1]));
    // ink width, ink width again (the gradient's closing stop), then the tile.
    expect(stops).toEqual([num('DIAGONAL_INK'), num('DIAGONAL_INK'), tile]);
  });

  it('uses the same tile and duty cycle for the crosshatch', () => {
    const rule = texturesCss.match(/\.chart-swatch-tex--crosshatch\s*\{([\s\S]*?)\n\}/)![1];
    const stops = [...rule.matchAll(/(\d+)px/g)].map((m) => Number(m[1]));
    const ink = num('CROSSHATCH_INK');
    // Two gradients, 45° and 135°, each ink/ink/tile.
    expect(stops).toEqual([ink, ink, tile, ink, ink, tile]);
  });

  it('draws both at the same ink opacity as the chart', () => {
    const chartInk = declared(texturesCss, '.chart-tex-ink', 'opacity');
    const swatchInks = [...texturesCss.matchAll(/rgba\(255, 255, 255, ([\d.]+)\)/g)].map(
      (m) => m[1]
    );
    expect(swatchInks.length).toBeGreaterThan(0);
    for (const ink of swatchInks) expect(ink).toBe(chartInk);
  });
});
