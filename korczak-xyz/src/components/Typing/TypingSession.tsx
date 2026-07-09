import React, { useRef, useState } from 'react';
import { useTypingSession } from '../../hooks/useTypingSession';
import type { AuthUser } from '../../hooks/useAuth';
import type { Book } from '../../utils/typing/types';
import { StatsBar } from './StatsBar';
import { PassageView } from './PassageView';
import { translations, type Lang } from './translations';

interface TypingSessionProps {
  book: Book;
  user: AuthUser | null;
  lang: Lang;
}

// One book's practice session UI. Remounted (via `key={book.id}` in the parent)
// whenever the picker changes book, so progress and the live session log reload
// cleanly for the newly-selected book.
export default function TypingSession({ book, user, lang }: TypingSessionProps) {
  const t = translations[lang];
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const {
    charStatuses,
    cursorIndex,
    progress,
    wpm,
    accuracy,
    progressPercent,
    isFinished,
    isPaused,
    pause,
    resume,
    inputRef,
    focusInput,
    resetProgress,
    exportLog,
    importLog,
  } = useTypingSession(user, book);

  const handleReset = () => {
    if (window.confirm(t.confirmReset)) {
      exportLog();
      resetProgress();
      setMessage(null);
    }
  };

  const handleImportClick = () => fileInputRef.current?.click();

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-importing the same file
    if (!file) return;
    const text = await file.text();
    const result = importLog(text);
    if (result.success) {
      // Reload so the imported progress is re-hydrated cleanly.
      window.location.reload();
    } else {
      setMessage(t.importFail);
    }
  };

  return (
    <>
      <StatsBar
        wpm={wpm}
        accuracy={accuracy}
        progressPercent={progressPercent}
        passageIndex={progress.passageIndex}
        passageCount={book.passages.length}
        bestWpm={progress.bestWpm}
        labels={{
          wpm: t.wpm,
          accuracy: t.accuracy,
          progress: t.progress,
          passage: t.passage,
          best: t.best,
        }}
      />

      {isFinished ? (
        <div className="typing-finished">
          <p className="typing-finished-title">🏆 {t.finished}</p>
          <p className="typing-finished-hint">{t.finishedHint}</p>
        </div>
      ) : (
        <>
          <div className="typing-passage-wrap">
            <PassageView
              passages={book.passages}
              passageIndex={progress.passageIndex}
              cursorIndex={cursorIndex}
              charStatuses={charStatuses}
              inputRef={inputRef}
              onFocus={focusInput}
              onBrowse={pause}
              browsingLabel={t.browsing}
              returnLabel={t.returnToTyping}
            />
          </div>
          <p className="typing-hint">{t.hint}</p>
        </>
      )}

      <div className="typing-controls">
        {!isFinished && (
          <button className="retro-btn" onClick={isPaused ? resume : pause}>
            {isPaused ? t.resume : t.pause}
          </button>
        )}
        <button className="retro-btn" onClick={exportLog}>
          {t.export}
        </button>
        <button className="retro-btn" onClick={handleImportClick}>
          {t.import}
        </button>
        <button className="retro-btn" onClick={handleReset}>
          {t.reset}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          style={{ display: 'none' }}
          onChange={handleImportFile}
        />
      </div>

      {message && <p className="typing-message">{message}</p>}
    </>
  );
}
