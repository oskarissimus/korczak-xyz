/*
 * The bits every entry point needs: the Admin SDK, the region, and the secret handles.
 *
 * Kept apart from index.ts so the source adapters and the tests can import `db` without pulling in
 * the function definitions, which the emulator would then try to register.
 */

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';

initializeApp();

export const db = getFirestore();

/** Warsaw. The data and the reader are both here, and so is the schedule's timezone. */
export const REGION = 'europe-central2';

export const VAPID_PUBLIC_KEY = defineSecret('VAPID_PUBLIC_KEY');
export const VAPID_PRIVATE_KEY = defineSecret('VAPID_PRIVATE_KEY');
export const TICKETMASTER_API_KEY = defineSecret('TICKETMASTER_API_KEY');

/**
 * Who the push service should contact about a misbehaving sender.
 *
 * Apple rejects a VAPID `sub` that is not a `mailto:` or `https:` URL, with a 400 that says
 * nothing useful about which field was wrong.
 */
export const VAPID_SUBJECT = 'https://korczak.xyz/';
