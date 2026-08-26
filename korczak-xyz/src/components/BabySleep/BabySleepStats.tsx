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
import { useNightRoutine } from '../../hooks/useNightRoutine';
import { useSleepTargets } from '../../hooks/useSleepTargets';
import { mergeAllSync } from '../../utils/flashcards/sync';
import { resolveWindow } from '../../utils/babySleep/days';
import { formatClock, formatHm, formatSpread } from '../../utils/babySleep/format';
import {
  bedtimePoints,
  computeStats,
  firstNapPoints,
  nightDurationPoints,
  wakePoints,
} from '../../utils/babySleep/stats';
import {
  asleepByRoutine,
  computeRoutineStats,
  cribPoints,
  nightRoutinesByDay,
  settlePoints,
} from '../../utils/babySleep/routineStats';
import { movingAverage, NIGHT_AVERAGE_WINDOW } from '../../utils/babySleep/movingAverage';
import { loadSettings, saveSettings } from '../../utils/babySleep/storage';
import type { ClockStat, MeanStat, WindowChoice } from '../../utils/babySleep/types';
import ClockSpreadChart from './ClockSpreadChart';
import DailySleepBars from './DailySleepBars';
import DurationSpreadChart, {
  SHORT_MIN_SPAN,
  SHORT_TICK_STEPS,
} from './DurationSpreadChart';
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
  const routines = useNightRoutine(auth.user, owner);
  /* The one thing on this page that is not a measurement: the crib time the household is aiming at,
     drawn on the timeline and on the in-crib chart. Set on the config tab. */
  const targets = useSleepTargets(auth.user, owner);

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
  /*
   * The routine figures are folded over the same day buckets, so every tile on this page — sleep and
   * routine alike — is drawn from one grouping of one window.
   */
  const routineStats = useMemo(
    () => computeRoutineStats(stats.days, routines.records),
    [stats.days, routines.records]
  );
  const routineByNight = useMemo(() => nightRoutinesByDay(routines.records), [routines.records]);
  /* Held in one place because the chart plots these, the trailing average is folded over them, and
     `nightPerDay` is the mean of them — three readings of one population, which is the whole reason
     `computeStats` goes through this extractor rather than over the day buckets. */
  const nightPoints = useMemo(() => nightDurationPoints(stats.days), [stats.days]);
  /* The timeline's settling bands end where this says the sleep began — the same `asleepFor` the
     history rows and the live strip use, so none of them can come to disagree. Keyed by routine id
     rather than by night: a day holds several routines now. */
  const asleep = useMemo(
    () => asleepByRoutine(stats.days, routines.records),
    [stats.days, routines.records]
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

  /* The target's own label, built here so neither chart learns about the translation table. */
  const targetLabel =
    targets.cribMinutes == null
      ? null
      : `${t.legendTarget} · ${t.tileCrib} ${formatClock(targets.cribMinutes)}`;

  if (!data.ready || !routines.ready || !targets.ready) return <div className="bs-loading" />;

  // One badge over three syncs: a half that failed is never reported as synced. See `mergeSync`.
  const sync = mergeAllSync([data.sync, routines.sync, targets.sync]);
  const retrySync = () => {
    data.retrySync();
    routines.retrySync();
    targets.retrySync();
  };

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
        {/* The routine last, in the order the evening happens: it is what comes before the night,
            and the four read together. */}
        {clockTile(t.tileRoutineStart, routineStats.routineStart)}
        {durationTile(t.tileRoutineLength, routineStats.routineLength)}
        {clockTile(t.tileCrib, routineStats.cribTime)}
        {durationTile(t.tileSettle, routineStats.settle)}
      </div>

      <p className="bs-note">{t.statsNote}</p>

      <section className="bs-section">
        <h2 className="bs-subhead">{t.timelineTitle}</h2>
        <SleepTimeline
          days={stats.days}
          entries={data.entries}
          routines={routines.records}
          asleep={asleep}
          now={now}
          formatDay={formatDay}
          formatTime={formatTime}
          /* Both tooltips are built here, out of the keys the live strip already prints, so the
             chart itself never learns about the translation table. */
          routineLabel={(from, to) =>
            to == null
              ? fill(t.routineRunning, { time: from })
              : fill(t.routineSpan, { from, to })
          }
          settleLabel={(from, duration) => {
            const waiting = fill(t.routineWaiting, { time: from });
            return duration == null
              ? waiting
              : `${waiting} · ${fill(t.routineAsleepAfter, { duration })}`;
          }}
          targetMinutes={targets.cribMinutes}
          targetLabel={targetLabel ?? undefined}
          ariaLabel={t.timelineAria}
          emptyLabel={t.chartEmpty}
          hintLabel={t.chartHint}
        />
        <ul className="bs-legend">
          <li>
            <span className="bs-swatch bs-swatch--night" aria-hidden="true" />
            {t.legendNight}
          </li>
          <li>
            <span className="bs-swatch bs-swatch--nap chart-swatch-tex--diagonal" aria-hidden="true" />
            {t.legendNap}
          </li>
          <li>
            <span className="bs-swatch bs-swatch--routine" aria-hidden="true" />
            {t.legendRoutine}
          </li>
          <li>
            <span className="bs-swatch bs-swatch--crib" aria-hidden="true" />
            {t.legendCrib}
          </li>
          <li>
            <span className="bs-swatch bs-swatch--settle" aria-hidden="true" />
            {t.legendSettle}
          </li>
          <li>
            <span className="bs-swatch bs-swatch--running" aria-hidden="true" />
            {t.legendRunning}
          </li>
          {targets.cribMinutes != null && (
            <li>
              <span className="bs-swatch bs-swatch--target" aria-hidden="true" />
              {t.legendTarget}
              <span className="bs-legend-value">{formatClock(targets.cribMinutes)}</span>
            </li>
          )}
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
          hintLabel={t.chartHint}
        />
      </section>

      {/* Beneath the totals, because it splits the top bar of each of them in two: the night alone,
          against its own mean rather than against zero. */}
      <section className="bs-section">
        <h2 className="bs-subhead">{t.nightLengthTitle}</h2>
        <DurationSpreadChart
          points={nightPoints}
          average={movingAverage(nightPoints, NIGHT_AVERAGE_WINDOW)}
          averageLabel={t.legendAverage}
          stat={stats.nightPerDay}
          formatDay={formatDay}
          label={t.nightLengthSeries}
          meanLabel={t.legendMean}
          spreadLabel={t.legendSpread}
          ariaLabel={t.nightLengthAria}
          emptyLabel={t.chartEmpty}
          hintLabel={t.chartHint}
        />
      </section>

      {/* Beside the night's length, because it is the other duration a bedtime produces — and on an
          axis of minutes rather than hours, or twenty minutes of drift draws as a flat line. */}
      <section className="bs-section">
        <h2 className="bs-subhead">{t.settleTitle}</h2>
        <DurationSpreadChart
          points={settlePoints(stats.days, routineByNight)}
          stat={routineStats.settle}
          minSpan={SHORT_MIN_SPAN}
          tickSteps={SHORT_TICK_STEPS}
          formatDay={formatDay}
          label={t.settleSeries}
          meanLabel={t.legendMean}
          spreadLabel={t.legendSpread}
          ariaLabel={t.settleAria}
          emptyLabel={t.chartEmpty}
          hintLabel={t.chartHint}
        />
      </section>

      {/* Before the bedtime charts, in the order the evening happens — and on its own rather than
          inside that section, because it is the one chart with a goal drawn on it and the sentence
          under the heading is about the goal. */}
      <section className="bs-section">
        <h2 className="bs-subhead">{t.cribTitle}</h2>
        {targets.cribMinutes == null && <p className="bs-note">{t.cribNoTarget}</p>}
        <ClockSpreadChart
          points={cribPoints(stats.days, routineByNight)}
          stat={routineStats.cribTime}
          target={targets.cribMinutes}
          targetLabel={t.legendTarget}
          formatDay={formatDay}
          label={t.cribSeries}
          meanLabel={t.legendMean}
          spreadLabel={t.legendSpread}
          ariaLabel={t.cribAria}
          emptyLabel={t.chartEmpty}
          hintLabel={t.chartHint}
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
          hintLabel={t.chartHint}
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
          hintLabel={t.chartHint}
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
          hintLabel={t.chartHint}
        />
      </section>

      <SyncBadge sync={sync} onRetry={retrySync} t={t} />
    </div>
  );
}
