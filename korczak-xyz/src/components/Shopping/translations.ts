/*
 * Strings for the shopping list, kept beside the app the way the sleep log and the trainers keep
 * theirs — there are too many of them, and they are too specific, to belong in the site-wide table.
 * The app's name and one-line description do live there, because the apps index shows them.
 *
 * `fill` and `localeOf` are re-exported from the sleep log's table rather than copied: they are a few
 * lines of string handling that know nothing about either app, and two copies drifting is how one of
 * them ends up not substituting a placeholder.
 */

export { fill, localeOf } from '../BabySleep/translations';

export type Lang = 'en' | 'pl';

export const translations = {
  en: {
    // Tabs
    navLabel: 'Shopping list sections',
    navList: 'List',
    navShare: 'Share',

    // Adding
    addLabel: 'What to buy',
    addPlaceholder: 'Milk',
    noteLabel: 'How much',
    notePlaceholder: '2 l',
    addButton: 'Add',
    addedNotice: '{name} added.',
    readdedNotice: '{name} is back on the list.',
    alreadyNotice: '{name} is already on the list.',
    errEmpty: 'Type what to buy first.',
    suggestTitle: 'Bought before',
    suggestHint: 'Tap to put one back on the list.',

    // The list
    todoTitle: 'To buy',
    todoEmpty: 'Nothing on the list. Add the first thing above.',
    // Bare numbers: the heading right beside it already says which half this is, and
    // "To buy — 3 to buy" is the kind of label nobody reads twice.
    todoCount: '{count}',
    doneTitle: 'In the basket',
    doneCount: '{count}',
    clearDone: 'Clear bought',
    // The one thing on this screen that loses work, so it asks first.
    clearDoneConfirm: 'Remove {count} bought items from the list?',
    markBought: 'Mark {name} as bought',
    markNotBought: 'Put {name} back on the list',
    addedBy: 'added by {who}',

    // Editing one line
    edit: 'Edit',
    editTitle: 'Edit item',
    save: 'Save',
    cancel: 'Cancel',
    remove: 'Remove',

    // Sync
    syncSignedOut: 'Kept on this device. Sign in to share it and keep it in sync.',
    syncPending: '{count} not sent yet',
    syncSynced: 'Synced',
    syncError: 'Could not sync',
    syncRetry: 'Try again',
    offlineNote:
      'Everything works with no signal — the shop basement is the point. Ticks are sent as soon as there is a connection.',

    // Sharing. A near-copy of the sleep log's, because the two tabs answer the same questions, with
    // the one addition that matters: the grant is the household's and covers both apps.
    shareTitle: 'Share this list',
    shareIntro:
      'Anyone you share with signs in with their own account and sees the same list — the same lines, the same ticks. Either of you can add, tick off and clear.',
    shareScope:
      'One grant per person, for the household rather than for one app: the same people also see the baby sleep log, and revoking here takes both away.',
    shareUnavailable:
      'Accounts are not configured on this build, so there is nothing to share the list with. It is still kept on this device.',
    shareSignedOutTitle: 'Sign in to share',
    shareSignedOutBody:
      'Sharing works between accounts, so the list has to be on an account before it can be shared. Signing in also syncs it to your other devices.',
    shareSignIn: 'Sign in',
    shareAddLabel: 'Email address',
    shareAddButton: 'Share',
    shareAddHint:
      'The address they sign in with. An account has to exist for it already — this does not send an invitation.',
    shareListTitle: 'Shared with',
    shareEmpty: 'Not shared with anyone yet.',
    shareRevoke: 'Revoke',
    shareRevoked: 'Access removed.',
    shareAdded: '{email} can now open this list.',
    shareSince: 'since {date}',
    shareErrEmpty: 'Enter an email address.',
    shareErrMalformed: 'That does not look like an email address.',
    shareErrTooLong: 'That address is too long.',
    shareErrSelf: 'That is your own address — you already have access.',
    shareErrFailed: 'Could not save the share. Check your connection and try again.',
    shareGuestTitle: "You are writing to {owner}'s list",
    shareGuestBody:
      'Everything you add here goes to their list, and everything they add appears here. Only they can change who it is shared with.',
    shareOwnerUnknown: 'another account',
    shareUnresolvedTitle: 'Could not tell whose list this is',
    shareUnresolvedBody:
      'The list is still working on this device and nothing has been lost, but it is not syncing until this is settled.',
    shareRetry: 'Try again',
    shareWorking: 'Saving…',
  },
  pl: {
    // Tabs
    navLabel: 'Sekcje listy zakupów',
    navList: 'Lista',
    navShare: 'Udostępnianie',

    // Adding
    addLabel: 'Co kupić',
    addPlaceholder: 'Mleko',
    noteLabel: 'Ile',
    notePlaceholder: '2 l',
    addButton: 'Dodaj',
    addedNotice: 'Dodano: {name}.',
    readdedNotice: '{name} wraca na listę.',
    alreadyNotice: '{name} jest już na liście.',
    errEmpty: 'Najpierw wpisz, co kupić.',
    suggestTitle: 'Kupowane wcześniej',
    suggestHint: 'Dotknij, żeby wrócił na listę.',

    // The list
    todoTitle: 'Do kupienia',
    todoEmpty: 'Lista jest pusta. Dodaj pierwszą rzecz powyżej.',
    todoCount: '{count}',
    doneTitle: 'W koszyku',
    doneCount: '{count}',
    clearDone: 'Wyczyść kupione',
    clearDoneConfirm: 'Usunąć z listy kupione rzeczy ({count})?',
    markBought: 'Oznacz {name} jako kupione',
    markNotBought: 'Przywróć {name} na listę',
    addedBy: 'dodał(a) {who}',

    // Editing one line
    edit: 'Zmień',
    editTitle: 'Zmiana pozycji',
    save: 'Zapisz',
    cancel: 'Anuluj',
    remove: 'Usuń',

    // Sync
    syncSignedOut: 'Trzymane na tym urządzeniu. Zaloguj się, żeby udostępnić i synchronizować.',
    syncPending: 'niewysłane: {count}',
    syncSynced: 'Zsynchronizowano',
    syncError: 'Nie udało się zsynchronizować',
    syncRetry: 'Spróbuj ponownie',
    offlineNote:
      'Wszystko działa bez zasięgu — o to właśnie chodzi w sklepie w podziemiach. Odhaczenia wysyłają się, gdy tylko wróci połączenie.',

    // Sharing
    shareTitle: 'Udostępnij tę listę',
    shareIntro:
      'Osoba, której udostępnisz listę, loguje się na własne konto i widzi tę samą listę — te same pozycje i te same odhaczenia. Każde z was może dodawać, odhaczać i czyścić.',
    shareScope:
      'Jeden dostęp na osobę, dla domu, a nie dla pojedynczej aplikacji: te same osoby widzą też dziennik snu dziecka, a odebranie dostępu tutaj zabiera jedno i drugie.',
    shareUnavailable:
      'W tej wersji konta nie są skonfigurowane, więc nie ma komu udostępnić listy. Nadal jest zapisana na tym urządzeniu.',
    shareSignedOutTitle: 'Zaloguj się, aby udostępnić',
    shareSignedOutBody:
      'Udostępnianie działa między kontami, więc lista musi najpierw trafić na konto. Logowanie synchronizuje ją też z twoimi innymi urządzeniami.',
    shareSignIn: 'Zaloguj się',
    shareAddLabel: 'Adres e-mail',
    shareAddButton: 'Udostępnij',
    shareAddHint:
      'Adres, którym ta osoba się loguje. Konto musi już istnieć — to nie wysyła zaproszenia.',
    shareListTitle: 'Udostępniono',
    shareEmpty: 'Nikomu jeszcze nie udostępniono.',
    shareRevoke: 'Odbierz dostęp',
    shareRevoked: 'Dostęp odebrany.',
    shareAdded: '{email} może teraz otworzyć tę listę.',
    shareSince: 'od {date}',
    shareErrEmpty: 'Podaj adres e-mail.',
    shareErrMalformed: 'To nie wygląda na adres e-mail.',
    shareErrTooLong: 'Ten adres jest za długi.',
    shareErrSelf: 'To twój własny adres — masz już dostęp.',
    shareErrFailed: 'Nie udało się zapisać. Sprawdź połączenie i spróbuj ponownie.',
    shareGuestTitle: 'Piszesz do listy, której właścicielem jest {owner}',
    shareGuestBody:
      'Wszystko, co tu dodasz, trafia na ich listę, a wszystko, co oni dodadzą, pojawia się tutaj. Tylko oni mogą zmieniać, komu lista jest udostępniona.',
    shareOwnerUnknown: 'inne konto',
    shareUnresolvedTitle: 'Nie udało się ustalić, czyja to lista',
    shareUnresolvedBody:
      'Lista nadal działa na tym urządzeniu i nic nie zginęło, ale nie synchronizuje się, dopóki to się nie wyjaśni.',
    shareRetry: 'Spróbuj ponownie',
    shareWorking: 'Zapisywanie…',
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
