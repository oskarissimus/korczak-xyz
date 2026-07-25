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
import { linearTrend } from '../../utils/typing/trend';
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

// A "nice" upper bound for the WPM axis: round up to the next 10, min 40.
function niceWpmMax(maxWpm: number): number {
  return Math.max(40, Math.ceil((maxWpm * 1.1) / 10) * 10);
}

// Below this the weekly slope is noise dressed up as a verdict — show it, but
// tinted neutral rather than green/red.
const FLAT_WPM_PER_WEEK = 0.5;

export default function PerKeyStats({ lang }: PerKeyStatsProps) {
  const t = translations[lang];
  const auth = useAuth();

  const [sessions, setSessions] = useState<TypingSession[]>(() => loadAllSessions());
  const [sortMode, setSortMode] = useState<SortMode>('slowest');
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

  const { keys: stats, averageWpm, typicalLatencyMs } = useMemo(
    () => computeKeyStats(sessions),
    [sessions]
  );

  // The bottleneck sort ranks by time lost, not speed — so in that mode the rows
  // show that duration instead of the WPM diverging bar, and the legend line
  // spells out the formula behind it.
  const showBottleneck = sortMode === 'bottleneck';

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

  const keyLabel = (key: string) =>
    key === ' ' ? t.keySpace : key === '\n' ? t.keyEnter : key;

  const renderKeyRow = (k: KeyStat, isUntrusted: boolean) => {
    const isSelected = k.key === selectedKey;
    const hasSpeed = k.samples > 0;
    // Diverging bar: slower-than-average keys grow left (red), faster grow right
    // (green), from the center line at the average. Outliers clamp to half-width.
    const slower = k.wpm < averageWpm;
    const devPct = hasSpeed ? Math.min(50, (Math.abs(k.wpm - averageWpm) / maxWpmDev) * 50) : 0;
    // Bottleneck mode: one magenta bar growing from the left, scaled to the
    // worst trusted key (clamped, since an untrusted key can exceed that max).
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
          title={
            !hasSpeed ? undefined : showBottleneck ? lostTitle : `${Math.round(k.meanLatencyMs)} ${t.ms}`
          }
        >
          <span
            className={`typing-key-diverge-track${
              showBottleneck ? ' typing-key-diverge-track--single' : ''
            }`}
          >
            <span className="typing-key-diverge-center" />
            {hasSpeed &&
              (showBottleneck ? (
                <span
                  className="typing-key-diverge-fill typing-key-diverge-fill--bottleneck"
                  style={{ left: 0, width: `${lostPct}%` }}
                />
              ) : (
                <span
                  className={`typing-key-diverge-fill typing-key-diverge-fill--${slower ? 'slow' : 'fast'}`}
                  style={slower ? { right: '50%', width: `${devPct}%` } : { left: '50%', width: `${devPct}%` }}
                />
              ))}
          </span>
          <span className={`typing-key-bar-value${showBottleneck ? ' typing-key-bar-value--lost' : ''}`}>
            {!hasSpeed
              ? '—'
              : showBottleneck
                ? formatDuration(k.bottleneckMs / 60000)
                : `${Math.round(k.wpm)} ${t.wpm}`}
          </span>
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
  const trendPerWeek = trend ? trend.slopePerDay * 7 : 0;
  const trendTone =
    Math.abs(trendPerWeek) < FLAT_WPM_PER_WEEK ? 'flat' : trendPerWeek > 0 ? 'up' : 'down';

  const selectedStat = selectedKey == null ? null : stats.find((k) => k.key === selectedKey) ?? null;

  const backHref = lang === 'pl' ? '/pl/games/typing/' : '/games/typing/';
  const overTimeHref = lang === 'pl' ? '/pl/games/typing/stats/' : '/games/typing/stats/';

  const sortModes: { mode: SortMode; label: string }[] = [
    { mode: 'slowest', label: t.sortSlowest },
    { mode: 'fastest', label: t.sortFastest },
    { mode: 'frequent', label: t.sortFrequent },
    { mode: 'leastAccurate', label: t.sortLeastAccurate },
    { mode: 'bottleneck', label: t.sortBottleneck },
  ];

  return (
    <div className="typing-stats-page typing-stats-page--keys">
      {!loading && stats.length === 0 ? (
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

          {showBottleneck ? (
            <p className="typing-key-avg-note typing-key-avg-note--formula">
              {t.bottleneckFormulaPre} <strong>{Math.round(typicalLatencyMs)} {t.ms}</strong>{' '}
              {t.bottleneckFormulaPost}
            </p>
          ) : (
            <p className="typing-key-avg-note">
              <span className="typing-key-avg-swatch typing-key-avg-swatch--slow" /> {t.slower}
              {'  ·  '}
              {t.avgWpmNote}: <strong>{Math.round(averageWpm)} {t.wpm}</strong>
              {'  ·  '}
              {t.faster} <span className="typing-key-avg-swatch typing-key-avg-swatch--fast" />
            </p>
          )}

          {/* Two columns: the ranked list on the left, the selected key's chart
              pinned alongside it on the right, so clicking a row doesn't send
              the chart off-screen below 26 rows of table. */}
          <div className="typing-key-layout">
            <div className="typing-key-layout-list">
              <div className="typing-key-table" role="table" aria-label={t.keyStatsTitle}>
                <div className="typing-key-row typing-key-row--head" role="row">
                  <span role="columnheader">{t.keyCol}</span>
                  <span role="columnheader">{showBottleneck ? t.timeLostCol : t.medianLatency}</span>
                  <span role="columnheader" className="typing-key-num">{t.timesTyped}</span>
                  <span role="columnheader" className="typing-key-num">{t.accuracy}</span>
                </div>
                {loading ? null : sortedTrusted.map((k) => renderKeyRow(k, false))}
              </div>

              {!loading && sortedUntrusted.length > 0 && (
                <div className="typing-key-table typing-key-table--untrusted" role="table" aria-label={t.notTrusted}>
                  <p className="typing-key-untrusted-heading">{t.notTrusted}</p>
                  {sortedUntrusted.map((k) => renderKeyRow(k, true))}
                </div>
              )}
            </div>

            <div className="typing-key-detail">
              {selectedStat == null ? (
                <p className="typing-message">{t.selectKeyHint}</p>
              ) : (
                <>
                  <p className="typing-key-detail-title">
                    {t.keyProgressTitle}{' '}
                    <strong className="typing-key-glyph">{keyLabel(selectedStat.key)}</strong>
                    {' — '}
                    {t.wpm}
                  </p>
                  {detailSeries.length > 0 ? (
                    <>
                      {trend && (
                        <p className={`typing-key-trend typing-key-trend--${trendTone}`}>
                          <span className="typing-key-trend-swatch" /> {t.trend}:{' '}
                          {trendPerWeek >= 0 ? '+' : '−'}
                          {Math.abs(trendPerWeek).toFixed(1)} {t.wpmPerWeek}
                        </p>
                      )}
                      <StatsChart
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

      <div className="typing-controls">
        <a className="retro-btn" href={backHref}>
          {t.backToTyping}
        </a>
        <a className="retro-btn" href={overTimeHref}>
          {t.backToOverTime}
        </a>
      </div>
    </div>
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
