/*
 * Who sells Every RPG's diesel, as the legal pages and their footer say it (`components/Rpg/RpgLegal.astro`).
 *
 * No address, on purpose (owner, 15 Nov 2026: the business has no seat of its own, only an address
 * registered for VAT that is not one). Paddle is the merchant of record, so the seller a buyer's
 * consumer rights are owed by is Paddle, whose address is on every receipt; what the game's own
 * pages owe is who runs it and how to reach them. `nip` is shown only once it is set.
 */
export const SELLER = {
  name: 'Oskar Korczak',
  nip: null as string | null,
  email: 'oskar.jan.korczak@gmail.com',
};
