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
import type { EntryDraft, SleepEntry } from '../../utils/babySleep/types';
import EntryForm from './EntryForm';
import EntryList from './EntryList';
import LiveControls from './LiveControls';
import SyncBadge from './SyncBadge';
import { fill, localeOf, plural, translations, type Lang } from './translations';

interface BabySleepProps {
  lang: Lang;
}

/** How many days of history the log shows. The stats tab is where a longer view lives. */
const HISTORY_DAYS = 14;

export default function BabySleep({ lang }: BabySleepProps) {
  const t = translations[lang];
  const auth = useAuth();
  const owner = useDataOwner(auth.user);
  const data = useBabySleepData(auth.user, owner);
  const [editingId, setEditingId] = useState<string | null>(null);
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

  const beginEdit = (entry: SleepEntry) => {
    setEditingId(entry.id);
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

  if (!data.ready) return <div className="bs-loading" />;

  return (
    <div className="bs-log">
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
        <EntryForm
          editing={editing}
          others={data.entries}
          onSubmit={submit}
          onCancel={editing ? () => setEditingId(null) : undefined}
          t={t}
        />
      </div>

      <EntryList
        entries={recent}
        now={now}
        viewer={auth.user?.email ?? null}
        formatDay={formatDay}
        formatTime={formatTime}
        onEdit={beginEdit}
        onDelete={(entry) => {
          if (entry.id === editingId) setEditingId(null);
          data.removeEntry(entry.id);
        }}
        t={t}
      />

      <SyncBadge sync={data.sync} onRetry={data.retrySync} t={t} />
    </div>
  );
}
