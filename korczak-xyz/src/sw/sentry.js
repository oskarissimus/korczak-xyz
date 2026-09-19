/*
 * Error reporting for the service worker.
 *
 * This posts to Sentry's envelope endpoint by hand rather than importing `@sentry/browser`, and
 * that is not a shortcut - it is the only option that keeps the two properties dist/sw.js is
 * built around. The worker is a **classic script** assembled by concatenating these files, which
 * is the safest thing to hand iOS; importing an npm package would make it a module and put a
 * bundler in the middle of generate-sw.mjs. And the SDK is ~25KB gzipped of DOM-oriented code
 * (breadcrumbs from clicks, history, `window` globals) for a scope that has none of those.
 *
 * What is left once you take that away is a POST of a JSON envelope, which is this file.
 *
 * Events land in the same project as the page, separated by the `context: sw` tag - the same tag
 * src/lib/sentry.ts sets - because a cache failure and the page failure it causes are one story
 * and splitting them across two projects would mean reading them in two places.
 */

/* eslint-disable no-unused-vars -- consumed by sw.template.js after concatenation */

// Parsed out of the DSN in src/lib/sentry.ts. A DSN is a public credential: it can only send
// events to this project, which is exactly what every visitor's browser already does.
const SENTRY_KEY = 'f949f4339b034801d79711536bf73d9d';
const SENTRY_ENVELOPE_URL =
  'https://o4512114964430848.ingest.de.sentry.io/api/4512115029180496/envelope/';

/*
 * A service worker outlives any one page and can be woken for a push at any hour, so an error
 * that repeats on every wake would report forever. These caps are per worker lifetime.
 */
const SENTRY_MAX_EVENTS = 20;
let sentryEventCount = 0;
const sentrySeen = new Set();

function sentryUuid() {
  // The envelope wants 32 hex characters, no dashes.
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '');
  }
  let out = '';
  for (let i = 0; i < 32; i += 1) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

/**
 * Report a service worker failure.
 *
 * `where` is a dotted name matching the logger's convention on the page side
 * (`sw.precache.fail`), and becomes the Sentry fingerprint so one broken route is one issue
 * rather than one issue per URL.
 *
 * Best-effort by contract: a worker that cannot report an error must still serve the page, so
 * every failure path here is swallowed. Never awaited on a request path.
 */
function sentryReport(where, error, extra) {
  try {
    if (sentryEventCount >= SENTRY_MAX_EVENTS) return;

    // Cheap de-duplication. The same route failing on every one of 80 precache entries is one
    // fact, and the free plan's quota is not worth spending 80 times on it.
    const signature = `${where}:${error && error.message ? error.message : String(error)}`;
    if (sentrySeen.has(signature)) return;
    sentrySeen.add(signature);
    sentryEventCount += 1;

    const now = new Date().toISOString();
    const eventId = sentryUuid();

    const payload = {
      event_id: eventId,
      timestamp: now,
      platform: 'javascript',
      level: 'error',
      logger: 'sw',
      release: COMMIT_HASH,
      environment: 'production',
      fingerprint: [where],
      tags: { context: 'sw', build_id: BUILD_ID, sw_event: where },
      extra: Object.assign({ where: where }, extra || {}),
      exception: {
        values: [
          {
            type: (error && error.name) || 'ServiceWorkerError',
            value: (error && error.message) || String(error),
            // No stack frames: a worker stack is minified and the maps are uploaded for the
            // page bundle, not this file. `where` is the locator that actually helps.
            stacktrace: undefined,
          },
        ],
      },
    };

    const envelope =
      JSON.stringify({ event_id: eventId, sent_at: now }) +
      '\n' +
      JSON.stringify({ type: 'event' }) +
      '\n' +
      JSON.stringify(payload) +
      '\n';

    // `keepalive` so a report survives the worker being torn down right after, which is the
    // normal way a push handler ends.
    fetch(`${SENTRY_ENVELOPE_URL}?sentry_key=${SENTRY_KEY}&sentry_version=7`, {
      method: 'POST',
      body: envelope,
      headers: { 'content-type': 'application/x-sentry-envelope' },
      keepalive: true,
      mode: 'cors',
      credentials: 'omit',
    }).catch(() => {
      // Reporting failed. There is nowhere left to report that to.
    });
  } catch {
    // Same contract.
  }
}
