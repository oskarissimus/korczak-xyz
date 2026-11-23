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

/*
 * Every screen of the game has an address (owner, 23 Nov 2026: "every settings page and the like
 * should have browser routing, and the game in a world too, with the world's id"). Still the hash,
 * since the game is one static page on both hosts and a path would need a fallback on the server:
 * `#worlds`, `#worlds/trash`, `#language`, `#diesel`, `#settings/…`, and `#world/<id>` while a world
 * is played. Opening a screen or a world is a history entry, so the browser's Back closes it.
 */

export const SCREENS = ['library', 'trash', 'language', 'diesel', 'settings'] as const;
export type Screen = (typeof SCREENS)[number];

export type GameRoute =
  | { kind: 'home' }
  | { kind: 'screen'; screen: Screen; settings?: SettingsRoute }
  | { kind: 'world'; id: string };

const SCREEN_HASH: Record<Exclude<Screen, 'settings'>, string> = {
  library: '#worlds',
  trash: '#worlds/trash',
  language: '#language',
  diesel: '#diesel',
};

/** A world's id as the hash carries it: the ids are base-36 words, so anything else is not one. */
const WORLD_ID = /^[a-z0-9-]{1,64}$/;

/** The route a hash names; anything unknown is the home screen. */
export function parseGameHash(hash: string): GameRoute {
  const settings = parseSettingsHash(hash);
  if (settings) return { kind: 'screen', screen: 'settings', settings };
  const clean = hash.startsWith('#') ? hash : `#${hash}`;
  for (const [screen, h] of Object.entries(SCREEN_HASH)) if (clean === h) return { kind: 'screen', screen: screen as Screen };
  const world = /^#world\/(.+)$/.exec(clean);
  if (world) {
    let id = world[1];
    try {
      id = decodeURIComponent(id);
    } catch {
      /* kept as written */
    }
    if (WORLD_ID.test(id)) return { kind: 'world', id };
  }
  return { kind: 'home' };
}

/** The hash for a route; the home screen has none. */
export function gameHash(route: GameRoute): string {
  if (route.kind === 'home') return '';
  if (route.kind === 'world') return `#world/${encodeURIComponent(route.id)}`;
  if (route.screen === 'settings') return settingsHash(route.settings ?? { tab: 'game', admin: 'keys' });
  return SCREEN_HASH[route.screen];
}

/** Whether going from one hash to the other only moves within a screen (a tab), not to another one. */
export function sameScreen(a: string, b: string): boolean {
  const ra = parseGameHash(a);
  const rb = parseGameHash(b);
  if (ra.kind === 'screen' && rb.kind === 'screen') return ra.screen === rb.screen;
  return ra.kind === 'world' && rb.kind === 'world';
}

/** The page's route, read once when the game starts. */
export function gameRouteNow(): GameRoute {
  return typeof location === 'undefined' ? { kind: 'home' } : parseGameHash(location.hash);
}

/** How deep in the game's own history entries this one is (0 for the page as it was opened). */
export function routeDepth(): number {
  try {
    const d = (history.state as { rpgDepth?: unknown } | null)?.rpgDepth;
    return typeof d === 'number' && d > 0 ? d : 0;
  } catch {
    return 0;
  }
}

/** A new history entry for the hash, one deeper than this one, remembering the hash it was opened from. */
export function pushHash(hash: string): void {
  try {
    const url = `${location.pathname}${location.search}${hash}`;
    history.pushState({ ...(history.state ?? {}), rpgDepth: routeDepth() + 1, rpgPrev: location.hash }, '', url);
  } catch {
    /* the screen still opens */
  }
}
