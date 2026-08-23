/**
 * The Event Watch app's own strings.
 *
 * Local rather than in `src/i18n/index.ts` for the reason the typing trainer and the sleep log are:
 * the global table is what the navbar, the apps index and the manifests read, and it should not
 * grow by two hundred keys per app. Only the app's name and one-line description live there,
 * because the apps index shows them.
 */

export type Lang = 'en' | 'pl';

export const translations = {
  en: {
    navFeed: 'Feed',
    navInterests: 'Interests',
    navAlerts: 'Alerts',
    navLabel: 'Event Watch sections',

    // Auth gate
    signedOutTitle: 'Sign in to watch for events',
    signedOutBody:
      'This one needs an account: the watching happens on a server, and the notifications have to know where to go.',
    signIn: 'Sign in',
    unavailable: 'Event watching is not configured on this deployment.',

    // Feed
    feedHeading: 'Coming up',
    feedEmpty: 'Nothing matches your interests yet.',
    feedEmptyHint:
      'The collector runs every few hours. If this stays empty, widen a keyword or check the sources on the Alerts tab.',
    feedLoading: 'Loading events…',
    matchedBy: 'Matched by',
    tickets: 'Tickets',
    moreInfo: 'Details',
    groupThisWeek: 'This week',
    groupThisMonth: 'This month',
    groupLater: 'Later',
    groupUndated: 'Announced, no dates yet',
    announcedAgo: 'Announced {when}',
    onSaleNow: 'On sale',
    showingCount: '{shown} of {total} upcoming',
    allEvents: 'Show everything',
    matchedOnly: 'Matched only',

    // Interests
    interestsHeading: 'What to watch for',
    interestsIntro:
      'An interest is a filter, not a category. Anything matching one shows in the feed; anything matching an unmuted one can notify you.',
    addInterest: 'Add an interest',
    editInterest: 'Edit',
    deleteInterest: 'Delete',
    muteInterest: 'Mute',
    unmuteInterest: 'Unmute',
    mutedNote: 'Muted — shows in the feed, never notifies',
    fieldLabel: 'Name',
    fieldKeywords: 'Keywords',
    fieldKeywordsHint:
      'Any of these, one per line or comma separated. End a word with * to match its other forms — klezmer* also finds "klezmerski". Leave empty to match everything the tags allow.',
    fieldExclude: 'Never match',
    fieldExcludeHint: 'Any hit here rules the event out, whatever else matched.',
    fieldTags: 'Tags',
    fieldTagsHint: 'All of these must be present. Try opera, music, theatre, tech, festival.',
    fieldCities: 'Cities',
    fieldCitiesHint: 'Any of these. Leave empty for anywhere.',
    fieldLead: 'Remind me this many days ahead',
    save: 'Save',
    cancel: 'Cancel',
    matchesNow: 'Matches {count} upcoming',
    errorNeedsLabel: 'Give it a name.',
    errorNeedsRule: 'Add at least one keyword or tag, or it would match everything.',
    confirmDelete: 'Delete “{label}”?',

    // Alerts
    alertsHeading: 'Notifications',
    pushUnsupported: 'This browser cannot receive push notifications.',
    pushUnsupportedHint: 'On iPhone you need iOS 16.4 or newer.',
    pushNeedsInstall: 'Add this to your Home Screen first',
    pushNeedsInstallHint:
      'iOS only delivers notifications to an installed app. Tap Share, then “Add to Home Screen”, then open Event Watch from the icon and come back here.',
    pushBlocked: 'Notifications are turned off',
    pushBlockedHint:
      'The browser is refusing them and a page cannot undo that. iOS Settings → Notifications → Event Watch.',
    pushPrompt: 'Turn on notifications',
    pushPromptHint:
      'You will be asked once. Nothing is sent about anything already in your feed — only about things announced from now on.',
    pushArming: 'Asking…',
    pushReady: 'Notifications are on',
    pushConfirmed: 'Last confirmed {when}',
    pushSaving: 'Saving this device…',
    pushRetry: 'Retry',
    sendTest: 'Send me a test notification',
    testSending: 'Sending…',
    testSent: 'Sent. It should arrive in a few seconds.',
    testFailed: 'Test failed: {error}',
    devicesHeading: 'Devices',
    deviceRemove: 'Remove',
    deviceLastSeen: 'last opened {when}',
    historyHeading: 'What you have been told',
    historyEmpty: 'Nothing yet.',
    sourcesHeading: 'Sources',
    sourceOk: 'ok, {count} events',
    sourceFailing: 'failing since {when}',
    sourceNever: 'has not run yet',

    // Sync badge
    syncOff: 'Not signed in — nothing is being saved to your account',
    syncSynced: 'Synced',
    syncFailed: 'Sync failed',
    syncPending: '{count} waiting to sync',

    // Relative time
    justNow: 'just now',
    minutesAgo: '{n} min ago',
    hoursAgo: '{n} h ago',
    daysAgo: '{n} d ago',
  },
  pl: {
    navFeed: 'Wydarzenia',
    navInterests: 'Zainteresowania',
    navAlerts: 'Powiadomienia',
    navLabel: 'Sekcje aplikacji',

    signedOutTitle: 'Zaloguj się, żeby śledzić wydarzenia',
    signedOutBody:
      'Ta aplikacja wymaga konta: zbieranie danych dzieje się na serwerze, a powiadomienia muszą wiedzieć, gdzie trafić.',
    signIn: 'Zaloguj się',
    unavailable: 'Śledzenie wydarzeń nie jest skonfigurowane w tej wersji.',

    feedHeading: 'Nadchodzące',
    feedEmpty: 'Nic jeszcze nie pasuje do Twoich zainteresowań.',
    feedEmptyHint:
      'Zbieranie danych działa co kilka godzin. Jeśli nadal jest pusto, poszerz słowa kluczowe albo sprawdź źródła w zakładce Powiadomienia.',
    feedLoading: 'Wczytywanie wydarzeń…',
    matchedBy: 'Pasuje do',
    tickets: 'Bilety',
    moreInfo: 'Szczegóły',
    groupThisWeek: 'W tym tygodniu',
    groupThisMonth: 'W tym miesiącu',
    groupLater: 'Później',
    groupUndated: 'Ogłoszone, bez dat',
    announcedAgo: 'Ogłoszone {when}',
    onSaleNow: 'W sprzedaży',
    showingCount: '{shown} z {total} nadchodzących',
    allEvents: 'Pokaż wszystko',
    matchedOnly: 'Tylko pasujące',

    interestsHeading: 'Czego szukać',
    interestsIntro:
      'Zainteresowanie to filtr, nie kategoria. Wszystko, co pasuje, pojawia się na liście; wszystko, co pasuje do niewyciszonego, może wysłać powiadomienie.',
    addInterest: 'Dodaj zainteresowanie',
    editInterest: 'Edytuj',
    deleteInterest: 'Usuń',
    muteInterest: 'Wycisz',
    unmuteInterest: 'Włącz',
    mutedNote: 'Wyciszone — widoczne na liście, bez powiadomień',
    fieldLabel: 'Nazwa',
    fieldKeywords: 'Słowa kluczowe',
    fieldKeywordsHint:
      'Wystarczy jedno z nich, po przecinku lub w osobnych liniach. Zakończ gwiazdką, żeby złapać odmiany — klezmer* znajdzie też „klezmerski”. Puste pole znaczy: wszystko, co przepuszczą tagi.',
    fieldExclude: 'Nigdy nie pasuje',
    fieldExcludeHint: 'Trafienie tutaj wyklucza wydarzenie, cokolwiek innego pasowało.',
    fieldTags: 'Tagi',
    fieldTagsHint: 'Wszystkie muszą wystąpić. Np. opera, music, theatre, tech, festival.',
    fieldCities: 'Miasta',
    fieldCitiesHint: 'Wystarczy jedno. Puste pole znaczy: gdziekolwiek.',
    fieldLead: 'Przypomnij tyle dni wcześniej',
    save: 'Zapisz',
    cancel: 'Anuluj',
    matchesNow: 'Pasuje do {count} nadchodzących',
    errorNeedsLabel: 'Podaj nazwę.',
    errorNeedsRule: 'Dodaj słowo kluczowe albo tag — inaczej pasowałoby wszystko.',
    confirmDelete: 'Usunąć „{label}”?',

    alertsHeading: 'Powiadomienia',
    pushUnsupported: 'Ta przeglądarka nie obsługuje powiadomień push.',
    pushUnsupportedHint: 'Na iPhonie potrzebny jest iOS 16.4 lub nowszy.',
    pushNeedsInstall: 'Najpierw dodaj do ekranu głównego',
    pushNeedsInstallHint:
      'iOS wysyła powiadomienia tylko do zainstalowanej aplikacji. Dotknij Udostępnij, potem „Do ekranu początkowego”, otwórz aplikację z ikony i wróć tutaj.',
    pushBlocked: 'Powiadomienia są wyłączone',
    pushBlockedHint:
      'Przeglądarka ich odmawia, a strona tego nie cofnie. Ustawienia iOS → Powiadomienia → Wydarzenia.',
    pushPrompt: 'Włącz powiadomienia',
    pushPromptHint:
      'Zapytamy raz. Nie przyjdzie nic o tym, co już jest na liście — tylko o rzeczach ogłoszonych od teraz.',
    pushArming: 'Pytamy…',
    pushReady: 'Powiadomienia są włączone',
    pushConfirmed: 'Ostatnio potwierdzone {when}',
    pushSaving: 'Zapisywanie urządzenia…',
    pushRetry: 'Spróbuj ponownie',
    sendTest: 'Wyślij mi testowe powiadomienie',
    testSending: 'Wysyłanie…',
    testSent: 'Wysłane. Powinno dotrzeć w kilka sekund.',
    testFailed: 'Test nieudany: {error}',
    devicesHeading: 'Urządzenia',
    deviceRemove: 'Usuń',
    deviceLastSeen: 'ostatnio otwarte {when}',
    historyHeading: 'Co już wiesz',
    historyEmpty: 'Jeszcze nic.',
    sourcesHeading: 'Źródła',
    sourceOk: 'ok, {count} wydarzeń',
    sourceFailing: 'nie działa od {when}',
    sourceNever: 'jeszcze nie uruchomione',

    syncOff: 'Nie zalogowano — nic nie jest zapisywane na koncie',
    syncSynced: 'Zsynchronizowano',
    syncFailed: 'Błąd synchronizacji',
    syncPending: '{count} czeka na wysłanie',

    justNow: 'przed chwilą',
    minutesAgo: '{n} min temu',
    hoursAgo: '{n} godz. temu',
    daysAgo: '{n} dni temu',
  },
} as const;

/**
 * The shape of one locale's table, with every value widened to `string`.
 *
 * Not `(typeof translations)['en']`: `as const` gives each entry a *literal* type, so that alias
 * describes only the English table and the Polish one is not assignable to it. Every helper taking
 * a `Translation` then rejects `translations['pl']` — which is every helper, on every Polish page.
 */
export type Translation = { [K in keyof (typeof translations)['en']]: string };

/** `fill('{n} min ago', { n: 5 })`. The sleep log's helper, copied rather than shared: it is four
 *  lines, and importing it would tie this app's strings to that app's. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key) =>
    key in vars ? String(vars[key]) : whole,
  );
}

export function localeOf(lang: Lang): string {
  return lang === 'pl' ? 'pl-PL' : 'en-GB';
}

/** How long ago, in the coarsest unit that is still true. */
export function relativeTime(at: number, now: number, t: Translation): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 90) return t.justNow;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return fill(t.minutesAgo, { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 36) return fill(t.hoursAgo, { n: hours });
  return fill(t.daysAgo, { n: Math.round(hours / 24) });
}
