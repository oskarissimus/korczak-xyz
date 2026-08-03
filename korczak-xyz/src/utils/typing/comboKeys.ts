/*
 * Keyboard behaviour for the select-only combo box (the typing trainer's book picker).
 *
 * This is a pure decision function rather than a pile of branches inside the component's
 * onKeyDown, because there is no jsdom in this project: a keystroke landing on a real listbox is
 * not a reachable state in a test, but "Up at the top wraps to the bottom" still has to hold. The
 * component owns the DOM half — focus, scrolling the active row into view — and nothing else.
 */

export interface ComboKey {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

export interface ComboState {
  isOpen: boolean;
  activeIndex: number; // while closed, the selected option
  labels: readonly string[];
}

export type ComboAction =
  | { type: 'none' } // the key is not ours; let the browser have it
  | { type: 'open'; activeIndex: number }
  | { type: 'move'; activeIndex: number }
  | { type: 'close' }
  | { type: 'commit'; index: number };

const NONE: ComboAction = { type: 'none' };

// A character the user typed, as opposed to a named key ('ArrowDown', 'F3', 'Escape'). Space is
// excluded: on a combo box it opens and commits, and is never type-ahead.
function isTypeAhead(e: ComboKey): boolean {
  return e.key.length === 1 && e.key !== ' ' && !e.altKey && !e.ctrlKey && !e.metaKey;
}

function clampIndex(index: number, count: number): number {
  if (count === 0) return 0;
  return Math.min(Math.max(index, 0), count - 1);
}

// The next option whose label starts with `char`, searching forward from `from` and wrapping.
// Starting *after* `from` is what lets repeated presses cycle through several books sharing a
// first letter instead of sticking on the first one.
function findByPrefix(labels: readonly string[], char: string, from: number): number {
  const needle = char.toLowerCase();
  for (let step = 1; step <= labels.length; step += 1) {
    const i = (from + step) % labels.length;
    if (labels[i].toLowerCase().startsWith(needle)) return i;
  }
  return -1;
}

export function comboKey(event: ComboKey, state: ComboState): ComboAction {
  const count = state.labels.length;
  if (count === 0) return NONE;

  const active = clampIndex(state.activeIndex, count);

  if (!state.isOpen) {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Enter':
      case ' ':
        return { type: 'open', activeIndex: active };
      case 'Home':
        return { type: 'open', activeIndex: 0 };
      case 'End':
        return { type: 'open', activeIndex: count - 1 };
      default:
        break;
    }
    if (isTypeAhead(event)) {
      const match = findByPrefix(state.labels, event.key, active);
      return match === -1 ? NONE : { type: 'open', activeIndex: match };
    }
    return NONE;
  }

  // Alt+Up closes the list without moving, the way Win95 does.
  if (event.altKey && event.key === 'ArrowUp') return { type: 'close' };

  switch (event.key) {
    case 'ArrowDown':
      return { type: 'move', activeIndex: (active + 1) % count };
    case 'ArrowUp':
      return { type: 'move', activeIndex: (active - 1 + count) % count };
    case 'Home':
      return { type: 'move', activeIndex: 0 };
    case 'End':
      return { type: 'move', activeIndex: count - 1 };
    case 'Enter':
    case ' ':
      return { type: 'commit', index: active };
    case 'Escape':
      return { type: 'close' };
    // Tab is deliberately absent: swallowing it would trap focus in the picker. The component
    // closes the list when focus leaves it.
    default:
      break;
  }

  if (isTypeAhead(event)) {
    const match = findByPrefix(state.labels, event.key, active);
    return match === -1 ? NONE : { type: 'move', activeIndex: match };
  }

  return NONE;
}
