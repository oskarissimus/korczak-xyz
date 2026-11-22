/**
 * The account's API keys inside the game's Settings (owner, 22 Nov 2026: "the admin panel and the
 * keys belong in the settings"), on everyrpg.korczak.xyz. Loaded lazily by `Rpg.tsx` when Settings
 * open signed in, so the provider cards are not in the game's first bundle. Their styles
 * (account.css, rpg-account.css) are imported by the standalone game's pages.
 */
export { SettingsKeys as default } from '../Account/Account';
