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
import { dayKeyOf, dayStart } from '../../utils/babySleep/days';
import { routineNightKey } from '../../utils/babySleep/routine';
import type { EntryDraft, SleepEntry } from '../../utils/babySleep/types';
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

/** When the night attributed to `night` began — its earliest block. Null if none has. */
function firstNightStart(entries: SleepEntry[], night: string): number | null {
  let first: number | null = null;
  for (const entry of entries) {
    if (entry.kind !== 'night' || dayKeyOf(entry) !== night) continue;
    if (first == null || entry.start < first) first = entry.start;
  }
  return first;
}

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
  /** Which night's routine is being edited. The third occupant of the one form slot. */
  const [routineNight, setRoutineNight] = useState<string | null>(null);
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

  const editing = editingId ? data.entries.find((e) => e.id === editingId) : undefined;
  /*
   * Looked up on every render rather than held in state, so the form is following the live entry. It
   * also means a split that arrives from another device — or a delete — closes the form instead of
   * leaving it addressing a sleep that no longer has those times.
   */
  const splitting = splittingId ? data.entries.find((e) => e.id === splittingId) : undefined;

  const beginEdit = (entry: SleepEntry) => {
    setSplittingId(null);
    setRoutineNight(null);
    setEditingId(entry.id);
    formRef.current?.scrollIntoView({ block: 'nearest' });
  };

  const beginSplit = (entry: SleepEntry) => {
    setEditingId(null);
    setRoutineNight(null);
    setSplittingId(entry.id);
    formRef.current?.scrollIntoView({ block: 'nearest' });
  };

  const beginRoutine = (night: string) => {
    setEditingId(null);
    setSplittingId(null);
    setRoutineNight(night);
    formRef.current?.scrollIntoView({ block: 'nearest' });
  };

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
   * The routine the live strip is about, and the night it leads into. `routineNightKey` is
   * `sleepDayKey(_, 'night')`, the same rule the entries are filed by, so the two agree across the
   * 06:00 cutoff without either being told about the other.
   */
  const tonight = routineNightKey(now);
  const tonightRoutine = routines.byNight.get(tonight) ?? null;

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
        routine={tonightRoutine}
        asleepAt={firstNightStart(data.entries, tonight)}
        formatTime={formatTime}
        onStart={() => routines.logRoutine(tonight, { start: Date.now(), end: null })}
        onInCrib={() =>
          tonightRoutine &&
          routines.logRoutine(tonight, { start: tonightRoutine.start, end: Date.now() })
        }
        onClear={() => {
          if (routineNight === tonight) setRoutineNight(null);
          routines.clearRoutine(tonight);
        }}
        onFixStale={() => beginRoutine(tonight)}
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
        {routineNight ? (
          <RoutineForm
            night={routineNight}
            routine={routines.byNight.get(routineNight)}
            asleepAt={firstNightStart(data.entries, routineNight)}
            dayLabel={formatDay(dayStart(routineNight))}
            onSubmit={(draft) => {
              routines.logRoutine(routineNight, draft);
              setRoutineNight(null);
            }}
            onRemove={() => {
              routines.clearRoutine(routineNight);
              setRoutineNight(null);
            }}
            onCancel={() => setRoutineNight(null)}
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
        routines={routines.byNight}
        onRoutine={beginRoutine}
        t={t}
      />

      <SyncBadge sync={sync} onRetry={retrySync} t={t} />
    </div>
  );
}
