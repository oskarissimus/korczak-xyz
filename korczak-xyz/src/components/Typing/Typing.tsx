import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { BOOKS, DEFAULT_BOOK_ID, getBookById } from '../../utils/typing/books';
import { loadSelectedBookId, saveSelectedBookId } from '../../utils/typing/storage';
import TypingSession from './TypingSession';
import { type Lang } from './translations';

interface TypingProps {
  lang: Lang;
}

export default function Typing({ lang }: TypingProps) {
  const auth = useAuth();

  const [bookId, setBookId] = useState<string>(() => loadSelectedBookId() ?? DEFAULT_BOOK_ID);
  const book = getBookById(bookId);

  const handleBookChange = (id: string) => {
    setBookId(id);
    saveSelectedBookId(id);
  };

  // The picker row lives inside TypingSession, alongside the sync indicator that shares it -
  // the indicator's state comes from the session's sync engine, and threading it back out to
  // a sibling only to render it here would put a callback in the middle of the typing path.
  return (
    <div className="typing-game">
      <TypingSession
        key={book.id}
        book={book}
        books={BOOKS}
        onBookChange={handleBookChange}
        user={auth.user}
        auth={auth}
        lang={lang}
      />
    </div>
  );
}
