// The seed book, parsed once and bundled via Vite's ?raw import.
import raw from './books/krasnoludek.txt?raw';
import { parseBook } from './parseBook';
import type { Book } from './types';

export const BOOK: Book = parseBook(raw, {
  id: 'krasnoludek',
  title: 'Krasnoludek',
  author: 'Hans Christian Andersen',
});
