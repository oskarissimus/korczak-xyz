/**
 * The transport app's own strings.
 *
 * Local rather than in `src/i18n/index.ts`, for the reason the events app's are: the global table
 * is what the navbar, the apps index and the manifests read, and it should not grow by a hundred
 * keys per app. Only the app's name and one-line description live there.
 *
 * One thing deliberately *not* translated anywhere in this app: **station names, line codes, and
 * the operator's own words.** `Rondo Daszyńskiego` is the name on the platform sign in both
 * locales, and the reason a communiqué gives — `awaria taboru` — is a phrase lifted out of the
 * source. Translating either would put a second reading between the reader and what WTP actually
 * said, which is exactly what the Raw tab exists to let them check.
 */

export type Lang = 'en' | 'pl';

export const translations = {
  en: {
    navFeed: 'Now',
    navRoutes: 'My route',
    navAlerts: 'Alerts',
    navRaw: 'Raw',
    navLabel: 'Public transport sections',

    // Auth gate
    signedOutTitle: 'Sign in to watch the metro',
    signedOutBody:
      'This one needs an account: the watching happens on a server, and the notifications have to know where to go.',
    signIn: 'Sign in',
    unavailable: 'Transport watching is not configured on this deployment.',

    // Feed
    feedHeading: 'Warsaw metro',
    sectionRoute: 'On your route',
    sectionLine: 'On your lines',
    sectionOther: 'Everything else',
    sectionRouteEmpty: 'Nothing is affecting your route.',
    sectionLineEmpty: 'Nothing else on M1 or M2.',
    feedEmpty: 'No notices in the last two weeks.',
    feedEmptyHint:
      'The collector reads both WTP feeds every ten minutes. If this stays empty, check the Raw tab — a feed that cannot be read is not the same as a quiet fortnight.',
    showOther: 'Show what was filtered out',
    hideOther: 'Hide the rest',
    otherIntro:
      'Notices that name none of your lines. Here so the filter can be checked rather than trusted.',
    coverage: '{read} of {total} metro notices read',
    coverageNone: 'None of the {total} metro notices has been read yet',
    offline: 'Showing a saved copy — this device is offline.',
    filterAll: 'Both feeds',
    filterImpediment: 'Disruptions',
    filterChange: 'Planned changes',

    // A card
    kindImpediment: 'Disruption',
    kindChange: 'Planned change',
    closedStops: 'No stops at',
    wholeLine: 'Whole line suspended',
    noClosure: 'No station closed',
    reason: 'Reason',
    from: 'From',
    until: 'until',
    openNotice: 'Read at wtp.waw.pl',
    showSource: 'Source',
    unread: 'Not read yet — treated as if it were on your route',
    unreadFailed: 'Could not be read — treated as if it were on your route',
    stale: 'WTP has edited this since it was read',
    yourStops: 'Your stops',

    // Routes
    routesHeading: 'The stretches you travel',
    routesIntro:
      'A leg is a line and two stations, and it means every station between them. One line per leg: a journey with a change is two.',
    routesEmpty: 'No legs yet. Add the stretch you actually ride.',
    addLeg: 'Add a leg',
    editLeg: 'Edit',
    removeLeg: 'Remove',
    muteLeg: 'Mute',
    unmuteLeg: 'Unmute',
    muted: 'muted',
    fieldLabel: 'Name',
    fieldLine: 'Line',
    fieldFrom: 'From',
    fieldTo: 'To',
    stops: '{count} stops',
    save: 'Save',
    cancel: 'Cancel',
    invalidLeg: 'Those two stations are not both on that line.',
    labelPlaceholder: 'Way home · leg 1',

    // Alerts
    alertsHeading: 'Notifications',
    alertsIntro:
      'Two kinds. A notice on a line you ride, and a notice on the stretch you ride — the second one is the loud one.',
    settingLine: 'Tell me about my lines, not only my route',
    settingChange: 'Tell me about planned changes, not only disruptions',
    historyHeading: 'Sent',
    historyEmpty: 'Nothing has been sent yet.',
    historyRoute: 'Your route',
    historyLine: 'Your line',
    historyFailed: 'not delivered',
    feedHealthHeading: 'The two feeds',
    feedOk: 'read {when}, {count} notices',
    feedBad: 'failing since {when}',
    feedNever: 'never read',
    feedFailures: '{count} in a row',

    // Raw
    rawHeading: 'What the feed actually said',
    rawIntro:
      'Every item of both feeds, exactly as it arrived, whether or not it could be read. This is what to look at when a card says something odd — the reading is a model\'s, the XML is WTP\'s.',
    rawEmpty: 'Nothing archived yet.',
    rawParsed: 'parsed',
    rawUnparsed: 'could not be parsed',
    rawFetched: 'fetched {when}',
    rawShow: 'Show XML',
    rawHide: 'Hide XML',
    sourcesHeading: 'The pages read',
    refreshEvery: 'every {n} min',

    syncOff: 'Not signed in — nothing is saved to an account',
    syncSynced: 'Synced',
    syncFailed: 'Sync failed',
    syncPending: '{count} waiting to send',
    retry: 'Retry',

    justNow: 'just now',
    minutesAgo: '{n} min ago',
    hoursAgo: '{n} h ago',
    daysAgo: '{n} d ago',
  },
  pl: {
    navFeed: 'Teraz',
    navRoutes: 'Moja trasa',
    navAlerts: 'Powiadomienia',
    navRaw: 'Źródło',
    navLabel: 'Sekcje komunikacji miejskiej',

    signedOutTitle: 'Zaloguj się, żeby śledzić metro',
    signedOutBody:
      'Tu potrzebne jest konto: śledzenie dzieje się na serwerze, a powiadomienia muszą wiedzieć, dokąd trafić.',
    signIn: 'Zaloguj się',
    unavailable: 'Śledzenie komunikacji nie jest skonfigurowane w tym wdrożeniu.',

    feedHeading: 'Metro w Warszawie',
    sectionRoute: 'Na Twojej trasie',
    sectionLine: 'Na Twoich liniach',
    sectionOther: 'Pozostałe',
    sectionRouteEmpty: 'Nic nie dotyczy Twojej trasy.',
    sectionLineEmpty: 'Nic więcej na M1 ani M2.',
    feedEmpty: 'Brak komunikatów z ostatnich dwóch tygodni.',
    feedEmptyHint:
      'Kolektor czyta oba kanały WTP co dziesięć minut. Jeśli tu nadal pusto, zajrzyj do zakładki Źródło — kanał, którego nie da się odczytać, to nie to samo co spokojne dwa tygodnie.',
    showOther: 'Pokaż odfiltrowane',
    hideOther: 'Ukryj pozostałe',
    otherIntro:
      'Komunikaty, które nie dotyczą żadnej z Twoich linii. Są tutaj, żeby filtr dało się sprawdzić, a nie tylko przyjąć na wiarę.',
    coverage: 'Odczytano {read} z {total} komunikatów o metrze',
    coverageNone: 'Nie odczytano jeszcze żadnego z {total} komunikatów o metrze',
    offline: 'To zapisana kopia — urządzenie jest offline.',
    filterAll: 'Oba kanały',
    filterImpediment: 'Utrudnienia',
    filterChange: 'Zmiany',

    kindImpediment: 'Utrudnienie',
    kindChange: 'Zmiana',
    closedStops: 'Bez zatrzymania na',
    wholeLine: 'Cała linia wstrzymana',
    noClosure: 'Żadna stacja nie jest zamknięta',
    reason: 'Powód',
    from: 'Od',
    until: 'do',
    openNotice: 'Przeczytaj na wtp.waw.pl',
    showSource: 'Źródło',
    unread: 'Jeszcze nieodczytany — traktowany jak dotyczący Twojej trasy',
    unreadFailed: 'Nie udało się odczytać — traktowany jak dotyczący Twojej trasy',
    stale: 'WTP zmieniło ten komunikat po odczytaniu',
    yourStops: 'Twoje stacje',

    routesHeading: 'Odcinki, którymi jeździsz',
    routesIntro:
      'Odcinek to linia i dwie stacje, i oznacza wszystkie stacje pomiędzy nimi. Jedna linia na odcinek: podróż z przesiadką to dwa odcinki.',
    routesEmpty: 'Brak odcinków. Dodaj ten, którym naprawdę jeździsz.',
    addLeg: 'Dodaj odcinek',
    editLeg: 'Edytuj',
    removeLeg: 'Usuń',
    muteLeg: 'Wycisz',
    unmuteLeg: 'Włącz',
    muted: 'wyciszony',
    fieldLabel: 'Nazwa',
    fieldLine: 'Linia',
    fieldFrom: 'Od',
    fieldTo: 'Do',
    stops: '{count} stacji',
    save: 'Zapisz',
    cancel: 'Anuluj',
    invalidLeg: 'Te dwie stacje nie leżą na jednej linii.',
    labelPlaceholder: 'Droga do domu · odcinek 1',

    alertsHeading: 'Powiadomienia',
    alertsIntro:
      'Dwa rodzaje. Komunikat o linii, którą jeździsz, i komunikat o odcinku, którym jeździsz — ten drugi jest głośniejszy.',
    settingLine: 'Powiadamiaj o moich liniach, nie tylko o trasie',
    settingChange: 'Powiadamiaj też o planowanych zmianach, nie tylko o utrudnieniach',
    historyHeading: 'Wysłane',
    historyEmpty: 'Nic jeszcze nie zostało wysłane.',
    historyRoute: 'Twoja trasa',
    historyLine: 'Twoja linia',
    historyFailed: 'niedostarczone',
    feedHealthHeading: 'Oba kanały',
    feedOk: 'odczytany {when}, {count} komunikatów',
    feedBad: 'błąd od {when}',
    feedNever: 'nigdy nieodczytany',
    feedFailures: '{count} z rzędu',

    rawHeading: 'Co naprawdę powiedział kanał',
    rawIntro:
      'Każdy element obu kanałów, dokładnie tak, jak przyszedł — niezależnie od tego, czy dało się go odczytać. Tu zaglądaj, gdy karta mówi coś dziwnego: odczyt jest modelu, XML jest WTP.',
    rawEmpty: 'Nic jeszcze nie zarchiwizowano.',
    rawParsed: 'sparsowany',
    rawUnparsed: 'nie dało się sparsować',
    rawFetched: 'pobrany {when}',
    rawShow: 'Pokaż XML',
    rawHide: 'Ukryj XML',
    sourcesHeading: 'Czytane strony',
    refreshEvery: 'co {n} min',

    syncOff: 'Nie zalogowano — nic nie jest zapisywane na koncie',
    syncSynced: 'Zsynchronizowano',
    syncFailed: 'Błąd synchronizacji',
    syncPending: '{count} czeka na wysłanie',
    retry: 'Ponów',

    justNow: 'przed chwilą',
    minutesAgo: '{n} min temu',
    hoursAgo: '{n} godz. temu',
    daysAgo: '{n} dni temu',
  },
} as const;

/** See the note on the events app's copy: `as const` makes the English table a literal type. */
export type Translation = { [K in keyof (typeof translations)['en']]: string };

export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key) => (key in vars ? String(vars[key]) : whole));
}

export function localeOf(lang: Lang): string {
  return lang === 'pl' ? 'pl-PL' : 'en-GB';
}

export function relativeTime(at: number, now: number, t: Translation): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 90) return t.justNow;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return fill(t.minutesAgo, { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 36) return fill(t.hoursAgo, { n: hours });
  return fill(t.daysAgo, { n: Math.round(hours / 24) });
}

/** A time of day with its date, in the reader's locale, always in Warsaw. */
export function whenLabel(at: number, lang: Lang): string {
  return new Intl.DateTimeFormat(localeOf(lang), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Warsaw',
  }).format(new Date(at));
}
