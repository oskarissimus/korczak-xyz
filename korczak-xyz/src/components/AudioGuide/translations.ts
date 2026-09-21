/*
 * Strings for the audio guide, kept beside the app the way the backseat driver and sloper keep
 * theirs — too many, and too specific, to belong in the site-wide table. The app's name and its
 * one-line description do live there, because the apps index and the manifest show them.
 *
 * Two things are deliberately not translated:
 *
 *  - The narration language names. "Polski" is what the guide is written in, and a language is
 *    named in itself — a Polish speaker looking for Polish is looking for "Polski", on either
 *    version of the page.
 *  - Whatever the backend says went wrong. Its errors are English sentences from OpenAI or
 *    ElevenLabs, shown verbatim under a translated one, because that is the string you would
 *    paste into their support page.
 */

export { fill } from '../BabySleep/translations';

export type Lang = 'en' | 'pl';

export const translations = {
  en: {
    // The band over the map
    title: 'Audio guide',
    pitch: 'Tap a pin and hear what happened there.',

    // The narration language
    languageLabel: 'Narration in',
    languageOther: 'Other…',
    languageCustomPlaceholder: 'e.g. Deutsch, Español',
    languageCustomLabel: 'Language to narrate in',

    // Location and compass
    locating: 'Finding you…',
    locationDenied:
      'Location is off, so the map opens where it last was. Pan to where you are — everything ' +
      'else works.',
    locationUnavailable: 'This browser has no location, so the map opens where it last was.',
    compassEnable: 'Enable compass',
    compassHint: 'So the arrow points the way you are facing.',
    compassDenied: 'Compass off — the arrow points north.',

    // Loading the pins
    attractionsLoading: 'Looking for places…',
    attractionsEmpty: 'Nothing tagged around here. Zoom out, or move the map.',
    attractionsRateLimited: 'The map data service is busy. Wait a moment and move the map again.',
    attractionsTimeout: 'That area was too big to answer. Zoom in and try again.',
    attractionsFailed: 'Could not load places for this area.',
    retry: 'Retry',

    // Generating
    generating: 'Writing your guide',
    stageResearching: 'Reading up…',
    stageWriting: 'Writing the script…',
    stageSpeaking: 'Recording the voice…',
    stageFinishing: 'Finishing…',
    slow: 'This is taking longer than usual. It is still running.',
    cancel: 'Cancel',

    // The player
    play: 'Play',
    pause: 'Pause',
    replay: 'Play again',
    playing: 'Playing',
    paused: 'Paused',
    finished: 'Finished',
    close: 'Close',

    // What can go wrong
    errorTitle: 'No guide this time',
    errorRateLimited: 'Too many guides at once. Wait a moment and tap again.',
    errorQuota: 'The account behind the narration is out of credit.',
    errorConfig: 'The narration service is not configured right now.',
    errorFailed: 'The narration service could not answer.',
    locationWarning:
      'This one could not be placed on a map, so the story is written from its name alone and ' +
      'may be about somewhere else of the same name.',
    dismiss: 'Dismiss',

    // The footnote under the map
    credits: 'Map and places from OpenStreetMap. Narration written and read by machine.',
    costNote: 'Every tap writes and records a new guide, so give it twenty seconds or so.',
  },
  pl: {
    title: 'Audioprzewodnik',
    pitch: 'Dotknij pinezki i posłuchaj, co się tam wydarzyło.',

    languageLabel: 'Narracja w języku',
    languageOther: 'Inny…',
    languageCustomPlaceholder: 'np. Deutsch, Español',
    languageCustomLabel: 'Język narracji',

    locating: 'Szukam Cię…',
    locationDenied:
      'Lokalizacja jest wyłączona, więc mapa otwiera się tam, gdzie była ostatnio. Przesuń ją ' +
      'tam, gdzie jesteś — reszta działa.',
    locationUnavailable:
      'Ta przeglądarka nie zna lokalizacji, więc mapa otwiera się tam, gdzie była ostatnio.',
    compassEnable: 'Włącz kompas',
    compassHint: 'Żeby strzałka pokazywała kierunek, w którym patrzysz.',
    compassDenied: 'Kompas wyłączony — strzałka wskazuje północ.',

    attractionsLoading: 'Szukam miejsc…',
    attractionsEmpty: 'Nic tu nie jest oznaczone. Oddal mapę albo przesuń ją gdzie indziej.',
    attractionsRateLimited:
      'Serwis z danymi mapy jest zajęty. Poczekaj chwilę i przesuń mapę jeszcze raz.',
    attractionsTimeout: 'Ten obszar był za duży. Przybliż mapę i spróbuj ponownie.',
    attractionsFailed: 'Nie udało się pobrać miejsc dla tego obszaru.',
    retry: 'Ponów',

    generating: 'Piszę przewodnik',
    stageResearching: 'Czytam…',
    stageWriting: 'Piszę scenariusz…',
    stageSpeaking: 'Nagrywam głos…',
    stageFinishing: 'Kończę…',
    slow: 'To trwa dłużej niż zwykle. Wciąż się liczy.',
    cancel: 'Anuluj',

    play: 'Odtwórz',
    pause: 'Pauza',
    replay: 'Odtwórz jeszcze raz',
    playing: 'Odtwarzam',
    paused: 'Pauza',
    finished: 'Koniec',
    close: 'Zamknij',

    errorTitle: 'Tym razem bez przewodnika',
    errorRateLimited: 'Za dużo przewodników naraz. Poczekaj chwilę i dotknij ponownie.',
    errorQuota: 'Konto, z którego powstaje narracja, nie ma już środków.',
    errorConfig: 'Serwis narracji nie jest teraz skonfigurowany.',
    errorFailed: 'Serwis narracji nie odpowiedział.',
    locationWarning:
      'Tego miejsca nie udało się umiejscowić na mapie, więc opowieść powstała z samej nazwy i ' +
      'może dotyczyć innego miejsca o tej samej nazwie.',
    dismiss: 'Zamknij',

    credits: 'Mapa i miejsca z OpenStreetMap. Narrację pisze i czyta maszyna.',
    costNote: 'Każde dotknięcie pisze i nagrywa nowy przewodnik, więc daj mu ze dwadzieścia sekund.',
  },
} as const;

/*
 * Mapped to `string` rather than `(typeof translations)['en']`. With `as const` the English table
 * types every value as its own literal, so the Polish one is a different type with the same shape
 * and `translations[lang]` satisfies neither. Same shape, same fix, as the backseat driver's.
 */
export type Translation = { [K in keyof (typeof translations)['en']]: string };
