/*
 * Firestore for the transposition trainer, used when someone is signed in.
 *
 * All of the behaviour is `createSrsCloud` in `src/utils/srs/cloud.ts` — one immutable document per
 * sitting, a last-write-wins settings document, every call on a deadline. This file only says
 * where this app's copy of that lives. The recursive rule under `users/{uid}` in `firestore.rules`
 * already covers it, so nothing has to be deployed for this to work.
 */

import { createSrsCloud } from '../srs/cloud';
import type { Settings } from './types';

export type { PullResult } from '../srs/cloud';

export const { pullSessions, pushSession, loadCloudSettings, saveCloudSettings } =
  createSrsCloud<Settings>('transposeSessions', ['transpose', 'settings'], 'transpose');
