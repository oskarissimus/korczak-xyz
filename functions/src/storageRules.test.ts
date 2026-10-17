/*
 * The one part of `storage.rules` that is not "your own files": the songbook's video inbox, where
 * whatever lands is published on the site under a song's name by the next run of
 * song-video-inbox.yml. So the sentence that matters is that only an admin can put anything there.
 *
 * Gated like rules.test.ts, on the Storage emulator:
 *
 *   npx firebase-tools@15 emulators:exec --config firebase.rules-test.json \
 *     --only storage --project demo-rules "npm test --prefix functions -- src/storageRules.test.ts"
 *
 * `firebase.rules-test.json` exists because the real `firebase.json` names its two buckets in the
 * array form, which the emulator refuses without deploy targets.
 *
 * THE TWO LOOKUPS ARE STUBBED, and that is a limit worth stating rather than hiding. `approved()`
 * and `admin()` reach into Firestore with `firestore.get`/`firestore.exists`, and the Storage
 * emulator denied every such lookup here even with the Firestore emulator up and the rows written —
 * including on the `users/{uid}` paths production has served through it since September. So this
 * swaps each for a check on the uid (`owner` is an admin, `friend` is approved, anything else is
 * not) and tests everything else in the file for real: that it compiles, and the path, slug, type
 * and bucket conditions around the lookups. The lookups themselves are the same two functions the
 * live bucket already depends on.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteObject, listAll, ref, uploadBytes } from 'firebase/storage';
import { afterAll, beforeAll, describe, it } from 'vitest';

const emulated = Boolean(process.env.FIREBASE_STORAGE_EMULATOR_HOST);
const maybe = emulated ? describe : describe.skip;

const ROOT = path.join(__dirname, '..', '..');
const BUCKET = 'korczak-xyz-501720-sloper';
const VIDEO = { contentType: 'video/quicktime' };
const bytes = new Uint8Array([0, 0, 0, 0x18]);

/** storage.rules with its two cross-service lookups replaced by checks on the uid. */
function rulesWithStubbedLookups(): string {
  const source = fs.readFileSync(path.join(ROOT, 'storage.rules'), 'utf8');
  const stubbed = source
    .replace(
      /firestore\.get\(\/databases\/\(default\)\/documents\/accounts\/\$\(request\.auth\.uid\)\)\.data\.approved == true/,
      "request.auth.uid in ['owner', 'friend']",
    )
    .replace(
      /firestore\.exists\(\/databases\/\(default\)\/documents\/admins\/\$\(request\.auth\.uid\)\)/,
      "request.auth.uid == 'owner'",
    );
  // A rules file that stopped matching would otherwise test the real lookups and fail confusingly.
  if (/firestore\.(get|exists)\(\//.test(stubbed)) throw new Error('storage.rules changed shape; update the stubs');
  return stubbed;
}

maybe('storage.rules — the video inbox', () => {
  let env: RulesTestEnvironment;

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: 'demo-rules',
      storage: { rules: rulesWithStubbedLookups() },
    });
  });

  afterAll(async () => {
    await env?.cleanup();
  });

  const storageAs = (uid: string) => env.authenticatedContext(uid).storage(`gs://${BUCKET}`);

  it('lets an admin put a recording in, list it, and take it back out', async () => {
    const storage = storageAs('owner');
    const file = ref(storage, 'videoInbox/barka/1760731200000-take.mov');
    await assertSucceeds(uploadBytes(file, bytes, VIDEO));
    await assertSucceeds(listAll(ref(storage, 'videoInbox')));
    await assertSucceeds(deleteObject(file));
  });

  it('refuses an approved account that is not an admin', async () => {
    const storage = storageAs('friend');
    await assertFails(uploadBytes(ref(storage, 'videoInbox/barka/1-take.mov'), bytes, VIDEO));
    await assertFails(listAll(ref(storage, 'videoInbox')));
  });

  it('refuses an account still waiting for approval, and nobody at all', async () => {
    await assertFails(uploadBytes(ref(storageAs('stranger'), 'videoInbox/barka/1-a.mov'), bytes, VIDEO));
    const anonymous = env.unauthenticatedContext().storage(`gs://${BUCKET}`);
    await assertFails(uploadBytes(ref(anonymous, 'videoInbox/barka/1-a.mov'), bytes, VIDEO));
  });

  it('keeps an approved account in its own folder, as before', async () => {
    await assertSucceeds(uploadBytes(ref(storageAs('friend'), 'users/friend/a.png'), bytes));
    await assertFails(uploadBytes(ref(storageAs('friend'), 'users/owner/a.png'), bytes));
  });

  it('opens the inbox in the sloper bucket only', async () => {
    const backseat = env.authenticatedContext('owner').storage('gs://korczak-xyz-501720-backseat');
    await assertFails(uploadBytes(ref(backseat, 'videoInbox/barka/1-a.mov'), bytes, VIDEO));
  });

  it('takes only a video, under a slug the workflow can read', async () => {
    const storage = storageAs('owner');
    await assertFails(uploadBytes(ref(storage, 'videoInbox/barka/1-a.html'), bytes, { contentType: 'text/html' }));
    await assertFails(uploadBytes(ref(storage, 'videoInbox/Barka Mleczna/1-a.mov'), bytes, VIDEO));
  });

  it('lets an admin see and clear what the workflow could not use, but not write there', async () => {
    const storage = storageAs('owner');
    await assertSucceeds(listAll(ref(storage, 'videoFailed')));
    await assertFails(uploadBytes(ref(storage, 'videoFailed/barka/1-a.mov'), bytes, VIDEO));
  });
});
