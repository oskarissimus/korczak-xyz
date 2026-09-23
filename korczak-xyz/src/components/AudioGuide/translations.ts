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
    // The account gate
    gateSignedOutTitle: 'Sign in for a guide',
    gateSignedOutBody:
      'Every guide is written and recorded fresh on your own API keys, and those are kept in your ' +
      'account, so the audio guide is for signed-in accounts.',
    gateSignIn: 'Sign in',
    gatePendingTitle: 'Waiting for approval',
    gatePendingBody:
      'Your account is signed in but has not been let in yet. The audio guide opens once it has.',
    gateUnavailable: 'Accounts are not available on this copy of the site, so neither is the guide.',

    // The band over the map
    title: 'Audio guide',
    pitch: 'Tap a pin and hear what happened there.',

    // The keys
    keysButton: 'Keys',
    keysButtonMissing: 'Add keys',
    keysTitle: 'API keys',
    keysBlurb:
      'Yours, billed to you. OpenAI writes each guide and ElevenLabs reads it. The keys go to ' +
      'this site’s narration function with every tap, are used for that one guide, and are not ' +
      'kept there.',
    keyOpenai: 'OpenAI key',
    keyElevenLabs: 'ElevenLabs key',
    keyShow: 'Show',
    keyHide: 'Hide',
    keyNotSet: 'not set',
    keySet: 'set',
    keysBorrowed:
      'Filled in from the Video Generation Wizard or the Annoying Passenger Simulator, so you do ' +
      'not have to paste them twice. They are copies: changing one here does not change it there.',
    keysNeeded: 'Both keys are needed before a pin can be read to you.',
    syncLocal: 'This browser only',
    syncSyncing: 'Checking the account…',
    syncSynced: 'Saved to your account',
    syncError: 'Not saved to the account — still in this browser. The next edit tries again.',
    keysDone: 'Done',
    keysClear: 'Clear keys',

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
    attractionsBusy: 'The map data service is busy. Wait a moment and move the map again.',
    attractionsTooBig: 'That area was too big to answer. Zoom in and try again.',
    attractionsFailed: 'Could not load places for this area.',
    attractionsZoomIn: 'Zoom in to look for places here.',
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
    errorKeys: 'A key is missing or was refused. Check them in the keys sheet.',
    errorQuota: 'One of your provider accounts is out of credit.',
    errorFailed: 'The narration service could not answer.',
    errorNoSources:
      'Nothing reliable is written about this place — no article and no checkable details on the ' +
      'map — so there is no guide rather than a made-up one.',
    sourcesLabel: 'Sources:',
    locationWarning:
      'The address could not be looked up, so the local encyclopedia may not have been read. ' +
      'Everything you hear is still taken from the sources below.',
    dismiss: 'Dismiss',

    // The footnote under the map
    credits:
      'Map and places from OpenStreetMap. Facts from Wikipedia, Wikidata and OpenStreetMap; ' +
      'narration written and read by machine.',
    costNote:
      'Every tap writes and records a new guide on your keys, so give it twenty seconds or so.',
  },
  pl: {
    gateSignedOutTitle: 'Zaloguj się po przewodnik',
    gateSignedOutBody:
      'Każdy przewodnik jest pisany i nagrywany od nowa na twoich kluczach API, a te są trzymane ' +
      'na koncie, więc audioprzewodnik jest dla zalogowanych kont.',
    gateSignIn: 'Zaloguj się',
    gatePendingTitle: 'Czeka na zatwierdzenie',
    gatePendingBody:
      'Twoje konto jest zalogowane, ale jeszcze nie zostało wpuszczone. Audioprzewodnik otworzy ' +
      'się, gdy to nastąpi.',
    gateUnavailable: 'Ta kopia strony nie obsługuje kont, więc przewodnik też nie działa.',

    title: 'Audioprzewodnik',
    pitch: 'Dotknij pinezki i posłuchaj, co się tam wydarzyło.',

    keysButton: 'Klucze',
    keysButtonMissing: 'Dodaj klucze',
    keysTitle: 'Klucze API',
    keysBlurb:
      'Twoje, na twój rachunek. OpenAI pisze każdy przewodnik, a ElevenLabs go czyta. Klucze ' +
      'trafiają z każdym dotknięciem do funkcji narracji tej strony, służą do tego jednego ' +
      'przewodnika i nie są tam przechowywane.',
    keyOpenai: 'Klucz OpenAI',
    keyElevenLabs: 'Klucz ElevenLabs',
    keyShow: 'Pokaż',
    keyHide: 'Ukryj',
    keyNotSet: 'brak',
    keySet: 'jest',
    keysBorrowed:
      'Wzięte z Kreatora generowania wideo albo z Symulatora upierdliwego pasażera, żeby nie ' +
      'wklejać ich drugi raz. To kopie: zmiana tutaj nie zmienia ich tam.',
    keysNeeded: 'Potrzebne są oba klucze, zanim pinezka zostanie ci przeczytana.',
    syncLocal: 'Tylko ta przeglądarka',
    syncSyncing: 'Sprawdzam konto…',
    syncSynced: 'Zapisane na koncie',
    syncError: 'Niezapisane na koncie — zostają w tej przeglądarce. Następna zmiana spróbuje ponownie.',
    keysDone: 'Gotowe',
    keysClear: 'Wyczyść klucze',

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
    attractionsBusy:
      'Serwis z danymi mapy jest zajęty. Poczekaj chwilę i przesuń mapę jeszcze raz.',
    attractionsTooBig: 'Ten obszar był za duży. Przybliż mapę i spróbuj ponownie.',
    attractionsFailed: 'Nie udało się pobrać miejsc dla tego obszaru.',
    attractionsZoomIn: 'Przybliż mapę, żeby wyszukać tu miejsca.',
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
    errorKeys: 'Brakuje klucza albo został odrzucony. Sprawdź je w kluczach.',
    errorQuota: 'Na którymś z twoich kont u dostawców skończyły się środki.',
    errorFailed: 'Serwis narracji nie odpowiedział.',
    errorNoSources:
      'O tym miejscu nie ma nic wiarygodnego — ani artykułu, ani sprawdzalnych danych na mapie — ' +
      'więc zamiast zmyślonego przewodnika nie ma żadnego.',
    sourcesLabel: 'Źródła:',
    locationWarning:
      'Nie udało się ustalić adresu, więc lokalna encyklopedia mogła nie zostać przeczytana. ' +
      'Wszystko, co słyszysz, i tak pochodzi ze źródeł poniżej.',
    dismiss: 'Zamknij',

    credits:
      'Mapa i miejsca z OpenStreetMap. Fakty z Wikipedii, Wikidanych i OpenStreetMap; narrację ' +
      'pisze i czyta maszyna.',
    costNote:
      'Każde dotknięcie pisze i nagrywa nowy przewodnik na twoich kluczach, więc daj mu ze ' +
      'dwadzieścia sekund.',
  },
} as const;

/*
 * Mapped to `string` rather than `(typeof translations)['en']`. With `as const` the English table
 * types every value as its own literal, so the Polish one is a different type with the same shape
 * and `translations[lang]` satisfies neither. Same shape, same fix, as the backseat driver's.
 */
export type Translation = { [K in keyof (typeof translations)['en']]: string };
