import React, { useEffect, useRef, useState } from 'react';
import { bookLabel, type BookMeta } from '../../utils/typing/bookMeta';
import { comboKey } from '../../utils/typing/comboKeys';

interface BookSelectProps {
  books: readonly BookMeta[];
  value: string;
  onChange: (id: string) => void;
  labelId: string;
  id: string;
}

/*
 * The book picker, drawn entirely by us.
 *
 * It used to be a <select> in a Win95 shell, and the shell is still here - but a <select>'s popup
 * belongs to the OS, not to the page. `appearance: none` reaches the field and nothing else, so on
 * iOS the list arrived as a translucent dark rounded sheet floating over a beige Windows 95 dialog.
 * There is no CSS for that. The only way to have the list look like the rest of the page is to be
 * the list.
 *
 * The pattern is the ARIA select-only combo box: focus stays on the button and the active option is
 * named by aria-activedescendant, which also keeps the on-screen keyboard away on a phone. The
 * keys themselves live in utils/typing/comboKeys.ts, where they can be tested.
 */
export default function BookSelect({ books, value, onChange, labelId, id }: BookSelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const labels = books.map(bookLabel);
  const selectedIndex = Math.max(
    books.findIndex((b) => b.id === value),
    0
  );
  const listId = `${id}-listbox`;
  const optionId = (index: number) => `${id}-option-${index}`;

  // A click anywhere else dismisses the list, the way a real drop-down does. pointerdown rather
  // than click so the list is gone before whatever was clicked reacts.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Keyboard navigation moves a highlight, not focus, so nothing scrolls the active row into view
  // on its own once the list is long enough to have a scrollbar.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const openList = (index: number) => {
    setActiveIndex(index);
    setOpen(true);
  };

  const closeList = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const commit = (index: number) => {
    setOpen(false);
    buttonRef.current?.focus();
    if (books[index] && books[index].id !== value) onChange(books[index].id);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const action = comboKey(e, {
      isOpen: open,
      activeIndex: open ? activeIndex : selectedIndex,
      labels,
    });
    if (action.type === 'none') return;
    e.preventDefault();
    switch (action.type) {
      case 'open':
        openList(action.activeIndex);
        break;
      case 'move':
        setActiveIndex(action.activeIndex);
        break;
      case 'close':
        closeList();
        break;
      case 'commit':
        commit(action.index);
        break;
    }
  };

  return (
    <span
      className={`typing-book-combo${open ? ' is-open' : ''}`}
      ref={wrapperRef}
      // Tabbing out of the picker leaves the list hanging over the page otherwise. Only focus
      // moving outside the wrapper counts; a null relatedTarget (the window losing focus) does not.
      onBlur={(e) => {
        if (e.relatedTarget && !wrapperRef.current?.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        id={id}
        ref={buttonRef}
        className="typing-book-face typing-book-select"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        // The label names the control and the button's own text reports its value, so a screen
        // reader announces both: "Book, Opowieść wigilijna - Charles Dickens, combo box".
        aria-labelledby={`${labelId} ${id}`}
        aria-activedescendant={open ? optionId(activeIndex) : undefined}
        onClick={() => (open ? closeList() : openList(selectedIndex))}
        onKeyDown={handleKeyDown}
      >
        {labels[selectedIndex]}
      </button>

      {/*
        Every label, stacked in the button's own grid cell and hidden: a <select> is as wide as its
        widest option and a <button> is only as wide as its current one, so without this the row
        would resize whenever the book changed - and the pre-hydration stand-in would have nothing
        to match but a measured guess.
      */}
      <span className="typing-book-sizer" aria-hidden="true">
        {labels.map((label, i) => (
          <span className="typing-book-face" key={books[i].id}>
            {label}
          </span>
        ))}
      </span>

      {open && (
        <ul className="typing-book-listbox" id={listId} role="listbox" aria-labelledby={labelId} ref={listRef}>
          {books.map((book, i) => (
            <li
              key={book.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === selectedIndex}
              data-active={i === activeIndex}
              className="typing-book-face typing-book-option"
              // The highlight follows the pointer, as it did in Win95: whatever is highlighted is
              // what a click - or Enter - is about to choose.
              onMouseMove={() => setActiveIndex(i)}
              onClick={() => commit(i)}
            >
              {bookLabel(book)}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
