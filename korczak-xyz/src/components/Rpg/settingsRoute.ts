/**
 * Where Settings is, in the URL (owner, 23 Nov 2026: "Settings should have tabs like the admin
 * panel, and the admin panel a tab with its own sub-tabs"). Settings are a screen of the game's
 * menu, not a page: `settings`, `settings/story`, `settings/admin/costs` after the game's own
 * path (see *Every screen … has an address* below). A reload or a bookmark opens the same tab, and
 * `/admin/#costs` — the admin panel's own page until that day — forwards here
 * (src-rpg/pages/admin.astro).
 *
 * Inside this module a route is written as a token that looks like a hash (`#settings/story`,
 * `#world/<id>`, '' for the home screen), so that parsing it does not care where it came from;
 * `currentRoute()` reads the token off the address and `routeUrl()` turns it into one.
 *
 * Its own module so that `Rpg.tsx` can read it without pulling the admin panel into the game's
 * first bundle; `AdminPanel.tsx` takes its tab names from here.
 */

export const ADMIN_TABS = ['keys', 'demo', 'diesel', 'accounts', 'costs', 'wallets', 'prices'] as const;
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
  return typeof location === 'undefined' ? null : parseSettingsHash(currentRoute());
}

/*
 * Every screen of the game has an address (owner, 23 Nov 2026: "every settings page and the like
 * should have browser routing, and the game in a world too, with the world's id"), and it is a path,
 * not a hash (owner, the same evening, asked why the addresses had a #): after the game's own page —
 * `/` or `/pl/` on everyrpg.korczak.xyz, `/apps/rpg/` on korczak.xyz — come `worlds`,
 * `worlds/trash`, `language`, `diesel`, `settings/…`, and `world/<id>` while a world is played.
 * The site is static, so the server answers those paths with the game's page by a 200 rewrite in
 * `_redirects` (public-rpg/ and public/); the page then reads the path. The hash addresses of the
 * first evening (`#settings/story`, `#world/<id>`) still open their screen, and the address is
 * rewritten to the path. Opening a screen or a world is a history entry, so the browser's Back
 * closes it.
 */

/** The part of a path that is a route of the game: what follows the game's own page. */
const ROUTE_TAIL = /^(.*?\/)((?:settings|worlds|language|diesel|world)(?:\/[^/]*)*?)\/?$/;

/** The game's page and the route after it, from a path. */
export function splitPath(pathname: string): { base: string; route: string } {
  const m = ROUTE_TAIL.exec(pathname);
  if (m && parseGameHash(`#${m[2]}`).kind !== 'home') return { base: m[1], route: `#${m[2]}` };
  return { base: pathname.endsWith('/') ? pathname : `${pathname}/`, route: '' };
}

/** The route the address names: its path, else an old hash address, else the home screen. */
export function currentRoute(): string {
  if (typeof location === 'undefined') return '';
  const { route } = splitPath(location.pathname);
  if (route) return route;
  return parseGameHash(location.hash).kind === 'home' ? '' : location.hash;
}

/** The address for a route on this page: the game's page and the route as a path, the query kept. */
export function routeUrl(route: string): string {
  const { base } = splitPath(location.pathname);
  const keepHash = parseGameHash(location.hash).kind === 'home' ? location.hash : '';
  return `${base}${route.replace(/^#/, '')}${location.search}${keepHash}`;
}

/** Whether the address already says this route, in its path form. */
export function routeIsCurrent(route: string): boolean {
  try {
    return routeUrl(route) === `${location.pathname}${location.search}${location.hash}`;
  } catch {
    return true;
  }
}

/** Puts the route in the address without a history entry; a refusal (a sandboxed frame) changes nothing. */
export function writeRoute(route: string): void {
  try {
    if (routeIsCurrent(route)) return;
    history.replaceState(history.state, '', routeUrl(route));
  } catch {
    /* the tab still switches */
  }
}

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
  return parseGameHash(currentRoute());
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

/** A new history entry for the route, one deeper than this one, remembering the route it was opened from. */
export function pushRoute(route: string): void {
  try {
    history.pushState({ ...(history.state ?? {}), rpgDepth: routeDepth() + 1, rpgPrev: currentRoute() }, '', routeUrl(route));
  } catch {
    /* the screen still opens */
  }
}
