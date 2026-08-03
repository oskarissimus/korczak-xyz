import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { BOOK_META } from '../../utils/typing/bookMeta';
import { DEFAULT_BOOK_ID, getBookById } from '../../utils/typing/books';
import { loadSelectedBookId, saveSelectedBookId } from '../../utils/typing/storage';
import BookSelect from './BookSelect';
import TypingSession from './TypingSession';
import { translations, type Lang } from './translations';

interface TypingProps {
  lang: Lang;
}

export default function Typing({ lang }: TypingProps) {
  const auth = useAuth();
  const t = translations[lang];

  const [bookId, setBookId] = useState<string>(() => loadSelectedBookId() ?? DEFAULT_BOOK_ID);
  const book = getBookById(bookId);

  const handleBookChange = (id: string) => {
    setBookId(id);
    saveSelectedBookId(id);
  };

  // The picker row lives here rather than inside TypingSession, which is keyed on the book and so
  // is torn down and rebuilt by the very change the picker makes. A <select> did not mind - the
  // browser owned its popup, and the control had no state of its own to lose. BookSelect has
  // both, and committing a choice would unmount it from inside its own click handler. Outside
  // the key it is the same element before and after.
  //
  // Where focus lands afterwards is still the session's call: it focuses the typing input on
  // mount, so choosing a book leaves the user ready to type, which is the point of choosing one.
  return (
    <div className="typing-game">
      <div className="typing-book-picker">
        <label className="typing-book-label" id="typing-book-label" htmlFor="typing-book-select">
          {t.book}
        </label>
        <BookSelect
          books={BOOK_META}
          value={book.id}
          onChange={handleBookChange}
          id="typing-book-select"
          labelId="typing-book-label"
        />
      </div>

      <TypingSession key={book.id} book={book} user={auth.user} auth={auth} lang={lang} />
    </div>
  );
}
