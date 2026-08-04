/*
 * Strings for the tuner, kept local to the island rather than pulled from src/i18n. The site's
 * translation table is one flat object for every page; importing it into a client:only component
 * ships all of it to the browser to use a dozen keys.
 */

export type Lang = 'en' | 'pl';

export const translations = {
  en: {
    start: 'Start tuning',
    stop: 'Stop',
    // Shown before the microphone is running, so it has to say what the button will do.
    idleHint: 'Tune by ear against the microphone. Nothing is recorded or sent anywhere.',
    listening: 'Listening',
    playAString: 'Play a string',
    inTune: 'In tune',
    flat: 'Flat',
    sharp: 'Sharp',
    tuneUp: 'Tighten',
    tuneDown: 'Loosen',
    cents: 'cents',
    signal: 'Signal',
    clarity: 'Clarity',
    strings: 'Strings',
    history: 'Last 6 seconds',
    tooQuiet: 'Too quiet — play closer to the microphone',
    unclear: 'Can’t find a pitch — try a cleaner, single note',
    outOfRange: 'That is not a guitar string',
    denied: 'Microphone access was refused.',
    deniedHint:
      'Allow the microphone for this site in your browser settings, then start again.',
    unsupported: 'This browser cannot capture microphone audio.',
    insecure: 'Microphone capture needs a secure (https) connection.',
    error: 'The microphone could not be started.',
    retry: 'Try again',
  },
  pl: {
    start: 'Zacznij stroić',
    stop: 'Zatrzymaj',
    idleHint: 'Strojenie przez mikrofon. Nic nie jest nagrywane ani wysyłane.',
    listening: 'Słucham',
    playAString: 'Zagraj strunę',
    inTune: 'Nastrojona',
    flat: 'Za nisko',
    sharp: 'Za wysoko',
    tuneUp: 'Napnij',
    tuneDown: 'Poluzuj',
    cents: 'centy',
    signal: 'Sygnał',
    clarity: 'Czystość',
    strings: 'Struny',
    history: 'Ostatnie 6 sekund',
    tooQuiet: 'Za cicho — zagraj bliżej mikrofonu',
    unclear: 'Nie słychać wyraźnej wysokości — zagraj pojedynczy dźwięk',
    outOfRange: 'To nie jest struna gitarowa',
    denied: 'Odmówiono dostępu do mikrofonu.',
    deniedHint: 'Zezwól tej stronie na mikrofon w ustawieniach przeglądarki i spróbuj ponownie.',
    unsupported: 'Ta przeglądarka nie potrafi nagrywać z mikrofonu.',
    insecure: 'Nagrywanie z mikrofonu wymaga bezpiecznego połączenia (https).',
    error: 'Nie udało się uruchomić mikrofonu.',
    retry: 'Spróbuj ponownie',
  },
} as const;

export type TunerTranslations = (typeof translations)[Lang];
