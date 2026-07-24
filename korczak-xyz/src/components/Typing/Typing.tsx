import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { BOOKS, DEFAULT_BOOK_ID, getBookById } from '../../utils/typing/books';
import { loadSelectedBookId, saveSelectedBookId } from '../../utils/typing/storage';
import SyncStatus from './SyncStatus';
import TypingSession from './TypingSession';
import { translations, type Lang } from './translations';

interface TypingProps {
  lang: Lang;
}

export default function Typing({ lang }: TypingProps) {
  const t = translations[lang];
  const auth = useAuth();

  const [bookId, setBookId] = useState<string>(() => loadSelectedBookId() ?? DEFAULT_BOOK_ID);
  const book = getBookById(bookId);

  const handleBookChange = (id: string) => {
    setBookId(id);
    saveSelectedBookId(id);
  };

  return (
    <div className="typing-game">
      <div className="typing-book-picker">
        <label className="typing-book-label" htmlFor="typing-book-select">
          {t.book}
        </label>
        <select
          id="typing-book-select"
          className="typing-book-select"
          value={book.id}
          onChange={(e) => handleBookChange(e.target.value)}
        >
          {BOOKS.map((b) => (
            <option key={b.id} value={b.id}>
              {b.title} — {b.author}
            </option>
          ))}
        </select>
        <a
          className="retro-btn"
          href={lang === 'pl' ? '/pl/games/typing/stats/' : '/games/typing/stats/'}
        >
          {t.stats}
        </a>
        <a
          className="retro-btn"
          href={lang === 'pl' ? '/pl/games/typing/keys/' : '/games/typing/keys/'}
        >
          {t.byKey}
        </a>
      </div>

      <SyncStatus auth={auth} lang={lang} />

      <TypingSession key={book.id} book={book} user={auth.user} lang={lang} />
    </div>
  );
}
