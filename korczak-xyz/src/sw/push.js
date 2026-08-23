/*
 * The pure half of push handling.
 *
 * Inlined into dist/sw.js beside routing.js, not imported — so the worker stays a classic script,
 * which is the safest thing to hand to iOS. The two files therefore share ONE top-level scope:
 * every name here must differ from every name in routing.js, or the concatenation is a SyntaxError
 * that kills the worker for *every* installed app on this origin, songbook included. swBundle.test.js
 * parses the concatenation for exactly that reason.
 *
 * Nothing here touches `self`, `caches` or `clients` — that is sw.template.js's job, and it is what
 * makes this testable at all, there being no jsdom in this project.
 */

/** Shown when a payload arrives that we cannot read at all. Never empty — see parsePushPayload. */
export const PUSH_FALLBACK_TITLE = 'korczak.xyz';
export const PUSH_FALLBACK_BODY = 'Something new is on.';
export const PUSH_FALLBACK_URL = '/apps/events';

/**
 * Turns a raw push payload into something showable. **Total by construction.**
 *
 * There is no input for which the right answer is "show nothing", and that is not politeness: iOS
 * revokes the push subscription if a push event completes without a notification, and it does so
 * silently — the next thing you notice is that notifications stopped working some weeks ago. So a
 * payload that is empty, truncated, not JSON, or written by a build that thought the shape was
 * different still has to come out of here as a title and a body.
 *
 * Understands the Declarative Web Push envelope as well as our own flat shape, because the sender
 * emits both: on Safari 18.4+ the OS renders `notification` itself before this worker runs, and the
 * `push` event is still dispatched, so reading the same fields keeps the two in step.
 */
export function parsePushPayload(text) {
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON. Fall through to the defaults rather than throwing — throwing here costs the
    // subscription.
  }

  // Declarative Web Push nests everything under `notification`; ours is flat. Prefer the nested
  // one when present so a single sender can emit one object for both paths.
  const source =
    data && typeof data === 'object' && data.notification && typeof data.notification === 'object'
      ? data.notification
      : data;

  const pick = (value, fallback) =>
    typeof value === 'string' && value.trim() ? value.trim() : fallback;

  const raw = source && typeof source === 'object' ? source : {};

  return {
    title: clamp(pick(raw.title, PUSH_FALLBACK_TITLE), 120),
    body: clamp(pick(raw.body, PUSH_FALLBACK_BODY), 300),
    // `navigate` is the declarative field name, `url` ours.
    url: sameOriginPath(pick(raw.navigate, pick(raw.url, PUSH_FALLBACK_URL))),
    // The notice id, so a re-send replaces the banner rather than stacking a second one — which is
    // also what keeps the declarative notification and this one from both showing.
    tag: clamp(pick(raw.tag, 'events'), 64),
    kind: clamp(pick(raw.kind, 'announced'), 32),
  };
}

function clamp(value, max) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * Reduces whatever the payload claimed to a same-origin path.
 *
 * A push payload is the one input to this worker that did not come from our own page, so an
 * absolute URL in it must never be able to send a tap to another host. Anything unparseable or
 * off-origin becomes the app's own root.
 */
export function sameOriginPath(value) {
  if (typeof value !== 'string' || !value) return PUSH_FALLBACK_URL;
  // A protocol-relative or absolute URL: only its path is usable, and only if we can read it.
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) {
    try {
      const parsed = new URL(value, 'https://korczak.xyz');
      return parsed.hostname === 'korczak.xyz' ? parsed.pathname + parsed.search : PUSH_FALLBACK_URL;
    } catch {
      return PUSH_FALLBACK_URL;
    }
  }
  return value.startsWith('/') ? value : `/${value}`;
}

/** The second argument to showNotification. */
export function notificationOptions(payload) {
  return {
    body: payload.body,
    tag: payload.tag,
    data: { url: payload.url, kind: payload.kind },
    // Same tag means "replace", but without renotify a replacement arrives silently — and a `soon`
    // reminder that supersedes an `announced` one is worth a buzz.
    renotify: true,
    icon: '/icons/events-192.png',
    badge: '/icons/events-192.png',
  };
}

/**
 * Which installed app a path belongs to, for routing a notification tap.
 *
 * Deliberately generic — it does not name the apps, so it is not a fourth copy of the fact
 * scope.ts, generate-sw.mjs and register-sw.js already state three times. push.test.js imports
 * `appForPath` from scope.ts and asserts the two agree on behaviour rather than on spelling.
 */
export function scopeKeyOf(pathname) {
  if (typeof pathname !== 'string' || !pathname) return '/';
  const path = pathname.replace(/\/+$/, '') || '/';
  const pl = /^\/pl(\/|$)/.test(path);
  const rest = pl ? path.slice(3) || '/' : path;
  const parts = rest.split('/').filter(Boolean);
  if (parts.length === 0) return pl ? '/pl' : '/';
  // An app under /apps/ is two segments deep; everything else is claimed at the first.
  const depth = parts[0] === 'apps' && parts.length > 1 ? 2 : 1;
  return `${pl ? '/pl' : ''}/${parts.slice(0, depth).join('/')}`;
}

/**
 * Which open window to focus for a notification tap, or null to open a new one.
 *
 * An exact path match first, then any window already inside the same app — but never one belonging
 * to a *different* installed app, which on iOS is a live possibility: all five share one service
 * worker registration, so `clients.matchAll` returns the songbook's window as readily as this
 * app's, and focusing that would look like the tap opened the wrong thing.
 */
export function pickClientToFocus(clientUrls, targetUrl) {
  if (!Array.isArray(clientUrls) || clientUrls.length === 0) return null;

  const target = safePath(targetUrl);
  const targetScope = scopeKeyOf(target);

  let sameScope = null;
  for (let i = 0; i < clientUrls.length; i++) {
    const path = safePath(clientUrls[i]);
    if (path === target) return i;
    if (sameScope === null && scopeKeyOf(path) === targetScope) sameScope = i;
  }
  return sameScope;
}

function safePath(value) {
  try {
    return new URL(value, 'https://korczak.xyz').pathname.replace(/\/+$/, '') || '/';
  } catch {
    return '/';
  }
}
