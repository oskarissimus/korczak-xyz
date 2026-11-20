/*
 * What the player asks the next world to be made of (the home screen's field): words and a description,
 * kept in this browser. No DOM beyond localStorage, so it can be tested.
 */

import { CHOSEN_MAX, WISH_MAX } from './genesis';

export interface Wish {
  words: string[];
  text: string;
}

export const NO_WISH: Wish = { words: [], text: '' };

const WISH_KEY = 'rpg-wish';

export function loadWish(): Wish {
  try {
    const raw = JSON.parse(localStorage.getItem(WISH_KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return NO_WISH;
    return {
      words: Array.isArray(raw.words) ? raw.words.filter((w: unknown) => typeof w === 'string').slice(0, CHOSEN_MAX) : [],
      text: typeof raw.text === 'string' ? raw.text.slice(0, WISH_MAX) : '',
    };
  } catch {
    return NO_WISH;
  }
}

export function saveWish(wish: Wish): void {
  try {
    localStorage.setItem(WISH_KEY, JSON.stringify(wish));
  } catch {
    /* this session only */
  }
}

/** True when the player asked for something; otherwise the dice decide. */
export function wished(wish: Wish): boolean {
  return wish.words.length > 0 || wish.text.trim().length > 0;
}
