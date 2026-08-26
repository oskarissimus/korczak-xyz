/*
 * Strings for the baby sleep log, kept beside the game the way the fretboard and typing trainers
 * keep theirs — there are too many of them, and they are too specific, to belong in the site-wide
 * table. The app's name and one-line description do live there, because the apps index shows them.
 */

export type Lang = 'en' | 'pl';

export const translations = {
  en: {
    // Tabs
    navLabel: 'Baby sleep log sections',
    navLog: 'Log',
    navStats: 'Stats',
    navShare: 'Share',

    // Live controls
    awake: 'Awake',
    startNight: 'Night sleep',
    startNap: 'Nap',
    asleepNight: 'Asleep for the night',
    asleepNap: 'Napping',
    since: 'since {time}',
    wokeUp: 'Woke up',
    liveHint: 'Tap when the baby falls asleep.',

    // The routine before a sleep
    routineStartNight: 'Night routine',
    routineStartNap: 'Nap routine',
    routineInCrib: 'In crib',
    routineRunning: 'Routine since {time}',
    routineSpan: 'Routine {from} – {to}',
    routineNapRunning: 'Nap routine since {time}',
    routineNapSpan: 'Nap routine {from} – {to}',
    routineWaiting: 'In crib since {time}',
    routineAsleepAfter: 'fell asleep after {duration}',
    routineClear: 'Clear',
    routineStaleTitle: 'Routine running for {duration}',
    routineStaleBody:
      'This looks like a routine nobody closed. Set the crib time below, or clear it — it is left out of every average until you do.',
    routineAdd: 'Add routine',
    routineEdit: 'Routine',
    routineNapEdit: 'Nap routine',
    routineNapAdd: 'Add nap routine',
    routineNone: 'No routine logged',
    routineFormTitle: 'Bedtime routine',
    routineFormOf: 'Night of {day}',
    routineFormHint:
      'One routine a night. The gap between the crib and falling asleep is what the stats call time to fall asleep.',
    routineNapFormTitle: 'Nap routine',
    routineNapFormOf: 'Nap on {day}',
    routineNapFormHint:
      'One routine per nap. It is joined to the next nap after the crib; nap routines are drawn on the timeline and left out of the tiles, which are about bedtime.',
    routineStartLabel: 'Routine started',
    routineEndLabel: 'In crib',
    routineOpen: 'Still in the routine',
    routineRemove: 'Remove',
    errRoutineNoStart: 'Set a time the routine started.',
    errRoutineOrder: 'The crib time has to be after the routine started.',
    errRoutineFuture: 'That is in the future.',
    errRoutineTooLong: 'Longer than four hours — check the times.',

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

    // Night wakings
    splitAction: 'Add wake',
    splitTitle: 'Wake period',
    splitOf: 'Splitting {kind} {from} – {to}',
    backAsleep: 'Fell asleep again',
    splitButton: 'Split',
    splitHint:
      'The two halves still count as one night — same bedtime, same morning. Only the time awake comes out of its total.',

    // Validation
    errNoStart: 'Enter a date and time for when the baby fell asleep.',
    errEndBeforeStart: 'The wake-up time has to come after falling asleep.',
    errTooShort: 'Shorter than five minutes — check the times.',
    errTooLongNap: 'Longer than five hours. Was this night sleep?',
    errTooLongNight: 'Longer than sixteen hours — check the times.',
    errFuture: 'That is in the future.',
    errOverlap: 'This overlaps a sleep already logged.',
    errWakeOutside: 'The waking has to fall inside this sleep.',
    errWakeOrder: 'Falling asleep again has to come after waking up.',
    errSplitTooShort: 'That leaves a piece shorter than five minutes.',

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
    loggedBy: 'by {name}',

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
    tileNightWakes: 'Night wakings',
    tileNightAwake: 'Awake at night',
    tileNapLength: 'Nap length',
    tileBedtime: 'Falls asleep',
    tileWake: 'Wakes up',
    tileFirstNap: 'First nap',
    tileRoutineLength: 'Routine length',
    tileSettle: 'Time to fall asleep',
    tileRoutineStart: 'Routine starts',
    tileCrib: 'Goes into crib',
    overDays: 'over {count} day',
    overDaysPlural: 'over {count} days',
    fromNaps: 'from {count} nap',
    fromNapsPlural: 'from {count} naps',
    noData: '—',

    // Stats — charts
    timelineTitle: 'Nights and naps, day by day',
    timelineAria:
      'Sleep blocks and the bedtime routine for each day against a midnight-to-midnight clock',
    totalsTitle: 'Total sleep per day',
    totalsAria: 'Night and nap sleep stacked, one bar per day',
    nightLengthTitle: 'How long the night was',
    nightLengthAria:
      'Night sleep duration per day, with the mean and one standard deviation',
    nightLengthSeries: 'Night sleep',
    settleTitle: 'How long he took to fall asleep',
    settleAria:
      'Time from going into the crib to falling asleep, per night, with the mean and one standard deviation',
    settleSeries: 'Time to fall asleep',
    cribTitle: 'When he went into the crib',
    cribAria:
      'Clock time of going into the crib per night, with the mean, one standard deviation and the target',
    cribSeries: 'In crib',
    cribNoTarget: 'No target set. The Config tab draws one on this chart and on the timeline above.',
    bedtimeTitle: 'Falling asleep and waking up',
    bedtimeAria: 'Bedtime and wake-up clock times per day, with the mean and one standard deviation',
    legendNight: 'Night',
    legendNap: 'Nap',
    legendRoutine: 'Routine',
    legendCrib: 'In crib',
    legendSettle: 'Falling asleep',
    legendRunning: 'Still asleep',
    legendIncomplete: 'Day in progress',
    legendMean: 'Mean',
    legendSpread: '±1 SD',
    legendTarget: 'Target',
    legendAverage: '7-night average',
    chartEmpty: 'Nothing logged in this window.',
    chartHint: 'Point at the chart, or tap it, for the values.',
    meanLine: 'Mean {value}',
    bedtimeSeries: 'Falls asleep',
    wakeSeries: 'Wakes up',
    statsNote:
      'Averages count only days that finished with a night logged, so today never drags them down. A sleep still running, or one left running far too long, is drawn but never counted. A night broken by a waking counts as one night: its blocks are added up, and the time awake is reported on its own.',

    // Climate — the tab
    navClimate: 'Climate',
    climateTitle: 'Tonight',
    climateIntro:
      'Two things, at the two moments you know them: the forecast low and the window before bed, and in the morning whether it was too cold. After a couple of weeks the chart below says how low you can go with the window open.',
    climateNight: 'Night of',
    climateTemp: 'Forecast low',
    climateTempUnit: '°C',
    climateTempHint: 'The overnight low outside, as forecast.',
    climateWindow: 'Window',
    windowOpen: 'Open',
    windowClosed: 'Closed',
    climateVerdict: 'In the morning',
    verdictCold: 'Too cold',
    verdictOk: 'Alright',
    verdictWarm: 'Too warm',
    verdictClear: 'Clear',
    climateSave: 'Save',
    climateSaved: 'Saved.',
    climateErrTemp: 'That is not a temperature.',
    climateErrRange: 'A forecast low is somewhere between −40 and 45 °C.',
    climateEveningMissing: 'No temperature logged for this night.',
    climateVerdictMissing: 'No verdict yet.',

    // Climate — the history
    climateHistoryTitle: 'Recent nights',
    climateEmpty: 'Nothing logged yet. Fill in tonight above.',
    climateEdit: 'Edit',
    climateClear: 'Clear',
    climateNotLogged: '—',

    // Climate — the chart
    climateChartTitle: 'How cold has been alright',
    climateChartAria:
      'Each night as a dot at its forecast low, in a lane for whether the window was open, coloured by how the morning went',
    climateLaneOpen: 'Window open',
    climateLaneClosed: 'Window closed',
    climateThresholdSettled: 'Window open: alright down to {ok} °C, too cold at {cold} °C and below.',
    climateThresholdOnlyOk: 'Window open: alright down to {ok} °C so far — no night has been too cold yet.',
    climateThresholdMixed:
      'Window open: mixed between {cold} °C and {ok} °C. A few more nights should settle it.',
    climateThresholdSameTemp:
      'Window open: {temp} °C has gone both ways. Something other than the forecast is deciding it.',
    climateThresholdThin: 'Only {count} complete {nights} with the window open — not enough to say yet.',
    climateNightOne: 'night',
    climateNightMany: 'nights',
    climateThresholdMark: 'Coldest alright',
    climateChartEmpty:
      'No complete nights yet. A night counts once it has a temperature, a window state and a verdict.',
    climateDot: '{date}: {temp} °C, {window}, {verdict}',

    // Sync
    syncSignedOut: 'This device only',
    syncSynced: 'Synced',
    syncPending: '{count} to upload',
    syncError: 'Sync failed',
    syncRetry: 'Retry',

    // Share
    shareTitle: 'Share this log',
    shareIntro:
      'Anyone you share with signs in with their own account and sees the same log — the same running sleep, the same history. Either of you can add, correct and delete entries.',
    shareUnavailable:
      'Accounts are not configured on this build, so there is nothing to share the log with. It is still kept on this device.',
    shareSignedOutTitle: 'Sign in to share',
    shareSignedOutBody:
      'Sharing works between accounts, so the log has to be on an account before it can be shared. Signing in also syncs it to your other devices.',
    shareSignIn: 'Sign in',
    shareAddLabel: 'Email address',
    shareAddButton: 'Share',
    shareAddHint:
      'The account has to be created in the Firebase console first — this page cannot create it. Adding the address here is safe either way: the access is simply waiting when the account appears.',
    shareListTitle: 'Shared with',
    shareEmpty: 'Not shared with anyone yet.',
    shareRevoke: 'Revoke',
    shareRevoked: 'Access removed.',
    shareAdded: '{email} can now open this log.',
    shareSince: 'since {date}',
    shareErrEmpty: 'Enter an email address.',
    shareErrMalformed: 'That does not look like an email address.',
    shareErrTooLong: 'That address is too long.',
    shareErrSelf: 'That is your own address — you already have access.',
    shareErrFailed: 'Could not save the share. Check your connection and try again.',
    shareGuestTitle: "You are logging into {owner}'s log",
    shareGuestBody:
      'Everything you add here goes to their log, and everything they add appears here. Only they can change who it is shared with.',
    shareOwnerUnknown: 'another account',
    shareUnresolvedTitle: 'Could not tell whose log this is',
    shareUnresolvedBody:
      'The log is still working on this device and nothing has been lost, but it is not syncing until this is settled — writing to the wrong account would be worse than waiting.',
    shareRetry: 'Try again',
    shareWorking: 'Saving…',

    // Config — the tab
    navConfig: 'Config',
    configIntro:
      'What bedtime is aiming at. Everything here belongs to the log rather than to this device, so it syncs to the account and to whoever the log is shared with.',
    configTargetTitle: 'Targets',
    configCribTarget: 'In crib by',
    configCribHint:
      'The end of the bedtime routine — the moment he goes into the crib, not the moment he falls asleep.',
    configNote:
      'Drawn on the stats page: a line down the timeline and across the in-crib chart, so each night can be read against it. Nothing is counted or graded against it, and no average changes.',
    configClear: 'No target',
    configSaved: 'Target cleared.',
    configSavedAt: 'Target saved: {time}.',
    configErrTime: 'Set a time, or clear the target.',
  },
  pl: {
    // Tabs
    navLabel: 'Sekcje dziennika snu',
    navLog: 'Dziennik',
    navStats: 'Statystyki',
    navShare: 'Udostępnianie',

    // Live controls
    awake: 'Nie śpi',
    startNight: 'Sen nocny',
    startNap: 'Drzemka',
    asleepNight: 'Śpi w nocy',
    asleepNap: 'Drzemie',
    since: 'od {time}',
    wokeUp: 'Obudziło się',
    liveHint: 'Naciśnij, gdy dziecko zaśnie.',

    // The routine before a sleep
    routineStartNight: 'Rytuał na noc',
    routineStartNap: 'Rytuał przed drzemką',
    routineInCrib: 'W łóżeczku',
    routineRunning: 'Rytuał od {time}',
    routineSpan: 'Rytuał {from} – {to}',
    routineNapRunning: 'Rytuał przed drzemką od {time}',
    routineNapSpan: 'Rytuał przed drzemką {from} – {to}',
    routineWaiting: 'W łóżeczku od {time}',
    routineAsleepAfter: 'zasnęło po {duration}',
    routineClear: 'Wyczyść',
    routineStaleTitle: 'Rytuał trwa już {duration}',
    routineStaleBody:
      'To wygląda na rytuał, którego nikt nie zamknął. Ustaw godzinę położenia do łóżeczka poniżej albo wyczyść wpis — do tego czasu nie liczy się do żadnej średniej.',
    routineAdd: 'Dodaj rytuał',
    routineEdit: 'Rytuał',
    routineNapEdit: 'Rytuał przed drzemką',
    routineNapAdd: 'Dodaj rytuał przed drzemką',
    routineNone: 'Brak rytuału',
    routineFormTitle: 'Rytuał przed snem',
    routineFormOf: 'Noc z {day}',
    routineFormHint:
      'Jeden rytuał na noc. Odstęp między położeniem do łóżeczka a zaśnięciem to w statystykach czas zasypiania.',
    routineNapFormTitle: 'Rytuał przed drzemką',
    routineNapFormOf: 'Drzemka dnia {day}',
    routineNapFormHint:
      'Jeden rytuał na drzemkę. Łączy się z pierwszą drzemką po położeniu do łóżeczka; rytuały przed drzemką rysujemy na osi czasu, ale nie liczą się do kafelków, które dotyczą wieczoru.',
    routineStartLabel: 'Początek rytuału',
    routineEndLabel: 'W łóżeczku',
    routineOpen: 'Rytuał wciąż trwa',
    routineRemove: 'Usuń',
    errRoutineNoStart: 'Podaj godzinę rozpoczęcia rytuału.',
    errRoutineOrder: 'Godzina położenia do łóżeczka musi być po rozpoczęciu rytuału.',
    errRoutineFuture: 'To jest w przyszłości.',
    errRoutineTooLong: 'Dłużej niż cztery godziny — sprawdź godziny.',

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

    // Night wakings
    splitAction: 'Dodaj pobudkę',
    splitTitle: 'Przerwa we śnie',
    splitOf: 'Dzielisz: {kind} {from} – {to}',
    backAsleep: 'Znów zasnęło',
    splitButton: 'Podziel',
    splitHint:
      'Obie części nadal liczą się jako jedna noc — to samo zaśnięcie, ta sama pobudka rano. Z jej sumy odchodzi tylko czas czuwania.',

    // Validation
    errNoStart: 'Podaj datę i godzinę zaśnięcia.',
    errEndBeforeStart: 'Pobudka musi być po zaśnięciu.',
    errTooShort: 'Krócej niż pięć minut — sprawdź godziny.',
    errTooLongNap: 'Dłużej niż pięć godzin. Czy to był sen nocny?',
    errTooLongNight: 'Dłużej niż szesnaście godzin — sprawdź godziny.',
    errFuture: 'To jest w przyszłości.',
    errOverlap: 'To nakłada się na już zapisany sen.',
    errWakeOutside: 'Pobudka musi mieścić się w tym śnie.',
    errWakeOrder: 'Ponowne zaśnięcie musi być po pobudce.',
    errSplitTooShort: 'Zostałby kawałek krótszy niż pięć minut.',

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
    loggedBy: 'zapisał(a) {name}',

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
    tileNightWakes: 'Pobudki w nocy',
    tileNightAwake: 'Czuwanie w nocy',
    tileNapLength: 'Długość drzemki',
    tileBedtime: 'Zasypia',
    tileWake: 'Wstaje',
    tileFirstNap: 'Pierwsza drzemka',
    tileRoutineLength: 'Długość rytuału',
    tileSettle: 'Czas zasypiania',
    tileRoutineStart: 'Początek rytuału',
    tileCrib: 'Ląduje w łóżeczku',
    overDays: 'z {count} dnia',
    overDaysPlural: 'z {count} dni',
    fromNaps: 'z {count} drzemki',
    fromNapsPlural: 'z {count} drzemek',
    noData: '—',

    // Stats — charts
    timelineTitle: 'Noce i drzemki, dzień po dniu',
    timelineAria: 'Bloki snu i rytuał przed snem dla każdego dnia na osi od północy do północy',
    totalsTitle: 'Sen na dobę',
    totalsAria: 'Sen nocny i drzemki jeden na drugim, jeden słupek na dzień',
    nightLengthTitle: 'Jak długa była noc',
    nightLengthAria:
      'Długość snu nocnego dla każdego dnia, ze średnią i jednym odchyleniem standardowym',
    nightLengthSeries: 'Sen nocny',
    settleTitle: 'Jak długo zasypiało',
    settleAria:
      'Czas od położenia do łóżeczka do zaśnięcia, noc po nocy, ze średnią i jednym odchyleniem standardowym',
    settleSeries: 'Czas zasypiania',
    cribTitle: 'O której trafiało do łóżeczka',
    cribAria:
      'Godzina położenia do łóżeczka dla każdej nocy, ze średnią, jednym odchyleniem standardowym i celem',
    cribSeries: 'W łóżeczku',
    cribNoTarget:
      'Nie ustawiono celu. Zakładka Ustawienia rysuje go na tym wykresie i na osi czasu powyżej.',
    bedtimeTitle: 'Zasypianie i pobudka',
    bedtimeAria:
      'Godziny zaśnięcia i pobudki dla każdego dnia, ze średnią i jednym odchyleniem standardowym',
    legendNight: 'Noc',
    legendNap: 'Drzemka',
    legendRoutine: 'Rytuał',
    legendCrib: 'W łóżeczku',
    legendSettle: 'Zasypianie',
    legendRunning: 'Nadal śpi',
    legendIncomplete: 'Dzień w toku',
    legendMean: 'Średnia',
    legendSpread: '±1 SD',
    legendTarget: 'Cel',
    legendAverage: 'Średnia z 7 nocy',
    chartEmpty: 'Brak wpisów w tym zakresie.',
    chartHint: 'Najedź na wykres lub dotknij go, aby zobaczyć wartości.',
    meanLine: 'Średnia {value}',
    bedtimeSeries: 'Zasypia',
    wakeSeries: 'Wstaje',
    statsNote:
      'Średnie liczą tylko dni zakończone zapisaną nocą, więc dzisiejszy dzień ich nie zaniża. Sen, który trwa — albo taki, który trwa o wiele za długo — jest rysowany, ale nigdy liczony. Noc przerwana pobudką liczy się jako jedna noc: jej części się sumują, a czas czuwania podawany jest osobno.',

    // Climate — the tab
    navClimate: 'Klimat',
    climateTitle: 'Dzisiejsza noc',
    climateIntro:
      'Dwie rzeczy, w dwóch momentach, w których się je wie: prognoza minimalnej temperatury i okno przed snem, a rano — czy nie było za zimno. Po kilkunastu nocach wykres poniżej powie, jak nisko można zejść przy otwartym oknie.',
    climateNight: 'Noc z',
    climateTemp: 'Prognoza minimum',
    climateTempUnit: '°C',
    climateTempHint: 'Prognozowana minimalna temperatura na zewnątrz w nocy.',
    climateWindow: 'Okno',
    windowOpen: 'Otwarte',
    windowClosed: 'Zamknięte',
    climateVerdict: 'Rano',
    verdictCold: 'Za zimno',
    verdictOk: 'W porządku',
    verdictWarm: 'Za ciepło',
    verdictClear: 'Wyczyść',
    climateSave: 'Zapisz',
    climateSaved: 'Zapisano.',
    climateErrTemp: 'To nie jest temperatura.',
    climateErrRange: 'Prognozowane minimum mieści się między −40 a 45 °C.',
    climateEveningMissing: 'Brak temperatury dla tej nocy.',
    climateVerdictMissing: 'Brak oceny.',

    // Climate — the history
    climateHistoryTitle: 'Ostatnie noce',
    climateEmpty: 'Nic jeszcze nie zapisano. Uzupełnij dzisiejszą noc powyżej.',
    climateEdit: 'Edytuj',
    climateClear: 'Usuń',
    climateNotLogged: '—',

    // Climate — the chart
    climateChartTitle: 'Przy jakim chłodzie było w porządku',
    climateChartAria:
      'Każda noc jako punkt przy prognozowanym minimum, w pasie odpowiadającym temu, czy okno było otwarte, w kolorze oceny poranka',
    climateLaneOpen: 'Okno otwarte',
    climateLaneClosed: 'Okno zamknięte',
    climateThresholdSettled:
      'Okno otwarte: w porządku do {ok} °C, za zimno przy {cold} °C i poniżej.',
    climateThresholdOnlyOk:
      'Okno otwarte: jak dotąd w porządku do {ok} °C — żadna noc nie była za zimna.',
    climateThresholdMixed:
      'Okno otwarte: różnie między {cold} °C a {ok} °C. Jeszcze kilka nocy powinno to rozstrzygnąć.',
    climateThresholdSameTemp:
      'Okno otwarte: {temp} °C wypadło i tak, i tak. Decyduje coś innego niż prognoza.',
    climateThresholdThin:
      'Tylko {count} {nights} z kompletem danych przy otwartym oknie — za mało, żeby cokolwiek powiedzieć.',
    climateNightOne: 'noc',
    climateNightMany: 'nocy',
    climateThresholdMark: 'Najchłodniej i w porządku',
    climateChartEmpty:
      'Brak kompletnych nocy. Noc liczy się, gdy ma temperaturę, stan okna i ocenę poranka.',
    climateDot: '{date}: {temp} °C, {window}, {verdict}',

    // Sync
    syncSignedOut: 'Tylko na tym urządzeniu',
    syncSynced: 'Zsynchronizowano',
    syncPending: '{count} do wysłania',
    syncError: 'Błąd synchronizacji',
    syncRetry: 'Ponów',

    // Share
    shareTitle: 'Udostępnij ten dziennik',
    shareIntro:
      'Osoba, której udostępnisz dziennik, loguje się na własne konto i widzi ten sam dziennik — ten sam trwający sen, tę samą historię. Każde z was może dodawać, poprawiać i usuwać wpisy.',
    shareUnavailable:
      'W tej wersji konta nie są skonfigurowane, więc nie ma komu udostępnić dziennika. Nadal jest zapisywany na tym urządzeniu.',
    shareSignedOutTitle: 'Zaloguj się, aby udostępnić',
    shareSignedOutBody:
      'Udostępnianie działa między kontami, więc dziennik musi najpierw trafić na konto. Logowanie synchronizuje go też z twoimi pozostałymi urządzeniami.',
    shareSignIn: 'Zaloguj się',
    shareAddLabel: 'Adres e-mail',
    shareAddButton: 'Udostępnij',
    shareAddHint:
      'Konto trzeba najpierw założyć w konsoli Firebase — ta strona tego nie zrobi. Dodanie adresu i tak jest bezpieczne: dostęp po prostu czeka, aż konto powstanie.',
    shareListTitle: 'Udostępniono',
    shareEmpty: 'Nikomu jeszcze nie udostępniono.',
    shareRevoke: 'Odbierz dostęp',
    shareRevoked: 'Dostęp odebrany.',
    shareAdded: '{email} może teraz otworzyć ten dziennik.',
    shareSince: 'od {date}',
    shareErrEmpty: 'Podaj adres e-mail.',
    shareErrMalformed: 'To nie wygląda na adres e-mail.',
    shareErrTooLong: 'Ten adres jest za długi.',
    shareErrSelf: 'To twój własny adres — masz już dostęp.',
    shareErrFailed: 'Nie udało się zapisać. Sprawdź połączenie i spróbuj ponownie.',
    shareGuestTitle: 'Piszesz do dziennika, którego właścicielem jest {owner}',
    shareGuestBody:
      'Wszystko, co tu dodasz, trafia do ich dziennika, a wszystko, co oni dodadzą, pojawia się tutaj. Tylko oni mogą zmienić, komu jest udostępniony.',
    shareOwnerUnknown: 'inne konto',
    shareUnresolvedTitle: 'Nie udało się ustalić, czyj to dziennik',
    shareUnresolvedBody:
      'Dziennik nadal działa na tym urządzeniu i nic nie zginęło, ale nie synchronizuje się, dopóki to się nie wyjaśni — zapis na złe konto byłby gorszy niż czekanie.',
    shareRetry: 'Spróbuj ponownie',
    shareWorking: 'Zapisywanie…',

    // Config — the tab
    navConfig: 'Ustawienia',
    configIntro:
      'Do czego dąży wieczór. Wszystko tutaj należy do dziennika, a nie do tego urządzenia, więc synchronizuje się z kontem i z osobą, której dziennik udostępniono.',
    configTargetTitle: 'Cele',
    configCribTarget: 'W łóżeczku do',
    configCribHint:
      'Koniec wieczornego rytuału — moment położenia do łóżeczka, a nie moment zaśnięcia.',
    configNote:
      'Rysowany na stronie statystyk: linia w poprzek osi czasu i wykresu położenia do łóżeczka, żeby każdą noc dało się do niego przyłożyć. Nic nie jest według niego liczone ani oceniane i żadna średnia się nie zmienia.',
    configClear: 'Bez celu',
    configSaved: 'Cel usunięty.',
    configSavedAt: 'Zapisano cel: {time}.',
    configErrTime: 'Ustaw godzinę albo usuń cel.',
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
