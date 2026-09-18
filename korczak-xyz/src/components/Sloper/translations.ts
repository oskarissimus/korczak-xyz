/*
 * Strings for the video generation wizard, kept beside the app the way the shopping list and the
 * sleep log keep theirs — there are far too many of them, and they are far too specific, to
 * belong in the site-wide table. The app's name and one-line description do live there, because
 * the apps index shows them.
 *
 * Two things are deliberately NOT translated, and both are names rather than prose:
 *
 *  - Provider, model and voice names. `gpt-image-1` is an identifier sent over the wire, and a
 *    Polish spelling of it would be a different model.
 *  - Whatever an API returns. Every error from OpenAI, Google or ElevenLabs is shown verbatim,
 *    in English, because it is the string you would paste into their support page. The sentence
 *    around it is translated; the quote is not.
 */

export { fill, localeOf } from '../BabySleep/translations';

export type Lang = 'en' | 'pl';

export const translations = {
  en: {
    // The step rail, and the band over the sheet beside it. The rail is short labels because it
    // is a list read at a glance; the band is the fuller name of the same step, which is the
    // division an installer's own left panel and title band make.
    steps: 'Steps',
    stepConfig: 'Settings',
    stepScenes: 'Script',
    stepAssets: 'Pictures & voice',
    stepAssembly: 'Assembling',
    stepOutput: 'Video',
    stepLocked: 'Not reached yet',
    stepCounter: 'Step {n} of {total}',
    configTitle: 'Keys and settings',

    // Sign-in gate
    signedOutTitle: 'Sign in to keep your keys',
    signedOutBody:
      'Signed out, everything works and the API keys stay in this browser only. Signed in, they follow the account to your other devices — and the video assembler, which runs on a server, will only answer a signed-in request.',
    signedOutLink: 'Sign in',

    // Sync badge
    syncLocal: 'This browser only',
    syncSyncing: 'Checking the account…',
    syncSynced: 'Saved to your account',
    syncError: 'Not saved to the account',
    syncErrorHint: 'The settings are still in this browser. The next edit tries again.',

    // Settings: keys
    keysTitle: 'API keys',
    keysBlurb:
      'Yours, billed to you, used straight from this page. Nothing goes through korczak.xyz except the last step.',
    keyOpenai: 'OpenAI key',
    keyDeepseek: 'DeepSeek key',
    keyGoogle: 'Google key',
    keyElevenLabs: 'ElevenLabs key',
    keyShow: 'Show',
    keyHide: 'Hide',
    keyNotSet: 'not set',
    keySet: 'set',
    keyShared: 'The same key as the script, when both use OpenAI.',

    // Settings: the script
    llmTitle: 'The script',
    llmProvider: 'Written by',
    llmModel: 'Model',
    llmModelsLoading: 'Asking for the model list…',
    llmModelsEmpty: 'Enter a key to list the models',
    llmShowAll: 'Show every model',
    llmTemperature: 'Imagination: {value}',
    llmFocused: 'Predictable',
    llmWild: 'Unhinged',

    // Settings: the pictures
    imageTitle: 'The pictures',
    imageProvider: 'Drawn by',
    imageModel: 'Model',
    imageQuality: 'Quality',
    imageQualityLow: 'Low — quick and cheap',
    imageQualityMedium: 'Medium',
    imageQualityHigh: 'High — slow and dear',
    imageAspect: 'Aspect ratio',
    imageAspectAuto: 'From the video size',
    imageAspectHint: 'Google takes a ratio rather than a pixel size.',

    // Settings: the video
    videoTitle: 'The video',
    videoResolution: 'Size',
    videoFrameRate: 'Frames per second',
    videoScenes: 'Scenes',
    videoDuration: 'Target length (seconds)',

    // Settings: the voice
    ttsTitle: 'The voice',
    ttsModel: 'Model',
    ttsVoice: 'Voice',
    ttsVoiceCustom: 'Or a voice ID',
    ttsVoiceCustomHint: 'Any ElevenLabs voice ID overrides the picker above.',
    ttsSpeed: 'Speed: {value}x',
    ttsSlow: 'Slow',
    ttsFast: 'Fast',
    ttsConcurrency: 'At once: {value}',
    ttsConcurrencyLow: '1 — safest',
    ttsConcurrencyHigh: '10 — hits rate limits',
    ttsPlan: 'ElevenLabs plan',
    ttsPlanHint: 'Only used to estimate the cost.',

    // Costs
    costLlm: 'Script',
    costImage: 'Pictures',
    costTts: 'Voice',
    costTotal: 'Estimated total',
    costVaries: 'varies',
    costScraped: 'Prices scraped {date}.',
    costUnknownModel: '{model} is not in the price list; gpt-4o rates used instead.',
    costUnlisted: '{model} is not in the price list.',
    costPerImage: '{each} each × {count} scenes',
    costChars: '~{chars} characters at {rate} per 1,000',
    costFreePlan: 'Inside the free allowance.',
    costEstimateOnly: 'An estimate over the target length, not a bill.',

    // Starting
    startButton: 'Write the script',
    startChecking: 'Checking the ElevenLabs key…',
    startMissingKeys: 'Still needed: {keys}',
    startNoModel: 'Pick a model for the script.',
    reset: 'Reset the settings',
    resetConfirm: 'Clear every setting and key, here and on your account?',

    // Script stage
    scenesTitle: 'The script',
    promptLabel: 'What is the video about?',
    promptPlaceholder: 'The history of coffee. A tour of the solar system. Why cats sit in boxes.',
    promptHint: '{scenes} scenes, about {words} words, aiming at {seconds}s.',
    generate: 'Generate',
    generating: 'Writing… ({count} so far)',
    stop: 'Stop',
    clearAll: 'Clear',
    sceneNumber: 'Scene {n}',
    sceneEdited: 'edited',
    sceneScript: 'Narration',
    sceneScriptPlaceholder: 'What the voice says over this picture.',
    sceneImage: 'Picture',
    sceneImagePlaceholder: 'What the picture shows.',
    sceneWords: '{count} words',
    sceneDelete: 'Delete',
    sceneEmpty: 'empty',
    scenesNone: 'No scenes yet. Say what the video is about and press Generate.',
    addScene: '+ Add a scene',
    tokensTitle: 'Tokens used',
    tokensPrompt: 'Prompt',
    tokensCompletion: 'Completion',
    tokensTotal: 'Total',
    tokensCost: 'Cost',
    toAssets: 'Make the pictures and the voice ({count} scenes)',
    scenesSkipped: '{count} scene(s) are missing a field and will be left out.',
    backToConfig: '← Settings',

    // Asset stage
    assetsTitle: 'Pictures & voice',
    assetsBlurb: 'One picture and one narration per scene, both at once.',
    assetsProgress: '{done} of {total} done',
    assetsImages: 'Pictures',
    assetsAudio: 'Voice',
    assetsFailed: '{count} failed',
    statusPending: 'Waiting',
    statusGenerating: 'Working',
    statusComplete: 'Done',
    statusFailed: 'Failed',
    retry: 'Retry',
    toAssembly: 'Assemble the video',
    toAssemblyPartial: 'Assemble what worked',
    assetsSomeFailed:
      'Some of them failed. Retry them one at a time, or carry on with the ones that worked.',
    backToScenes: '← Script',

    // Assembly stage
    assemblyTitle: 'Assembling',
    assemblyPreparing: 'Getting the files together…',
    assemblyUploading: 'Sending {mb} MB to the assembler…',
    assemblyWait: 'FFmpeg is encoding. A dozen scenes takes a few minutes.',
    assemblyElapsed: 'Elapsed: {time}',
    assemblyFailed: 'The video could not be assembled.',
    assemblyRetry: 'Try again',
    backToAssets: '← Pictures & voice',

    // Output stage
    outputTitle: 'Your video',
    outputBlurb: 'Play it, then save it.',
    download: 'Download',
    driveUpload: 'Send to Google Drive',
    driveLoading: 'Loading Google…',
    driveAuth: 'Waiting for Google…',
    driveUploading: 'Sending {percent}%',
    driveOpen: 'Open in Drive',
    driveFailed: 'Sending failed — retry',
    driveDismiss: 'Dismiss',
    startOver: 'Start a new video',
    startOverConfirm: 'Start again? This throws away the script, the pictures and the video.',

    // Errors
    errorDismiss: 'Dismiss',
    leaveWarning: 'The pictures and the voice are only in this page. Leaving loses them.',
  },

  pl: {
    steps: 'Kroki',
    stepConfig: 'Ustawienia',
    stepScenes: 'Scenariusz',
    stepAssets: 'Obrazy i głos',
    stepAssembly: 'Składanie',
    stepOutput: 'Wideo',
    stepLocked: 'Jeszcze nie tutaj',
    stepCounter: 'Krok {n} z {total}',
    configTitle: 'Klucze i ustawienia',

    signedOutTitle: 'Zaloguj się, żeby zachować klucze',
    signedOutBody:
      'Bez logowania wszystko działa, ale klucze API zostają tylko w tej przeglądarce. Po zalogowaniu wędrują z kontem na inne urządzenia — a składarka wideo, która działa na serwerze, odpowiada tylko zalogowanym.',
    signedOutLink: 'Zaloguj się',

    syncLocal: 'Tylko ta przeglądarka',
    syncSyncing: 'Sprawdzam konto…',
    syncSynced: 'Zapisane na koncie',
    syncError: 'Niezapisane na koncie',
    syncErrorHint: 'Ustawienia są nadal w tej przeglądarce. Następna zmiana spróbuje ponownie.',

    keysTitle: 'Klucze API',
    keysBlurb:
      'Twoje, płacone przez Ciebie, używane prosto z tej strony. Przez korczak.xyz idzie tylko ostatni krok.',
    keyOpenai: 'Klucz OpenAI',
    keyDeepseek: 'Klucz DeepSeek',
    keyGoogle: 'Klucz Google',
    keyElevenLabs: 'Klucz ElevenLabs',
    keyShow: 'Pokaż',
    keyHide: 'Ukryj',
    keyNotSet: 'brak',
    keySet: 'jest',
    keyShared: 'Ten sam klucz co scenariusz, jeśli oba używają OpenAI.',

    llmTitle: 'Scenariusz',
    llmProvider: 'Pisze',
    llmModel: 'Model',
    llmModelsLoading: 'Pytam o listę modeli…',
    llmModelsEmpty: 'Wpisz klucz, żeby zobaczyć modele',
    llmShowAll: 'Pokaż wszystkie modele',
    llmTemperature: 'Wyobraźnia: {value}',
    llmFocused: 'Przewidywalnie',
    llmWild: 'Szaleńczo',

    imageTitle: 'Obrazy',
    imageProvider: 'Rysuje',
    imageModel: 'Model',
    imageQuality: 'Jakość',
    imageQualityLow: 'Niska — szybko i tanio',
    imageQualityMedium: 'Średnia',
    imageQualityHigh: 'Wysoka — wolno i drogo',
    imageAspect: 'Proporcje',
    imageAspectAuto: 'Z rozmiaru wideo',
    imageAspectHint: 'Google przyjmuje proporcje, nie rozmiar w pikselach.',

    videoTitle: 'Wideo',
    videoResolution: 'Rozmiar',
    videoFrameRate: 'Klatki na sekundę',
    videoScenes: 'Sceny',
    videoDuration: 'Docelowa długość (sekundy)',

    ttsTitle: 'Głos',
    ttsModel: 'Model',
    ttsVoice: 'Głos',
    ttsVoiceCustom: 'Albo ID głosu',
    ttsVoiceCustomHint: 'Dowolne ID głosu ElevenLabs zastępuje wybór powyżej.',
    ttsSpeed: 'Tempo: {value}x',
    ttsSlow: 'Wolno',
    ttsFast: 'Szybko',
    ttsConcurrency: 'Naraz: {value}',
    ttsConcurrencyLow: '1 — najbezpieczniej',
    ttsConcurrencyHigh: '10 — limity zaczną odmawiać',
    ttsPlan: 'Plan ElevenLabs',
    ttsPlanHint: 'Tylko do oszacowania kosztu.',

    costLlm: 'Scenariusz',
    costImage: 'Obrazy',
    costTts: 'Głos',
    costTotal: 'Szacowana całość',
    costVaries: 'różnie',
    costScraped: 'Ceny zebrane {date}.',
    costUnknownModel: '{model} nie ma w cenniku; liczone stawkami gpt-4o.',
    costUnlisted: '{model} nie ma w cenniku.',
    costPerImage: '{each} za sztukę × {count} scen',
    costChars: '~{chars} znaków po {rate} za 1000',
    costFreePlan: 'Mieści się w darmowym limicie.',
    costEstimateOnly: 'Szacunek z docelowej długości, nie rachunek.',

    startButton: 'Napisz scenariusz',
    startChecking: 'Sprawdzam klucz ElevenLabs…',
    startMissingKeys: 'Brakuje jeszcze: {keys}',
    startNoModel: 'Wybierz model do scenariusza.',
    reset: 'Wyczyść ustawienia',
    resetConfirm: 'Usunąć wszystkie ustawienia i klucze, tutaj i na koncie?',

    scenesTitle: 'Scenariusz',
    promptLabel: 'O czym jest to wideo?',
    promptPlaceholder: 'Historia kawy. Wycieczka po Układzie Słonecznym. Czemu koty siedzą w pudłach.',
    promptHint: '{scenes} scen, około {words} słów, na {seconds} s.',
    generate: 'Generuj',
    generating: 'Piszę… ({count} gotowych)',
    stop: 'Stop',
    clearAll: 'Wyczyść',
    sceneNumber: 'Scena {n}',
    sceneEdited: 'zmieniona',
    sceneScript: 'Narracja',
    sceneScriptPlaceholder: 'Co głos mówi do tego obrazu.',
    sceneImage: 'Obraz',
    sceneImagePlaceholder: 'Co widać na obrazie.',
    sceneWords: 'słów: {count}',
    sceneDelete: 'Usuń',
    sceneEmpty: 'pusta',
    scenesNone: 'Jeszcze nie ma scen. Napisz, o czym ma być wideo, i naciśnij Generuj.',
    addScene: '+ Dodaj scenę',
    tokensTitle: 'Zużyte tokeny',
    tokensPrompt: 'Wejście',
    tokensCompletion: 'Wyjście',
    tokensTotal: 'Razem',
    tokensCost: 'Koszt',
    toAssets: 'Zrób obrazy i głos ({count} scen)',
    scenesSkipped: 'Scen bez jednego z pól: {count}. Zostaną pominięte.',
    backToConfig: '← Ustawienia',

    assetsTitle: 'Obrazy i głos',
    assetsBlurb: 'Jeden obraz i jedna narracja na scenę, równolegle.',
    assetsProgress: 'gotowe {done} z {total}',
    assetsImages: 'Obrazy',
    assetsAudio: 'Głos',
    assetsFailed: 'nieudane: {count}',
    statusPending: 'Czeka',
    statusGenerating: 'Pracuje',
    statusComplete: 'Gotowe',
    statusFailed: 'Błąd',
    retry: 'Ponów',
    toAssembly: 'Złóż wideo',
    toAssemblyPartial: 'Złóż z tego, co się udało',
    assetsSomeFailed:
      'Część się nie udała. Ponów je pojedynczo albo złóż wideo z tego, co jest.',
    backToScenes: '← Scenariusz',

    assemblyTitle: 'Składanie',
    assemblyPreparing: 'Zbieram pliki…',
    assemblyUploading: 'Wysyłam {mb} MB do składarki…',
    assemblyWait: 'FFmpeg koduje. Kilkanaście scen to kilka minut.',
    assemblyElapsed: 'Upłynęło: {time}',
    assemblyFailed: 'Nie udało się złożyć wideo.',
    assemblyRetry: 'Spróbuj ponownie',
    backToAssets: '← Obrazy i głos',

    outputTitle: 'Twoje wideo',
    outputBlurb: 'Obejrzyj i zapisz.',
    download: 'Pobierz',
    driveUpload: 'Wyślij na Dysk Google',
    driveLoading: 'Ładuję Google…',
    driveAuth: 'Czekam na Google…',
    driveUploading: 'Wysyłam {percent}%',
    driveOpen: 'Otwórz na Dysku',
    driveFailed: 'Wysyłanie nieudane — ponów',
    driveDismiss: 'Zamknij',
    startOver: 'Nowe wideo',
    startOverConfirm: 'Zacząć od nowa? Scenariusz, obrazy i wideo przepadną.',

    errorDismiss: 'Zamknij',
    leaveWarning: 'Obrazy i głos są tylko na tej stronie. Wyjście je traci.',
  },
} as const;

/**
 * Every key, as a plain string.
 *
 * Not `(typeof translations)['en']`: `as const` gives each entry its own literal type, so the
 * Polish table would fail to satisfy the English one key by key. Mapping the keys keeps the
 * completeness check — a missing key is still an error — without demanding the two languages say
 * the same words. Same reasoning, same shape, as the shopping list's table.
 */
export type Translation = { [K in keyof (typeof translations)['en']]: string };
