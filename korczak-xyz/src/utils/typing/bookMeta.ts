// Titles and authors only, with no `?raw` import behind them.
//
// The picker's stand-in in TypingSkeleton.astro needs the same labels the real picker renders,
// and it runs at build time in the page's server bundle. Importing BOOKS there would drag both
// book texts and parseBook along for two strings apiece; this module costs nothing.

export interface BookMeta {
  id: string; // e.g. 'krasnoludek'
  title: string;
  author: string;
}

export const BOOK_META: readonly BookMeta[] = [
  { id: 'krasnoludek', title: 'Krasnoludek', author: 'Hans Christian Andersen' },
  { id: 'opowiesc-wigilijna', title: 'Opowieść wigilijna', author: 'Charles Dickens' },
  { id: 'krol-macius-pierwszy', title: 'Król Maciuś Pierwszy', author: 'Janusz Korczak' },
];

// The one place the picker's option text is composed. The button, the width sizer, the list rows
// and the pre-hydration stand-in all read it from here, because the stand-in's width is the widest
// of these strings and any drift between them shifts the row on hydration.
export function bookLabel(book: BookMeta): string {
  return `${book.title} — ${book.author}`;
}
