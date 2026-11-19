/*
 * Who sells Every RPG's diesel, as the legal pages and their footer say it (`components/Rpg/RpgLegal.astro`).
 *
 * The business has no seat and no fixed place of business; its address for service in CEIDG is a
 * virtual office (owner, 18 Nov 2026, from that day), and the pages give that as the
 * correspondence address and nothing more. Art. 5 ust. 2 pkt 2 of the e-services act reads
 * "miejsce zamieszkania i adres" for a sole trader; the owner chose (18 Nov 2026) to leave the town
 * of residence out, knowing that. The home address appears nowhere on the site. `nip` is shown
 * only once it is set.
 */
export const SELLER = {
  name: 'Oskar Korczak',
  nip: '7981456475' as string | null,
  email: 'contact@korczak.xyz',
  address: 'Al. Jerozolimskie 109/70, 02-011 Warszawa',
};
