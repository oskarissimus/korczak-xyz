/*
 * The climate tab: what the night was forecast to be, what the window was doing, and how it went.
 *
 * The card at the top is about *one* night — the one `currentNightKey` names, which is tonight after
 * noon and last night before it. That is the whole of the routine: at bedtime you fill in the top
 * half, in the morning you tap the bottom one. The list underneath is for corrections and for the
 * nights somebody forgot to finish.
 *
 * `now` is read once per render, so the card, the list and the chart cannot disagree about which
 * night is the current one.
 */

import { useMemo, useState } from 'react';

import { useAuth } from '../../hooks/useAuth';
import { useDataOwner } from '../../hooks/useDataOwner';
import { useNightClimate } from '../../hooks/useNightClimate';
import { currentNightKey } from '../../utils/babySleep/climate';
import { windowThreshold } from '../../utils/babySleep/climateStats';
import { dayStart } from '../../utils/babySleep/days';
import ClimateChart from './ClimateChart';
import ClimateForm from './ClimateForm';
import ClimateList from './ClimateList';
import SyncBadge from './SyncBadge';
import { fill, localeOf, plural, translations, type Lang, type Translation } from './translations';

interface BabySleepClimateProps {
  lang: Lang;
}

/** How many nights the list shows. Longer than that is what the chart is for. */
const HISTORY_NIGHTS = 21;

/**
 * The sentence above the chart — the actual answer, in words, so it does not have to be read off
 * the dots. Every branch names its evidence: a number nobody can see the basis of is a number
 * nobody should act on.
 */
function thresholdLine(
  nights: ReturnType<typeof useNightClimate>['nights'],
  formatTemp: (v: number) => string,
  t: Translation
): string {
  const open = windowThreshold(nights, 'open');
  if (open.settled && open.okFloor != null) {
    return open.coldCeiling == null
      ? fill(t.climateThresholdOnlyOk, { ok: formatTemp(open.okFloor) })
      : fill(t.climateThresholdSettled, {
          ok: formatTemp(open.okFloor),
          cold: formatTemp(open.coldCeiling),
        });
  }
  if (open.okFloor != null && open.coldCeiling != null) {
    // The same reading having gone both ways is not a range to narrow — "mixed between 12 °C and
    // 12 °C" is true and says nothing. It is worth naming as its own answer, because it means the
    // forecast is not what decided those nights.
    return open.okFloor === open.coldCeiling
      ? fill(t.climateThresholdSameTemp, { temp: formatTemp(open.okFloor) })
      : fill(t.climateThresholdMixed, {
          ok: formatTemp(open.okFloor),
          cold: formatTemp(open.coldCeiling),
        });
  }
  return fill(t.climateThresholdThin, {
    count: open.n,
    nights: plural(open.n, t.climateNightOne, t.climateNightMany),
  });
}

export default function BabySleepClimate({ lang }: BabySleepClimateProps) {
  const t = translations[lang];
  const { user } = useAuth();
  const owner = useDataOwner(user);
  const { ready, nights, sync, logEvening, logVerdict, clearNight, retrySync } = useNightClimate(
    user,
    owner
  );

  const now = Date.now();
  /*
   * Which night the card is about. It starts at the one the clock implies and moves only when a
   * human moves it — a re-render at 00:00 must not slide the date field out from under a half-typed
   * temperature.
   */
  const [night, setNight] = useState(() => currentNightKey(Date.now()));

  const formatDay = useMemo(
    () => new Intl.DateTimeFormat(localeOf(lang), { weekday: 'short', day: 'numeric', month: 'short' }).format,
    [lang]
  );

  /*
   * A temperature is a number in prose, so it is written the way the reader writes numbers — 11,5
   * in Polish and 11.5 in English. The *field* stays a plain string that `parseTemp` accepts either
   * way; this is only for what is printed back.
   */
  const formatTemp = useMemo(() => {
    const format = new Intl.NumberFormat(localeOf(lang), { maximumFractionDigits: 1 }).format;
    return (value: number) => format(value);
  }, [lang]);

  const byNight = useMemo(() => new Map(nights.map((n) => [n.night, n])), [nights]);
  const line = thresholdLine(nights, formatTemp, t);
  const open = windowThreshold(nights, 'open');

  if (!ready) return <div className="bs-loading" />;

  return (
    <div className="bs-climate">
      <p className="bs-hint">{t.climateIntro}</p>

      <ClimateForm
        night={night}
        logged={byNight.get(night) ?? null}
        title={night === currentNightKey(now) ? t.climateTitle : formatDay(dayStart(night))}
        onNight={setNight}
        onEvening={(draft) => logEvening(night, draft)}
        onVerdict={(verdict) => logVerdict(night, verdict)}
        t={t}
      />

      <section className="bs-section">
        <h2 className="bs-subhead">{t.climateChartTitle}</h2>
        <p className="bs-note">{line}</p>
        <ClimateChart
          nights={nights}
          markAt={open.settled ? open.okFloor : null}
          formatDay={formatDay}
          formatTemp={formatTemp}
          t={t}
        />
      </section>

      <section className="bs-section">
        <h2 className="bs-subhead">{t.climateHistoryTitle}</h2>
        <ClimateList
          nights={nights.slice(0, HISTORY_NIGHTS)}
          viewer={user?.email ?? null}
          formatDay={formatDay}
          formatTemp={formatTemp}
          onEdit={setNight}
          onClear={clearNight}
          t={t}
        />
      </section>

      <SyncBadge sync={sync} onRetry={retrySync} t={t} />
    </div>
  );
}
