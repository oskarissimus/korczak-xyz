/*
 * The account page's strings. Kept beside the component, as the apps keep theirs: they are read by
 * nothing else, and two locales of one page sit better together than scattered through the site's
 * shared table.
 */

export type Lang = 'en' | 'pl';

const en = {
  checking: 'Checking…',
  signedOut: 'Sign in to see your API keys.',
  signIn: 'Sign in',
  signedInAs: 'Signed in as',
  refresh: 'Check again',

  keysTitle: 'API keys',
  keysBlurb:
    'One copy of each key, shared by every app on the site: a key typed here, or in any app, is ' +
    'the one they all use, and clearing it here clears it everywhere. Kept in this browser and in ' +
    'your account, readable by you alone. The numbers come straight from each provider, with the ' +
    'key itself; where a provider does not say, this page says so instead of guessing.',
  syncLocal: 'This browser only',
  syncSyncing: 'Checking the account…',
  syncSynced: 'Saved to your account',
  syncError: 'Not saved to the account — still in this browser. The next edit tries again.',

  key: 'Key',
  show: 'Show',
  hide: 'Hide',
  clear: 'Clear',
  clearConfirm: 'Clear this key? Every app that uses it stops working until you add one again.',
  noKey: 'no key',
  works: 'works',
  refused: 'refused',
  unreachable: 'could not check',
  usedBy: 'Used by, as set up now',
  usedByNone: 'nothing at the moment',
  spent: 'Spent',
  spentMonth: 'Spent this month',
  spentSince: 'spent since',
  left: 'Left',
  of: 'of',
  chars: 'characters',
  plan: 'plan',
  resets: 'resets',

  googleNoApi: 'Google has no API that reports spend for an AI Studio key.',
  googleFreeTier:
    'On the free tier there is no money to run out of — only per-minute and per-day request limits.',
  googleUsageLink: 'Usage and limits in AI Studio',

  elevenLabsPermission:
    'If the key works in the apps but is refused here, it lacks the “User: read” permission, which ' +
    'is what reports the character count. Add it to the key in ElevenLabs.',

  deepseekNoSpend: 'DeepSeek reports the balance, not what was spent:',
  deepseekGranted: 'of which granted',
  deepseekEmpty: 'Balance too low to make calls',

  openaiNeedsAdmin: 'Needs an admin key (below) — an ordinary key cannot read spend.',
  adminRefused: 'The admin key was refused',
  openaiNoBalanceApi:
    'OpenAI has no API for the prepaid balance. Type it in below from the billing page and this ' +
    'subtracts what has been spent since.',
  creditAsOf: 'as of',
  creditNoSubtract: 'add an admin key to subtract what was spent since',
  openaiBillingTitle: 'Spend and balance',
  openaiBillingBlurb:
    'An admin key (sk-admin-…) can read the organisation’s costs and nothing is spent with it. ' +
    'The balance is what the billing page shows on the day you type it.',
  adminKey: 'Admin key (reads costs only)',
  creditLabel: 'Balance on the billing page',
  openaiBillingLink: 'Billing page',
  openaiAdminLink: 'Admin keys',

  appsTitle: 'Which provider each app uses',
  appsBlurb:
    'Each app chooses its own provider, in its own settings, where the models go with it. Here is ' +
    'what each is set to now.',
  appSloper: 'Video Generation Wizard',
  appBackseat: 'Annoying Passenger Simulator',
  appRoaster: 'Roaster',
  appAudioGuide: 'Audio Guide',
  appEvents: 'Event Watch',
  appTransit: 'Metro Watch',
  roleScript: 'Script',
  roleImages: 'Pictures',
  roleVoice: 'Voice',
  roleEyes: 'Eyes',
  roleWriter: 'Written by',
  deviceVoice: 'The phone’s own voice (no key)',
  changeInApp: 'Change it in the app',
  serverTitle: 'Run by the site, not your keys',
  serverBlurb:
    'These read the news on a schedule on the site’s own Google Cloud project. They spend none ' +
    'of your keys and have no provider to choose.',
  serverEvents: 'Gemini 2.5 Flash-Lite on Vertex AI, plus the site’s Ticketmaster key',
  serverTransit: 'Gemini 2.5 Flash-Lite on Vertex AI',
};

export type Translation = typeof en;

const pl: Translation = {
  checking: 'Sprawdzam…',
  signedOut: 'Zaloguj się, żeby zobaczyć swoje klucze API.',
  signIn: 'Zaloguj',
  signedInAs: 'Zalogowano jako',
  refresh: 'Sprawdź ponownie',

  keysTitle: 'Klucze API',
  keysBlurb:
    'Jedna kopia każdego klucza, wspólna dla wszystkich aplikacji na stronie: klucz wpisany tutaj ' +
    'albo w dowolnej aplikacji jest tym, którego używają wszystkie, a wyczyszczenie go tutaj ' +
    'czyści go wszędzie. Trzymane w tej przeglądarce i na twoim koncie, widoczne tylko dla ciebie. ' +
    'Liczby pochodzą prosto od dostawców, z użyciem tego klucza; gdy dostawca czegoś nie podaje, ' +
    'strona to mówi zamiast zgadywać.',
  syncLocal: 'Tylko ta przeglądarka',
  syncSyncing: 'Sprawdzam konto…',
  syncSynced: 'Zapisane na koncie',
  syncError: 'Niezapisane na koncie — zostają w tej przeglądarce. Następna zmiana spróbuje ponownie.',

  key: 'Klucz',
  show: 'Pokaż',
  hide: 'Ukryj',
  clear: 'Wyczyść',
  clearConfirm: 'Wyczyścić ten klucz? Każda aplikacja, która go używa, przestanie działać, dopóki nie dodasz nowego.',
  noKey: 'brak klucza',
  works: 'działa',
  refused: 'odrzucony',
  unreachable: 'nie udało się sprawdzić',
  usedBy: 'Używają, wg obecnych ustawień',
  usedByNone: 'na razie nic',
  spent: 'Wydano',
  spentMonth: 'Wydano w tym miesiącu',
  spentSince: 'wydane od tego dnia',
  left: 'Zostało',
  of: 'z',
  chars: 'znaków',
  plan: 'plan',
  resets: 'odnowienie',

  googleNoApi: 'Google nie ma API, które podaje wydatki dla klucza AI Studio.',
  googleFreeTier:
    'Na darmowym poziomie nie ma pieniędzy, które mogą się skończyć — są tylko limity zapytań na minutę i na dzień.',
  googleUsageLink: 'Zużycie i limity w AI Studio',

  elevenLabsPermission:
    'Jeśli klucz działa w aplikacjach, a tu jest odrzucany, brakuje mu uprawnienia „User: read”, ' +
    'które podaje liczbę znaków. Dodaj je do klucza w ElevenLabs.',

  deepseekNoSpend: 'DeepSeek podaje saldo, a nie wydatki:',
  deepseekGranted: 'w tym bonus',
  deepseekEmpty: 'Saldo za niskie, żeby wykonywać zapytania',

  openaiNeedsAdmin: 'Potrzebny klucz admina (niżej) — zwykły klucz nie odczyta wydatków.',
  adminRefused: 'Klucz admina został odrzucony',
  openaiNoBalanceApi:
    'OpenAI nie ma API do salda konta. Wpisz je niżej ze strony rozliczeń, a strona odejmie to, ' +
    'co wydano od tego czasu.',
  creditAsOf: 'na dzień',
  creditNoSubtract: 'dodaj klucz admina, żeby odjąć wydatki od tego dnia',
  openaiBillingTitle: 'Wydatki i saldo',
  openaiBillingBlurb:
    'Klucz admina (sk-admin-…) odczytuje koszty organizacji i nic się nim nie wydaje. Saldo to ' +
    'kwota ze strony rozliczeń z dnia, w którym ją wpiszesz.',
  adminKey: 'Klucz admina (tylko odczyt kosztów)',
  creditLabel: 'Saldo ze strony rozliczeń',
  openaiBillingLink: 'Strona rozliczeń',
  openaiAdminLink: 'Klucze admina',

  appsTitle: 'Którego dostawcy używa każda aplikacja',
  appsBlurb:
    'Każda aplikacja wybiera dostawcę u siebie, w swoich ustawieniach, gdzie są też jego modele. ' +
    'Tu widać, na co każda jest teraz ustawiona.',
  appSloper: 'Kreator generowania wideo',
  appBackseat: 'Symulator upierdliwego pasażera',
  appRoaster: 'Roaster',
  appAudioGuide: 'Audioprzewodnik',
  appEvents: 'Na tropie wydarzeń',
  appTransit: 'Metro na oku',
  roleScript: 'Scenariusz',
  roleImages: 'Obrazy',
  roleVoice: 'Głos',
  roleEyes: 'Oczy',
  roleWriter: 'Pisze',
  deviceVoice: 'Głos telefonu (bez klucza)',
  changeInApp: 'Zmień w aplikacji',
  serverTitle: 'Działa na koszt strony, nie twoich kluczy',
  serverBlurb:
    'Te czytają wiadomości według harmonogramu, na własnym projekcie Google Cloud strony. Nie ' +
    'wydają twoich kluczy i nie mają dostawcy do wyboru.',
  serverEvents: 'Gemini 2.5 Flash-Lite na Vertex AI oraz klucz Ticketmaster strony',
  serverTransit: 'Gemini 2.5 Flash-Lite na Vertex AI',
};

export const translations: Record<Lang, Translation> = { en, pl };
