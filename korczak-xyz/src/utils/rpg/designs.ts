/**
 * The ten candidate looks for Every RPG (owner, 9 Nov 2026: "design overhaul … z duszą, przyjemny,
 * zapraszający, nie za dużo szczegółów na raz, szczególnie na ekranie startowym, i design
 * guidelines, żeby cały UI był spójny. 10 wariantów, wybiorę jeden").
 *
 * A look is a `data-rpg-design` attribute on <html> and a block of tokens in
 * `styles/rpg-designs.css`. Without the attribute nothing changes: the game in production is drawn
 * exactly as before until one of these is picked. `?design=<id>` (or its number) turns one on and
 * remembers it in this browser; `?design=off` turns it off. `/designs/` on everyrpg.korczak.xyz
 * shows every screen in each of them, with the guidelines below.
 *
 * Once one is picked it stops being an option: its tokens become the game's defaults and this file,
 * the switcher and the other nine blocks go.
 */

export type DesignId =
  | 'ognisko'
  | 'pergamin'
  | 'runa'
  | 'zmierzch'
  | 'gaj'
  | 'kronika'
  | 'witraz'
  | 'piksel'
  | 'mgla'
  | 'kuznia';

type Text = { en: string; pl: string };

export interface Design {
  id: DesignId;
  name: Text;
  /** One line: what it should feel like. */
  mood: Text;
  /** Fonts, display first. */
  fonts: string[];
  /** Five colours for the swatch strip: background, surface, text, accent, decision. */
  swatches: string[];
  /** The rules that make every screen of this look one look. */
  rules: { en: string[]; pl: string[] };
}

export const DESIGNS: Design[] = [
  {
    id: 'ognisko',
    name: { en: 'Hearth', pl: 'Ognisko' },
    mood: {
      en: 'A warm tavern at night: embers, wood and soft light. Cosy, never grim.',
      pl: 'Ciepła karczma nocą: żar, drewno i miękkie światło. Przytulnie, nigdy ponuro.',
    },
    fonts: ['Alegreya'],
    swatches: ['#120a05', '#2a170c', '#f6e7cf', '#ffb562', '#ff8a4c'],
    rules: {
      en: [
        'Every panel is the same warm, rounded, slightly translucent slab (radius 14) — dialogue, journal, cards and sign-in alike.',
        'Ember orange is light, not decoration: only the primary action, the speaker, the objective and decisions glow.',
        'Alegreya everywhere; headings in small caps, never all-caps shouting.',
        'Light comes from below: the start screen is darkened at the top and lit by a low glow at the foot.',
        'Motion is a slow flicker on the title only; nothing else moves on its own.',
      ],
      pl: [
        'Każdy panel to ta sama ciepła, zaokrąglona, lekko prześwitująca płyta (promień 14) — dialog, dziennik, karty i logowanie.',
        'Pomarańcz żaru to światło, nie ozdoba: świeci tylko główna akcja, imię mówiącego, cel i decyzje.',
        'Alegreya wszędzie; nagłówki kapitalikami, nigdy krzykliwe wersaliki.',
        'Światło idzie od dołu: ekran startowy jest przyciemniony u góry i rozświetlony nisko, jak od ogniska.',
        'Ruch to tylko powolne migotanie tytułu; nic innego nie rusza się samo.',
      ],
    },
  },
  {
    id: 'pergamin',
    name: { en: 'Parchment', pl: 'Pergamin' },
    mood: {
      en: 'An illuminated manuscript laid over the world: cream pages, ink and a red rubric.',
      pl: 'Iluminowany rękopis położony na świecie: kremowe karty, atrament i czerwona rubryka.',
    },
    fonts: ['EB Garamond'],
    swatches: ['#1a140c', '#efe2c2', '#2b1d10', '#8e2a1c', '#b5481e'],
    rules: {
      en: [
        'Panels are pages: light parchment with dark ink and a thin double rule — the only look where text is dark on light.',
        'Rubric red marks what matters: the speaker, decisions, the primary action. Gold only on the dark scene.',
        'EB Garamond with real small caps for headings; the first letter of every spoken line is a drop capital.',
        'Corners are almost square (radius 3): a page, not a pill.',
        'Text that sits straight on the scene (title, compass) is cream with a dark halo, never parchment-coloured boxes everywhere.',
      ],
      pl: [
        'Panele to karty: jasny pergamin, ciemny atrament i cienka podwójna linia — jedyny wariant z ciemnym tekstem na jasnym.',
        'Czerwień rubryki oznacza to, co ważne: mówiącego, decyzje, główną akcję. Złoto tylko na ciemnej scenie.',
        'EB Garamond z prawdziwymi kapitalikami w nagłówkach; pierwsza litera każdej kwestii to inicjał.',
        'Rogi prawie proste (promień 3): karta, nie pigułka.',
        'Tekst prosto na scenie (tytuł, kompas) jest kremowy z ciemną poświatą.',
      ],
    },
  },
  {
    id: 'runa',
    name: { en: 'Rune', pl: 'Runa' },
    mood: {
      en: 'Carved stone under a northern sky: cold slate, frost and one line of gold.',
      pl: 'Kamień rzeźbiony pod północnym niebem: zimny łupek, szron i jedna linia złota.',
    },
    fonts: ['Cinzel', 'Marcellus'],
    swatches: ['#0b1014', '#18222b', '#e4ecf1', '#a9d8ff', '#ffd27a'],
    rules: {
      en: [
        'Every box has its corners cut (8px chamfers): buttons, panels and cards are hewn, not rounded.',
        'Cinzel for anything that is a name or a heading, tracked wide; Marcellus for reading.',
        'Frost blue is the accent; gold is reserved for decisions — the one warm thing on the screen.',
        'Surfaces are slate with a frosted inner edge; no drop shadows, the stone sits flat.',
        'The start screen is a monument: a wide-tracked title, one primary slab, the rest as quiet runes underneath.',
      ],
      pl: [
        'Każde pudełko ma ścięte rogi (8px): przyciski, panele i karty są ciosane, nie zaokrąglone.',
        'Cinzel dla nazw i nagłówków, z szerokim światłem; Marcellus do czytania.',
        'Szronowy błękit to akcent; złoto tylko dla decyzji — jedyna ciepła rzecz na ekranie.',
        'Powierzchnie to łupek z oszronioną wewnętrzną krawędzią; bez cieni, kamień leży płasko.',
        'Ekran startowy jak pomnik: szeroko rozstrzelony tytuł, jedna główna płyta, reszta cicho pod spodem.',
      ],
    },
  },
  {
    id: 'zmierzch',
    name: { en: 'Dusk', pl: 'Zmierzch' },
    mood: {
      en: 'The blue hour: violet glass, moonlight and a lot of air. Dreamy and light.',
      pl: 'Niebieska godzina: fioletowe szkło, światło księżyca i dużo powietrza. Marzycielsko i lekko.',
    },
    fonts: ['Cormorant Garamond'],
    swatches: ['#0d0a1f', '#251f45', '#ece8ff', '#c9b8ff', '#ffc6a8'],
    rules: {
      en: [
        'Frosted glass everywhere: violet surfaces, strong blur, a hairline of light on the edge.',
        'Buttons are pills; panels are soft (radius 18). Nothing has a hard corner.',
        'Cormorant Garamond, set a size larger than the others, italic for the title and for what is narrated.',
        'Lavender is the accent, peach marks a decision — two cool-warm notes, no third colour.',
        'The scene stays visible behind every panel: the world is the background, the UI floats on it.',
      ],
      pl: [
        'Wszędzie matowe szkło: fioletowe powierzchnie, mocny blur, włoskowata linia światła na krawędzi.',
        'Przyciski to pigułki; panele miękkie (promień 18). Nic nie ma ostrego rogu.',
        'Cormorant Garamond, o stopień większy niż w innych wariantach; kursywa w tytule i w narracji.',
        'Lawenda to akcent, brzoskwinia oznacza decyzję — dwie nuty, bez trzeciego koloru.',
        'Scena prześwituje za każdym panelem: świat jest tłem, UI na nim pływa.',
      ],
    },
  },
  {
    id: 'gaj',
    name: { en: 'Grove', pl: 'Gaj' },
    mood: {
      en: 'Slavic folk: deep forest green, embroidery stitches and a paper-cut ornament.',
      pl: 'Słowiański folk: głęboka zieleń lasu, ściegi haftu i ornament jak z wycinanki.',
    },
    fonts: ['Lora'],
    swatches: ['#0a140d', '#16291b', '#f4efe0', '#f2c14e', '#e2553f'],
    rules: {
      en: [
        'Every button and panel carries a dashed "stitch" just inside its edge — the thread that ties the look together.',
        'Forest green surfaces, sunflower yellow accent, poppy red for decisions and danger.',
        'Lora, sentence case, generous line height; the title sits on a paper-cut band of red, yellow and green.',
        'Radius 10 for panels, 999 for small tags: friendly, hand-made.',
        'Ornament appears once per screen (under the title, above the dialogue), never on every element.',
      ],
      pl: [
        'Każdy przycisk i panel ma przerywany „ścieg” tuż przy krawędzi — nić, która spina cały wygląd.',
        'Leśna zieleń powierzchni, słonecznikowy żółty akcent, makowa czerwień dla decyzji i zagrożeń.',
        'Lora, zwykła wielkość liter, hojna interlinia; tytuł stoi na pasie wycinanki czerwono-żółto-zielonej.',
        'Promień 10 dla paneli, 999 dla małych etykiet: przyjaźnie, ręcznie robione.',
        'Ornament raz na ekran (pod tytułem, nad dialogiem), nigdy na każdym elemencie.',
      ],
    },
  },
  {
    id: 'kronika',
    name: { en: 'Chronicle', pl: 'Kronika' },
    mood: {
      en: 'The quietest: words on darkness, one gold hairline, nothing that is not needed.',
      pl: 'Najcichszy: słowa na ciemności, jedna złota linia, nic, co niepotrzebne.',
    },
    fonts: ['Spectral'],
    swatches: ['#050505', '#0e0e0d', '#ecebe6', '#d8c08a', '#e6b36a'],
    rules: {
      en: [
        'No boxes on the start screen: entries are words, the primary one framed by two dashes. Boxes appear only where text must sit on the 3D scene.',
        'One gold hairline on top of every panel is the whole ornament.',
        'Spectral Light, wide-tracked small caps for headings, plenty of space between things.',
        'The scene behind menus is darkened almost to black: the menu is a page in the dark, not a sign over a village.',
        'Colour is rare: gold for the primary and the speaker, amber for decisions, everything else in shades of bone.',
      ],
      pl: [
        'Na ekranie startowym nie ma pudełek: pozycje to słowa, główna ujęta w dwie kreski. Pudełka tylko tam, gdzie tekst musi leżeć na scenie 3D.',
        'Jedna złota linia na górze każdego panelu to cały ornament.',
        'Spectral Light, szeroko rozstrzelone kapitaliki w nagłówkach, dużo przestrzeni.',
        'Scena za menu przyciemniona prawie do czerni: menu to strona w ciemności, nie szyld nad wioską.',
        'Kolor rzadko: złoto dla głównej akcji i mówiącego, bursztyn dla decyzji, reszta w odcieniach kości.',
      ],
    },
  },
  {
    id: 'witraz',
    name: { en: 'Stained glass', pl: 'Witraż' },
    mood: {
      en: 'A cathedral window: jewel colours held in black lead, light shining through.',
      pl: 'Okno katedry: klejnotowe kolory w czarnym ołowiu, światło przez nie prześwieca.',
    },
    fonts: ['Cinzel Decorative', 'EB Garamond'],
    swatches: ['#07070c', '#121633', '#f6f0e2', '#f5c542', '#ff6f7d'],
    rules: {
      en: [
        'Thick black "lead" outlines (3px) around every button and panel; the fill is a jewel gradient with a glint at the top.',
        'Ruby for the primary action, sapphire for the rest, emerald for success, gold for text accents.',
        'Buttons are arched: a large radius on top, a small one at the foot, like a window.',
        'Cinzel Decorative for the title and headings only; EB Garamond for every sentence.',
        'A thin rainbow band of the four jewels crowns each panel — the same band everywhere.',
      ],
      pl: [
        'Grube czarne „ołowiane” obrysy (3px) wokół każdego przycisku i panelu; wypełnienie to klejnotowy gradient z odblaskiem u góry.',
        'Rubin dla głównej akcji, szafir dla reszty, szmaragd dla sukcesu, złoto dla akcentów w tekście.',
        'Przyciski są łukowe: duży promień u góry, mały u dołu, jak okno.',
        'Cinzel Decorative tylko w tytule i nagłówkach; EB Garamond w każdym zdaniu.',
        'Cienki pas czterech klejnotów wieńczy każdy panel — wszędzie ten sam.',
      ],
    },
  },
  {
    id: 'piksel',
    name: { en: 'Pixel', pl: 'Piksel' },
    mood: {
      en: 'A 16-bit adventure: blue windows with white frames, a pointing cursor, pixel type.',
      pl: '16-bitowa przygoda: niebieskie okna z białą ramką, kursor-strzałka, pikselowy krój.',
    },
    fonts: ['Pixelify Sans'],
    swatches: ['#05081a', '#1e3a8a', '#ffffff', '#ffe066', '#ff9f43'],
    rules: {
      en: [
        'Every panel is the same window: a navy gradient, a 3px white frame, a dark keyline outside it.',
        'The selected entry gets a ▶ cursor rather than a colour change alone.',
        'Pixelify Sans for everything; no blur, no soft shadows — hard 3px drop shadows only.',
        'Yellow is the accent (names, the primary), orange the decision; white text everywhere else.',
        'Square-ish corners (radius 6) and whole-pixel sizes; nothing animates except the cursor blink.',
      ],
      pl: [
        'Każdy panel to to samo okno: granatowy gradient, biała ramka 3px, ciemna linia na zewnątrz.',
        'Wybrana pozycja dostaje kursor ▶, nie tylko inny kolor.',
        'Pixelify Sans wszędzie; bez rozmyć i miękkich cieni — tylko twarde cienie 3px.',
        'Żółty to akcent (imiona, główna akcja), pomarańczowy to decyzja; poza tym biały tekst.',
        'Prawie kwadratowe rogi (promień 6) i całe piksele; nic się nie rusza poza mruganiem kursora.',
      ],
    },
  },
  {
    id: 'mgla',
    name: { en: 'Mist', pl: 'Mgła' },
    mood: {
      en: 'A modern indie game: clean sans type, frosted grey glass, a white pill to press.',
      pl: 'Współczesna gra indie: czysty bezszeryfowy krój, matowe szare szkło, biała pigułka do naciśnięcia.',
    },
    fonts: ['Manrope'],
    swatches: ['#0b0c0d', '#1c1f21', '#f3f5f4', '#9fe3c8', '#ffd08a'],
    rules: {
      en: [
        'The primary action is a solid white pill with dark text; everything else is glass.',
        'Manrope: heavy and tight for the title, medium for buttons, regular for reading. No serifs anywhere.',
        'Grey frosted glass with a 1px light edge and radius 16; the scene stays sharp behind it.',
        'Mint is the only accent, a soft amber marks decisions.',
        'Lowercase-friendly, sentence case, no letter-spacing tricks: it should read like a well-made app.',
      ],
      pl: [
        'Główna akcja to pełna biała pigułka z ciemnym tekstem; wszystko inne to szkło.',
        'Manrope: gruby i ciasny w tytule, średni w przyciskach, zwykły do czytania. Zero szeryfów.',
        'Szare matowe szkło z jasną krawędzią 1px i promieniem 16; scena zostaje ostra za nim.',
        'Mięta to jedyny akcent, miękki bursztyn oznacza decyzje.',
        'Zwykła wielkość liter, bez sztuczek z rozstrzeleniem: ma się czytać jak dobrze zrobiona aplikacja.',
      ],
    },
  },
  {
    id: 'kuznia',
    name: { en: 'Forge', pl: 'Kuźnia' },
    mood: {
      en: 'Iron and fire: brushed dark metal, rivets and molten orange. Heavy and sure.',
      pl: 'Żelazo i ogień: szczotkowany ciemny metal, nity i roztopiony pomarańcz. Ciężko i pewnie.',
    },
    fonts: ['Barlow Condensed'],
    swatches: ['#0c0c0d', '#222326', '#e9e6e1', '#ff7a1a', '#ffb347'],
    rules: {
      en: [
        'Panels are iron plates: a brushed gradient, a 2px steel edge and a rivet in each corner.',
        'Barlow Condensed in capitals for anything you press or any heading; regular case for reading.',
        'Molten orange is heat: it lights the primary action, the speaker and decisions, and glows on hover.',
        'Corners are nearly square (radius 2); shadows are deep and short.',
        'The title is forged metal — a steel gradient in the letters, an ember glow behind them.',
      ],
      pl: [
        'Panele to żelazne płyty: szczotkowany gradient, stalowa krawędź 2px i nit w każdym rogu.',
        'Barlow Condensed wersalikami we wszystkim, co się naciska, i w nagłówkach; zwykła wielkość do czytania.',
        'Roztopiony pomarańcz to żar: świeci główna akcja, mówiący i decyzje, i rozżarza się pod kursorem.',
        'Rogi prawie proste (promień 2); cienie głębokie i krótkie.',
        'Tytuł jest kuty — stalowy gradient w literach, żar za nimi.',
      ],
    },
  },
];

/** The rules every one of the ten keeps, whichever is picked. */
export const SHARED_RULES: { en: string[]; pl: string[] } = {
  en: [
    'One primary action per screen. On the start screen that is Continue, or Start / New quest when there is nothing to continue.',
    'The start screen shows a title, at most three full-width entries and one quiet row (language, settings, controls). Sub-lines are dimmed; numbers and model names stay in the ~ console.',
    'Every panel — dialogue, journal, notices, cards, sign-in — is the same surface: one background, one edge, one radius.',
    'The accent colour marks only: the primary action, who is speaking, the current objective and decisions. If everything glows, nothing does.',
    'State is never colour alone: ◆ ✓ ⏳ ✗ and the words stay in every look.',
    'Text on the 3D scene always has its own surface or a dark halo; body text reaches at least 4.5:1 contrast.',
    'The developer console under ~ keeps its monospace and is the same in every look.',
  ],
  pl: [
    'Jedna główna akcja na ekran. Na starcie to Kontynuuj, a gdy nie ma czego kontynuować — Start / Nowy quest.',
    'Ekran startowy: tytuł, najwyżej trzy szerokie pozycje i jeden cichy rząd (język, ustawienia, sterowanie). Podpisy przygaszone; liczby i nazwy modeli zostają w konsoli ~.',
    'Każdy panel — dialog, dziennik, komunikaty, karty, logowanie — to ta sama powierzchnia: jedno tło, jedna krawędź, jeden promień.',
    'Kolor akcentu oznacza tylko: główną akcję, kto mówi, bieżący cel i decyzje. Jeśli świeci wszystko, nie świeci nic.',
    'Stan nigdy samym kolorem: ◆ ✓ ⏳ ✗ i słowa zostają w każdym wariancie.',
    'Tekst na scenie 3D zawsze ma swoją powierzchnię albo ciemną poświatę; tekst do czytania ma kontrast co najmniej 4,5:1.',
    'Konsola deweloperska pod ~ zostaje monospace i jest taka sama w każdym wariancie.',
  ],
};

export const DESIGN_IDS = DESIGNS.map((d) => d.id);
export const DESIGN_STORAGE_KEY = 'rpg-design';
