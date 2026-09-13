/*
 * The add box, and the chips under it.
 *
 * Two fields and not one: what to buy, and how much. Folding the amount into the name looks simpler
 * and is not — "2 mleko" sorts and matches as a different thing from "mleko", so the list grows a
 * second line every time somebody needs a different number of the same item, and `matchName` can
 * never join them. Separate, the amount is a note on one line that both phones keep editing.
 *
 * The name box **keeps focus after a submit**, and the whole point of this screen is why: a list is
 * written in one go, standing at the fridge, five things in a row. Anything that costs a tap between
 * items costs five taps.
 */

import { useRef, useState } from 'react';

import type { ItemDraft } from '../../utils/shopping/item';
import { MAX_NAME_LENGTH, MAX_NOTE_LENGTH } from '../../utils/shopping/item';
import type { AddOutcome } from '../../hooks/useShoppingList';
import { fill } from './translations';
import type { Translation } from './translations';

interface AddItemProps {
  onAdd: (draft: ItemDraft) => AddOutcome;
  suggestions: string[];
  t: Translation;
}

export default function AddItem({ onAdd, suggestions, t }: AddItemProps) {
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState<{ kind: AddOutcome; name: string } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const commit = (draft: ItemDraft) => {
    const outcome = onAdd(draft);
    setNotice({ kind: outcome, name: draft.name.trim() });
    if (outcome !== 'empty') {
      setName('');
      setNote('');
    }
    nameRef.current?.focus();
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    commit({ name, note });
  };

  /** A chip is the same add with the name filled in; whatever is in the amount box rides along. */
  const addSuggestion = (suggestion: string) => commit({ name: suggestion, note });

  const message =
    notice == null
      ? null
      : notice.kind === 'empty'
        ? t.errEmpty
        : fill(
            notice.kind === 'added'
              ? t.addedNotice
              : notice.kind === 'readded'
                ? t.readdedNotice
                : t.alreadyNotice,
            { name: notice.name }
          );

  return (
    <section className="sl-add">
      <form className="sl-add-form" onSubmit={submit}>
        <div className="sl-add-row">
          <div className="sl-add-field sl-add-field--name">
            <label className="sl-field-label" htmlFor="sl-add-name">
              {t.addLabel}
            </label>
            <input
              id="sl-add-name"
              ref={nameRef}
              className="sl-input"
              type="text"
              value={name}
              maxLength={MAX_NAME_LENGTH}
              placeholder={t.addPlaceholder}
              // The list is proper nouns and shopping words, not prose: autocorrect turning "pesto"
              // into something else, in Polish, on a phone, is a wrong line nobody notices.
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="sl-add-field sl-add-field--note">
            <label className="sl-field-label" htmlFor="sl-add-note">
              {t.noteLabel}
            </label>
            <input
              id="sl-add-note"
              className="sl-input"
              type="text"
              value={note}
              maxLength={MAX_NOTE_LENGTH}
              placeholder={t.notePlaceholder}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <button type="submit" className="sl-big sl-big--add">
          {t.addButton}
        </button>
      </form>

      {/* `role="status"` rather than an alert: nothing here is urgent, and the empty-name case is a
          correction the reader is already looking at the box for. */}
      {message && (
        <p
          className={`sl-sync ${notice?.kind === 'empty' ? 'sl-sync--error' : 'sl-sync--ok'}`}
          role="status"
        >
          {message}
        </p>
      )}

      {suggestions.length > 0 && (
        <div className="sl-suggest">
          <h2 className="sl-subhead">{t.suggestTitle}</h2>
          <ul className="sl-chips">
            {suggestions.map((suggestion) => (
              <li key={suggestion}>
                <button
                  type="button"
                  className="sl-chip"
                  onClick={() => addSuggestion(suggestion)}
                >
                  {suggestion}
                </button>
              </li>
            ))}
          </ul>
          <p className="sl-hint">{t.suggestHint}</p>
        </div>
      )}
    </section>
  );
}
