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
import { asleepFor, settleMs } from '../../utils/babySleep/routineStats';
import { canSplit } from '../../utils/babySleep/split';
import type { SleepEntry, SleepKind } from '../../utils/babySleep/types';
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
   * The routines by sleep-day, night first then the naps in order. A routine belongs to the sleep it
   * leads into, not to any one entry — a broken night is several rows and still one routine — so
   * they are drawn as their own rows under the day heading rather than on an entry's row.
   */
  routines: Map<string, RoutineRecord[]>;
  onEditRoutine: (routine: RoutineRecord) => void;
  onAddRoutine: (day: string, kind: SleepKind) => void;
  t: Translation;
}

interface Group {
  key: string;
  at: number;
  entries: SleepEntry[];
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

/**
 * One routine's row under a day heading — the night's, or one nap's.
 *
 * `settle` comes from `settleMs`, the same rule the chart and the tiles use, so this row cannot go
 * on reporting a gap the figures have already excluded: it used to compute its own and forgot
 * `MAX_SETTLE_MS`.
 */
function RoutineRow({
  routine,
  label,
  settle,
  formatTime,
  onEdit,
  onAdd,
  addLabel,
  t,
}: {
  routine: RoutineRecord | undefined;
  label: string;
  settle: number | null;
  formatTime: (t: number) => string;
  onEdit: () => void;
  onAdd: () => void;
  addLabel: string;
  t: Translation;
}) {
  return (
    <p className="bs-routine-row">
      <span className="bs-routine-label">{label}</span>
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
      <button type="button" className="bs-link" onClick={routine ? onEdit : onAdd}>
        {routine ? t.edit : addLabel}
      </button>
    </p>
  );
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
  onEditRoutine,
  onAddRoutine,
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
        /* One row for the night's routine and one for each nap's — a day holds several now. The
           settling of each is `asleepFor`'s join, so the row agrees with the chart by construction:
           the night's is measured from the *first* block, because a waking at three in the morning
           starts a second entry the routine had nothing to do with, and a nap's from the next nap
           after the crib. */
        const dayRoutines = routines.get(group.key) ?? [];
        const nightRoutine = dayRoutines.find((r) => r.kind === 'night');
        const napRoutines = dayRoutines.filter((r) => r.kind === 'nap');
        const settleOf = (routine: RoutineRecord) => settleMs(routine, asleepFor(routine, entries));

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
            <RoutineRow
              routine={nightRoutine}
              label={t.routineEdit}
              settle={nightRoutine ? settleOf(nightRoutine) : null}
              formatTime={formatTime}
              onEdit={() => nightRoutine && onEditRoutine(nightRoutine)}
              onAdd={() => onAddRoutine(group.key, 'night')}
              addLabel={t.routineAdd}
              t={t}
            />
            {napRoutines.map((routine) => (
              <RoutineRow
                key={routine.id}
                routine={routine}
                label={t.routineNapEdit}
                settle={settleOf(routine)}
                formatTime={formatTime}
                onEdit={() => onEditRoutine(routine)}
                onAdd={() => onAddRoutine(group.key, 'nap')}
                addLabel={t.routineNapAdd}
                t={t}
              />
            ))}
            {/* The way in for one more. Its own row rather than a second button on the night's:
                which routine an `Add` belongs to has to be readable at a glance. */}
            <p className="bs-routine-row bs-routine-row--add">
              <button
                type="button"
                className="bs-link"
                onClick={() => onAddRoutine(group.key, 'nap')}
              >
                {t.routineNapAdd}
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
