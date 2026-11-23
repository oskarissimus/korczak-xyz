/**
 * Where Settings is, in the URL (owner, 23 Nov 2026: "Settings should have tabs like the admin
 * panel, and the admin panel a tab with its own sub-tabs"). Settings are a screen of the game's
 * menu, not a page, so the address is the hash: `#settings`, `#settings/story`,
 * `#settings/admin/costs`. A reload or a bookmark opens the same tab, and `/admin/#costs` — the
 * admin panel's own page until that day — forwards here (src-rpg/pages/admin.astro).
 *
 * Its own module so that `Rpg.tsx` can read it without pulling the admin panel into the game's
 * first bundle; `AdminPanel.tsx` takes its tab names from here.
 */

export const ADMIN_TABS = ['keys', 'demo', 'diesel', 'costs', 'wallets', 'prices'] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];

export const SETTINGS_TABS = ['game', 'story', 'account', 'controls', 'admin'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export interface SettingsRoute {
  tab: SettingsTab;
  admin: AdminTab;
}

/** The route a hash names, or null when it is not one of Settings. */
export function parseSettingsHash(hash: string): SettingsRoute | null {
  const [head, tab, sub] = hash.replace(/^#/, '').split('/');
  if (head !== 'settings') return null;
  return {
    tab: (SETTINGS_TABS as readonly string[]).includes(tab) ? (tab as SettingsTab) : 'game',
    admin: (ADMIN_TABS as readonly string[]).includes(sub) ? (sub as AdminTab) : 'keys',
  };
}

/** The hash for a route: the admin's sub-tab only on the admin's tab. */
export function settingsHash({ tab, admin }: SettingsRoute): string {
  return tab === 'admin' ? `#settings/admin/${admin}` : `#settings/${tab}`;
}

/** The current page's route, read once when the game starts. */
export function settingsRouteNow(): SettingsRoute | null {
  return typeof location === 'undefined' ? null : parseSettingsHash(location.hash);
}

/** Puts the hash in the address without a history entry or a jump; a refusal (a sandboxed frame) changes nothing. */
export function writeHash(hash: string): void {
  try {
    if (location.hash === hash || (!hash && !location.hash)) return;
    history.replaceState(history.state, '', `${location.pathname}${location.search}${hash}`);
  } catch {
    /* the tab still switches */
  }
}
