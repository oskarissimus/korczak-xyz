/*
 * The textures every chart on this site reaches for when hue is carrying meaning.
 *
 * The rule these exist to enforce: **no series may be told apart by hue alone.** Every chart here
 * draws on a black panel in the site's phosphor palette, and that palette is almost flat in
 * luminance at the bright end — cyan and yellow are 229 and 247 out of 255 once the colour is
 * taken away, and green and cyan are 220 and 229. On an e-ink reader, a grayscale phone mode, a
 * monochrome print, or to a reader who cannot separate the red-green axis, two series in two of
 * those colours are one series drawn twice. So each carries a second channel that survives the
 * colour being removed: a dash pattern and a marker shape on a line, one of these textures on an
 * area or a bar.
 *
 * Textures are an **overlay**, not a fill. The shape is drawn once in its own colour and once more
 * on top filled with `url(#…)`, whose ink is white at low opacity — so the colour reader loses
 * nothing and the monochrome reader gains a texture. The alternative, a pattern carrying the base
 * colour as a full-tile background rect, needs only one element per bar and was rejected: a
 * full-coverage tile shows hairline seams where the tiles meet under anti-aliasing, and on a
 * near-black panel those seams read as a grid ruled across the data. Semi-transparent stripes have
 * no such edge.
 *
 * The overlay is `pointer-events: none` (in `chartTextures.css`) because the `<title>` carrying a
 * bar's tooltip is on the shape beneath it, and a lid over that shape is a bar with no tooltip.
 *
 * Ids are fixed rather than namespaced per chart. Several charts on one page each render their own
 * copy of these defs, so the ids repeat and `url(#chart-tex-diagonal)` resolves to whichever came
 * first — which is correct by construction, the definitions being identical. Pattern geometry is
 * `userSpaceOnUse`, resolved against the *referencing* element's user space, so a shared definition
 * still tiles at each chart's own scale.
 */

/**
 * The tile, in user units. Every chart here is a 600-unit viewBox drawn at 320–600 CSS px, so a
 * tile of 8 lands between 4 and 8 px — coarse enough to read as texture on a 9px timeline bar, fine
 * enough not to become a second data series on a 200px area band.
 *
 * `chartContrast.test.ts` reads this number out of this file and checks the CSS gradients that
 * restate these textures for the legend swatches still agree with it.
 */
export const TILE = 8;

/** Width of the ink stripe in the diagonal tile, and of each arm of the crosshatch. */
export const DIAGONAL_INK = 3;
export const CROSSHATCH_INK = 2;

export const TEXTURE = {
  /** 45° stripes. The default when one series in a pair needs marking. */
  diagonal: 'chart-tex-diagonal',
  /** Stripes both ways — reads as "denser than diagonal", so it pairs with it on a third series. */
  crosshatch: 'chart-tex-crosshatch',
  /** A dither of dots, the lightest of the three, for a series that is already pale. */
  dot: 'chart-tex-dot',
} as const;

export type TextureName = (typeof TEXTURE)[keyof typeof TEXTURE];

/** What to put in a `fill` for a textured overlay. */
export function texture(name: TextureName): string {
  return `url(#${name})`;
}

/**
 * The `<defs>` block. Render it once inside each chart's own `<svg>`, before anything that
 * references it.
 */
export default function ChartTextures() {
  return (
    <defs>
      <pattern
        id={TEXTURE.diagonal}
        width={TILE}
        height={TILE}
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(45)"
      >
        <rect className="chart-tex-ink" width={DIAGONAL_INK} height={TILE} />
      </pattern>

      <pattern
        id={TEXTURE.crosshatch}
        width={TILE}
        height={TILE}
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(45)"
      >
        <rect className="chart-tex-ink" width={TILE} height={CROSSHATCH_INK} />
        <rect className="chart-tex-ink" width={CROSSHATCH_INK} height={TILE} />
      </pattern>

      <pattern id={TEXTURE.dot} width={6} height={6} patternUnits="userSpaceOnUse">
        <circle className="chart-tex-ink" cx={3} cy={3} r={1.4} />
      </pattern>
    </defs>
  );
}
