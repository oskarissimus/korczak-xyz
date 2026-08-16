/*
 * Firestore for the fretboard trainer, used when someone is signed in.
 *
 * All of the behaviour is `createSrsCloud` in `src/utils/srs/cloud.ts` — one immutable document
 * per sitting, a last-write-wins settings document, every call on a deadline. This file only says
 * where this app's copy of that lives.
 */

import { createSrsCloud } from '../srs/cloud';
import type { Settings } from './types';

export type { PullResult } from '../srs/cloud';

export const { pullSessions, pushSession, loadCloudSettings, saveCloudSettings } =
  createSrsCloud<Settings>('fretboardSessions', ['fretboard', 'settings'], 'fretboard');
