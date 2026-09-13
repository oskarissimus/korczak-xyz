/*
 * The list tab.
 *
 * Holds nothing but which line is being corrected: the lines themselves, and which half each is in,
 * come from `useShoppingList`. That matters — the two halves are derived from the synced records
 * rather than tracked here, so one phone ticking "milk" in the shop is the same line the other phone
 * sees move into the basket, instead of two screens quietly disagreeing about what is left to get.
 */

import { useState } from 'react';

import { useAuth } from '../../hooks/useAuth';
import { useDataOwner } from '../../hooks/useDataOwner';
import { useShoppingList } from '../../hooks/useShoppingList';
import AddItem from './AddItem';
import ItemRow from './ItemRow';
import SyncBadge from './SyncBadge';
import { fill, translations, type Lang } from './translations';

interface ShoppingListProps {
  lang: Lang;
}

export default function ShoppingList({ lang }: ShoppingListProps) {
  const t = translations[lang];
  const auth = useAuth();
  const owner = useDataOwner(auth.user);
  const data = useShoppingList(auth.user, owner);
  const [editingId, setEditingId] = useState<string | null>(null);

  if (!data.ready) return <div className="sl-loading" />;

  const { todo, done } = data.list;
  const viewer = auth.user?.email ?? null;

  const rowProps = (id: string) => ({
    viewer,
    editing: editingId === id,
    onToggle: () => data.toggle(id),
    onBeginEdit: () => setEditingId(id),
    onSave: (name: string, note: string) => {
      data.rename(id, { name, note });
      setEditingId(null);
    },
    onCancel: () => setEditingId(null),
    onRemove: () => {
      data.remove(id);
      setEditingId(null);
    },
    t,
  });

  /*
   * The one control on this screen that loses work, so it is the one that asks. Everything else is a
   * tick, and a tick is undone by tapping it again; clearing the basket tombstones a dozen rows at
   * once, on a list somebody else may be looking at.
   */
  const clearDone = () => {
    if (done.length === 0) return;
    if (!window.confirm(fill(t.clearDoneConfirm, { count: done.length }))) return;
    data.clearDone();
  };

  return (
    <div className="sl-list">
      <AddItem onAdd={data.add} suggestions={data.suggestions} t={t} />

      <section className="sl-section">
        <h2 className="sl-subhead">
          {t.todoTitle}{' '}
          <span className="sl-count">{fill(t.todoCount, { count: todo.length })}</span>
        </h2>
        {todo.length === 0 ? (
          <p className="sl-hint">{t.todoEmpty}</p>
        ) : (
          <ul className="sl-items">
            {todo.map((item) => (
              <ItemRow key={item.id} item={item} {...rowProps(item.id)} />
            ))}
          </ul>
        )}
      </section>

      {done.length > 0 && (
        <section className="sl-section sl-section--done">
          <h2 className="sl-subhead">
            {t.doneTitle}{' '}
            <span className="sl-count">{fill(t.doneCount, { count: done.length })}</span>
          </h2>
          <ul className="sl-items">
            {done.map((item) => (
              <ItemRow key={item.id} item={item} {...rowProps(item.id)} />
            ))}
          </ul>
          <button type="button" className="sl-action" onClick={clearDone}>
            {t.clearDone}
          </button>
        </section>
      )}

      <SyncBadge sync={data.sync} onRetry={data.retrySync} t={t} />
      <p className="sl-hint">{t.offlineNote}</p>
    </div>
  );
}
