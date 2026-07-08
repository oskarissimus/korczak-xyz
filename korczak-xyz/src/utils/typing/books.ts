// The available books, each parsed once and bundled via Vite's ?raw import.
import krasnoludekRaw from './books/krasnoludek.txt?raw';
import opowiescRaw from './books/opowiesc-wigilijna.txt?raw';
import { parseBook } from './parseBook';
import type { Book } from './types';

export const BOOKS: Book[] = [
  parseBook(krasnoludekRaw, {
    id: 'krasnoludek',
    title: 'Krasnoludek',
    author: 'Hans Christian Andersen',
  }),
  parseBook(opowiescRaw, {
    id: 'opowiesc-wigilijna',
    title: 'Opowieść wigilijna',
    author: 'Charles Dickens',
  }),
];

export const DEFAULT_BOOK_ID = BOOKS[0].id;

export function getBookById(id: string | null | undefined): Book {
  return BOOKS.find((b) => b.id === id) ?? BOOKS[0];
}
