/*
 * Error reporting for the backend.
 *
 * These four functions have had exactly one failure channel since they were written: a
 * `console.log` summary and whatever Cloud Logging happened to capture. That is enough to answer
 * "what went wrong" once you already know something did — and the two collectors are scheduled,
 * so nobody is watching when they run. `collectTransit` fires every ten minutes at 3am; a run
 * that throws is a line in a log nobody reads until Metro Watch has been quietly dead for a week.
 *
 * This is a separate Sentry project from the site (`korczak-xyz-functions`), which the browser
 * one is not, because the two have nothing to say about each other: no user's page load is
 * waiting on a collector, and mixing scheduled backend failures into the project you open to see
 * whether the typing trainer is broken would make both harder to read.
 *
 * Errors only, matching the site: no tracing. There are four functions, two of them on a
 * schedule, and their durations are already in Cloud Monitoring.
 */

import * as Sentry from '@sentry/node';

/*
 * A DSN is a public credential and identifies the project to the ingest endpoint; it is not a
 * secret and does not belong in Secret Manager alongside the VAPID keys. Overridable by env so a
 * local `firebase emulators:start` can point somewhere else, or nowhere.
 */
const DSN =
  process.env.SENTRY_DSN ??
  'https://3f048444dd9366925531ca09ce09737d@o4512114964430848.ingest.de.sentry.io/4512115029573712';

let started = false;

/**
 * Initialise Sentry. Called once at module load in index.ts, before any function body runs.
 *
 * Deliberately not gated on an env flag: a reporting path that is off in production by default is
 * a reporting path that is off when it is needed. The emulator is the case that wants silence,
 * and it gets it by setting SENTRY_DSN empty.
 */
export function initSentry(): void {
  if (started || !DSN) return;
  started = true;

  Sentry.init({
    dsn: DSN,
    environment: process.env.FUNCTIONS_EMULATOR === 'true' ? 'emulator' : 'production',
    // Set by the platform on every gen-2 function; ties an issue to a specific deploy.
    release: process.env.K_REVISION ?? 'unknown',

    // Errors only. See the note at the top of this file.
    tracesSampleRate: 0,

    /*
     * Off. The collectors handle other people's push subscriptions and Firestore documents, and
     * `sendDefaultPii` would attach request bodies and headers to events. The uid is set
     * explicitly where it is genuinely useful (sendTestPush, assembleVideo) and nowhere else.
     */
    sendDefaultPii: false,

    // Cloud Functions freeze the instance between invocations, so a queued event can sit for
    // hours. Small queue, and every entry point flushes before it returns.
    maxBreadcrumbs: 30,
  });
}

/**
 * Report a failure, with the function name as the fingerprint.
 *
 * Grouping by function rather than by message is what keeps "Ticketmaster returned 502" from
 * becoming a new issue every time the status code changes. The message is still on the event.
 */
export function reportError(
  fn: string,
  error: unknown,
  extra?: Record<string, unknown>
): void {
  if (!started) return;
  try {
    Sentry.withScope((scope) => {
      scope.setTag('function', fn);
      scope.setFingerprint([fn, '{{ default }}']);
      if (extra) scope.setContext('run', extra);
      Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
    });
  } catch {
    // Reporting must never be what fails a run.
  }
}

/**
 * Get queued events out before the instance freezes.
 *
 * This is the part of serverless Sentry that is easy to leave out and silently loses events: the
 * moment a function returns, the platform can suspend the container, and anything still in the
 * transport queue goes with it. Every entry point awaits this on its way out.
 *
 * Bounded at two seconds and never throws — a slow Sentry must not extend a function's billed
 * duration indefinitely, and must not turn a successful run into a failed one.
 */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!started) return;
  try {
    await Sentry.flush(timeoutMs);
  } catch {
    // Nothing useful to do; the run's own outcome stands.
  }
}

/**
 * Wrap a scheduled function body so a throw is reported and still fails the run.
 *
 * Rethrowing matters: swallowing here would make every run look successful in Cloud Scheduler,
 * which is the dashboard that gets checked when somebody asks whether the collector is alive.
 */
export async function withSentry<T>(
  fn: string,
  body: () => Promise<T>,
  extra?: Record<string, unknown>
): Promise<T> {
  try {
    const result = await body();
    await flushSentry();
    return result;
  } catch (error) {
    reportError(fn, error, extra);
    await flushSentry();
    throw error;
  }
}
