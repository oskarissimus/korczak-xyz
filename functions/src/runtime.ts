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
 * The project the classifier authenticates and bills against.
 *
 * **Not a secret**, and that is the point: the classifier talks to Vertex AI on Application
 * Default Credentials, which in this runtime is the function's own service account. There is no
 * key to store, rotate or leak — and nothing new on the deploy path, since a secret named in a
 * function's `secrets` array has to exist before the CLI will deploy at all.
 *
 * `GOOGLE_CLOUD_PROJECT` is set by the Cloud Functions runtime. The literal is the fallback for a
 * local run, and it is the same id `.firebaserc` names.
 */
export const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'korczak-xyz-501720';

/**
 * Where the model is asked. Not `REGION`: the functions run in Warsaw, and the generative models
 * are served from a different, smaller set of locations. See `LOCATION` in `classify.ts`.
 */
export const VERTEX_LOCATION = 'global';

/**
 * Who the push service should contact about a misbehaving sender.
 *
 * Apple rejects a VAPID `sub` that is not a `mailto:` or `https:` URL, with a 400 that says
 * nothing useful about which field was wrong.
 */
export const VAPID_SUBJECT = 'https://korczak.xyz/';
