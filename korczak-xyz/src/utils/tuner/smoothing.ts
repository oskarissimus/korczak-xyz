/*
 * Turning a stream of per-frame estimates into a needle someone can actually read.
 *
 * Two different jobs, deliberately kept apart. The median window is a *correctness* filter: a
 * frame that survived the gates but latched onto the wrong period is a wild outlier, and a median
 * discards it outright where any averaging filter would smear it across the next second. The One
 * Euro filter is a *presentation* filter, applied afterwards to a stream that is already sane.
 */

/** A rolling median. Odd sizes only, so there is a single middle element and no averaging. */
export class MedianWindow {
  private readonly values: number[] = [];

  constructor(private readonly size: number) {
    if (size < 1 || size % 2 === 0) {
      throw new Error(`Median window needs an odd size of at least 1, got ${size}`);
    }
  }

  /** Adds a sample and returns the median once the window is full, or null while it fills. */
  push(value: number): number | null {
    this.values.push(value);
    if (this.values.length > this.size) this.values.shift();
    if (this.values.length < this.size) return null;
    const sorted = [...this.values].sort((a, b) => a - b);
    return sorted[(this.size - 1) / 2];
  }

  get filled(): boolean {
    return this.values.length >= this.size;
  }

  reset(): void {
    this.values.length = 0;
  }
}

function lowpassAlpha(cutoffHz: number, deltaSeconds: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / deltaSeconds);
}

class ExponentialFilter {
  private value: number | null = null;

  filter(x: number, alpha: number): number {
    this.value = this.value === null ? x : alpha * x + (1 - alpha) * this.value;
    return this.value;
  }

  get last(): number | null {
    return this.value;
  }

  reset(): void {
    this.value = null;
  }
}

export interface OneEuroOptions {
  /**
   * Cut-off while the value is holding still, in Hz. Low means a needle that does not twitch on
   * a held note. This is the setting that costs lag, and `beta` is what buys the lag back.
   */
  minCutoff?: number;
  /**
   * How hard the cut-off opens up as the value moves. Zero degenerates to a plain exponential
   * filter, and the smooth-versus-responsive trade-off becomes unavoidable again.
   */
  beta?: number;
  /** Cut-off for the derivative estimate itself. */
  derivativeCutoff?: number;
}

/*
 * The One Euro filter (Casiez, Roussel & Vogel, CHI 2012).
 *
 * A tuner asks for two contradictory things from the same number: dead still while a string rings
 * at pitch, and immediate while a peg is turning. A fixed smoothing constant has to choose. This
 * one adapts its cut-off to the speed the value is moving, so it is heavily smoothed at rest and
 * barely smoothed during a peg turn.
 *
 * Defaults are tuned for cents at a ~30 Hz frame rate: a string ringing steadily jitters by a
 * couple of cents, which minCutoff flattens, while a peg turn moves hundreds of cents per second
 * and opens the cut-off wide enough to follow without visible lag.
 */
export class OneEuroFilter {
  private readonly minCutoff: number;
  private readonly beta: number;
  private readonly derivativeCutoff: number;
  private readonly xFilter = new ExponentialFilter();
  private readonly dxFilter = new ExponentialFilter();
  private lastTimeSeconds: number | null = null;

  constructor({ minCutoff = 0.8, beta = 0.012, derivativeCutoff = 1 }: OneEuroOptions = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.derivativeCutoff = derivativeCutoff;
  }

  filter(value: number, timeSeconds: number): number {
    const previous = this.xFilter.last;
    // The first sample has no interval to measure against; assume the nominal frame rate.
    const delta =
      this.lastTimeSeconds === null ? 1 / 30 : Math.max(timeSeconds - this.lastTimeSeconds, 1e-4);
    this.lastTimeSeconds = timeSeconds;

    const derivative = previous === null ? 0 : (value - previous) / delta;
    const smoothedDerivative = this.dxFilter.filter(
      derivative,
      lowpassAlpha(this.derivativeCutoff, delta),
    );

    const cutoff = this.minCutoff + this.beta * Math.abs(smoothedDerivative);
    return this.xFilter.filter(value, lowpassAlpha(cutoff, delta));
  }

  reset(): void {
    this.xFilter.reset();
    this.dxFilter.reset();
    this.lastTimeSeconds = null;
  }
}
