/*
 * The history, grouped by the day each sleep is attributed to.
 *
 * Grouping uses `dayKeyOf`, the same rule the stats use, so a bedtime past midnight appears under the
 * evening it belongs to here as well. If the list grouped by raw calendar date and the charts did not,
 * the two would disagree about which night was which and there would be no way to tell which was
 * right.
 */

import { dayKeyAt, dayKeyOf, dayStart, durationOf } from '../../utils/babySleep/days';
import { authorLabel, formatHm } from '../../utils/babySleep/format';
import type { RoutineRecord } from '../../utils/babySleep/routine';
import { canSplit } from '../../utils/babySleep/split';
import type { SleepEntry } from '../../utils/babySleep/types';
import { isPlausible } from '../../utils/babySleep/types';
import { fill, plural, type Translation } from './translations';

interface EntryListProps {
  entries: SleepEntry[];
  now: number;
  /**
   * Who is reading. Entries logged by anyone else are named; the reader's own are not — on a log
   * shared between two people, labelling every row is noise, and "Ola logged this" is the only part
   * that carries information. Null when signed out, where nothing is attributed at all.
   */
  viewer: string | null;
  formatDay: (t: number) => string;
  formatTime: (t: number) => string;
  onEdit: (entry: SleepEntry) => void;
  /**
   * Cut this sleep in two around a waking. Offered on any sleep with room for one — naps as well as
   * nights, and the sleep still running, whose second half stays running. That last case is the one
   * that matters at eight in the morning, when the waking was slept through and never logged.
   */
  onSplit: (entry: SleepEntry) => void;
  onDelete: (entry: SleepEntry) => void;
  /**
   * The bedtime routines by night key. A routine belongs to the night, not to any one entry — a
   * broken night is several rows and still one routine — so it is drawn once per day group rather
   * than on a row.
   */
  routines: Map<string, RoutineRecord>;
  onRoutine: (night: string) => void;
  t: Translation;
}

interface Group {
  key: string;
  at: number;
  entries: SleepEntry[];
}

/** When the night attributed to a day began — its earliest block. Null on a day of naps only. */
function firstNightStart(entries: SleepEntry[]): number | null {
  let first: number | null = null;
  for (const entry of entries) {
    if (entry.kind !== 'night') continue;
    if (first == null || entry.start < first) first = entry.start;
  }
  return first;
}

function groupEntries(entries: SleepEntry[]): Group[] {
  const groups = new Map<string, Group>();
  for (const entry of entries) {
    const key = dayKeyOf(entry);
    const group = groups.get(key) ?? { key, at: dayStart(key), entries: [] };
    group.entries.push(entry);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.at - a.at);
}

export default function EntryList({
  entries,
  now,
  viewer,
  formatDay,
  formatTime,
  onEdit,
  onSplit,
  onDelete,
  routines,
  onRoutine,
  t,
}: EntryListProps) {
  const viewerKey = viewer?.toLowerCase() ?? null;
  if (entries.length === 0) {
    return (
      <section className="bs-history">
        <h2 className="bs-subhead">{t.historyTitle}</h2>
        <p className="bs-hint">{t.empty}</p>
      </section>
    );
  }

  const today = dayKeyAt(now);
  const yesterday = dayKeyAt(dayStart(today) - 1);

  return (
    <section className="bs-history">
      <h2 className="bs-subhead">{t.historyTitle}</h2>
      {groupEntries(entries).map((group) => {
        const naps = group.entries.filter((e) => e.kind === 'nap' && e.end != null).length;
        const total = group.entries.reduce((sum, e) => sum + (durationOf(e) ?? 0), 0);
        const label =
          group.key === today ? t.today : group.key === yesterday ? t.yesterday : formatDay(group.at);
        const routine = routines.get(group.key);
        // The settling is measured from the *first* block of the night: a waking at three in the
        // morning starts a second entry, and the routine has nothing to do with it.
        const asleepAt = firstNightStart(group.entries);
        const settle =
          routine && routine.end != null && asleepAt != null && asleepAt >= routine.end
            ? asleepAt - routine.end
            : null;

        return (
          <div className="bs-day" key={group.key}>
            <h3 className="bs-day-head">
              <span className="bs-day-name">{label}</span>
              <span className="bs-day-meta">
                {fill(plural(naps, t.napsCount, t.napsCountPlural), { count: naps })}
                {' · '}
                {fill(t.dayTotal, { total: formatHm(total) })}
              </span>
            </h3>
            <p className="bs-routine-row">
              <span className="bs-routine-label">{t.routineEdit}</span>
              <span className="bs-routine-value">
                {routine ? (
                  <>
                    {formatTime(routine.start)}
                    {' – '}
                    {routine.end == null ? (
                      <em className="bs-entry-running">{t.running}</em>
                    ) : (
                      formatTime(routine.end)
                    )}
                    {settle != null && (
                      <> {' · '}{fill(t.routineAsleepAfter, { duration: formatHm(settle) })}</>
                    )}
                  </>
                ) : (
                  <span className="bs-routine-none">{t.routineNone}</span>
                )}
              </span>
              <button type="button" className="bs-link" onClick={() => onRoutine(group.key)}>
                {routine ? t.edit : t.routineAdd}
              </button>
            </p>
            <ul className="bs-entries">
              {group.entries.map((entry) => {
                const ms = durationOf(entry);
                const suspect = !isPlausible(entry, now);
                const author =
                  entry.authorEmail && entry.authorEmail.toLowerCase() !== viewerKey
                    ? authorLabel(entry.authorEmail)
                    : '';
                return (
                  <li
                    key={entry.id}
                    className={`bs-entry bs-entry--${entry.kind}${suspect ? ' bs-entry--suspect' : ''}`}
                  >
                    <span className={`bs-swatch bs-swatch--${entry.kind}`} aria-hidden="true" />
                    <span className="bs-entry-kind">
                      {entry.kind === 'night' ? t.kindNight : t.kindNap}
                    </span>
                    <span className="bs-entry-span">
                      {formatTime(entry.start)}
                      {' – '}
                      {entry.end == null ? (
                        <em className="bs-entry-running">{t.running}</em>
                      ) : (
                        formatTime(entry.end)
                      )}
                    </span>
                    <span className="bs-entry-dur">{ms == null ? '' : formatHm(ms)}</span>
                    {author && (
                      <span className="bs-entry-author" title={entry.authorEmail}>
                        {fill(t.loggedBy, { name: author })}
                      </span>
                    )}
                    <span className="bs-entry-actions">
                      <button type="button" className="bs-link" onClick={() => onEdit(entry)}>
                        {t.edit}
                      </button>
                      {canSplit(entry, now) && (
                        <button type="button" className="bs-link" onClick={() => onSplit(entry)}>
                          {t.splitAction}
                        </button>
                      )}
                      <button type="button" className="bs-link" onClick={() => onDelete(entry)}>
                        {t.remove}
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
