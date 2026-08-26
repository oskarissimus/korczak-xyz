import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { loadCloudSessions } from '../../utils/typing/cloudStorage';
import { dedupeSessionsById, loadAllSessions } from '../../utils/typing/storage';
import {
  computeKeyStats,
  keyWpmOverTime,
  latencyFromWpm,
  MIN_KEY_SAMPLES,
  type KeyStat,
} from '../../utils/typing/keyStats';
import { formatDuration } from '../../utils/typing/metrics';
import { filterSessionsSince, PERIOD_MS, type StatsPeriod } from '../../utils/typing/period';
import { linearTrend, trendTone, wpmPerWeek } from '../../utils/typing/trend';
import type { TypingSession } from '../../utils/typing/types';
import StatsChart, { type StatsSeries } from './StatsChart';
import { translations, type Lang } from './translations';

interface PerKeyStatsProps {
  lang: Lang;
}

type SortMode = 'slowest' | 'fastest' | 'frequent' | 'leastAccurate' | 'bottleneck';

// A key is "trusted" once it has enough correct-press latency samples for its
// median to mean something; below that it lives in a separate dimmed section.
const trusted = (k: KeyStat) => k.samples >= MIN_KEY_SAMPLES;

// Sort comparators for the (already-grouped) key rows. Slowest = lowest WPM.
const comparators: Record<SortMode, (a: KeyStat, b: KeyStat) => number> = {
  slowest: (a, b) => a.wpm - b.wpm,
  fastest: (a, b) => b.wpm - a.wpm,
  frequent: (a, b) => b.count - a.count,
  leastAccurate: (a, b) => a.accuracy - b.accuracy,
  bottleneck: (a, b) => b.bottleneckMs - a.bottleneckMs,
};

// Every column is shown in every mode, so the row order is the only thing a
// sort changes — which makes the header the one place that can say where that
// order came from. Maps each mode to the column it ranks and the direction.
type Column = 'speed' | 'lost' | 'typed' | 'accuracy';
const sortedBy: Record<SortMode, { column: Column; dir: 'ascending' | 'descending' }> = {
  slowest: { column: 'speed', dir: 'ascending' },
  fastest: { column: 'speed', dir: 'descending' },
  frequent: { column: 'typed', dir: 'descending' },
  leastAccurate: { column: 'accuracy', dir: 'ascending' },
  bottleneck: { column: 'lost', dir: 'descending' },
};

// A "nice" upper bound for the WPM axis: round up to the next 10, min 40.
function niceWpmMax(maxWpm: number): number {
  return Math.max(40, Math.ceil((maxWpm * 1.1) / 10) * 10);
}

export default function PerKeyStats({ lang }: PerKeyStatsProps) {
  const t = translations[lang];
  const auth = useAuth();

  const [sessions, setSessions] = useState<TypingSession[]>(() => loadAllSessions());
  const [sortMode, setSortMode] = useState<SortMode>('slowest');
  const [period, setPeriod] = useState<StatsPeriod>('all');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Mirror the over-time stats page: show local data immediately, then merge the
  // signed-in user's cloud sessions once they land. Gate the empty state on the
  // cloud settling so we don't flash "no data" for a user who has cloud sessions.
  const [cloudSettled, setCloudSettled] = useState(false);
  const uid = auth.user?.uid;
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    setCloudSettled(false);
    loadCloudSessions(uid)
      .then((cloud) => {
        if (cancelled) return;
        if (cloud.length > 0) {
          setSessions((local) => dedupeSessionsById([...local, ...cloud]));
        }
      })
      .catch(() => {
        // Cloud fetch is best-effort; local sessions are already shown.
      })
      .finally(() => {
        if (!cancelled) setCloudSettled(true);
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const loading = auth.loading || (!!uid && !cloudSettled);

  // The ranked table, the spotlights and the average baseline are all scoped to
  // the chosen period; the detail chart below deliberately isn't (see there).
  const scopedSessions = useMemo(
    () => (period === 'all' ? sessions : filterSessionsSince(sessions, Date.now() - PERIOD_MS[period])),
    [sessions, period]
  );

  const { keys: stats, averageWpm, typicalLatencyMs } = useMemo(
    () => computeKeyStats(scopedSessions),
    [scopedSessions]
  );

  // Gated on the *unfiltered* sessions: an empty period is a filtering result,
  // not an empty page, and must keep the controls around to switch back.
  const hasAnyKeystrokes = useMemo(
    () => sessions.some((s) => s.events.some((e) => e.kind === 'char')),
    [sessions]
  );

  // Two groups: trusted keys (enough correct samples) in the main table, the
  // noisy remainder in a dimmed section below. Both follow the active sort.
  const ranked = useMemo(() => stats.filter(trusted), [stats]);
  const sortedTrusted = useMemo(() => [...ranked].sort(comparators[sortMode]), [ranked, sortMode]);
  const sortedUntrusted = useMemo(
    () =>
      stats
        .filter((k) => !trusted(k))
        // Keys with no measurable speed (samples 0) sink to the bottom; the rest
        // are ranked slowest-first (lowest WPM) regardless of the active sort,
        // since their sparse numbers aren't worth re-ordering.
        .sort((a, b) => Number(a.samples === 0) - Number(b.samples === 0) || a.wpm - b.wpm),
    [stats]
  );
  const slowest = useMemo(
    () => ranked.reduce<KeyStat | null>((m, k) => (!m || k.wpm < m.wpm ? k : m), null),
    [ranked]
  );
  const fastest = useMemo(
    () => ranked.reduce<KeyStat | null>((m, k) => (!m || k.wpm > m.wpm ? k : m), null),
    [ranked]
  );
  const bottleneck = useMemo(
    () => ranked.reduce<KeyStat | null>((m, k) => (!m || k.bottleneckMs > m.bottleneckMs ? k : m), null),
    [ranked]
  );

  // Diverging-bar scale: the largest WPM gap from the average among trusted
  // keys sets the half-width, so the biggest outlier fills its side.
  const maxWpmDev =
    ranked.reduce((m, k) => (k.samples > 0 ? Math.max(m, Math.abs(k.wpm - averageWpm)) : m), 0) || 1;

  // Bottleneck bars are single-direction and scaled to the worst trusted key.
  const maxBottleneck = ranked.reduce((m, k) => Math.max(m, k.bottleneckMs), 0) || 1;

  const locale = lang === 'pl' ? 'pl-PL' : 'en-US';
  const formatDate = (ms: number) =>
    new Date(ms).toLocaleDateString(locale, { month: 'short', day: 'numeric' });

  const ariaSort = (column: Column) =>
    sortedBy[sortMode].column === column ? sortedBy[sortMode].dir : undefined;

  const keyLabel = (key: string) =>
    key === ' ' ? t.keySpace : key === '\n' ? t.keyEnter : key;

  const renderKeyRow = (k: KeyStat, isUntrusted: boolean) => {
    const isSelected = k.key === selectedKey;
    const hasSpeed = k.samples > 0;
    // Diverging bar: slower-than-average keys grow left (red), faster grow right
    // (green), from the center line at the average. Outliers clamp to half-width.
    const slower = k.wpm < averageWpm;
    const devPct = hasSpeed ? Math.min(50, (Math.abs(k.wpm - averageWpm) / maxWpmDev) * 50) : 0;
    // Time lost has no meaningful midpoint, so its cell gets a magenta rule
    // along the bottom edge instead of a track: it grows from the left, scaled
    // to the worst trusted key (clamped, since an untrusted key can exceed it).
    const lostPct = hasSpeed ? Math.min(100, (k.bottleneckMs / maxBottleneck) * 100) : 0;
    // Spell out the numbers behind the metric on hover: (gap − avg) ms × presses.
    const lostTitle = `(${Math.round(k.meanLatencyMs)} − ${Math.round(typicalLatencyMs)}) ${t.ms} × ${k.samples}`;
    return (
      <button
        type="button"
        key={k.key}
        role="row"
        className={`typing-key-row${isSelected ? ' typing-key-row--selected' : ''}${
          isUntrusted ? ' typing-key-row--untrusted' : ''
        }`}
        aria-pressed={isSelected}
        onClick={() => setSelectedKey(k.key)}
      >
        <span className="typing-key-glyph" role="cell">
          {keyLabel(k.key)}
        </span>
        <span
          className="typing-key-bar-cell"
          role="cell"
          title={hasSpeed ? `${Math.round(k.meanLatencyMs)} ${t.ms}` : undefined}
        >
          <span className="typing-key-diverge-track">
            <span className="typing-key-diverge-center" />
            {hasSpeed && (
              <span
                className={`typing-key-diverge-fill typing-key-diverge-fill--${slower ? 'slow' : 'fast'}`}
                style={slower ? { right: '50%', width: `${devPct}%` } : { left: '50%', width: `${devPct}%` }}
              />
            )}
          </span>
          <span className="typing-key-bar-value">
            {hasSpeed ? Math.round(k.wpm) : '—'}
            {hasSpeed && <span className="typing-key-wpm-unit"> {t.wpm}</span>}
          </span>
        </span>
        <span className="typing-key-lost" role="cell" title={hasSpeed ? lostTitle : undefined}>
          {hasSpeed && <span className="typing-key-lost-fill" style={{ width: `${lostPct}%` }} />}
          {hasSpeed ? formatDuration(k.bottleneckMs / 60000) : '—'}
        </span>
        <span className="typing-key-num" role="cell">
          {k.count}
        </span>
        <span className="typing-key-num" role="cell">
          {Math.round(k.accuracy)}%
        </span>
      </button>
    );
  };

  // Detail mini-chart series for the selected key: that key's WPM per day, plus
  // a least-squares fit through it so the direction is readable at a glance.
  // Always full history, whatever the period filter says — long-run progress is
  // the whole point of this panel, and a 24-hour window would leave one dot.
  const detailPoints = useMemo(
    () => (selectedKey == null ? [] : keyWpmOverTime(sessions, selectedKey)),
    [sessions, selectedKey]
  );
  const trend = useMemo(() => linearTrend(detailPoints), [detailPoints]);
  const detailSeries: StatsSeries[] = [];
  if (detailPoints.length > 0) {
    detailSeries.push({
      key: 'keywpm',
      points: detailPoints,
      lineClass: 'typing-chart-line--keywpm',
      // Spell out the gap behind the WPM — it's the number the rest of the page
      // (bottleneck formula, row tooltips) is denominated in.
      formatValue: (v) => `${Math.round(v)} ${t.wpm} (${Math.round(latencyFromWpm(v))} ${t.ms})`,
      formatLabel: (v) => String(Math.round(v)),
    });
    if (trend) {
      detailSeries.push({
        key: 'trend',
        points: trend.endpoints,
        lineClass: 'typing-chart-line--trend',
        markers: false, // an annotation, not measurements
        formatValue: (v) => String(Math.round(v)),
        formatLabel: (v) => String(Math.round(v)),
      });
    }
  }
  const detailMax = [...detailPoints, ...(trend?.endpoints ?? [])].reduce(
    (m, p) => Math.max(m, p.value),
    0
  );
  const detailYDomain: [number, number] = [0, niceWpmMax(detailMax)];
  const perWeek = trend ? wpmPerWeek(trend) : 0;
  const tone = trendTone(perWeek);

  const sortModes: { mode: SortMode; label: string }[] = [
    { mode: 'slowest', label: t.sortSlowest },
    { mode: 'fastest', label: t.sortFastest },
    { mode: 'frequent', label: t.sortFrequent },
    { mode: 'leastAccurate', label: t.sortLeastAccurate },
    { mode: 'bottleneck', label: t.sortBottleneck },
  ];

  const periods: { value: StatsPeriod; label: string }[] = [
    { value: 'all', label: t.periodAll },
    { value: 'week', label: t.periodWeek },
    { value: 'day', label: t.periodDay },
  ];

  // History exists, but none of it falls inside the chosen window: swap the
  // table (and the average note, which would otherwise claim 0 WPM) for a
  // message, keeping the controls so the period can be widened again.
  const emptyPeriod = !loading && stats.length === 0;

  return (
    <div className="typing-stats-page typing-stats-page--keys">
      {!loading && !hasAnyKeystrokes ? (
        <p className="typing-message">{t.noKeyData}</p>
      ) : (
        <>
          <div className="typing-key-spotlights">
            <SpotlightCard label={t.slowestKey} stat={slowest} keyLabel={keyLabel} t={t} tone="slow" />
            <SpotlightCard label={t.fastestKey} stat={fastest} keyLabel={keyLabel} t={t} tone="fast" />
            <SpotlightCard
              label={t.bottleneckKey}
              stat={bottleneck}
              keyLabel={keyLabel}
              t={t}
              tone="bottleneck"
            />
          </div>

          <div className="typing-chart-controls">
            <div className="typing-toggle-group" role="group" aria-label={t.keyStatsTitle}>
              {sortModes.map(({ mode, label }) => (
                <button
                  key={mode}
                  type="button"
                  className="typing-toggle"
                  aria-pressed={sortMode === mode}
                  onClick={() => setSortMode(mode)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="typing-toggle-group" role="group" aria-label={t.period}>
              {periods.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  className="typing-toggle"
                  aria-pressed={period === value}
                  onClick={() => setPeriod(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* One legend line per metric column, both always shown: the swatches
              read the diverging speed bar, the formula reads the time-lost
              column. Neither column is conditional any more, so neither note is. */}
          {emptyPeriod ? null : (
            <>
              <p className="typing-key-avg-note">
                <span className="typing-key-avg-swatch typing-key-avg-swatch--slow" /> {t.slower}
                {'  ·  '}
                {t.avgWpmNote}: <strong>{Math.round(averageWpm)} {t.wpm}</strong>
                {'  ·  '}
                {t.faster} <span className="typing-key-avg-swatch typing-key-avg-swatch--fast" />
              </p>
              <p className="typing-key-avg-note typing-key-avg-note--formula">
                {t.bottleneckFormulaPre} <strong>{Math.round(typicalLatencyMs)} {t.ms}</strong>{' '}
                {t.bottleneckFormulaPost}
              </p>
            </>
          )}

          {/* Two columns: the ranked list on the left, the selected key's chart
              pinned alongside it on the right, so clicking a row doesn't send
              the chart off-screen below 26 rows of table. */}
          <div className="typing-key-layout">
            <div className="typing-key-layout-list">
              {emptyPeriod ? (
                <p className="typing-message">{t.noKeyDataInPeriod}</p>
              ) : (
                <>
                  <div className="typing-key-table" role="table" aria-label={t.keyStatsTitle}>
                    <div className="typing-key-row typing-key-row--head" role="row">
                      <HeadCell full={t.keyCol} short={t.keyColShort} />
                      <HeadCell
                        full={t.medianLatency}
                        short={t.medianLatencyShort}
                        sort={ariaSort('speed')}
                      />
                      <HeadCell
                        full={t.timeLostCol}
                        short={t.timeLostColShort}
                        sort={ariaSort('lost')}
                        numeric
                      />
                      <HeadCell
                        full={t.timesTyped}
                        short={t.timesTypedShort}
                        sort={ariaSort('typed')}
                        numeric
                      />
                      <HeadCell
                        full={t.accuracy}
                        short={t.accuracyShort}
                        sort={ariaSort('accuracy')}
                        numeric
                      />
                    </div>
                    {loading ? null : sortedTrusted.map((k) => renderKeyRow(k, false))}
                  </div>

                  {!loading && sortedUntrusted.length > 0 && (
                    <div className="typing-key-table typing-key-table--untrusted" role="table" aria-label={t.notTrusted}>
                      <p className="typing-key-untrusted-heading">{t.notTrusted}</p>
                      {sortedUntrusted.map((k) => renderKeyRow(k, true))}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="typing-key-detail">
              {selectedKey == null ? (
                <p className="typing-message">{t.selectKeyHint}</p>
              ) : (
                <>
                  <p className="typing-key-detail-title">
                    {t.keyProgressTitle}{' '}
                    <strong className="typing-key-glyph">{keyLabel(selectedKey)}</strong>
                    {' — '}
                    {t.wpm}
                  </p>
                  {detailSeries.length > 0 ? (
                    <>
                      {trend && (
                        <p className={`typing-trend-note typing-trend-note--${tone}`}>
                          <span className="typing-trend-swatch" /> {t.trend}:{' '}
                          {perWeek >= 0 ? '+' : '−'}
                          {Math.abs(perWeek).toFixed(1)} {t.wpmPerWeek}
                        </p>
                      )}
                      <StatsChart
                        hintLabel={t.chartHint}
                        series={detailSeries}
                        yDomain={detailYDomain}
                        formatDate={formatDate}
                        showLabels={detailPoints.length <= 12}
                      />
                    </>
                  ) : (
                    <p className="typing-message">{t.selectKeyHint}</p>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// A column heading in two lengths: the full word, and the abbreviation a phone
// has room for. Which one shows is CSS's call (see the 600px block), so the
// accessible name is pinned to the full word — it can't depend on the viewport.
function HeadCell({
  full,
  short,
  sort,
  numeric,
}: {
  full: string;
  short: string;
  sort?: 'ascending' | 'descending';
  numeric?: boolean;
}) {
  return (
    <span
      role="columnheader"
      className={numeric ? 'typing-key-num' : undefined}
      aria-label={full}
      aria-sort={sort}
    >
      <span className="typing-key-head-full" aria-hidden="true">
        {full}
      </span>
      <span className="typing-key-head-short" aria-hidden="true">
        {short}
      </span>
    </span>
  );
}

interface SpotlightProps {
  label: string;
  stat: KeyStat | null;
  keyLabel: (key: string) => string;
  t: (typeof translations)[Lang];
  tone: 'slow' | 'fast' | 'bottleneck';
}

function SpotlightCard({ label, stat, keyLabel, t, tone }: SpotlightProps) {
  const value =
    stat == null
      ? '—'
      : tone === 'bottleneck'
        ? formatDuration(stat.bottleneckMs / 60000) // time lost vs. typical speed
        : `${Math.round(stat.wpm)} ${t.wpm}`;
  return (
    <div className={`typing-key-spotlight typing-key-spotlight--${tone}`}>
      <span className="typing-key-spotlight-label">{label}</span>
      <span className="typing-key-spotlight-glyph">{stat ? keyLabel(stat.key) : '—'}</span>
      <span className="typing-key-spotlight-value">{value}</span>
    </div>
  );
}
