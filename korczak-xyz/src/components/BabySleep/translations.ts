/*
 * Strings for the baby sleep log, kept beside the game the way the fretboard and typing trainers
 * keep theirs — there are too many of them, and they are too specific, to belong in the site-wide
 * table. The game's name and one-line description do live there, because the games index shows them.
 */

export type Lang = 'en' | 'pl';

export const translations = {
  en: {
    // Tabs
    navLabel: 'Baby sleep log sections',
    navLog: 'Log',
    navStats: 'Stats',

    // Live controls
    awake: 'Awake',
    startNight: 'Night sleep',
    startNap: 'Nap',
    asleepNight: 'Asleep for the night',
    asleepNap: 'Napping',
    since: 'since {time}',
    wokeUp: 'Woke up',
    liveHint: 'Tap when the baby falls asleep.',

    // The forgotten timer
    staleTitle: 'Still running after {duration}',
    staleBody:
      'This looks like a timer nobody stopped. Set the wake-up time below, or discard it — it is left out of every average until you do.',
    staleFix: 'Set wake-up time',
    staleDiscard: 'Discard',
    orphanTitle: '{count} other unfinished sleep',
    orphanTitlePlural: '{count} other unfinished sleeps',
    orphanBody:
      'Started on another device and never closed. Give each one a wake-up time or remove it.',

    // Manual entry
    addTitle: 'Add a sleep',
    editTitle: 'Edit sleep',
    kind: 'Type',
    kindNight: 'Night',
    kindNap: 'Nap',
    fellAsleep: 'Fell asleep',
    wokeUpLabel: 'Woke up',
    dateLabel: 'Date',
    timeLabel: 'Time',
    stillAsleep: 'Still asleep',
    save: 'Save',
    add: 'Add',
    cancel: 'Cancel',

    // Validation
    errNoStart: 'Enter a date and time for when the baby fell asleep.',
    errEndBeforeStart: 'The wake-up time has to come after falling asleep.',
    errTooShort: 'Shorter than five minutes — check the times.',
    errTooLongNap: 'Longer than five hours. Was this night sleep?',
    errTooLongNight: 'Longer than sixteen hours — check the times.',
    errFuture: 'That is in the future.',
    errOverlap: 'This overlaps a sleep already logged.',

    // History
    historyTitle: 'Recent sleeps',
    empty: 'Nothing logged yet. Use the buttons above, or add a sleep by hand.',
    edit: 'Edit',
    remove: 'Delete',
    running: 'running',
    today: 'Today',
    yesterday: 'Yesterday',
    napsCount: '{count} nap',
    napsCountPlural: '{count} naps',
    dayTotal: '{total} total',

    // Stats — window
    windowLabel: 'Window',
    window3d: '3 days',
    window7d: 'Week',
    window30d: 'Month',
    windowCustom: 'Custom',
    customFrom: 'From',
    customTo: 'To',

    // Stats — tiles
    tileTotal: 'Sleep per day',
    tileNight: 'Night sleep',
    tileNaps: 'Nap sleep',
    tileNapCount: 'Naps per day',
    tileNapLength: 'Nap length',
    tileBedtime: 'Falls asleep',
    tileWake: 'Wakes up',
    tileFirstNap: 'First nap',
    overDays: 'over {count} day',
    overDaysPlural: 'over {count} days',
    fromNaps: 'from {count} nap',
    fromNapsPlural: 'from {count} naps',
    noData: '—',

    // Stats — charts
    timelineTitle: 'Nights and naps, day by day',
    timelineAria: 'Sleep blocks for each day against a midnight-to-midnight clock',
    totalsTitle: 'Total sleep per day',
    totalsAria: 'Night and nap sleep stacked, one bar per day',
    bedtimeTitle: 'Falling asleep and waking up',
    bedtimeAria: 'Bedtime and wake-up clock times per day, with the mean and one standard deviation',
    legendNight: 'Night',
    legendNap: 'Nap',
    legendRunning: 'Still asleep',
    legendIncomplete: 'Day in progress',
    legendMean: 'Mean',
    legendSpread: '±1 SD',
    chartEmpty: 'Nothing logged in this window.',
    meanLine: 'Mean {value}',
    bedtimeSeries: 'Falls asleep',
    wakeSeries: 'Wakes up',
    statsNote:
      'Averages count only days that finished with a night logged, so today never drags them down. A sleep still running, or one left running far too long, is drawn but never counted.',

    // Sync
    syncSignedOut: 'This device only',
    syncSynced: 'Synced',
    syncPending: '{count} to upload',
    syncError: 'Sync failed',
    syncRetry: 'Retry',
  },
  pl: {
    // Tabs
    navLabel: 'Sekcje dziennika snu',
    navLog: 'Dziennik',
    navStats: 'Statystyki',

    // Live controls
    awake: 'Nie śpi',
    startNight: 'Sen nocny',
    startNap: 'Drzemka',
    asleepNight: 'Śpi w nocy',
    asleepNap: 'Drzemie',
    since: 'od {time}',
    wokeUp: 'Obudziło się',
    liveHint: 'Naciśnij, gdy dziecko zaśnie.',

    // The forgotten timer
    staleTitle: 'Wciąż liczy od {duration}',
    staleBody:
      'Wygląda na to, że nikt nie zatrzymał pomiaru. Podaj godzinę pobudki poniżej albo odrzuć wpis — do tego czasu nie wchodzi do żadnej średniej.',
    staleFix: 'Podaj godzinę pobudki',
    staleDiscard: 'Odrzuć',
    orphanTitle: '{count} inny niezakończony sen',
    orphanTitlePlural: '{count} inne niezakończone sny',
    orphanBody:
      'Rozpoczęte na innym urządzeniu i nigdy nie zamknięte. Podaj godzinę pobudki albo usuń wpis.',

    // Manual entry
    addTitle: 'Dodaj sen',
    editTitle: 'Edytuj sen',
    kind: 'Rodzaj',
    kindNight: 'Noc',
    kindNap: 'Drzemka',
    fellAsleep: 'Zaśnięcie',
    wokeUpLabel: 'Pobudka',
    dateLabel: 'Data',
    timeLabel: 'Godzina',
    stillAsleep: 'Nadal śpi',
    save: 'Zapisz',
    add: 'Dodaj',
    cancel: 'Anuluj',

    // Validation
    errNoStart: 'Podaj datę i godzinę zaśnięcia.',
    errEndBeforeStart: 'Pobudka musi być po zaśnięciu.',
    errTooShort: 'Krócej niż pięć minut — sprawdź godziny.',
    errTooLongNap: 'Dłużej niż pięć godzin. Czy to był sen nocny?',
    errTooLongNight: 'Dłużej niż szesnaście godzin — sprawdź godziny.',
    errFuture: 'To jest w przyszłości.',
    errOverlap: 'To nakłada się na już zapisany sen.',

    // History
    historyTitle: 'Ostatnie sny',
    empty: 'Nic jeszcze nie zapisano. Użyj przycisków powyżej albo dodaj sen ręcznie.',
    edit: 'Edytuj',
    remove: 'Usuń',
    running: 'trwa',
    today: 'Dziś',
    yesterday: 'Wczoraj',
    napsCount: '{count} drzemka',
    napsCountPlural: '{count} drzemek',
    dayTotal: 'razem {total}',

    // Stats — window
    windowLabel: 'Zakres',
    window3d: '3 dni',
    window7d: 'Tydzień',
    window30d: 'Miesiąc',
    windowCustom: 'Własny',
    customFrom: 'Od',
    customTo: 'Do',

    // Stats — tiles
    tileTotal: 'Sen na dobę',
    tileNight: 'Sen nocny',
    tileNaps: 'Drzemki',
    tileNapCount: 'Drzemek na dobę',
    tileNapLength: 'Długość drzemki',
    tileBedtime: 'Zasypia',
    tileWake: 'Wstaje',
    tileFirstNap: 'Pierwsza drzemka',
    overDays: 'z {count} dnia',
    overDaysPlural: 'z {count} dni',
    fromNaps: 'z {count} drzemki',
    fromNapsPlural: 'z {count} drzemek',
    noData: '—',

    // Stats — charts
    timelineTitle: 'Noce i drzemki, dzień po dniu',
    timelineAria: 'Bloki snu dla każdego dnia na osi od północy do północy',
    totalsTitle: 'Sen na dobę',
    totalsAria: 'Sen nocny i drzemki jeden na drugim, jeden słupek na dzień',
    bedtimeTitle: 'Zasypianie i pobudka',
    bedtimeAria:
      'Godziny zaśnięcia i pobudki dla każdego dnia, ze średnią i jednym odchyleniem standardowym',
    legendNight: 'Noc',
    legendNap: 'Drzemka',
    legendRunning: 'Nadal śpi',
    legendIncomplete: 'Dzień w toku',
    legendMean: 'Średnia',
    legendSpread: '±1 SD',
    chartEmpty: 'Brak wpisów w tym zakresie.',
    meanLine: 'Średnia {value}',
    bedtimeSeries: 'Zasypia',
    wakeSeries: 'Wstaje',
    statsNote:
      'Średnie liczą tylko dni zakończone zapisaną nocą, więc dzisiejszy dzień ich nie zaniża. Sen, który trwa — albo taki, który trwa o wiele za długo — jest rysowany, ale nigdy liczony.',

    // Sync
    syncSignedOut: 'Tylko na tym urządzeniu',
    syncSynced: 'Zsynchronizowano',
    syncPending: '{count} do wysłania',
    syncError: 'Błąd synchronizacji',
    syncRetry: 'Ponów',
  },
} as const;

/**
 * Every key, as a plain string.
 *
 * Not `(typeof translations)['en']`: `as const` gives each entry its own literal type, so the Polish
 * table would fail to satisfy the English one key by key. Mapping the keys keeps the completeness
 * check — a missing key is still an error — without demanding the two languages say the same words.
 */
export type Translation = { [K in keyof (typeof translations)['en']]: string };

/** Fill `{name}` placeholders. Kept trivial on purpose — these are labels, not prose. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    key in values ? String(values[key]) : match
  );
}

/** Polish and English both need a plural switch for the few counted labels here. */
export function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export function localeOf(lang: Lang): string {
  return lang === 'pl' ? 'pl-PL' : 'en-GB';
}
