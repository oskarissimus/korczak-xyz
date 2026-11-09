/*
 * The game's language, any language (owner, 9 Nov 2026: "user language should be guessed,
 * defaulting to English, and the page should autotranslate to that language and it should be
 * persisted; the user should be able to change language in the main menu to any language, and the
 * choice persisted in the browser and in the account").
 *
 * A language is its ISO 639 primary subtag, lower case (`en`, `pl`, `de`, `pt`, `zh`…), and only one
 * on `LANGUAGES`: the list the menu offers, the server translates the interface into
 * (`uiTranslate.ts`), and a stranger's request is checked against. No region: a Brazilian gets `pt`,
 * which keeps one world list, one voice search and one cached interface per language.
 *
 * Two languages are written by hand — English and Polish: the interface tables in
 * `translations.ts`, the hand-written quest, the intro's script, the stage directions. Every other
 * language reads those in English (`base`), while everything a model writes — the world, the quest,
 * the lines spoken — is written in the language itself (`languageName` in each prompt).
 */

export type Lang = string;
/** A language somebody wrote by hand. */
export type BaseLang = 'en' | 'pl';

/**
 * Each language's name in itself, as the menu lists it: written out, since a browser's Intl data
 * may lack a language's own name and quietly answer in the browser's language instead.
 */
const NATIVE: Record<Lang, string> = {
  af: 'Afrikaans',
  am: 'አማርኛ',
  ar: 'العربية',
  az: 'Azərbaycan',
  be: 'Беларуская',
  bg: 'Български',
  bn: 'বাংলা',
  bs: 'Bosanski',
  ca: 'Català',
  cs: 'Čeština',
  cy: 'Cymraeg',
  da: 'Dansk',
  de: 'Deutsch',
  el: 'Ελληνικά',
  en: 'English',
  eo: 'Esperanto',
  es: 'Español',
  et: 'Eesti',
  eu: 'Euskara',
  fa: 'فارسی',
  fi: 'Suomi',
  fil: 'Filipino',
  fr: 'Français',
  ga: 'Gaeilge',
  gl: 'Galego',
  gu: 'ગુજરાતી',
  he: 'עברית',
  hi: 'हिन्दी',
  hr: 'Hrvatski',
  hu: 'Magyar',
  hy: 'Հայերեն',
  id: 'Bahasa Indonesia',
  is: 'Íslenska',
  it: 'Italiano',
  ja: '日本語',
  ka: 'ქართული',
  kk: 'Қазақ',
  km: 'ខ្មែរ',
  kn: 'ಕನ್ನಡ',
  ko: '한국어',
  ky: 'Кыргызча',
  la: 'Latina',
  lo: 'ລາວ',
  lt: 'Lietuvių',
  lv: 'Latviešu',
  mk: 'Македонски',
  ml: 'മലയാളം',
  mn: 'Монгол',
  mr: 'मराठी',
  ms: 'Bahasa Melayu',
  mt: 'Malti',
  my: 'မြန်မာ',
  nb: 'Norsk',
  ne: 'नेपाली',
  nl: 'Nederlands',
  pa: 'ਪੰਜਾਬੀ',
  pl: 'Polski',
  ps: 'پښتو',
  pt: 'Português',
  ro: 'Română',
  ru: 'Русский',
  si: 'සිංහල',
  sk: 'Slovenčina',
  sl: 'Slovenščina',
  sq: 'Shqip',
  sr: 'Српски',
  sv: 'Svenska',
  sw: 'Kiswahili',
  ta: 'தமிழ்',
  te: 'తెలుగు',
  th: 'ไทย',
  tr: 'Türkçe',
  uk: 'Українська',
  ur: 'اردو',
  uz: 'Oʻzbek',
  vi: 'Tiếng Việt',
  zh: '中文',
  zu: 'isiZulu',
};

/**
 * Every language the game can be played in. Gemini and ElevenLabs' multilingual voices both cover
 * these; the list is ISO 639-1 languages with a sizeable written use, not every code there is.
 */
export const LANGUAGES: readonly Lang[] = Object.keys(NATIVE);

const KNOWN = new Set(LANGUAGES);

/** Codes a browser says that mean a language on the list under another name. */
const ALIASES: Record<string, Lang> = { no: 'nb', nn: 'nb', iw: 'he', in: 'id', tl: 'fil' };

/** `value` as a language on the list, or null: `pt-BR` → `pt`, `NO` → `nb`, `xx` → null. */
export function asLang(value: unknown): Lang | null {
  if (typeof value !== 'string') return null;
  const primary = value.trim().toLowerCase().split(/[-_]/)[0];
  const code = ALIASES[primary] ?? primary;
  return KNOWN.has(code) ? code : null;
}

/** `value` as a language on the list, English when it is not one. */
export function normLang(value: unknown): Lang {
  return asLang(value) ?? 'en';
}

/** The hand-written tables a language reads: its own for Polish and English, English for the rest. */
export function base(lang: Lang): BaseLang {
  return lang === 'pl' ? 'pl' : 'en';
}

/** Whether the interface in `lang` is written by hand rather than translated. */
export function handWritten(lang: Lang): boolean {
  return lang === 'en' || lang === 'pl';
}

/** What `toLocaleString` is given for numbers and dates in `lang`. */
export function localeOf(lang: Lang): string {
  return lang === 'en' ? 'en-GB' : lang === 'pl' ? 'pl-PL' : lang;
}

function displayName(lang: Lang, inLang: string): string | null {
  try {
    const name = new Intl.DisplayNames([inLang], { type: 'language' }).of(lang);
    return name && name.toLowerCase() !== lang ? name : null;
  } catch {
    return null;
  }
}

/** The language's English name, as every prompt names it to the model: `de` → German. */
export function languageName(lang: Lang): string {
  if (lang === 'pl') return 'Polish';
  if (lang === 'en') return 'English';
  return displayName(lang, 'en') ?? lang;
}

/** The language's name in itself, as the menu lists it: `de` → Deutsch. */
export function nativeName(lang: Lang): string {
  return NATIVE[lang] ?? languageName(lang);
}

/**
 * The browser's first language that is on the list, English when none is: `navigator.languages`
 * in order (`pl-PL, en-US` → `pl`), then `navigator.language`.
 */
type BrowserLanguages = { languages?: readonly string[]; language?: string } | undefined;

export function guessLang(nav: BrowserLanguages): Lang {
  for (const tag of [...(nav?.languages ?? []), nav?.language]) {
    const lang = asLang(tag);
    if (lang) return lang;
  }
  return 'en';
}

const CHOICE_KEY = 'rpg-lang';

/** The language this browser chose, with when it chose it; null when nothing was ever chosen here. */
export function loadLangChoice(): { lang: Lang; at: number } | null {
  try {
    const raw = JSON.parse(localStorage.getItem(CHOICE_KEY) ?? 'null') as {
      lang?: unknown;
      at?: unknown;
    } | null;
    const lang = asLang(raw?.lang);
    return lang ? { lang, at: Number(raw?.at) || 0 } : null;
  } catch {
    return null;
  }
}

export function storeLangChoice(lang: Lang, at = Date.now()): void {
  try {
    localStorage.setItem(CHOICE_KEY, JSON.stringify({ lang, at }));
  } catch {
    /* a full or blocked store: the guess comes back on the next visit, and the account still has it */
  }
}

/**
 * The language a visit starts in, before the account has answered: what this browser chose, then
 * the language of a quest left half way (somebody mid-quest from before this existed), then the
 * page's own when it is not the English default (`/pl/` is asked for by name), then the browser's.
 */
export function startingLang(
  page: Lang,
  savedQuest: Lang | null,
  nav: BrowserLanguages = typeof navigator === 'undefined' ? undefined : navigator,
): Lang {
  const chosen = loadLangChoice();
  if (chosen) return chosen.lang;
  if (savedQuest && asLang(savedQuest)) return savedQuest;
  if (page !== 'en') return page;
  return guessLang(nav);
}
