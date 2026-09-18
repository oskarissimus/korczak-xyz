/*
 * What a saved sitting is called, and how it is addressed.
 *
 * THE ID IS ELEVEN CHARACTERS OF BASE64URL, which is a YouTube video id and is that on purpose.
 * It goes in the address bar — `/apps/sloper/?p=Kx3_pQ2mTaV` — and a URL is a thing people paste
 * into a message and read back off a second screen, so its length is a real cost. A v4 UUID is 36
 * characters to say the same thing, and thirty of them are ceremony: the dashes, the version
 * nibble, the variant bits. Eleven characters of a 64-symbol alphabet is 2^66 values, which is
 * four times what a UUID's 122 random bits buy per character and far more than enough for a site
 * where one person makes videos on a weekend.
 *
 * The alphabet is A–Z a–z 0–9 `-` `_`, and the last two are the point of choosing base64URL over
 * base62: both are safe unescaped in a query string, so the id survives being copied, pasted and
 * re-encoded without ever growing a `%`.
 *
 * `crypto.getRandomValues` and `byte & 63`, not `Math.random()`. The mask is uniform because 64
 * divides 256 exactly — the usual modulo bias does not arise and there is nothing to reject. What
 * `Math.random()` would cost is not secrecy, it is collisions: two tabs opened in the same
 * millisecond seed alike in more engines than you would like, and two sittings sharing an id means
 * one of them silently overwrites the other's scenes in Firestore.
 *
 * THE NAME IS TWO WORDS AND IS NOT THE ID. A project needs something a person can pick out of a
 * list, and eleven random characters is the opposite of that. It is generated at mint time, from
 * the same random source, because the alternative — naming a project after its topic — cannot
 * work: the project is minted when the script stage opens, which is *before* a topic has been
 * typed. A name that changes under somebody after they have learnt it is worse than one that
 * never meant anything.
 *
 * The words are English in both locales, for the reason stated at the top of `translations.ts`:
 * a name is a name. "Brisk Lantern" is what this project is called, the way a file is called what
 * it is called, and translating it would make the same project answer to two different names on
 * two devices.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export const PROJECT_ID_LENGTH = 11;

/** The query parameter the id rides in. Short, because it is read aloud off a phone. */
export const PROJECT_PARAM = 'p';

function randomBytes(count: number): Uint8Array {
  const bytes = new Uint8Array(count);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
    return bytes;
  }
  // Server-side rendering only — this module is imported by an island that never mints an id
  // during the build. A number that is merely unlikely to repeat is fine for that.
  for (let i = 0; i < count; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

/** A fresh project id: eleven base64URL characters, uniformly drawn. */
export function newProjectId(): string {
  const bytes = randomBytes(PROJECT_ID_LENGTH);
  let id = '';
  for (let i = 0; i < PROJECT_ID_LENGTH; i += 1) id += ALPHABET[bytes[i] & 63];
  return id;
}

/**
 * Whether a string off the address bar is shaped like one of ours.
 *
 * This is the whole of the validation, and it is worth being strict here rather than at the
 * Firestore call: an id is pasted straight into a document path, and a path segment containing a
 * `/` addresses a different collection entirely.
 */
export function isProjectId(value: unknown): value is string {
  return typeof value === 'string' && new RegExp(`^[A-Za-z0-9_-]{${PROJECT_ID_LENGTH}}$`).test(value);
}

/* Deliberately plain and deliberately concrete. An abstract noun makes a name you cannot picture
   and therefore cannot tell apart from the one above it in the list. */
const ADJECTIVES = [
  'Amber', 'Brisk', 'Calm', 'Copper', 'Crimson', 'Dusty', 'Eager', 'Faint', 'Gentle', 'Glossy',
  'Hollow', 'Idle', 'Jolly', 'Keen', 'Lucid', 'Mellow', 'Nimble', 'Olive', 'Placid', 'Quiet',
  'Rustic', 'Silver', 'Tidy', 'Umber', 'Velvet', 'Wistful', 'Yellow', 'Zesty',
];

const NOUNS = [
  'Anchor', 'Beacon', 'Cargo', 'Dial', 'Ember', 'Ferry', 'Garden', 'Harbour', 'Ink', 'Jetty',
  'Kettle', 'Lantern', 'Meadow', 'Nickel', 'Orchard', 'Pebble', 'Quarry', 'Ribbon', 'Signal',
  'Thistle', 'Umbrella', 'Vessel', 'Willow', 'Yarn',
];

/** A two-word label for a new project. Not unique, and not required to be — the id is. */
export function newProjectName(): string {
  const bytes = randomBytes(2);
  return `${ADJECTIVES[bytes[0] % ADJECTIVES.length]} ${NOUNS[bytes[1] % NOUNS.length]}`;
}
