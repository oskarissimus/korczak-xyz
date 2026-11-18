/*
 * Who sells Every RPG's diesel, as the legal pages and their footer say it (`components/Rpg/RpgLegal.astro`).
 *
 * The business has no seat and no fixed place of business; its address for service in CEIDG is a
 * virtual office (owner, 18 Nov 2026, from that day). Art. 5 ust. 2 pkt 2 of the e-services act
 * still asks a sole trader for "miejsce zamieszkania i adres" — Paddle being the merchant of record
 * does not lift it, since the game itself is our service — so the pages give the town of residence
 * (`residence`, the town only, never the street) and the virtual office as the correspondence
 * address. The home address appears nowhere on the site. `nip` is shown only once it is set.
 */
export const SELLER = {
  name: 'Oskar Korczak',
  nip: '7981456475' as string | null,
  email: 'oskar.jan.korczak@gmail.com',
  residence: { pl: 'Warszawie', en: 'Warsaw' },
  address: 'Al. Jerozolimskie 109/70, 02-011 Warszawa',
};
