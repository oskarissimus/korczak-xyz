// Least-squares linear fit for the time series on the stats pages.
//
// Day-to-day per-key numbers are noisy enough that the raw line rarely answers
// the only question that matters — "is this getting better?" — so the charts
// overlay the regression line through the points.

const MS_PER_DAY = 86_400_000;

export interface TrendPoint {
  t: number; // epoch ms
  value: number;
}

export interface TrendFit {
  slopePerDay: number; // change in value per day
  endpoints: [TrendPoint, TrendPoint]; // fitted value at the first and last t
}

// A week that moves the fit by less than this is noise, not a direction.
export const FLAT_WPM_PER_WEEK = 0.5;

// Days are too short a horizon to read a typing trend on; weeks are what the
// readouts quote.
export function wpmPerWeek(fit: TrendFit): number {
  return fit.slopePerDay * 7;
}

export function trendTone(perWeek: number): 'up' | 'down' | 'flat' {
  return Math.abs(perWeek) < FLAT_WPM_PER_WEEK ? 'flat' : perWeek > 0 ? 'up' : 'down';
}

/**
 * Fit `value = a + b·x` where x is days elapsed since the first point (raw epoch
 * ms would make the sums huge and the fit numerically mushy).
 *
 * Returns null below three distinct timestamps: through two points the fit *is*
 * the data line, so drawing it would only double the stroke.
 */
export function linearTrend(points: TrendPoint[]): TrendFit | null {
  const distinctT = new Set(points.map((p) => p.t));
  if (distinctT.size < 3) return null;

  const t0 = points[0].t;
  const n = points.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (const p of points) {
    const x = (p.t - t0) / MS_PER_DAY;
    sumX += x;
    sumY += p.value;
    sumXY += x * p.value;
    sumXX += x * x;
  }

  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return null; // all points on the same day
  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  const at = (t: number) => {
    const fitted = intercept + slope * ((t - t0) / MS_PER_DAY);
    // A steep downward fit can run negative past the data; the charts here are
    // all non-negative quantities, so clamp rather than blow out the y-domain.
    return Math.max(0, fitted);
  };

  const first = points[0].t;
  const last = points[n - 1].t;
  return {
    slopePerDay: slope,
    endpoints: [
      { t: first, value: at(first) },
      { t: last, value: at(last) },
    ],
  };
}
