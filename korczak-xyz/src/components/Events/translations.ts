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
    navAlerts: 'Alerts',
    navSources: 'Sources',
    navLabel: 'Event Watch sections',

    // Auth gate
    signedOutTitle: 'Sign in to watch for events',
    signedOutBody:
      'This one needs an account: the watching happens on a server, and the notifications have to know where to go.',
    signIn: 'Sign in',
    unavailable: 'Event watching is not configured on this deployment.',

    // Feed
    feedHeading: 'Coming up',
    feedEmpty: 'Nothing has been collected yet.',
    feedEmptyHint:
      'The collector runs every few hours, and everything it finds lands here. If this stays empty, a source is failing — the Sources tab says which.',
    tickets: 'Tickets',
    moreInfo: 'Details',
    groupThisWeek: 'This week',
    groupThisMonth: 'This month',
    groupLater: 'Later',
    groupUndated: 'Announced, no dates yet',
    announcedAgo: 'Announced {when}',
    publishedAgo: 'Published {when}',
    onSaleNow: 'On sale',
    saleOpens: 'Sale opens {when}',
    showingCount: '{shown} of {total} upcoming',
    // The one thing that can empty the feed, and its control is on another tab — so it is a link
    // to Sources rather than a button.
    // Count after the noun, in both languages, so neither has to agree a number with a plural —
    // Polish has three forms of "źródła" and English would still read "1 sources".
    sourcesOffHint: 'Sources switched off: {count} — Sources tab',
    reachLocal: 'local',
    reachNational: 'national',
    reachInternational: 'international',
    reachUnknown: 'not labelled yet',
    kindAnnouncement: 'announcement',
    kindCoverage: 'news',

    // Arriving from a notification
    focusMissing:
      'The event that notification named is not in the feed — it has happened, its sale has opened, or its source has since been switched off. Everything still upcoming is below.',
    focusClear: 'Back to the whole feed',

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

    // Sources
    sourcesTabHeading: 'Where events come from',
    sourcesIntro:
      'Every page the collector reads, as a link, so the list can be checked rather than taken on trust. It runs every few hours; nothing is watched that is not on this page, and everything that is reaches your feed unless you switch it off here.',
    kindScrape: 'scraped page',
    kindIcal: 'calendar feed',
    kindRss: 'RSS',
    kindApi: 'API',
    // One name and one sentence per source id — see `sourceNames.ts`, whose two tables are typed
    // over `SourceId`, so a fifth source cannot be added without both.
    sourceNameTeatrWielki: 'Teatr Wielki – Opera Narodowa',
    sourceNamePythonOrg: 'python.org events',
    sourceNameElektroniczneZapisy: 'Elektroniczne Zapisy — races',
    sourceNameFeed: 'Watched feeds',
    sourceNameTicketmaster: 'Ticketmaster (PL)',
    noteTeatrWielki:
      'The theatre’s own news list, and nothing else from this house. It is read for one thing: the morning the tickets go on sale, which the theatre states in prose a fortnight or more ahead and which is the only fact here with a deadline on it. The season repertoire pages were dropped — what is programmed is never urgent, and they could not answer this.',
    notePythonOrg:
      'Worldwide, and deliberately not narrowed by country: what is collected is a fact about the world, so PyCon US is here whether or not you would go. Each card says which country it is in.',
    noteElektroniczneZapisy:
      'The running listings on an entry platform, nationwide — road, cross, obstacle and ultra. Each row says its own town, and there are well over a hundred of them, so this is the source to switch off first if the feed is too long; the sign-up form is a page of its own, which is what lets this one tell you entries have opened.',
    noteFeed:
      'Blogs and magazines that publish what they are putting on. A feed item is an article, so it carries no date of its own and shows under “announced, no dates yet”.',
    noteTicketmaster:
      'The ticketed end of what is watched for. Everything it lists is already on sale, so it can never tell you tickets have just been released.',
    sourceNeedsKey: 'needs {name}',
    // The switch under each source, and the two states it can be read in. The label is the whole
    // sentence rather than the source's name again: a box beside `Teatr Wielki` says nothing about
    // what ticking it does, and this is a control that silences notifications.
    sourceOn: 'Watching — in your feed, and can notify you',
    sourceOff: 'Off — not in your feed, and cannot notify you. Still collected.',
    sourceSwitchFailed: 'That switch is set on this device but was not saved: {error}',
    sourceLastRun: 'ran {when}',
    sourceInCorpus: '{count} collected',
    pageOptional: 'appears when announced',

    // What a model was asked about this source's rows
    extractionHeading: 'Read by a model',
    extractionNone:
      'Nothing from this source has been collected yet, so no model has been asked anything about it.',
    extractionDisabled:
      'Classification is switched off for this source: no model is asked about its rows. Each race states its own town and every page is in Poland, so there is nothing left for it to answer.',
    passClassifier: 'Classifier',
    passClassifierNote:
      'One call per row, over everything this source produces except its newsroom articles. Nothing is filtered on what it decides, so a count stuck well under the rows costs you the labels on the cards rather than the cards — which is why it is worth looking at here.',
    passNewsroom: 'Newsroom reader',
    passNewsroomNote:
      'One call per article, over the rows a page tagged newsroom, fetching the article behind each one. It is asked a single question, because the answer schedules a notification on a particular morning: do tickets go on sale on a stated date, and when.',
    passAnswered: '{answered} of {rows} answered',
    extractKind: 'is it an event, an announcement, or writing about one',
    extractReach: 'how far it draws people',
    extractCountry: 'which country it is in',
    extractTicketSale: 'does it announce a ticket sale',
    extractSaleAt: 'the morning the sale opens',
    fieldShared: 'stated by the source where it knows it',

    sourcesUnlistedHeading: 'Also reporting',
    sourcesUnlistedHint:
      'Reporting its health beside the sources without being a page — the classifier is one. A scrape here is one that was removed from the list and is still collecting.',

    // Relative time
    justNow: 'just now',
    minutesAgo: '{n} min ago',
    hoursAgo: '{n} h ago',
    daysAgo: '{n} d ago',
  },
  pl: {
    navFeed: 'Wydarzenia',
    navAlerts: 'Powiadomienia',
    navSources: 'Źródła',
    navLabel: 'Sekcje aplikacji',

    signedOutTitle: 'Zaloguj się, żeby śledzić wydarzenia',
    signedOutBody:
      'Ta aplikacja wymaga konta: zbieranie danych dzieje się na serwerze, a powiadomienia muszą wiedzieć, gdzie trafić.',
    signIn: 'Zaloguj się',
    unavailable: 'Śledzenie wydarzeń nie jest skonfigurowane w tej wersji.',

    feedHeading: 'Nadchodzące',
    feedEmpty: 'Nic jeszcze nie zostało zebrane.',
    feedEmptyHint:
      'Kolektor działa co kilka godzin, a wszystko, co znajdzie, trafia tutaj. Jeśli nadal jest pusto, jakieś źródło nie działa — zakładka Źródła powie które.',
    tickets: 'Bilety',
    moreInfo: 'Szczegóły',
    groupThisWeek: 'W tym tygodniu',
    groupThisMonth: 'W tym miesiącu',
    groupLater: 'Później',
    groupUndated: 'Ogłoszone, bez dat',
    announcedAgo: 'Ogłoszone {when}',
    publishedAgo: 'Opublikowano {when}',
    onSaleNow: 'W sprzedaży',
    saleOpens: 'Sprzedaż od {when}',
    showingCount: '{shown} z {total} nadchodzących',
    sourcesOffHint: 'Wyłączone źródła: {count} — zakładka Źródła',
    reachLocal: 'lokalne',
    reachNational: 'krajowe',
    reachInternational: 'międzynarodowe',
    reachUnknown: 'jeszcze nieopisane',
    kindAnnouncement: 'ogłoszenie',
    kindCoverage: 'tekst',

    focusMissing:
      'Wydarzenia z tego powiadomienia nie ma na liście — odbyło się, ruszyła jego sprzedaż albo jego źródło zostało w międzyczasie wyłączone. Poniżej jest wszystko, co dopiero przed nami.',
    focusClear: 'Wróć do pełnej listy',


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

    sourcesTabHeading: 'Skąd biorą się wydarzenia',
    sourcesIntro:
      'Każda strona, którą czyta kolektor, jako link — żeby dało się to sprawdzić, a nie tylko przyjąć na słowo. Działa co kilka godzin; nie śledzimy niczego, czego nie ma na tej liście, a wszystko, co na niej jest, trafia na Twoją listę, dopóki tego tutaj nie wyłączysz.',
    kindScrape: 'strona',
    kindIcal: 'kalendarz',
    kindRss: 'RSS',
    kindApi: 'API',
    sourceNameTeatrWielki: 'Teatr Wielki – Opera Narodowa',
    sourceNamePythonOrg: 'python.org events',
    sourceNameElektroniczneZapisy: 'Elektroniczne Zapisy — biegi',
    sourceNameFeed: 'Śledzone kanały',
    sourceNameTicketmaster: 'Ticketmaster (PL)',
    noteTeatrWielki:
      'Same aktualności teatru i nic więcej z tego domu. Czytane dla jednej rzeczy: ranka, w którym rusza sprzedaż biletów — teatr pisze o tym prostym zdaniem, zwykle z dwutygodniowym wyprzedzeniem, i to jedyny fakt tutaj z terminem. Strony repertuaru sezonu odpadły: co jest w planie, nigdy nie jest pilne, a tej daty i tak nie podawały.',
    notePythonOrg:
      'Cały świat i celowo bez filtra kraju: to, co zbieramy, jest faktem o świecie, więc PyCon US jest tu niezależnie od tego, czy pojedziesz. Każda karta mówi, w jakim kraju się odbywa.',
    noteElektroniczneZapisy:
      'Biegowe listy na platformie zapisów, z całej Polski — szosa, przełaje, przeszkody i ultra. Każdy wiersz podaje własne miasto, a wierszy jest grubo ponad sto, więc to pierwsze źródło do wyłączenia, jeśli lista robi się za długa; formularz zapisów to osobna strona i stąd wiadomo, kiedy ruszyły zapisy.',
    noteFeed:
      'Blogi i czasopisma, które piszą o tym, co organizują. Wpis w kanale to artykuł, więc nie ma własnej daty i trafia do „ogłoszone, bez dat”.',
    noteTicketmaster:
      'Biletowana część tego, czego szukamy. Wszystko, co tam jest, już jest w sprzedaży, więc stamtąd nie przyjdzie wiadomość o starcie sprzedaży.',
    sourceNeedsKey: 'wymaga {name}',
    sourceOn: 'Śledzone — jest na liście i może powiadamiać',
    sourceOff: 'Wyłączone — nie ma go na liście i nie powiadomi. Nadal jest zbierane.',
    sourceSwitchFailed: 'Ten przełącznik działa na tym urządzeniu, ale nie został zapisany: {error}',
    sourceLastRun: 'ostatnio {when}',
    sourceInCorpus: 'zebrane: {count}',
    pageOptional: 'pojawi się po ogłoszeniu',

    extractionHeading: 'Czytane przez model',
    extractionNone:
      'Z tego źródła nie ma jeszcze żadnych wierszy, więc żaden model nie był o nie pytany.',
    extractionDisabled:
      'Klasyfikacja jest wyłączona dla tego źródła: żaden model nie jest pytany o jego wiersze. Każdy bieg podaje własną miejscowość, a każda strona dotyczy Polski, więc model nie miałby tu nic do ustalenia.',
    passClassifier: 'Klasyfikator',
    passClassifierNote:
      'Jedno zapytanie na wiersz, dla wszystkiego z tego źródła poza aktualnościami. Nic nie jest filtrowane na podstawie jego odpowiedzi, więc licznik stojący mocno poniżej liczby wierszy kosztuje opisy na kartach, a nie same karty — i dlatego warto na niego patrzeć tutaj.',
    passNewsroom: 'Czytnik aktualności',
    passNewsroomNote:
      'Jedno zapytanie na artykuł, dla wierszy oznaczonych przez stronę jako aktualności, z pobraniem treści każdego z nich. Pytanie jest jedno, bo odpowiedź planuje powiadomienie na konkretny poranek: czy bilety trafiają do sprzedaży w podanym terminie i kiedy.',
    passAnswered: 'odpowiedzi: {answered} z {rows}',
    extractKind: 'czy to wydarzenie, ogłoszenie, czy tekst o wydarzeniu',
    extractReach: 'jak daleko sięga',
    extractCountry: 'w jakim kraju się odbywa',
    extractTicketSale: 'czy zapowiada start sprzedaży biletów',
    extractSaleAt: 'poranek, w którym rusza sprzedaż',
    fieldShared: 'podaje je źródło, kiedy je zna',

    sourcesUnlistedHeading: 'Zgłasza się też',
    sourcesUnlistedHint:
      'Raportuje swój stan obok źródeł, nie będąc stroną — tak działa klasyfikator. Jeśli trafi tu scraper, znaczy że wypadł z listy, a nadal zbiera.',



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
