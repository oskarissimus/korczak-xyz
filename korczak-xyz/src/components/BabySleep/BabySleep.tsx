/*
 * The log tab.
 *
 * Holds nothing but which entry is being edited: the entries themselves, and which one is running,
 * come from `useBabySleepData`. That matters for the running sleep in particular — it is derived from
 * the synced entries rather than tracked here, so one parent tapping "fell asleep" on a phone is the
 * same sleep the other parent's "woke up" closes, instead of two rows for one nap.
 */

import { useMemo, useRef, useState } from 'react';

import { useAuth } from '../../hooks/useAuth';
import { useBabySleepData } from '../../hooks/useBabySleepData';
import { useDataOwner } from '../../hooks/useDataOwner';
import { useNightRoutine } from '../../hooks/useNightRoutine';
import { mergeSync } from '../../utils/flashcards/sync';
import { dayKeyAt, dayStart } from '../../utils/babySleep/days';
import type { RoutineKey, RoutineRecord } from '../../utils/babySleep/routine';
import { routineKey, routineNightKey } from '../../utils/babySleep/routine';
import { asleepFor } from '../../utils/babySleep/routineStats';
import type { EntryDraft, SleepEntry, SleepKind } from '../../utils/babySleep/types';
import EntryForm from './EntryForm';
import EntryList from './EntryList';
import LiveControls from './LiveControls';
import RoutineForm from './RoutineForm';
import RoutineLive from './RoutineLive';
import SplitForm from './SplitForm';
import SyncBadge from './SyncBadge';
import { fill, localeOf, plural, translations, type Lang } from './translations';

interface BabySleepProps {
  lang: Lang;
}

/** How many days of history the log shows. The stats tab is where a longer view lives. */
const HISTORY_DAYS = 14;

/**
 * Which routine the form is addressing: an existing record, or a new one for a day and a kind.
 *
 * A new one carries no id, because the id is minted from the start time the form has not been given
 * yet. `logRoutine` does that minting, in the one place the live tap uses too.
 */
type RoutineTarget = { day: string; kind: SleepKind; key?: RoutineKey };

export default function BabySleep({ lang }: BabySleepProps) {
  const t = translations[lang];
  const auth = useAuth();
  const owner = useDataOwner(auth.user);
  const data = useBabySleepData(auth.user, owner);
  const routines = useNightRoutine(auth.user, owner);
  const [editingId, setEditingId] = useState<string | null>(null);
  /*
   * Which sleep is having a wake period added to it. Mutually exclusive with `editingId` — both
   * forms occupy the same place on the page, and correcting an entry's times while also cutting it
   * in two is two answers to the same question.
   */
  const [splittingId, setSplittingId] = useState<string | null>(null);
  /** Which routine is being edited or added. The third occupant of the one form slot. */
  const [routineTarget, setRoutineTarget] = useState<RoutineTarget | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const locale = localeOf(lang);
  const formatTime = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format,
    [locale]
  );
  const formatDay = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format,
    [locale]
  );

  // One clock reading per render, so the list, the plausibility marks and the day labels agree.
  const now = Date.now();
  const cutoff = now - HISTORY_DAYS * 86_400_000;
  const recent = useMemo(
    () => data.entries.filter((e) => e.start >= cutoff || e.end == null),
    [data.entries, cutoff]
  );

  /** When the sleep a routine led into began — one rule for both kinds, from `routineStats`. */
  const asleepAtOf = (routine: RoutineRecord | null) =>
    routine ? asleepFor(routine, data.entries) : null;

  const editing = editingId ? data.entries.find((e) => e.id === editingId) : undefined;
  /*
   * Looked up on every render rather than held in state, so the form is following the live entry. It
   * also means a split that arrives from another device — or a delete — closes the form instead of
   * leaving it addressing a sleep that no longer has those times.
   */
  const splitting = splittingId ? data.entries.find((e) => e.id === splittingId) : undefined;
  /*
   * Looked up live for the same reason: a routine cleared on the other parent's phone must not leave
   * the form addressing a record that is gone. A target with no key is a new routine and has none.
   */
  const editingRoutine = routineTarget?.key
    ? routines.records.find((r) => r.id === routineTarget.key?.id && !r.deleted)
    : undefined;

  const beginEdit = (entry: SleepEntry) => {
    setSplittingId(null);
    setRoutineTarget(null);
    setEditingId(entry.id);
    formRef.current?.scrollIntoView({ block: 'nearest' });
  };

  const beginSplit = (entry: SleepEntry) => {
    setEditingId(null);
    setRoutineTarget(null);
    setSplittingId(entry.id);
    formRef.current?.scrollIntoView({ block: 'nearest' });
  };

  const beginRoutine = (target: RoutineTarget) => {
    setEditingId(null);
    setSplittingId(null);
    setRoutineTarget(target);
    formRef.current?.scrollIntoView({ block: 'nearest' });
  };

  const editRoutine = (routine: RoutineRecord) =>
    beginRoutine({ day: routine.night, kind: routine.kind, key: routine });

  const submit = (draft: EntryDraft) => {
    if (editing) {
      data.updateEntry(editing.id, draft);
      setEditingId(null);
    } else {
      data.addEntry(draft);
    }
  };

  if (!data.ready || !routines.ready) return <div className="bs-loading" />;

  /*
   * The two routines the live strip is about.
   *
   * The night's is `routineNightKey(now)` — `sleepDayKey(_, 'night')`, the same rule the entries are
   * filed by, so the two agree across the 06:00 cutoff without either being told about the other,
   * and the line is gone by breakfast.
   *
   * The nap's is the *latest* of today's, shown until the calendar day ends. Same argument: the last
   * reading is the one worth looking at, and the `Nap routine` button sits beside it for the next
   * one. A nap never crosses the 06:00 cutoff, so its day is the plain calendar one.
   */
  const tonight = routineNightKey(now);
  const nightRoutine = routines.nightByDay.get(tonight) ?? null;
  const todaysNaps = routines.napsByDay.get(dayKeyAt(now)) ?? [];
  const napRoutine = todaysNaps.length > 0 ? todaysNaps[todaysNaps.length - 1] : null;

  const slots = [
    {
      kind: 'night' as const,
      routine: nightRoutine,
      asleepAt: asleepAtOf(nightRoutine),
      canRestart: false,
    },
    {
      kind: 'nap' as const,
      routine: napRoutine,
      asleepAt: asleepAtOf(napRoutine),
      canRestart: true,
    },
  ];

  /*
   * One badge over two syncs, and one rule that matters: a half that failed is never reported as
   * synced. `mergeSync` is pure and knows nothing about flashcards — it is the same two-collections,
   * one-account problem the merged trainers had.
   */
  const sync = mergeSync(data.sync, routines.sync);
  const retrySync = () => {
    data.retrySync();
    routines.retrySync();
  };

  return (
    <div className="bs-log">
      <RoutineLive
        slots={slots}
        formatTime={formatTime}
        onStart={(kind) => routines.logRoutine({ start: Date.now(), end: null }, kind)}
        onInCrib={(routine) =>
          routines.logRoutine({ start: routine.start, end: Date.now() }, routine.kind, routine)
        }
        onClear={(routine) => {
          if (routineTarget?.key?.id === routine.id) setRoutineTarget(null);
          routines.clearRoutine(routine.id);
        }}
        onFixStale={editRoutine}
        t={t}
      />

      <LiveControls
        open={data.open}
        formatTime={formatTime}
        onStart={data.startSleep}
        onEnd={data.endSleep}
        onFixStale={beginEdit}
        onDiscard={(entry) => data.removeEntry(entry.id)}
        t={t}
      />

      {data.orphans.length > 0 && (
        <div className="bs-warn" role="status">
          <p className="bs-warn-title">
            {fill(plural(data.orphans.length, t.orphanTitle, t.orphanTitlePlural), {
              count: data.orphans.length,
            })}
          </p>
          <p>{t.orphanBody}</p>
        </div>
      )}

      <div ref={formRef}>
        {routineTarget ? (
          <RoutineForm
            day={routineTarget.day}
            kind={routineTarget.kind}
            routine={editingRoutine}
            asleepAt={asleepAtOf(editingRoutine ?? null)}
            dayLabel={formatDay(dayStart(routineTarget.day))}
            onSubmit={(draft) => {
              routines.logRoutine(draft, routineTarget.kind, routineTarget.key);
              setRoutineTarget(null);
            }}
            onRemove={() => {
              if (routineTarget.key) routines.clearRoutine(routineTarget.key.id);
              setRoutineTarget(null);
            }}
            onCancel={() => setRoutineTarget(null)}
            t={t}
          />
        ) : splitting ? (
          <SplitForm
            entry={splitting}
            formatTime={formatTime}
            onSplit={(wakeAt, sleepAt) => {
              data.splitSleep(splitting.id, wakeAt, sleepAt);
              setSplittingId(null);
            }}
            onCancel={() => setSplittingId(null)}
            t={t}
          />
        ) : (
          <EntryForm
            editing={editing}
            others={data.entries}
            onSubmit={submit}
            onCancel={editing ? () => setEditingId(null) : undefined}
            t={t}
          />
        )}
      </div>

      <EntryList
        entries={recent}
        now={now}
        viewer={auth.user?.email ?? null}
        formatDay={formatDay}
        formatTime={formatTime}
        onEdit={beginEdit}
        onSplit={beginSplit}
        onDelete={(entry) => {
          if (entry.id === editingId) setEditingId(null);
          if (entry.id === splittingId) setSplittingId(null);
          data.removeEntry(entry.id);
        }}
        routines={routines.byDay}
        onEditRoutine={editRoutine}
        onAddRoutine={(day, kind) => beginRoutine({ day, kind })}
        t={t}
      />

      <SyncBadge sync={sync} onRetry={retrySync} t={t} />
    </div>
  );
}
