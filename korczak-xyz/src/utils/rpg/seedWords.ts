/*
 * The dice a world is invented from (`genesis.ts`): unrelated words, and a random Wikipedia title
 * when the network gives one. Not a list of worlds — nobody can read a setting off it — but things,
 * processes, materials and feelings from every corner of life, so that three drawn together are a
 * combination no model reaches for on its own. The model is told to transform them, never to use
 * them literally.
 *
 * English on purpose, whatever the game's language: they are the model's raw material, never shown
 * as the world's text.
 */

export const SEED_WORDS = [
  // things
  'lighthouse', 'bell', 'loom', 'kiln', 'abacus', 'compass', 'umbrella', 'kite', 'mirror', 'hourglass',
  'lantern', 'anchor', 'saddle', 'harp', 'typewriter', 'telescope', 'beehive', 'scarecrow', 'chandelier',
  'music box', 'birdcage', 'weathervane', 'periscope', 'accordion', 'sundial', 'spinning top', 'teapot',
  'prosthetic hand', 'diving helmet', 'snow globe', 'tuning fork', 'carousel', 'gramophone', 'kaleidoscope',
  'pocket watch', 'gondola', 'funicular', 'tram', 'zeppelin', 'submarine', 'canal lock', 'aqueduct',
  'water tower', 'grain silo', 'radio mast', 'observatory dome', 'greenhouse', 'bathhouse', 'library',
  'post office', 'pawnshop', 'tannery', 'brewery', 'mint', 'lighthouse keeper', 'ferry', 'cable car',
  'stilts', 'scaffolding', 'bridge of ropes', 'terraced fields', 'salt pans', 'quarry', 'mine shaft',
  'dam', 'windbreak', 'tide pool', 'reef', 'atoll', 'fjord', 'geyser', 'salt flat', 'sinkhole', 'canyon',
  'glacier', 'iceberg', 'crater', 'volcano vent', 'mangrove', 'peat bog', 'bamboo grove', 'kelp forest',
  'termite mound', 'coral', 'pearl', 'amber', 'obsidian', 'chalk', 'copper', 'tin', 'mercury', 'glass',
  'porcelain', 'lacquer', 'wax', 'tar', 'resin', 'felt', 'silk', 'leather', 'bone', 'ivory', 'ink',
  'indigo dye', 'saffron', 'pepper', 'salt', 'honey', 'vinegar', 'yeast', 'cheese cave', 'sourdough',
  'rice paddy', 'tea plantation', 'orchard', 'vineyard', 'olive press', 'sugar cane', 'cotton', 'flax',
  'wool', 'paper', 'clay', 'bricks', 'cork', 'rubber', 'soap', 'perfume', 'candle', 'fireworks',
  // creatures
  'jellyfish', 'octopus', 'whale song', 'moth', 'firefly', 'locust', 'silkworm', 'ant colony', 'crow',
  'heron', 'owl', 'pigeon post', 'peacock', 'tortoise', 'snail', 'axolotl', 'eel', 'crab', 'barnacle',
  'starfish', 'seahorse', 'manta ray', 'lungfish', 'yak', 'camel caravan', 'reindeer', 'mule', 'goat',
  'beetle', 'spider silk', 'wasp nest', 'bat colony', 'hermit crab', 'lichen', 'moss', 'mycelium',
  'orchid', 'cactus', 'baobab', 'sequoia', 'willow', 'lotus', 'venus flytrap', 'pollen',
  // processes and ideas
  'fermentation', 'distillation', 'erosion', 'migration', 'hibernation', 'moulting', 'pollination',
  'tides', 'eclipse', 'aurora', 'monsoon', 'drought', 'avalanche', 'echo', 'static', 'rust', 'decay',
  'mapmaking', 'bookbinding', 'glassblowing', 'beekeeping', 'cartography', 'taxidermy', 'origami',
  'calligraphy', 'puppetry', 'acrobatics', 'opera', 'chess', 'auction', 'census', 'lottery', 'quarantine',
  'pilgrimage', 'exile', 'debt', 'inheritance', 'dowry', 'apprenticeship', 'strike', 'smuggling', 'tithe',
  'mourning', 'carnival', 'masquerade', 'wedding', 'funeral', 'harvest festival', 'curfew', 'ration book',
  'lost and found', 'translation', 'forgery', 'insurance', 'weather forecast', 'radio broadcast',
  'postal route', 'night shift', 'lullaby', 'sleepwalking', 'dreams', 'amnesia', 'twins', 'mirages',
  'silence', 'gravity', 'magnetism', 'radiation', 'clockwork', 'steam', 'electricity', 'photosynthesis',
  'bioluminescence', 'crystallisation', 'evaporation', 'freezing', 'melting', 'sediment', 'fossils',
  'archaeology', 'genealogy', 'quarantine ship', 'lighthouse code', 'semaphore', 'morse code', 'tattoos',
  'masks', 'perfumers', 'bell ringers', 'cartographers', 'ferrymen', 'lamplighters', 'chimney sweeps',
  'divers', 'miners', 'shepherds', 'tailors', 'clockmakers', 'gravediggers', 'midwives', 'jugglers',
  'monks', 'librarians', 'astronomers', 'salt traders', 'whalers', 'tea merchants', 'pearl divers',
  'ice cutters', 'kite fighters', 'sand sculptors', 'stilt walkers', 'beekeepers', 'puppeteers',
  // feelings and qualities
  'nostalgia', 'jealousy', 'patience', 'shame', 'boredom', 'awe', 'homesickness', 'stubbornness',
  'gratitude', 'grief', 'curiosity', 'politeness', 'thrift', 'vanity', 'hospitality', 'superstition',
  'rivalry', 'loyalty', 'gossip', 'secrecy', 'bureaucracy', 'ceremony', 'routine', 'scarcity', 'abundance',
  'upside down', 'endless stairs', 'very small', 'enormous', 'hollow', 'frozen in time', 'always dusk',
  'underground', 'underwater', 'in orbit', 'on stilts', 'nomadic', 'vertical', 'labyrinth', 'archipelago',
  'one long street', 'inside a shell', 'on a glacier', 'on a moon', 'in the clouds', 'in a crater',
];

export function drawWords(n: number, random: () => number = Math.random): string[] {
  const picked = new Set<string>();
  while (picked.size < n) picked.add(SEED_WORDS[Math.floor(random() * SEED_WORDS.length)]);
  return [...picked];
}

/**
 * One random English Wikipedia article title, or null when the network says no within `ms`. The
 * world's widest die: any subject anybody ever wrote an article about.
 */
export async function wikipediaSeed(ms = 2500): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(
      'https://en.wikipedia.org/w/api.php?action=query&list=random&rnnamespace=0&rnlimit=1&format=json&origin=*',
      { signal: controller.signal },
    );
    if (!response.ok) return null;
    const data = await response.json();
    const title = data?.query?.random?.[0]?.title;
    return typeof title === 'string' && title.length <= 80 ? title : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Three seeds: two words, and a Wikipedia title when one comes (a third word otherwise). */
export async function drawSeeds(random: () => number = Math.random): Promise<string[]> {
  const words = drawWords(3, random);
  const wiki = await wikipediaSeed();
  return wiki ? [words[0], words[1], wiki] : words;
}

/**
 * The words the player picks a world from on the intro screen (`WorldWish` in `Rpg.tsx`; owner, Oct
 * 2026: "a dropdown to pick the seed words, and you can type your own too — hat, sand, revolver makes
 * a Wild West"). Unlike the dice above these are meant to be read together, so they are the ones that
 * point at a world: places, things, creatures, weather, a mood. Shown and sent in the game's
 * language; the model reads both.
 */
export const PICK_GROUPS: { en: string; pl: string; words: [string, string][] }[] = [
  {
    en: 'Places',
    pl: 'Miejsca',
    words: [
      ['desert', 'pustynia'], ['forest', 'las'], ['swamp', 'bagno'], ['mountains', 'góry'], ['steppe', 'step'],
      ['jungle', 'dżungla'], ['islands', 'wyspy'], ['the sea', 'morze'], ['underground', 'podziemia'],
      ['a great city', 'wielkie miasto'], ['a village', 'wioska'], ['a castle', 'zamek'], ['a monastery', 'klasztor'],
      ['a harbour', 'port'], ['ruins', 'ruiny'], ['a glacier', 'lodowiec'], ['a volcano', 'wulkan'],
      ['the Moon', 'Księżyc'], ['a space station', 'stacja kosmiczna'], ['the sky', 'niebo'],
    ],
  },
  {
    en: 'Things',
    pl: 'Rzeczy',
    words: [
      ['hat', 'kapelusz'], ['sand', 'piasek'], ['revolver', 'rewolwer'], ['sword', 'miecz'], ['bow', 'łuk'],
      ['shield', 'tarcza'], ['crown', 'korona'], ['lantern', 'latarnia'], ['compass', 'kompas'], ['mask', 'maska'],
      ['book', 'księga'], ['map', 'mapa'], ['bell', 'dzwon'], ['clock', 'zegar'], ['anchor', 'kotwica'],
      ['sail', 'żagiel'], ['train', 'pociąg'], ['airship', 'sterowiec'], ['robot', 'robot'], ['radio', 'radio'],
      ['gold', 'złoto'], ['salt', 'sól'], ['tea', 'herbata'], ['wine', 'wino'], ['silk', 'jedwab'],
    ],
  },
  {
    en: 'Creatures',
    pl: 'Stworzenia',
    words: [
      ['horse', 'koń'], ['wolf', 'wilk'], ['bear', 'niedźwiedź'], ['raven', 'kruk'], ['snake', 'wąż'],
      ['spider', 'pająk'], ['whale', 'wieloryb'], ['octopus', 'ośmiornica'], ['camel', 'wielbłąd'], ['bees', 'pszczoły'],
      ['dragon', 'smok'], ['ghosts', 'duchy'], ['vampires', 'wampiry'], ['giants', 'olbrzymy'], ['mushrooms', 'grzyby'],
    ],
  },
  {
    en: 'People',
    pl: 'Ludzie',
    words: [
      ['cowboys', 'kowboje'], ['knights', 'rycerze'], ['samurai', 'samuraje'], ['pirates', 'piraci'], ['monks', 'mnisi'],
      ['witches', 'czarownice'], ['nomads', 'koczownicy'], ['merchants', 'kupcy'], ['miners', 'górnicy'],
      ['sailors', 'marynarze'], ['detectives', 'detektywi'], ['smugglers', 'przemytnicy'], ['pilgrims', 'pielgrzymi'],
    ],
  },
  {
    en: 'Weather and time',
    pl: 'Pogoda i czas',
    words: [
      ['snow', 'śnieg'], ['rain', 'deszcz'], ['fog', 'mgła'], ['storm', 'burza'], ['heat', 'upał'], ['ash', 'popiół'],
      ['night', 'noc'], ['dusk', 'zmierzch'], ['eternal winter', 'wieczna zima'], ['autumn', 'jesień'],
      ['an eclipse', 'zaćmienie'], ['the end of the world', 'koniec świata'],
    ],
  },
  {
    en: 'Magic and machines',
    pl: 'Magia i maszyny',
    words: [
      ['magic', 'magia'], ['runes', 'runy'], ['alchemy', 'alchemia'], ['a curse', 'klątwa'], ['gods', 'bogowie'],
      ['steam', 'para'], ['clockwork', 'mechanizmy'], ['electricity', 'elektryczność'], ['computers', 'komputery'],
      ['crystals', 'kryształy'], ['blood', 'krew'], ['dreams', 'sny'],
    ],
  },
  {
    en: 'Mood',
    pl: 'Nastrój',
    words: [
      ['loneliness', 'samotność'], ['adventure', 'przygoda'], ['fear', 'strach'], ['war', 'wojna'], ['plague', 'zaraza'],
      ['a feast', 'uczta'], ['a gold rush', 'gorączka złota'], ['revenge', 'zemsta'], ['mystery', 'tajemnica'],
      ['humour', 'humor'], ['decay', 'rozpad'], ['hope', 'nadzieja'],
    ],
  },
];
