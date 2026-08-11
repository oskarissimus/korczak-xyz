// The available books, each parsed once and bundled via Vite's ?raw import.
import krasnoludekRaw from './books/krasnoludek.txt?raw';
import opowiescRaw from './books/opowiesc-wigilijna.txt?raw';
import krolMaciusRaw from './books/krol-macius-pierwszy.txt?raw';
import { BOOK_META } from './bookMeta';
import { parseBook } from './parseBook';
import type { Book } from './types';

// Keyed by the ids in BOOK_META, so a book's metadata and its text cannot drift apart.
const RAW: Record<string, string> = {
  krasnoludek: krasnoludekRaw,
  'opowiesc-wigilijna': opowiescRaw,
  'krol-macius-pierwszy': krolMaciusRaw,
};

export const BOOKS: Book[] = BOOK_META.map((meta) => parseBook(RAW[meta.id], meta));

export const DEFAULT_BOOK_ID = BOOKS[0].id;

export function getBookById(id: string | null | undefined): Book {
  return BOOKS.find((b) => b.id === id) ?? BOOKS[0];
}
