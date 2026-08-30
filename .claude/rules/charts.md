---
name: charts
description: Every chart on the site - why no series is ever told apart by colour alone, the shared texture/mark machinery, the pointer readout, and value-label thinning.
paths:
  - "**/components/charts/**"
  - "**/utils/charts/**"
  - "**/styles/chartTextures.css"
  - "**/styles/chartReadout.css"
  - "**/styles/chartContrast.test.ts"
  - "**/styles/srsCharts.css"
  - "**/*Chart.tsx"
  - "**/SleepTimeline.tsx"
  - "**/DailySleepBars.tsx"
---

## The charts, and why none of them is read by colour alone

Every chart on this site draws on a black panel in the CRT phosphor palette, and that palette is
almost flat in luminance at the bright end: converted to 8-bit gray, green is 220, cyan 229 and
yellow 247. So a chart that tells two series apart by those hues tells them apart by **nothing** on
an e-ink reader, in a grayscale phone mode, on a monochrome print, or to a reader who cannot
separate the red-green axis. Most of them did. Measured, worst pair per chart, before:

| Chart | Worst pair | Gray contrast | CVD ΔE |
|---|---|---|---|
| `ClimateChart` | ok / warm | **1.02** | **5.8** deutan — below the 6.0 floor |
| Typing `StatsChart` | wpm / trend | **1.09** | **3.5** protan — far below it |
| `SpreadChart` legend | dot / target | **1.09** | passes |
| `TrendChart` | accuracy / speed | **1.17** | passes (22.0) |
| `MasteryChart` + `.fb-heat-*` | young / learning | **1.20** | passes |
| `SleepTimeline` / `DailySleepBars` | night / nap | 1.74 | passes |

Two different faults, one rule. Climate and typing failed for colour-blind readers as well; the SRS
trend and the bucket ramp passed CVD and failed only in grayscale.

**No series may be told apart by hue alone.** Each carries a second channel that survives the colour
being taken away, and the legend carries the same channel:

- **lines** → a dash pattern *and* a marker shape
- **areas and bars** → a texture overlay, plus a luminance ramp where the data is sequential
- **categorical points** → a marker shape
- **annotations** (a trend fit) → neutral ink, never a series hue

`src/components/charts/` is the shared machinery — `ChartTextures.tsx` (three SVG patterns) and
`ChartMarks.tsx` (`Mark`, `SeriesSwatch`), with `src/styles/chartTextures.css` `@import`ed by the
three app sheets the way `tabs.css` is. No app prefix on those class names: they belong to none of
the four apps, which is the `.fb-empty`-in-a-shared-component lesson.

Three things about them are worth knowing before touching one:

- **A texture is an overlay, not a fill.** The shape is drawn once in its colour and again on top
  with the pattern, whose ink is white at 0.38 — so the colour reader loses no hue. A pattern
  carrying the base colour as a full-tile background rect would be one element instead of two, and
  was rejected: full-coverage tiles show hairline seams under anti-aliasing, which on a near-black
  panel read as a grid ruled across the data. The overlay is `pointer-events: none`, because the
  shape beneath owns the `<title>` that is the bar's tooltip.
- **Every `MarkShape` is filled, and there is deliberately no hollow ring.** A stroked mark cannot
  take its colour from the `fill` every series class declares, and `fill: none` would have to beat a
  series class of equal specificity imported later in the sheet. Losing that race floods the mark
  silently. Four filled shapes separate fine at four pixels.
- **A marker wearing its line's class inherits that class's `stroke`.** Hence `.typing-chart-point`,
  which resets it — and which replaced a `circle.…` selector that stopped matching the moment a
  marker could be a square or a triangle.

Hues stayed in the phosphor family; only lightness was re-stepped where two series collided. The
four scheduler buckets are the clearest case and are now named once, as `--srs-bucket-*` in
`srsCharts.css`, read by `fretboard.css` for the neck heatmap — they had been two copies of the same
four hexes. That ramp is monotonic in luminance (47 / 88 / 132 / 186, neighbours ~1.9 apart), which
is the right encoding anyway for a sequence a card walks one way along.

The typing trend fit left the palette altogether. It was yellow drawn along the green wpm line it
fits, which is the one pair here a protanope cannot separate at all; it is `--retro-gray` now, and a
least-squares fit is an annotation over the data rather than a fourth measurement, so neutral ink is
what it should always have worn.

`src/styles/chartContrast.test.ts` guards all of it, reading the stylesheets as text the way
`chordAlignment.test.ts` and `pwa/tiers.test.ts` do. It has to: **a rendering test can never catch
this.** A headless Chromium draws the colour version perfectly, and the failure exists only for a
reader whose display or vision removes a channel the test environment has. The test also checks the
CSS gradients that restate the textures for the legend swatches still agree with the SVG patterns'
geometry, since two declarations of one texture drift invisibly.

What it does **not** assert is that hue separation is ever sufficient. It is not; the second channel
is the point, and it lives in the components.

To check a change by eye, temporarily add an Astro page under `src/pages/` that renders the chart
components with synthetic props, build, and screenshot it with `html { filter: grayscale(1) }`
injected. Note that a page whose filename starts with `_` is one Astro will not build, and that
there is no JSX transform in this project's vitest — the test files are all logic and text, and
server-rendering a component from a test is not available without adding config.

### Reading a value off a chart

Every value tooltip here was an SVG `<title>`: a native hover tooltip on a desktop, and **nothing at
all** on a phone. There is no hover on a touch screen, so a dot's value was unreadable on the device
the sleep log is actually used from, and `MasteryChart` — which had no `<title>` anywhere — could not
be queried on any device at all. All eleven charts now carry a pointer readout instead.

The seam is the one the rest of this file keeps drawing: **the shared piece never learns what is
plotted.** `useChartPointer` reports where the pointer is and stops there; each chart maps that to
its own datum. Three things about it are load-bearing:

- **The conversion goes through `getScreenCTM()`**, not arithmetic on `getBoundingClientRect()`.
  These charts are drawn at `width: 100%` into a fixed viewBox, inside a panel that scrolls, on a
  page that zooms. The CTM already accounts for all of it; a scale factor worked out by hand accounts
  for whichever of them was remembered.
- **`pointerleave` clears for a mouse only.** A finger fires it the instant it lifts, so clearing
  there blanks the reading the tap was for — which is the entire feature on touch. A tapped value
  stays until the next tap. `touch-action: pan-y` is what keeps the page scrolling under a vertical
  drag while a horizontal one scrubs.
- **The hit-testing maths is pure and lives in `src/utils/charts/hitTest.ts`**, for `comboKeys.ts`'s
  reason: there is no jsdom here, so a `pointermove` handler is not a state a test can reach.
  `nearestIndex` / `nearestPoint` / `bandIndex` / `rowIndex` / `spanAt` are the five shapes the
  eleven charts need — a line, a jittered scatter, a bar's slot, a timeline's row, a bar within it.

Each chart gains a transparent `.chart-surface` rect as its **first** child, so the empty parts of a
panel are pointable and not just the pixels a 4px mark covers. Being at the bottom of the paint order
it takes nothing away: every existing `<title>` above it still fires, so the desktop tooltips are
kept rather than replaced. Where a readout and a `<title>` say the same thing they are built from one
function, so the two cannot come to disagree.

`ChartReadout` is the line itself, and it reserves its height whether or not it has anything to say —
a row that grows and shrinks moves the chart under the finger scrubbing it, the typing sync slot's
rule again. Idle shows a **hint, not data**: an empty reserved line and a broken feature look
identical, and on a phone nothing else says the chart can be asked. It wraps rather than truncating;
the Polish readout is two lines at 320px, and the reserved two lines are why nothing shifts there.

One thing this does not do is give the keyboard a way in. Arrow-key traversal of a chart is a real
feature and a separate one; `role="img"`, the `aria-label` and the `<title>`s are untouched.

### The numbers printed on the typing chart thin out; they do not switch off

`StatsChart` draws a direct value label above each point in day and week mode, and those labels lived
**inside the marker loop** — so `MAX_MARKERS`, the cap that drops markers past 40 points because they
become clutter, took every number down with them. A daily chart gains a point a day, so it printed
its numbers for forty days and then, on the forty-first, printed none at all, with nothing on the
screen to say why. That is a decision about markers being applied to labels, and it is the kind of
threshold nobody crosses twice: the chart looked fine the day before.

Room for a label is a matter of **pixels**, so `src/utils/charts/labels.ts` works out a stride and
the chart labels every nth point instead of abandoning them. Four things about it:

- **The stride is per series**, from the widest label that series actually prints. `1h 05m` needs
  three times the room `44` does, and one stride shared across the three would size the wpm numbers
  for the time series' worst case.
- **A slot is one and a half labels wide.** The labels at the two ends are anchored to the plot's
  edges rather than centred on their points, which puts each of them half a label further in than the
  stride assumed; sizing for the middle alone leaves the last two numbers of a long chart printed on
  top of each other, at the end of the chart that is read most.
- **The stride counts back from the newest point**, so the last day is always labelled — a stride
  anchored at the left drops it whenever the count is not a multiple of the stride.
- **A labelled point keeps its marker** even past `MAX_MARKERS`, or the number floats over a line of
  a hundred vertices with nothing saying which one it belongs to.

The label's font size is stated twice — `LABEL_FONT_SIZE` in `StatsChart.tsx`, which the stride is
measured with, and `font-size` on `.typing-chart-label`, which is what gets drawn. Nothing makes a
TypeScript constant and a CSS declaration agree by construction, so `labels.test.ts` reads both files
as text and compares them, the way `chordAlignment.test.ts` and `pwa/tiers.test.ts` do. The width
itself is arithmetic on VT323's 0.40em cell — the same cell the songbook aligns chords on — and it is
exact: measured in Chromium, every label comes out at 5.2 units per character at 13px.
