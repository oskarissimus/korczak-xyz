import { describe, expect, it } from 'vitest';
import { comboKey, type ComboKey, type ComboState } from './comboKeys';

const LABELS = ['Krasnoludek — Andersen', 'Opowieść wigilijna — Dickens', 'Ogniem i mieczem — Sienkiewicz'];

function state(overrides: Partial<ComboState> = {}): ComboState {
  return { isOpen: false, activeIndex: 0, labels: LABELS, ...overrides };
}

function press(key: string, modifiers: Omit<ComboKey, 'key'> = {}): ComboKey {
  return { key, ...modifiers };
}

describe('comboKey', () => {
  describe('while closed', () => {
    it.each(['ArrowDown', 'ArrowUp', 'Enter', ' '])('opens on %s at the selected option', (key) => {
      expect(comboKey(press(key), state({ activeIndex: 1 }))).toEqual({
        type: 'open',
        activeIndex: 1,
      });
    });

    it('opens at the first option on Home and the last on End', () => {
      expect(comboKey(press('Home'), state({ activeIndex: 1 }))).toEqual({
        type: 'open',
        activeIndex: 0,
      });
      expect(comboKey(press('End'), state({ activeIndex: 0 }))).toEqual({
        type: 'open',
        activeIndex: 2,
      });
    });

    it('opens on the first matching option when a letter is typed', () => {
      expect(comboKey(press('o'), state({ activeIndex: 0 }))).toEqual({
        type: 'open',
        activeIndex: 1,
      });
    });

    it('leaves keys it has no use for to the browser', () => {
      expect(comboKey(press('Tab'), state())).toEqual({ type: 'none' });
      expect(comboKey(press('F5'), state())).toEqual({ type: 'none' });
      expect(comboKey(press('Escape'), state())).toEqual({ type: 'none' });
    });
  });

  describe('while open', () => {
    const open = (activeIndex: number) => state({ isOpen: true, activeIndex });

    it('moves down and wraps past the last option', () => {
      expect(comboKey(press('ArrowDown'), open(0))).toEqual({ type: 'move', activeIndex: 1 });
      expect(comboKey(press('ArrowDown'), open(2))).toEqual({ type: 'move', activeIndex: 0 });
    });

    it('moves up and wraps past the first option', () => {
      expect(comboKey(press('ArrowUp'), open(2))).toEqual({ type: 'move', activeIndex: 1 });
      expect(comboKey(press('ArrowUp'), open(0))).toEqual({ type: 'move', activeIndex: 2 });
    });

    it('jumps to the ends on Home and End', () => {
      expect(comboKey(press('Home'), open(1))).toEqual({ type: 'move', activeIndex: 0 });
      expect(comboKey(press('End'), open(1))).toEqual({ type: 'move', activeIndex: 2 });
    });

    it.each(['Enter', ' '])('commits the active option on %s', (key) => {
      expect(comboKey(press(key), open(2))).toEqual({ type: 'commit', index: 2 });
    });

    it('closes on Escape and on Alt+Up without committing', () => {
      expect(comboKey(press('Escape'), open(1))).toEqual({ type: 'close' });
      expect(comboKey(press('ArrowUp', { altKey: true }), open(1))).toEqual({ type: 'close' });
    });

    it('does not swallow Tab, which would trap focus in the picker', () => {
      expect(comboKey(press('Tab'), open(1))).toEqual({ type: 'none' });
    });

    it('cycles between options sharing a first letter on repeated presses', () => {
      // 'Opowieść' at 1 and 'Ogniem' at 2 both start with O.
      expect(comboKey(press('O'), open(0))).toEqual({ type: 'move', activeIndex: 1 });
      expect(comboKey(press('O'), open(1))).toEqual({ type: 'move', activeIndex: 2 });
      expect(comboKey(press('O'), open(2))).toEqual({ type: 'move', activeIndex: 1 });
    });

    it('matches type-ahead case-insensitively and ignores a letter nothing starts with', () => {
      expect(comboKey(press('k'), open(1))).toEqual({ type: 'move', activeIndex: 0 });
      expect(comboKey(press('z'), open(1))).toEqual({ type: 'none' });
    });

    it('treats a modified letter as a shortcut, not type-ahead', () => {
      expect(comboKey(press('o', { ctrlKey: true }), open(0))).toEqual({ type: 'none' });
      expect(comboKey(press('o', { metaKey: true }), open(0))).toEqual({ type: 'none' });
    });
  });

  it('does nothing at all with no options to move between', () => {
    expect(comboKey(press('ArrowDown'), state({ labels: [] }))).toEqual({ type: 'none' });
    expect(comboKey(press('Enter'), state({ labels: [], isOpen: true }))).toEqual({ type: 'none' });
  });

  it('survives an activeIndex left over from a longer list', () => {
    expect(comboKey(press('ArrowDown'), state({ isOpen: true, activeIndex: 9 }))).toEqual({
      type: 'move',
      activeIndex: 0,
    });
  });
});
