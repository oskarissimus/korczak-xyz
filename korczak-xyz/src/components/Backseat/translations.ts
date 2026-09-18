/*
 * Strings for the annoying passenger, kept beside the app the way sloper and the sleep log keep
 * theirs — too many of them, and too specific, to belong in the site-wide table. The app's name
 * and one-line description do live there, because the apps index and the manifest show them.
 *
 * Three things are deliberately NOT translated:
 *
 *  - Provider, model and voice names. `gpt-4o-mini` is an identifier sent over the wire.
 *  - Whatever an API returns. Every error from OpenAI, Google or ElevenLabs is shown verbatim, in
 *    English, because it is the string you would paste into their support page. The sentence
 *    around it is translated; the quote is not.
 *  - The remarks themselves, obviously — those are written by the model, in the language the app
 *    is being read in, which is what `systemPrompt` is handed `lang` for.
 */

import type { CameraFailure } from '../../utils/backseat/frame';

export { fill, localeOf } from '../BabySleep/translations';

export type Lang = 'en' | 'pl';

export const translations = {
  en: {
    // The two screens
    setupTitle: 'Before we set off',
    rideTitle: 'On the road',

    // The pitch, on the setup screen
    pitch:
      'Point the phone at the road. Every few seconds it takes a look and says the sort of thing ' +
      'a passenger says when they are not driving.',

    // Sign-in notice
    signedOutTitle: 'Sign in to keep your keys',
    signedOutBody:
      'Signed out, everything works and the API keys stay in this browser only. Signed in, they ' +
      'follow the account to your other devices.',
    signedOutLink: 'Sign in',

    // Sync badge
    syncLocal: 'This browser only',
    syncSyncing: 'Checking the account…',
    syncSynced: 'Saved to your account',
    syncError: 'Not saved to the account',
    syncErrorHint: 'The settings are still in this browser. The next edit tries again.',

    // Keys
    keysTitle: 'API keys',
    keysBlurb:
      'Yours, billed to you, used straight from this page. Nothing goes through korczak.xyz at all.',
    keyOpenai: 'OpenAI key',
    keyGoogle: 'Google key',
    keyElevenLabs: 'ElevenLabs key',
    keyShow: 'Show',
    keyHide: 'Hide',
    keyNotSet: 'not set',
    keySet: 'set',
    keyElevenLabsHint: 'Only needed if you pick an ElevenLabs voice below.',

    // The eyes
    visionTitle: 'The eyes',
    visionProvider: 'Looks through',
    visionModel: 'Model',
    visionModelsLoading: 'Asking for the model list…',
    visionModelsEmpty: 'Enter a key to list the models',
    visionModelsHint: 'Only models that can look at a picture are listed.',

    // The passenger
    personaTitle: 'The passenger',
    personaWho: 'Who is sitting there',
    personaNervous: 'Nervous wreck',
    personaInstructor: 'Retired driving instructor',
    personaParent: 'Your mother',
    personaChild: 'Bored child',
    personaCodriver: 'Rally co-driver',
    intensityLabel: 'How much of it',
    intensityMild: 'Mild — the odd sigh',
    intensityNormal: 'Normal — properly annoying',
    intensityRelentless: 'Relentless — nothing escapes comment',
    intervalLabel: 'A remark every {n} seconds',
    intervalHint:
      'Each remark is one look at the road and one call on your key. Shorter is chattier and dearer.',

    // The voice
    voiceTitle: 'The voice',
    voiceEngine: 'Spoken by',
    voiceEngineDevice: 'This device (free)',
    voiceEngineElevenLabs: 'ElevenLabs (your key)',
    voiceDevice: 'Device voice',
    voiceDeviceDefault: 'Whatever the device picks',
    voiceDeviceEmpty: 'This browser lists no voices.',
    voiceElevenLabs: 'ElevenLabs voice',
    voiceElevenLabsLoading: 'Asking for your voices…',
    voiceElevenLabsEmpty: 'Enter a key to list your voices',
    voiceRate: 'Speed: {value}×',
    voiceSlow: 'Slow',
    voiceFast: 'Fast',
    voiceTest: 'Test the voice',
    voiceTestLine: 'Oh, slow down, would you? There is a lorry.',

    // Camera
    cameraTitle: 'The camera',
    cameraFacing: 'Which camera',
    cameraBack: 'Back — pointed at the road',
    cameraFront: 'Front — pointed at you',

    // Buttons
    start: 'Start the journey',
    stop: 'That is enough',
    hush: 'Be quiet',
    settings: 'Settings',
    resetAll: 'Clear everything',
    resetConfirm: 'Clear every key and setting on this device and in your account?',

    // Ride screen
    waitingFirst: 'Getting a look at the road…',
    speakingNow: 'Speaking',
    remarksTitle: 'Already said',
    remarksEmpty: 'Nothing yet.',
    remarkFailed: 'not spoken',
    cameraStarting: 'Asking for the camera…',

    // Blockers
    needKey: 'Enter the key for the provider you picked before setting off.',
    needModel: 'Pick a model before setting off.',

    // Camera failures — one sentence each, because they need different answers
    cameraDenied:
      'The camera was refused. Allow it for korczak.xyz in the browser settings and try again.',
    cameraMissing: 'No camera answered. On a laptop, try the front camera instead.',
    cameraBusy: 'Something else is using the camera. Close it and try again.',
    cameraUnsupported:
      'This browser will not give a page the camera. It needs a secure connection and a browser that supports it.',
    cameraUnknown: 'The camera would not start.',

    // The thing that has to be said
    disclaimerTitle: 'It is a joke, and you are driving',
    disclaimerBody:
      'The passenger is making things up about a photograph from a few seconds ago. It is not ' +
      'looking out for you, it cannot see what you can, and nothing it says is advice. Do not act ' +
      'on it, and do not hold the phone while you drive — put it in a cradle before you set off.',
    disclaimerShort: 'A joke, not a co-pilot. Never act on what it says.',

    errorDismiss: 'Dismiss',
  },

  pl: {
    setupTitle: 'Zanim ruszymy',
    rideTitle: 'W drodze',

    pitch:
      'Skieruj telefon na drogę. Co kilka sekund rzuci okiem i powie to, co zwykle mówi pasażer, ' +
      'który akurat nie prowadzi.',

    signedOutTitle: 'Zaloguj się, żeby zachować klucze',
    signedOutBody:
      'Bez logowania wszystko działa, a klucze API zostają tylko w tej przeglądarce. Po ' +
      'zalogowaniu wędrują z kontem na pozostałe urządzenia.',
    signedOutLink: 'Zaloguj się',

    syncLocal: 'Tylko ta przeglądarka',
    syncSyncing: 'Sprawdzam konto…',
    syncSynced: 'Zapisane na koncie',
    syncError: 'Niezapisane na koncie',
    syncErrorHint: 'Ustawienia są w tej przeglądarce. Następna zmiana spróbuje ponownie.',

    keysTitle: 'Klucze API',
    keysBlurb:
      'Twoje, na twój rachunek, używane prosto z tej strony. Nic nie idzie przez korczak.xyz.',
    keyOpenai: 'Klucz OpenAI',
    keyGoogle: 'Klucz Google',
    keyElevenLabs: 'Klucz ElevenLabs',
    keyShow: 'Pokaż',
    keyHide: 'Ukryj',
    keyNotSet: 'brak',
    keySet: 'jest',
    keyElevenLabsHint: 'Potrzebny tylko wtedy, gdy wybierzesz niżej głos z ElevenLabs.',

    visionTitle: 'Oczy',
    visionProvider: 'Patrzy przez',
    visionModel: 'Model',
    visionModelsLoading: 'Pytam o listę modeli…',
    visionModelsEmpty: 'Wpisz klucz, żeby zobaczyć modele',
    visionModelsHint: 'Na liście są tylko modele, które potrafią patrzeć na zdjęcie.',

    personaTitle: 'Pasażer',
    personaWho: 'Kto tam siedzi',
    personaNervous: 'Kłębek nerwów',
    personaInstructor: 'Instruktor jazdy na emeryturze',
    personaParent: 'Twoja mama',
    personaChild: 'Znudzone dziecko',
    personaCodriver: 'Pilot rajdowy',
    intensityLabel: 'W jakim natężeniu',
    intensityMild: 'Łagodnie — od czasu do czasu westchnie',
    intensityNormal: 'Normalnie — porządnie irytująco',
    intensityRelentless: 'Bez litości — nic nie ujdzie uwadze',
    intervalLabel: 'Uwaga co {n} sekund',
    intervalHint:
      'Każda uwaga to jedno spojrzenie na drogę i jedno zapytanie na twoim kluczu. Częściej ' +
      'znaczy gadatliwiej i drożej.',

    voiceTitle: 'Głos',
    voiceEngine: 'Mówi przez',
    voiceEngineDevice: 'To urządzenie (za darmo)',
    voiceEngineElevenLabs: 'ElevenLabs (twój klucz)',
    voiceDevice: 'Głos urządzenia',
    voiceDeviceDefault: 'Co urządzenie wybierze',
    voiceDeviceEmpty: 'Ta przeglądarka nie podaje żadnych głosów.',
    voiceElevenLabs: 'Głos ElevenLabs',
    voiceElevenLabsLoading: 'Pytam o twoje głosy…',
    voiceElevenLabsEmpty: 'Wpisz klucz, żeby zobaczyć swoje głosy',
    voiceRate: 'Tempo: {value}×',
    voiceSlow: 'Wolno',
    voiceFast: 'Szybko',
    voiceTest: 'Sprawdź głos',
    voiceTestLine: 'Ojej, zwolnij trochę. Tam jest ciężarówka.',

    cameraTitle: 'Kamera',
    cameraFacing: 'Która kamera',
    cameraBack: 'Tylna — skierowana na drogę',
    cameraFront: 'Przednia — skierowana na ciebie',

    start: 'Ruszamy',
    stop: 'Wystarczy',
    hush: 'Cicho już',
    settings: 'Ustawienia',
    resetAll: 'Wyczyść wszystko',
    resetConfirm: 'Usunąć wszystkie klucze i ustawienia z tego urządzenia i z konta?',

    waitingFirst: 'Zerkam na drogę…',
    speakingNow: 'Mówi',
    remarksTitle: 'Już powiedziane',
    remarksEmpty: 'Jeszcze nic.',
    remarkFailed: 'niewypowiedziane',
    cameraStarting: 'Proszę o kamerę…',

    needKey: 'Wpisz klucz do wybranego dostawcy, zanim ruszysz.',
    needModel: 'Wybierz model, zanim ruszysz.',

    cameraDenied:
      'Odmówiono dostępu do kamery. Zezwól na nią dla korczak.xyz w ustawieniach przeglądarki i spróbuj ponownie.',
    cameraMissing: 'Żadna kamera się nie zgłosiła. Na laptopie spróbuj przedniej.',
    cameraBusy: 'Kamery używa coś innego. Zamknij tamto i spróbuj ponownie.',
    cameraUnsupported:
      'Ta przeglądarka nie udostępni stronie kamery. Potrzebne jest bezpieczne połączenie i przeglądarka, która to obsługuje.',
    cameraUnknown: 'Nie udało się uruchomić kamery.',

    disclaimerTitle: 'To żart, a ty prowadzisz',
    disclaimerBody:
      'Pasażer zmyśla na podstawie zdjęcia sprzed kilku sekund. Nie uważa za ciebie, nie widzi ' +
      'tego co ty, a nic z tego, co mówi, nie jest poradą. Nie stosuj się do tego i nie trzymaj ' +
      'telefonu w ręku podczas jazdy — włóż go w uchwyt, zanim ruszysz.',
    disclaimerShort: 'Żart, nie drugi kierowca. Nigdy nie rób tego, co mówi.',

    errorDismiss: 'Zamknij',
  },
} as const;

/**
 * Every key, as a plain string.
 *
 * Not `(typeof translations)['en']`: `as const` gives each entry its own literal type, so the
 * Polish table would fail to satisfy the English one key by key. Mapping the keys keeps the
 * completeness check — a missing key is still an error — without demanding the two languages say
 * the same words. Same reasoning, same shape, as sloper's table and the shopping list's.
 */
export type Translation = { [K in keyof (typeof translations)['en']]: string };

/**
 * Which sentence a camera refusal gets.
 *
 * One mapping, read by both screens: a ride can fail to start from the setup sheet and a stream can
 * be refused after the ride screen is already up. They are the same five failures and they must not
 * drift into two lists — each one needs a different answer from the person (a browser setting, a
 * different camera, another application), and "the camera would not start" answers none of them.
 */
export function cameraMessage(t: Translation, failure: CameraFailure): string {
  switch (failure) {
    case 'denied':
      return t.cameraDenied;
    case 'missing':
      return t.cameraMissing;
    case 'busy':
      return t.cameraBusy;
    case 'unsupported':
      return t.cameraUnsupported;
    default:
      return t.cameraUnknown;
  }
}
