/*
 * Strings for the merged app's own chrome — the tabs, the start screen, the session bar, the
 * summary, the settings shell and the sync badge.
 *
 * Deliberately *not* a merge of the two trainers' tables. Those overlap by about forty keys and
 * disagree on a dozen: `answerWas` is `It was {note}` on one and `Answer: {answer}` on the other,
 * `notationGerman` is the single letter `H` in one and a sentence in the other. Folding them into
 * one namespace would silently pick a winner per key, and the losing card would print the wrong
 * template. So both tables stay where they are, each card is drawn with its own, and this table
 * holds only what belongs to neither.
 */

export type Lang = 'en' | 'pl';

export const translations = {
  en: {
    // Tabs
    navLabel: 'Flashcard sections',
    navPractice: 'Practice',
    navNeck: 'Neck stats',
    navChords: 'Chord stats',

    // Start screen
    due: 'Due',
    fresh: 'New',
    mastered: 'Mastered',
    start: 'Start session',
    practiceAhead: 'Practice anyway',
    caughtUp: 'Nothing due right now.',
    nextCard: 'Next card',
    nothingInScope: 'No cards in scope — widen the settings below.',
    loading: 'Loading…',
    // The per-deck split under the tiles, so a combined figure can still be read as two.
    splitNeck: 'neck',
    splitChords: 'chords',
    splitDue: 'Waiting: {neck} {neckLabel}, {chords} {chordLabel}',

    // Session
    answered: 'Answered',
    left: 'Left',
    endSession: 'End session',

    // Summary
    summaryTitle: 'Session done',
    accuracy: 'Accuracy',
    avgTime: 'Average',
    fastest: 'Fastest',
    cardsSeen: 'Cards',
    newlyMastered: 'Newly mastered',
    missedCards: 'Worth another look',
    again: 'Practise again',
    backToStart: 'Back',
    seeNeckStats: 'Neck progress',
    seeChordStats: 'Chord progress',

    /*
     * The practice-time panel — the tile on the start screen and the chart on both progress pages.
     *
     * Here rather than in either deck's table because it belongs to neither: a sitting draws from
     * both decks, and how long one took is a fact about the sitting. Both stats pages already
     * import this table for the sync badge.
     */
    practiceTime: 'Practice time',
    practiceTimeTitle: 'Time spent practising',
    perDay: 'Per day',
    perWeek: 'Per week',
    groupBy: 'Group by',
    /* Labelled rather than plural — the readout says `Sessions: 2`, so neither English's one
       plural nor Polish's three has to be got right in a template. */
    sessionsLabel: 'Sessions',
    total: 'Total',
    noPractice: 'No practice recorded yet — play a session first.',

    // Settings
    settings: 'Settings',
    decks: 'Decks',
    deckNeck: 'Neck',
    deckNeckTitle: 'Notes on the fretboard',
    deckChords: 'Chords',
    deckChordsTitle: 'Moving chords between keys',
    sessionLength: 'Session length',
    newPerSession: 'New per session',
    neckSettings: 'Neck cards',
    chordSettings: 'Chord cards',

    // Sync
    syncSignedOut: 'On this device only',
    syncSynced: 'Synced',
    syncPending: '{count} to upload',
    syncError: 'Sync failed',
    syncRetry: 'Retry',
  },
  pl: {
    // Tabs
    navLabel: 'Sekcje fiszek',
    navPractice: 'Ćwiczenie',
    navNeck: 'Postępy: gryf',
    navChords: 'Postępy: akordy',

    // Start screen
    due: 'Do powtórki',
    fresh: 'Nowe',
    mastered: 'Opanowane',
    start: 'Zacznij sesję',
    practiceAhead: 'Ćwicz mimo to',
    caughtUp: 'Nic nie czeka na powtórkę.',
    nextCard: 'Następna karta',
    nothingInScope: 'Brak kart w zakresie — poszerz ustawienia poniżej.',
    loading: 'Ładowanie…',
    splitNeck: 'gryf',
    splitChords: 'akordy',
    splitDue: 'Czeka: {neck} — {neckLabel}, {chords} — {chordLabel}',

    // Session
    answered: 'Odpowiedzi',
    left: 'Zostało',
    endSession: 'Zakończ sesję',

    // Summary
    summaryTitle: 'Koniec sesji',
    accuracy: 'Trafność',
    avgTime: 'Średnio',
    fastest: 'Najszybciej',
    cardsSeen: 'Karty',
    newlyMastered: 'Nowo opanowane',
    missedCards: 'Warto wrócić',
    again: 'Ćwicz jeszcze raz',
    backToStart: 'Wróć',
    seeNeckStats: 'Postępy: gryf',
    seeChordStats: 'Postępy: akordy',

    practiceTime: 'Czas ćwiczeń',
    practiceTimeTitle: 'Czas spędzony na ćwiczeniach',
    perDay: 'Dziennie',
    perWeek: 'Tygodniowo',
    groupBy: 'Grupuj wg',
    sessionsLabel: 'Sesje',
    total: 'Razem',
    noPractice: 'Brak zapisanych ćwiczeń — zagraj najpierw sesję.',

    // Settings
    settings: 'Ustawienia',
    decks: 'Talie',
    deckNeck: 'Gryf',
    deckNeckTitle: 'Dźwięki na gryfie',
    deckChords: 'Akordy',
    deckChordsTitle: 'Przenoszenie akordów między tonacjami',
    sessionLength: 'Długość sesji',
    newPerSession: 'Nowych na sesję',
    neckSettings: 'Karty z gryfem',
    chordSettings: 'Karty z akordami',

    // Sync
    syncSignedOut: 'Tylko na tym urządzeniu',
    syncSynced: 'Zsynchronizowano',
    syncPending: '{count} do wysłania',
    syncError: 'Synchronizacja nieudana',
    syncRetry: 'Ponów',
  },
} as const;

export type Translation = { [K in keyof (typeof translations)['en']]: string };

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ''));
}
