/*
 * Sentry, the error reporting backend.
 *
 * Until Sep 2026 the site carried its own telemetry: `logger.ts` wrote structured entries into a
 * localStorage ring buffer and `logSink.ts` batched them into `users/{uid}/logs` in Firestore.
 * That worked, but it only ever recorded what the code thought to record — an uncaught exception
 * from a component nobody had instrumented left no trace at all, and reading any of it meant
 * querying Firestore by hand. Sentry replaces the whole of it. `logger.ts` is now a thin facade
 * over this module, so the 165 existing `log.*` call sites kept their meaning and changed only
 * where they end up.
 *
 * What is deliberately NOT enabled here:
 *
 * - **Performance tracing.** Every span this site could produce would be a client-only span.
 *   Cloudflare serves static assets and nothing runs per request, so there is no server span to
 *   join a page load to; the two Cloud Functions are on their own DSN and are not in any user's
 *   critical path. Tracing would cost ~10KB gzipped to draw waterfalls of `fetch` calls we can
 *   already see in devtools.
 * - **Session Replay.** It is the single most useful Sentry feature for a UI like the typing
 *   trainer, and it is still off: it is ~40KB gzipped, and it records the DOM. The baby sleep log
 *   and the shopping list are somebody's actual life, and no amount of masking makes recording
 *   them a thing to switch on without deciding to.
 *
 * Both are one integration each if that changes. Keep the reasoning above in view first.
 */

import {
  addBreadcrumb,
  breadcrumbsIntegration,
  captureException,
  captureMessage,
  dedupeIntegration,
  functionToStringIntegration,
  getClient,
  globalHandlersIntegration,
  httpContextIntegration,
  init,
  inboundFiltersIntegration,
  linkedErrorsIntegration,
  setTag,
  setUser,
  withScope,
  type Breadcrumb,
  type ErrorEvent as SentryErrorEvent,
  type EventHint,
  type SeverityLevel,
} from '@sentry/browser';

/*
 * A DSN is a public credential and belongs in the bundle — it identifies the project to the
 * ingest endpoint and grants nothing but the ability to send events to it, which is exactly what
 * every visitor's browser has to be able to do. It is not a secret and there is no env var to
 * hide it in on a static site. The token that CAN do damage is SENTRY_AUTH_TOKEN, which uploads
 * source maps; that one is a GitHub Actions secret and never reaches the client (see
 * astro.config.mjs).
 */
const DSN = 'https://f949f4339b034801d79711536bf73d9d@o4512114964430848.ingest.de.sentry.io/4512115029180496';

/*
 * Set by the `define` in astro.config.mjs, from the same `git rev-parse --short HEAD` that
 * Navbar.astro prints in the status bar. Tying the release to that exact string is the point:
 * when the navbar says `4a1ccf8` and Sentry says `4a1ccf8`, an issue can be read against a diff
 * without guessing which deploy the reporter was on.
 */
declare const __COMMIT_HASH__: string;
const RELEASE = typeof __COMMIT_HASH__ === 'string' ? __COMMIT_HASH__ : 'dev';

/*
 * Noise that is never actionable, dropped before it costs quota.
 *
 * `ResizeObserver loop` is the well-known benign browser warning — it fires when a resize handler
 * dirties layout, which the chart components do legitimately, and no browser has ever attached a
 * real failure to it. The abort/network family is a user navigating away mid-fetch. The rest are
 * extensions and embedded webviews reaching into the page, which is not this site's code.
 */
const IGNORED_MESSAGES = [
  /ResizeObserver loop/i,
  /Non-Error promise rejection captured with value: undefined/i,
  // A fetch the user cancelled by navigating; the app already treats these as non-events.
  /AbortError/i,
  /The operation was aborted/i,
  /Load failed$/i,
  /NetworkError when attempting to fetch resource/i,
  // Safari/iOS webview noise with no stack and no reproduction.
  /^Script error\.?$/i,
];

/*
 * Frames from anything that is not this site. An extension that throws inside the page produces
 * an event indistinguishable from ours apart from the frame URL, and on a free plan a single
 * popular broken extension can eat a month's quota on its own.
 */
const DENY_URLS = [
  /extensions\//i,
  /^chrome:\/\//i,
  /^chrome-extension:\/\//i,
  /^moz-extension:\/\//i,
  /^safari-(web-)?extension:\/\//i,
];

let started = false;

/**
 * Initialise Sentry. Safe to call more than once — the second call is a no-op, which matters
 * because `ClientRouter` re-runs module scripts after every view transition.
 */
export function initSentry(context: 'page' | 'sw' = 'page'): void {
  if (started) return;
  if (typeof window === 'undefined' && context === 'page') return;
  started = true;

  try {
    init({
      dsn: DSN,
      release: RELEASE,
      environment: import.meta.env.DEV ? 'development' : 'production',

      /*
       * Errors only. The default integration list includes the tracing and replay machinery, so
       * it is replaced wholesale rather than filtered — naming exactly what runs is what keeps
       * the bundle at the size this was chosen for, and makes an accidental re-enable visible in
       * a diff rather than silent in a dependency bump.
       */
      integrations: [
        inboundFiltersIntegration(),
        functionToStringIntegration(),
        breadcrumbsIntegration({
          console: false, // the logger feeds breadcrumbs directly; console would double every one
          dom: true,
          fetch: true,
          history: true,
          xhr: true,
        }),
        globalHandlersIntegration({ onerror: true, onunhandledrejection: true }),
        linkedErrorsIntegration(),
        dedupeIntegration(),
        httpContextIntegration(),
      ],

      /*
       * No automatic PII. `sendDefaultPii` would attach IP addresses and request headers; the
       * only identity this site attaches is the Firebase uid, set explicitly by `setSentryUser`
       * when somebody signs in, because that is the one field that makes "did this happen to a
       * real account or only on my laptop" answerable.
       */
      sendDefaultPii: false,

      ignoreErrors: IGNORED_MESSAGES,
      denyUrls: DENY_URLS,

      /*
       * The site is static and every visitor's browser reports to the same project, so one
       * broken third-party script could fill the plan's quota in an afternoon. A cap here is
       * cheaper than discovering it from an email.
       */
      maxBreadcrumbs: 60,

      beforeSend,
      beforeBreadcrumb,
    });

    setTag('context', context);
  } catch {
    // Telemetry must never be the thing that breaks the page. Same contract the old logger had.
    started = false;
  }
}

/*
 * Last line of defence before an event leaves the browser.
 *
 * The URL scrub is the part that matters. Several apps put identifiers in the path or query —
 * a baby sleep share token, a shopping household id — and those would otherwise ride along in
 * `request.url` and in every navigation breadcrumb.
 */
function beforeSend(event: SentryErrorEvent, _hint: EventHint): SentryErrorEvent | null {
  try {
    if (event.request?.url) event.request.url = scrubUrl(event.request.url);
    if (event.breadcrumbs) {
      event.breadcrumbs = event.breadcrumbs.map((crumb) =>
        crumb.data?.to || crumb.data?.from
          ? {
              ...crumb,
              data: {
                ...crumb.data,
                ...(crumb.data.to ? { to: scrubUrl(String(crumb.data.to)) } : {}),
                ...(crumb.data.from ? { from: scrubUrl(String(crumb.data.from)) } : {}),
              },
            }
          : crumb
      );
    }
  } catch {
    // A failed scrub must not become a dropped event; the event is still worth having.
  }
  return event;
}

function beforeBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  // Fetch/xhr breadcrumbs carry the full URL, including any token in the query string.
  if ((crumb.category === 'fetch' || crumb.category === 'xhr') && crumb.data?.url) {
    return { ...crumb, data: { ...crumb.data, url: scrubUrl(String(crumb.data.url)) } };
  }
  return crumb;
}

/*
 * Replace the value of any query parameter that could identify a person or grant access, and
 * keep the key so the shape of the request is still readable. Allow-listing would be safer, but
 * the query strings here are open-ended and a missed key is a leak, whereas a missed *redaction*
 * of a harmless key costs nothing.
 */
const SENSITIVE_PARAM = /^(token|share|key|secret|code|email|uid|password|apikey|api_key)$/i;

export function scrubUrl(raw: string): string {
  try {
    const url = new URL(raw, typeof location === 'undefined' ? 'https://korczak.xyz' : location.href);
    let touched = false;
    url.searchParams.forEach((_value, key) => {
      if (SENSITIVE_PARAM.test(key)) touched = true;
    });
    if (touched) {
      const next = new URLSearchParams();
      url.searchParams.forEach((value, key) => {
        next.append(key, SENSITIVE_PARAM.test(key) ? '[redacted]' : value);
      });
      url.search = next.toString();
    }
    return url.toString();
  } catch {
    return raw;
  }
}

/** Whether `init` actually took. Used by the debug console to report honestly. */
export function sentryReady(): boolean {
  return started && getClient() !== undefined;
}

/**
 * Identify the signed-in account. Called by `useAuth` on every auth state change, including the
 * transition to signed out, which passes null and clears it.
 */
export function setSentryUser(uid: string | null, clientId: string): void {
  try {
    setUser(uid ? { id: uid } : null);
    // Always present, signed in or not: it is what ties a run of events to one browser profile,
    // which is the grouping the old logger's clientId existed to provide.
    setTag('client_id', clientId);
  } catch {
    /* never throw into the auth path */
  }
}

const LEVEL_MAP: Record<string, SeverityLevel> = {
  debug: 'debug',
  info: 'info',
  warn: 'warning',
  error: 'error',
};

/**
 * A structured log entry on its way to Sentry.
 *
 * `debug`/`info`/`warn` become breadcrumbs — the trail attached to whatever fails next, which is
 * what those levels were always for. `error` becomes an event in its own right, because the
 * places that call `log.error` (a poisoned Firestore client, a sync rollback) are failures that
 * no exception will ever be thrown for.
 */
export function recordLog(
  level: 'debug' | 'info' | 'warn' | 'error',
  event: string,
  fields?: Record<string, unknown>
): void {
  try {
    if (level === 'error') {
      withScope((scope) => {
        scope.setLevel('error');
        // The dotted event name is the fingerprint. Without this, Sentry groups by message text
        // and `firestore.stalled` with two different labels becomes two issues.
        scope.setFingerprint([event]);
        scope.setTag('log_event', event);
        if (fields && Object.keys(fields).length > 0) scope.setContext('fields', fields);

        // A field carrying a real stack is worth more as an exception than as a string: it gets
        // the stack trace UI, source maps applied, and grouping by frame.
        const stack = typeof fields?.stack === 'string' ? fields.stack : null;
        if (stack) {
          const err = new Error(String(fields?.message ?? event));
          err.name = String(fields?.name ?? 'LoggedError');
          err.stack = stack;
          captureException(err);
        } else {
          captureMessage(event, 'error');
        }
      });
      return;
    }

    addBreadcrumb({
      category: 'log',
      message: event,
      level: LEVEL_MAP[level] ?? 'info',
      ...(fields && Object.keys(fields).length > 0 ? { data: fields } : {}),
    });
  } catch {
    /* the logger's own contract: never throw into the caller */
  }
}
