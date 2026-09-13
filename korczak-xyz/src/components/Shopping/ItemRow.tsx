/*
 * One line of the list, in its two states: tickable, and being corrected.
 *
 * The tick is a real `<input type="checkbox">` inside a `<label>`, so the whole row is the hit area
 * and the keyboard and the screen reader get the control for free. That matters more here than
 * anywhere else on the site — this is read one-handed, pushing a trolley, and a 20px target is a
 * target you miss.
 *
 * The checkbox carries an accessible name of its own (`markBought` / `markNotBought`) rather than
 * leaning on the label text, because "Milk" alone does not say what ticking it will do, and the row
 * also holds the amount and who asked for it.
 */

import { useEffect, useRef, useState } from 'react';

import { authorLabel } from '../../utils/babySleep/format';
import type { ShoppingItem } from '../../utils/shopping/item';
import { MAX_NAME_LENGTH, MAX_NOTE_LENGTH } from '../../utils/shopping/item';
import { fill } from './translations';
import type { Translation } from './translations';

interface ItemRowProps {
  item: ShoppingItem;
  /** The signed-in address, so a line is attributed only when somebody else asked for it. */
  viewer: string | null;
  editing: boolean;
  onToggle: () => void;
  onBeginEdit: () => void;
  onSave: (name: string, note: string) => void;
  onCancel: () => void;
  onRemove: () => void;
  t: Translation;
}

export default function ItemRow({
  item,
  viewer,
  editing,
  onToggle,
  onBeginEdit,
  onSave,
  onCancel,
  onRemove,
  t,
}: ItemRowProps) {
  const [name, setName] = useState(item.name);
  const [note, setNote] = useState(item.note);
  const nameRef = useRef<HTMLInputElement>(null);

  /*
   * Re-seed from the record whenever the form opens, and whenever the record changes under it — the
   * other phone can correct this line while it is open here, and a form still holding the old text
   * would write it straight back over the correction on Save.
   */
  useEffect(() => {
    if (!editing) return;
    setName(item.name);
    setNote(item.note);
  }, [editing, item.name, item.note]);

  useEffect(() => {
    if (editing) nameRef.current?.focus();
  }, [editing]);

  if (editing) {
    return (
      <li className="sl-item sl-item--editing">
        <form
          className="sl-edit"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(name, note);
          }}
        >
          <h3 className="sl-sr">{t.editTitle}</h3>
          <input
            ref={nameRef}
            className="sl-input"
            type="text"
            value={name}
            maxLength={MAX_NAME_LENGTH}
            aria-label={t.addLabel}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="sl-input sl-input--note"
            type="text"
            value={note}
            maxLength={MAX_NOTE_LENGTH}
            aria-label={t.noteLabel}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="sl-edit-actions">
            <button type="submit" className="sl-action">
              {t.save}
            </button>
            <button type="button" className="sl-action" onClick={onCancel}>
              {t.cancel}
            </button>
            <button type="button" className="sl-link sl-link--danger" onClick={onRemove}>
              {t.remove}
            </button>
          </div>
        </form>
      </li>
    );
  }

  // Only lines somebody *else* asked for are attributed. Labelling every row on a two-person list
  // is noise, and it is the sleep log's rule for the same reason.
  const author = item.authorEmail && item.authorEmail !== viewer ? authorLabel(item.authorEmail) : '';

  return (
    <li className={`sl-item ${item.done ? 'sl-item--done' : ''}`}>
      <label className="sl-item-main">
        <input
          type="checkbox"
          className="sl-check"
          checked={item.done}
          onChange={onToggle}
          aria-label={fill(item.done ? t.markNotBought : t.markBought, { name: item.name })}
        />
        <span className="sl-item-name">{item.name}</span>
        {item.note && <span className="sl-item-note">{item.note}</span>}
      </label>
      <span className="sl-item-meta">
        {author && <span className="sl-item-by">{fill(t.addedBy, { who: author })}</span>}
        <button type="button" className="sl-link" onClick={onBeginEdit}>
          {t.edit}
        </button>
      </span>
    </li>
  );
}
