import React, { useRef, useState } from 'react';
import { useTypingSession } from '../../hooks/useTypingSession';
import type { AuthApi, AuthUser } from '../../hooks/useAuth';
import type { Book } from '../../utils/typing/types';
import ConflictModal from './ConflictModal';
import { StatsBar } from './StatsBar';
import { PassageView } from './PassageView';
import SyncStatus from './SyncStatus';
import { translations, type Lang } from './translations';

interface TypingSessionProps {
  book: Book;
  user: AuthUser | null;
  auth: AuthApi;
  lang: Lang;
}

// One book's practice session UI. Remounted (via `key={book.id}` in the parent)
// whenever the picker changes book, so progress and the live session log reload
// cleanly for the newly-selected book. The picker itself stays in the parent,
// outside that key.
export default function TypingSession({ book, user, auth, lang }: TypingSessionProps) {
  const t = translations[lang];
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const {
    charStatuses,
    cursorIndex,
    progress,
    wpm,
    accuracy,
    durationMs,
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
    sync,
    conflict,
    resolveConflict,
    retrySync,
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
        durationMs={durationMs}
        progressPercent={progressPercent}
        syncStatus={<SyncStatus auth={auth} sync={sync} lang={lang} onRetry={retrySync} />}
        labels={{
          wpm: t.wpm,
          accuracy: t.accuracy,
          progress: t.progress,
          timeSpent: t.timeSpent,
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
              typedHistory={progress.typedHistory}
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

      {/* Rendered last and over everything: while it is up, the passage underneath is not
          the state the user is going to keep, so it must not be typed into. */}
      {conflict && (
        <ConflictModal
          conflict={conflict}
          passageCount={book.passages.length}
          lang={lang}
          onChoose={resolveConflict}
        />
      )}
    </>
  );
}
