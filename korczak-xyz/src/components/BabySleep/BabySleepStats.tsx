/*
 * The stats tab.
 *
 * Everything is recomputed from the entries on render — there is nothing cached, because the whole
 * window is at most a few hundred entries and a stale figure would be worse than a cheap one.
 *
 * `now` is read once per render into a const, the way `FretboardStats` does it, so every tile and
 * every chart agrees on where the present is. Two readings a millisecond apart could put the "day in
 * progress" marker on a different bar than the mean excluded.
 *
 * Each tile prints the number of days behind its figure. Those counts differ between tiles by design
 * — a day with naps logged and no night is data for one mean and not the other — and an average over
 * two days should not look like an average over thirty.
 */

import { useMemo, useState } from 'react';

import { useAuth } from '../../hooks/useAuth';
import { useBabySleepData } from '../../hooks/useBabySleepData';
import { useDataOwner } from '../../hooks/useDataOwner';
import { resolveWindow } from '../../utils/babySleep/days';
import { formatClock, formatHm, formatSpread } from '../../utils/babySleep/format';
import { bedtimePoints, computeStats, firstNapPoints, wakePoints } from '../../utils/babySleep/stats';
import { loadSettings, saveSettings } from '../../utils/babySleep/storage';
import type { ClockStat, MeanStat, WindowChoice } from '../../utils/babySleep/types';
import ClockSpreadChart from './ClockSpreadChart';
import DailySleepBars from './DailySleepBars';
import SleepTimeline from './SleepTimeline';
import SyncBadge from './SyncBadge';
import WindowPicker from './WindowPicker';
import { fill, localeOf, plural, translations, type Lang, type Translation } from './translations';

interface BabySleepStatsProps {
  lang: Lang;
}

function isWindowChoice(value: string): value is WindowChoice {
  return value === '3d' || value === '7d' || value === '30d' || value === 'custom';
}

interface TileProps {
  label: string;
  value: string;
  n: number;
  spread?: string;
  /**
   * What `n` counts. Every figure here is a mean over days except the nap length, which is a mean
   * over individual naps — printing "over 8 days" beneath a figure drawn from eight naps across four
   * days is simply a false statement about the data.
   */
  unit?: 'days' | 'naps';
  t: Translation;
}

function Tile({ label, value, n, spread, unit = 'days', t }: TileProps) {
  const qualifier =
    unit === 'naps'
      ? plural(n, t.fromNaps, t.fromNapsPlural)
      : plural(n, t.overDays, t.overDaysPlural);
  return (
    <div className="bs-tile">
      <span className="bs-tile-value">{value}</span>
      {spread && <span className="bs-tile-spread">{spread}</span>}
      <span className="bs-tile-label">{label}</span>
      <span className="bs-tile-of">{n === 0 ? '' : fill(qualifier, { count: n })}</span>
    </div>
  );
}

export default function BabySleepStats({ lang }: BabySleepStatsProps) {
  const t = translations[lang];
  const auth = useAuth();
  const owner = useDataOwner(auth.user);
  const data = useBabySleepData(auth.user, owner);

  const [stored] = useState(() => loadSettings());
  const [choice, setChoice] = useState<WindowChoice>(() =>
    isWindowChoice(stored.window) ? stored.window : '7d'
  );
  const [range, setRange] = useState({ from: stored.customFrom, to: stored.customTo });

  const persist = (next: { window: WindowChoice; from: string; to: string }) => {
    saveSettings({ window: next.window, customFrom: next.from, customTo: next.to });
  };

  const locale = localeOf(lang);
  const formatDay = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format,
    [locale]
  );
  const formatTime = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format,
    [locale]
  );

  const now = Date.now();
  const window = useMemo(
    () => resolveWindow(choice, now, range),
    // `now` is deliberately not a dependency: it changes every render, and the window only needs to
    // move when the choice does. A page left open overnight is refreshed by any interaction.
    [choice, range.from, range.to] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const stats = useMemo(
    () => computeStats(data.entries, window, now),
    [data.entries, window] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const clockTile = (label: string, stat: ClockStat) => (
    <Tile
      label={label}
      value={stat.mean == null ? t.noData : formatClock(stat.mean)}
      spread={stat.sd == null ? undefined : formatSpread(stat.sd * 60_000)}
      n={stat.n}
      t={t}
    />
  );

  const durationTile = (label: string, stat: MeanStat, unit?: 'days' | 'naps') => (
    <Tile
      label={label}
      value={stat.mean == null ? t.noData : formatHm(stat.mean)}
      n={stat.n}
      unit={unit}
      t={t}
    />
  );

  if (!data.ready) return <div className="bs-loading" />;

  return (
    <div className="bs-stats">
      <WindowPicker
        choice={choice}
        from={range.from}
        to={range.to}
        onChoice={(next) => {
          setChoice(next);
          persist({ window: next, ...range });
        }}
        onRange={(from, to) => {
          setRange({ from, to });
          persist({ window: choice, from, to });
        }}
        t={t}
      />

      <div className="bs-tiles">
        {/* The night figures together, then the nap ones: how long the night was, how often it broke
            and how much of it was spent awake are one question asked three ways, and reading them
            off a row that alternates between nights and naps is harder than it needs to be. */}
        {durationTile(t.tileTotal, stats.totalPerDay)}
        {durationTile(t.tileNight, stats.nightPerDay)}
        <Tile
          label={t.tileNightWakes}
          value={stats.nightWakes.mean == null ? t.noData : stats.nightWakes.mean.toFixed(1)}
          n={stats.nightWakes.n}
          t={t}
        />
        {durationTile(t.tileNightAwake, stats.nightAwake)}
        {durationTile(t.tileNaps, stats.napPerDay)}
        <Tile
          label={t.tileNapCount}
          value={stats.napsPerDay.mean == null ? t.noData : stats.napsPerDay.mean.toFixed(1)}
          n={stats.napsPerDay.n}
          t={t}
        />
        {durationTile(t.tileNapLength, stats.napLength, 'naps')}
        {clockTile(t.tileBedtime, stats.bedtime)}
        {clockTile(t.tileWake, stats.wakeTime)}
        {clockTile(t.tileFirstNap, stats.firstNapStart)}
      </div>

      <p className="bs-note">{t.statsNote}</p>

      <section className="bs-section">
        <h2 className="bs-subhead">{t.timelineTitle}</h2>
        <SleepTimeline
          days={stats.days}
          entries={data.entries}
          now={now}
          formatDay={formatDay}
          formatTime={formatTime}
          ariaLabel={t.timelineAria}
          emptyLabel={t.chartEmpty}
        />
        <ul className="bs-legend">
          <li>
            <span className="bs-swatch bs-swatch--night" aria-hidden="true" />
            {t.legendNight}
          </li>
          <li>
            <span className="bs-swatch bs-swatch--nap" aria-hidden="true" />
            {t.legendNap}
          </li>
          <li>
            <span className="bs-swatch bs-swatch--running" aria-hidden="true" />
            {t.legendRunning}
          </li>
        </ul>
      </section>

      <section className="bs-section">
        <h2 className="bs-subhead">{t.totalsTitle}</h2>
        <DailySleepBars
          days={stats.days}
          mean={stats.totalPerDay}
          formatDay={formatDay}
          labels={{
            night: t.legendNight,
            nap: t.legendNap,
            incomplete: t.legendIncomplete,
            mean: t.legendMean,
          }}
          ariaLabel={t.totalsAria}
          emptyLabel={t.chartEmpty}
        />
      </section>

      <section className="bs-section">
        <h2 className="bs-subhead">{t.bedtimeTitle}</h2>
        <ClockSpreadChart
          points={bedtimePoints(stats.days)}
          stat={stats.bedtime}
          formatDay={formatDay}
          label={t.bedtimeSeries}
          meanLabel={t.legendMean}
          spreadLabel={t.legendSpread}
          ariaLabel={t.bedtimeAria}
          emptyLabel={t.chartEmpty}
        />
        <ClockSpreadChart
          points={wakePoints(stats.days)}
          stat={stats.wakeTime}
          formatDay={formatDay}
          label={t.wakeSeries}
          meanLabel={t.legendMean}
          spreadLabel={t.legendSpread}
          ariaLabel={t.bedtimeAria}
          emptyLabel={t.chartEmpty}
        />
        <ClockSpreadChart
          points={firstNapPoints(stats.days)}
          stat={stats.firstNapStart}
          formatDay={formatDay}
          label={t.tileFirstNap}
          meanLabel={t.legendMean}
          spreadLabel={t.legendSpread}
          ariaLabel={t.bedtimeAria}
          emptyLabel={t.chartEmpty}
        />
      </section>

      <SyncBadge sync={data.sync} onRetry={data.retrySync} t={t} />
    </div>
  );
}
