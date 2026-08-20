/*
 * Strings for the transposition trainer, kept beside the game the way the fretboard trainer keeps
 * its own — there are too many of them, and they are too specific, to belong in the site-wide
 * table. The game's name and one-line description do live there, because the games index and the
 * manifests show them.
 *
 * Chord names are not in here. Which systems the deck asks under is a *setting* — see `Notation` in
 * `src/utils/transpose/theory.ts` — because it is a property of the player and not of the language
 * they read the page in: someone reading the English page in Warsaw still wants `H`, and the
 * setting has to survive a locale switch. The language only picks the default, and either language
 * can have all three in the deck at once.
 */

import type { Notation } from '../../utils/transpose/theory';

export type Lang = 'en' | 'pl';

/**
 * Which chord names a page opens on.
 *
 * The Polish page opens on the two systems that call B natural `H` — which is what is used here,
 * and what every chart in `src/content/songs/` is written in. The English page opens on
 * international names. A default only: the moment the setting is touched it is stored and synced,
 * and follows the account instead.
 */
export function defaultNotationsFor(lang: Lang): Notation[] {
  return lang === 'pl' ? ['polish', 'german'] : ['international'];
}

export const translations = {
  en: {
    // Tabs
    navLabel: 'Transposition trainer sections',
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
    nothingInScope: 'No cards in scope — widen the settings below.',
    loading: 'Loading…',

    // Settings
    settings: 'Settings',
    directions: 'Ask',
    dirTranspose: 'Move a progression',
    dirDegrees: 'Name a key’s chords',
    dirKey: 'Name the key',
    patterns: 'Patterns',
    keysScope: 'Keys',
    keysAll: 'All 12',
    keysSongbook: 'From my songs',
    keysAllTitle: 'Every key, in every direction — all the permutations.',
    keysSongbookTitle: 'Only the keys the songs on this site are written in.',
    keysPick: 'Just these',
    keysPickTitle: 'Practise these keys only. Fewer keys, a deck you can finish.',
    orders: 'Chord order',
    orderDegree: 'In order',
    orderShuffled: 'Shuffled',
    orderDegreeTitle: 'The progression as it is written — I, IV, V in that order.',
    orderShuffledTitle:
      'The same chords in every other order, so the tonic is not always first. One card per order.',
    notations: 'Chord names',
    notationPolish: 'Songbook names: C#, a, H, and B for B flat',
    notationGerman: 'German names: Cis, Des, Es, a, H, and B for B flat',
    notationInternational: 'International names: C#, Am, B, Bb',
    sessionLength: 'Session length',
    newPerSession: 'New per session',

    // Session
    answered: 'Answered',
    left: 'Left',
    endSession: 'End session',
    intoKey: 'into',
    askDegrees: 'in the key of',
    askKey: 'Which key is this?',
    tapChords: 'Tap the chords, in order.',
    tapKey: 'Tap the key.',
    tapMode: 'Major or minor?',
    major: 'major',
    minor: 'minor',
    check: 'Check',
    correct: 'Correct',
    wrong: 'Not quite',
    answerWas: 'Answer: {answer}',
    next: 'Next',
    undo: 'Undo',
    asIn: 'as in',

    // Summary
    summaryTitle: 'Session complete',
    accuracy: 'Accuracy',
    avgTime: 'Avg time',
    fastest: 'Fastest',
    cardsSeen: 'Cards seen',
    newlyMastered: 'Newly mastered',
    missedCards: 'Worth another look',
    again: 'Again',
    backToStart: 'Done',
    seeStats: 'Progress',

    // Sync
    syncSignedOut: 'Sign in to keep your practice across devices.',
    syncSynced: 'Synced',
    syncError: 'Sync failed',
    syncRetry: 'Retry',
    syncPending: '{count} session(s) waiting to sync',

    // Stats
    statsTitle: 'Progress',
    noData: 'Nothing practised yet. Start a session and this fills in.',
    totalAnswers: 'Answers',
    totalTime: 'Time',
    sessionsCount: 'Sessions',
    daysPractised: 'Days',
    streak: 'Streak',
    masteryOverTime: 'Mastery over time',
    trend: 'Accuracy and speed',
    perKey: 'By key',
    perDirection: 'By question',
    keyColumn: 'Key',
    cardsColumn: 'Cards',
    seenColumn: 'Answers',
    accuracyColumn: 'Accuracy',
    speedColumn: 'Avg',
    masteredColumn: 'Mastered',
    history: 'Recent sessions',
    dateColumn: 'Date',
    bucketNew: 'New',
    bucketLearning: 'Learning',
    bucketYoung: 'Young',
    bucketMature: 'Mastered',
    legendAccuracy: 'Accuracy',
    legendSpeed: 'Speed',
  },

  pl: {
    navLabel: 'Sekcje trenera transpozycji',
    navPractice: 'Ćwiczenie',
    navStats: 'Postępy',

    due: 'Do powtórki',
    fresh: 'Nowe',
    mastered: 'Opanowane',
    start: 'Zacznij sesję',
    practiceAhead: 'Ćwicz mimo to',
    caughtUp: 'Nic nie czeka na powtórkę.',
    nextCard: 'Następna karta',
    nothingInScope: 'Brak kart w zakresie — poszerz ustawienia poniżej.',
    loading: 'Ładowanie…',

    settings: 'Ustawienia',
    directions: 'Pytaj',
    dirTranspose: 'Przenieś progresję',
    dirDegrees: 'Podaj akordy tonacji',
    dirKey: 'Rozpoznaj tonację',
    patterns: 'Schematy',
    keysScope: 'Tonacje',
    keysAll: 'Wszystkie 12',
    keysSongbook: 'Z moich piosenek',
    keysAllTitle: 'Każda tonacja, w każdą stronę — wszystkie kombinacje.',
    keysSongbookTitle: 'Tylko tonacje, w których są piosenki na tej stronie.',
    keysPick: 'Tylko te',
    keysPickTitle: 'Ćwicz tylko te tonacje. Mniej tonacji, talia do przerobienia.',
    orders: 'Kolejność',
    orderDegree: 'Po kolei',
    orderShuffled: 'Wymieszane',
    orderDegreeTitle: 'Schemat tak, jak się go zapisuje — I, IV, V w tej kolejności.',
    orderShuffledTitle:
      'Te same akordy w każdej innej kolejności, żeby tonika nie była zawsze pierwsza. Każda kolejność to osobna fiszka.',
    notations: 'Nazwy akordów',
    notationPolish: 'Jak w śpiewniku: C#, a, H, a B to b-mol',
    notationGerman: 'Nazwy niemieckie: Cis, Des, Es, a, H, a B to b-mol',
    notationInternational: 'Nazwy międzynarodowe: C#, Am, B, Bb',
    sessionLength: 'Długość sesji',
    newPerSession: 'Nowych na sesję',

    answered: 'Odpowiedzi',
    left: 'Zostało',
    endSession: 'Zakończ sesję',
    intoKey: 'do',
    askDegrees: 'w tonacji',
    askKey: 'Jaka to tonacja?',
    tapChords: 'Wybierz akordy, po kolei.',
    tapKey: 'Wybierz tonację.',
    tapMode: 'Dur czy moll?',
    major: 'dur',
    minor: 'moll',
    check: 'Sprawdź',
    correct: 'Dobrze',
    wrong: 'Nie tym razem',
    answerWas: 'Odpowiedź: {answer}',
    next: 'Dalej',
    undo: 'Cofnij',
    asIn: 'jak w',

    summaryTitle: 'Sesja zakończona',
    accuracy: 'Skuteczność',
    avgTime: 'Śr. czas',
    fastest: 'Najszybciej',
    cardsSeen: 'Kart',
    newlyMastered: 'Nowo opanowane',
    missedCards: 'Warto powtórzyć',
    again: 'Jeszcze raz',
    backToStart: 'Gotowe',
    seeStats: 'Postępy',

    syncSignedOut: 'Zaloguj się, aby zachować postępy na wszystkich urządzeniach.',
    syncSynced: 'Zsynchronizowano',
    syncError: 'Synchronizacja nieudana',
    syncRetry: 'Ponów',
    syncPending: 'Sesje czekają na synchronizację: {count}',

    statsTitle: 'Postępy',
    noData: 'Jeszcze nic nie ćwiczone. Zacznij sesję, a tu się zapełni.',
    totalAnswers: 'Odpowiedzi',
    totalTime: 'Czas',
    sessionsCount: 'Sesje',
    daysPractised: 'Dni',
    streak: 'Seria',
    masteryOverTime: 'Opanowanie w czasie',
    trend: 'Skuteczność i szybkość',
    perKey: 'Wg tonacji',
    perDirection: 'Wg pytania',
    keyColumn: 'Tonacja',
    cardsColumn: 'Karty',
    seenColumn: 'Odpowiedzi',
    accuracyColumn: 'Skuteczność',
    speedColumn: 'Śr.',
    masteredColumn: 'Opanowane',
    history: 'Ostatnie sesje',
    dateColumn: 'Data',
    bucketNew: 'Nowe',
    bucketLearning: 'W nauce',
    bucketYoung: 'Świeże',
    bucketMature: 'Opanowane',
    legendAccuracy: 'Skuteczność',
    legendSpeed: 'Szybkość',
  },
} as const;

/**
 * Not `(typeof translations)['en']`: `as const` gives each entry its own literal type, so the
 * Polish table would not be assignable to the English one and every component taking a `t` prop
 * would only accept one of the two languages. Mapping the keys to `string` keeps the key list
 * exact — a missing translation is still an error — and drops the literal values.
 */
export type Translation = { [K in keyof (typeof translations)['en']]: string };

/** `{count} sessions` → `3 sessions`. The same one-placeholder fill the fretboard trainer uses. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    key in values ? String(values[key]) : match
  );
}
