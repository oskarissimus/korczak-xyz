import React, { useRef, useState } from 'react';
import { useTypingSession } from '../../hooks/useTypingSession';
import { useAuth } from '../../hooks/useAuth';
import { StatsBar } from './StatsBar';
import { PassageView } from './PassageView';
import { AuthBar } from './AuthBar';

interface TypingProps {
  lang: 'en' | 'pl';
}

const translations = {
  en: {
    wpm: 'WPM',
    accuracy: 'Accuracy',
    best: 'Best',
    passage: 'Passage',
    progress: 'Progress',
    reset: 'Reset progress',
    skip: 'Skip',
    export: 'Export log',
    import: 'Import log',
    confirmReset: 'Reset all progress for this book? Your keystroke log is exported first.',
    finished: 'You finished the book!',
    finishedHint: 'Reset progress to start again.',
    hint: 'Click the text and start typing.',
    importOk: 'Imported log.',
    importFail: 'Could not import that file.',
    signIn: 'Sign in',
    signOut: 'Sign out',
    email: 'Email',
    password: 'Password',
    signedInAs: 'Signed in as',
    synced: 'Progress syncs to the cloud',
    signInPrompt: 'Sign in to sync',
  },
  pl: {
    wpm: 'WPM',
    accuracy: 'Celność',
    best: 'Rekord',
    passage: 'Fragment',
    progress: 'Postęp',
    reset: 'Zresetuj postęp',
    skip: 'Pomiń',
    export: 'Eksportuj log',
    import: 'Importuj log',
    confirmReset: 'Zresetować cały postęp tej książki? Log klawiszy zostanie najpierw wyeksportowany.',
    finished: 'Ukończyłeś książkę!',
    finishedHint: 'Zresetuj postęp, aby zacząć od nowa.',
    hint: 'Kliknij tekst i zacznij pisać.',
    importOk: 'Zaimportowano log.',
    importFail: 'Nie udało się zaimportować pliku.',
    signIn: 'Zaloguj się',
    signOut: 'Wyloguj',
    email: 'E-mail',
    password: 'Hasło',
    signedInAs: 'Zalogowano jako',
    synced: 'Postęp synchronizuje się z chmurą',
    signInPrompt: 'Zaloguj się, aby synchronizować',
  },
};

export default function Typing({ lang }: TypingProps) {
  const t = translations[lang];
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const auth = useAuth();
  const {
    book,
    passage,
    charStatuses,
    progress,
    wpm,
    accuracy,
    progressPercent,
    isFinished,
    inputRef,
    focusInput,
    resetProgress,
    skipPassage,
    exportLog,
    importLog,
  } = useTypingSession(auth.user);

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
    <div className="typing-game">
      <div className="typing-book-title">
        {book.title} — {book.author}
      </div>

      <AuthBar
        auth={auth}
        labels={{
          signIn: t.signIn,
          signOut: t.signOut,
          email: t.email,
          password: t.password,
          signedInAs: t.signedInAs,
          synced: t.synced,
          signInPrompt: t.signInPrompt,
        }}
      />

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
          <PassageView
            passage={passage}
            charStatuses={charStatuses}
            inputRef={inputRef}
            onFocus={focusInput}
          />
          <p className="typing-hint">{t.hint}</p>
        </>
      )}

      <div className="typing-controls">
        {!isFinished && (
          <button className="retro-btn" onClick={skipPassage}>
            {t.skip}
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
    </div>
  );
}
