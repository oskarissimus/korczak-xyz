/*
 * The demo's settings document, read and written from the admin panel.
 *
 * `demo/config` is a top-level document rather than one under `users/{uid}`, because it is a fact
 * about the site rather than about an account — so it needed its own rule in `firestore.rules`,
 * where it is readable and writable by `admins/` only. The Cloud Function reads it with the Admin
 * SDK and is unaffected by that rule; the browser half is this file.
 *
 * The counters it decides against (`demoUsage`) deliberately have NO rule at all: unmatched means
 * denied, only the function writes them, and nothing in the panel reads them. If the panel ever
 * wants to show today's usage, that is a rule to add on purpose rather than a collection to find
 * already open.
 *
 * Every call reads `getDb()` afresh and goes through `runCloud`, per CLAUDE.md: holding the handle
 * leaves the app talking to a client that died mid-session, and skipping `runCloud` leaves a
 * promise unsettled for ever rather than rejected.
 */

import { doc, getDoc, setDoc } from 'firebase/firestore';

import { getDb } from '../../lib/firebase';
import { runCloud } from '../../lib/firestoreHealth';
import { DEMO_DEFAULTS, normalizeSettings, type DemoSettings } from './demoLimits';

function settingsDoc() {
  return doc(getDb()!, 'demo', 'config');
}

/**
 * The settings as they stand, or the defaults when nobody has saved any.
 *
 * The defaults rather than null, because that is what the function is running on in that state:
 * a panel showing blank fields for a demo that is already answering would be lying about it.
 */
export async function pullDemoSettings(): Promise<DemoSettings> {
  if (!getDb()) return DEMO_DEFAULTS;
  const snap = await runCloud('demo.settings.pull', () => getDoc(settingsDoc()));
  return normalizeSettings(snap.exists() ? snap.data() : {});
}

/**
 * Save them, whole.
 *
 * `setDoc` without a merge, like every other config in this repo: the document is small, one panel
 * writes it, and a field-by-field merge is how a cleared `keyUid` comes back. Normalised on the
 * way out as well as on the way in, so a cap typed past its maximum is saved clamped rather than
 * being clamped silently by every reader for ever.
 */
export async function pushDemoSettings(settings: DemoSettings): Promise<void> {
  if (!getDb()) return;
  await runCloud('demo.settings.push', () =>
    setDoc(settingsDoc(), { ...normalizeSettings(settings), updatedAt: Date.now() }),
  );
}
