/*
 * Strings for the fretboard trainer, kept beside the game the way the typing trainer keeps its
 * own — there are too many of them, and they are too specific, to belong in the site-wide table.
 * The game's name and one-line description do live there, because the games index shows them.
 *
 * Note names stay international (A, A♯/B♭, B) in both languages. Polish notation calls B
 * natural "H" and B♭ "B", and half the country's guitarists have never used it: the songbook
 * here already writes chords the international way, and a trainer that disagreed with the
 * chord charts on the same site would be teaching a conflict.
 */

export type Lang = 'en' | 'pl';

export const translations = {
  en: {
    // Tabs
    navLabel: 'Fretboard trainer sections',
    navPractice: 'Practice',
    navStats: 'Progress',

    // Start screen
    due: 'Due',
    fresh: 'New',
    mastered: 'Mastered',
    start: 'Start session',
    practiceAhead: 'Practice anyway',
    caughtUp: 'Nothing due right now.',
    nextCard: 'Next card',
    nothingInScope: 'No cards in range — widen the settings below.',
    loading: 'Loading…',

    // Settings
    settings: 'Settings',
    frets: 'Frets',
    strings: 'Strings',
    directions: 'Ask',
    dirName: 'Name the note',
    dirFind: 'Find the note',
    sessionLength: 'Session length',
    newPerSession: 'New per session',
    stringLabels: 'String names',
    on: 'On',
    off: 'Off',

    // Card
    askName: 'What note is this?',
    askFind: 'Where is this note?',
    onString: 'on the {string} string',
    correct: 'Correct',
    wrong: 'Not quite',
    answerWas: 'It was {note}',
    fretWas: 'Fret {fret}',
    openString: 'open',
    next: 'Next',
    endSession: 'End session',
    answered: 'Answered',
    left: 'Left',
    tapNote: 'Tap the note',
    tapFret: 'Tap the fret on the highlighted string',
    // Spoken descriptions. The diagram is a picture of a question, so these name the position
    // and never the note — reading out the answer would be a strange kind of help.
    a11yPosition: '{string} string, fret {fret}',
    a11yPositionOpen: '{string} string, open',
    a11yFret: 'Fret {fret}',
    a11yFretOpen: 'Open string',

    // Summary
    summaryTitle: 'Session complete',
    accuracy: 'Accuracy',
    avgTime: 'Average',
    fastest: 'Fastest',
    cardsSeen: 'Cards',
    newlyMastered: 'Newly mastered',
    missedCards: 'Worth another look',
    again: 'Practise again',
    seeStats: 'See progress',
    backToStart: 'Done',

    // Stats page
    statsTitle: 'Progress',
    totalAnswers: 'Answers',
    timeSpent: 'Time',
    sessionsCount: 'Sessions',
    streak: 'Day streak',
    masteryTitle: 'Cards mastered',
    trendTitle: 'Accuracy and speed',
    neckTitle: 'The neck',
    neckHint: 'Colour is how well the position is known; both directions counted.',
    historyTitle: 'Recent sessions',
    colDate: 'Date',
    colAnswers: 'Answers',
    colAccuracy: 'Accuracy',
    colTime: 'Time',
    colMastered: 'Mastered',
    noData: 'No practice recorded yet — play a session first.',
    bucketNew: 'New',
    bucketLearning: 'Learning',
    bucketYoung: 'Young',
    bucketMature: 'Mastered',
    seconds: 'Seconds',

    // Sync
    syncSignedOut: 'On this device only',
    syncSynced: 'Synced',
    syncSyncing: 'Syncing…',
    syncPending: '{count} to upload',
    syncError: 'Sync failed',
    syncRetry: 'Retry',
  },
  pl: {
    navLabel: 'Sekcje treningu gryfu',
    navPractice: 'Ćwiczenie',
    navStats: 'Postępy',

    due: 'Do powtórki',
    fresh: 'Nowe',
    mastered: 'Opanowane',
    start: 'Rozpocznij sesję',
    practiceAhead: 'Ćwicz mimo to',
    caughtUp: 'Nic nie czeka na powtórkę.',
    nextCard: 'Następna karta',
    nothingInScope: 'Brak kart w zakresie — poszerz ustawienia poniżej.',
    loading: 'Wczytywanie…',

    settings: 'Ustawienia',
    frets: 'Progi',
    strings: 'Struny',
    directions: 'Pytaj',
    dirName: 'Nazwij dźwięk',
    dirFind: 'Znajdź dźwięk',
    sessionLength: 'Długość sesji',
    newPerSession: 'Nowych na sesję',
    stringLabels: 'Nazwy strun',
    on: 'Tak',
    off: 'Nie',

    askName: 'Jaki to dźwięk?',
    askFind: 'Gdzie jest ten dźwięk?',
    onString: 'na strunie {string}',
    correct: 'Dobrze',
    wrong: 'Niezupełnie',
    answerWas: 'To było {note}',
    fretWas: 'Próg {fret}',
    openString: 'pusta',
    next: 'Dalej',
    endSession: 'Zakończ sesję',
    answered: 'Odpowiedzi',
    left: 'Zostało',
    tapNote: 'Wybierz dźwięk',
    tapFret: 'Wskaż próg na podświetlonej strunie',
    a11yPosition: 'struna {string}, próg {fret}',
    a11yPositionOpen: 'struna {string}, pusta',
    a11yFret: 'Próg {fret}',
    a11yFretOpen: 'Pusta struna',

    summaryTitle: 'Sesja zakończona',
    accuracy: 'Skuteczność',
    avgTime: 'Średnio',
    fastest: 'Najszybciej',
    cardsSeen: 'Karty',
    newlyMastered: 'Nowo opanowane',
    missedCards: 'Warto powtórzyć',
    again: 'Ćwicz dalej',
    seeStats: 'Zobacz postępy',
    backToStart: 'Gotowe',

    statsTitle: 'Postępy',
    totalAnswers: 'Odpowiedzi',
    timeSpent: 'Czas',
    sessionsCount: 'Sesje',
    streak: 'Dni z rzędu',
    masteryTitle: 'Opanowane karty',
    trendTitle: 'Skuteczność i tempo',
    neckTitle: 'Gryf',
    neckHint: 'Kolor pokazuje, jak dobrze znasz pozycję; liczą się oba kierunki.',
    historyTitle: 'Ostatnie sesje',
    colDate: 'Data',
    colAnswers: 'Odpowiedzi',
    colAccuracy: 'Skuteczność',
    colTime: 'Czas',
    colMastered: 'Opanowane',
    noData: 'Brak zapisanych ćwiczeń — zagraj najpierw sesję.',
    bucketNew: 'Nowe',
    bucketLearning: 'W nauce',
    bucketYoung: 'Świeże',
    bucketMature: 'Opanowane',
    seconds: 'Sekundy',

    syncSignedOut: 'Tylko na tym urządzeniu',
    syncSynced: 'Zsynchronizowano',
    syncSyncing: 'Synchronizacja…',
    syncPending: '{count} do wysłania',
    syncError: 'Błąd synchronizacji',
    syncRetry: 'Ponów',
  },
} as const;

/**
 * Every key, as a plain string.
 *
 * Not `(typeof translations)['en']`: `as const` gives each entry its own literal type, so the
 * Polish table would fail to satisfy the English one key by key. Mapping the keys keeps the
 * completeness check — a missing key is still an error — without demanding the two languages
 * say the same words.
 */
export type Translation = { [K in keyof (typeof translations)['en']]: string };

/** Fill `{name}` placeholders. Kept trivial on purpose — these are labels, not prose. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    key in values ? String(values[key]) : match
  );
}
