/*
 * The contract `firestore.rules` is supposed to keep, executed against the real rules engine.
 *
 * It lives here rather than in the site's test suite because it needs the Firestore emulator — a
 * jar and a JVM — and the site's `npm test` is a two-second vitest run that should stay one. It is
 * gated the same way `smoke.live.test.ts` is: skipped unless something has put an emulator in
 * front of it, which `emulators:exec` does by setting FIRESTORE_EMULATOR_HOST.
 *
 *   npx firebase-tools@15 emulators:exec --only firestore --project demo-rules \
 *     "npm test --prefix functions -- src/rules.test.ts"
 *
 * The deploy workflow runs exactly that line before pushing the rules out, which is the point: the
 * rules are the entire admissions policy since sign-up was opened up, and the failure mode they
 * guard against is silent. A ruleset that quietly grants everything looks, from every screen in
 * the app, precisely like one that works.
 *
 * The cases are written as the sentences they are meant to be. If one of them ever has to be
 * deleted to make a change pass, that is the change asking for a second opinion.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const emulated = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const maybe = emulated ? describe : describe.skip;

const RULES = path.join(__dirname, '..', '..', 'firestore.rules');

/** An account row as the client would write one, with the verdicts overridable per test. */
function account(email: string, extra: Partial<Record<string, unknown>> = {}) {
  return {
    email,
    emailVerified: false,
    approved: true,
    emailTrusted: true,
    createdAt: 0,
    lastSeenAt: null,
    ...extra,
  };
}

maybe('firestore.rules', () => {
  let env: RulesTestEnvironment;

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: 'demo-rules',
      firestore: { rules: fs.readFileSync(RULES, 'utf8') },
    });
  });

  afterAll(async () => {
    await env?.cleanup();
  });

  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      // The world as production looks: the owner, the invitee he let in by hand, an admin row,
      // one household share, and a stranger who has signed up and been told to wait.
      await setDoc(doc(db, 'accounts/owner'), account('owner@example.com'));
      await setDoc(doc(db, 'accounts/wife'), account('wife@example.com'));
      await setDoc(
        doc(db, 'accounts/stranger'),
        account('stranger@example.com', { approved: false, emailTrusted: false, emailVerified: true, createdAt: 5 })
      );
      await setDoc(doc(db, 'admins/owner'), { email: 'owner@example.com' });
      await setDoc(doc(db, 'shares/wife@example.com'), {
        email: 'wife@example.com',
        ownerUid: 'owner',
        ownerEmail: 'owner@example.com',
        createdAt: 1,
      });
      await setDoc(doc(db, 'users/owner/progress/p1'), { done: 1 });
      await setDoc(doc(db, 'users/owner/shopping/i1'), { name: 'mleko' });
      await setDoc(doc(db, 'events/e1'), { title: 'x' });
      await setDoc(doc(db, 'transitItems/t1'), { title: 'x' });
    });
  });

  const as = (uid: string, email: string, emailVerified = false) =>
    env.authenticatedContext(uid, { email, email_verified: emailVerified }).firestore();

  const owner = () => as('owner', 'owner@example.com');
  const wife = () => as('wife', 'wife@example.com');
  const stranger = () => as('stranger', 'stranger@example.com', true);

  describe('an approved account', () => {
    it('reads and writes its own subtree', async () => {
      await assertSucceeds(getDoc(doc(owner(), 'users/owner/progress/p1')));
      await assertSucceeds(setDoc(doc(owner(), 'users/owner/progress/p2'), { done: 2 }));
    });

    it('reads the corpora the collectors write, and writes neither', async () => {
      await assertSucceeds(getDoc(doc(owner(), 'events/e1')));
      await assertSucceeds(getDoc(doc(owner(), 'transitItems/t1')));
      await assertFails(setDoc(doc(owner(), 'events/e2'), { title: 'y' }));
    });

    it('cannot reach another account’s subtree', async () => {
      await assertFails(getDoc(doc(wife(), 'users/owner/progress/p1')));
    });
  });

  describe('the household share', () => {
    it('lets a trusted invitee work the shared list', async () => {
      await assertSucceeds(getDoc(doc(wife(), 'shares/wife@example.com')));
      await assertSucceeds(setDoc(doc(wife(), 'users/owner/shopping/i2'), { name: 'chleb' }));
    });

    it('closes when the address is neither verified nor vouched for', async () => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'accounts/wife'), account('wife@example.com', { emailTrusted: false }));
      });
      await assertFails(setDoc(doc(wife(), 'users/owner/shopping/i3'), { name: 'x' }));
    });

    // The scenario the old shouted comment in firestore.rules was about: sign-up is open, so
    // somebody else can register the invited address. Approval alone must not be enough.
    it('is not opened by registering the invited address', async () => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(
          doc(ctx.firestore(), 'accounts/impostor'),
          account('wife@example.com', { emailTrusted: false })
        );
      });
      const impostor = as('impostor', 'wife@example.com');
      await assertFails(getDoc(doc(impostor, 'shares/wife@example.com')));
      await assertFails(setDoc(doc(impostor, 'users/owner/shopping/i9'), { name: 'x' }));
    });
  });

  describe('an account nobody has approved', () => {
    it('opens nothing at all — not even its own subtree', async () => {
      await assertFails(getDoc(doc(stranger(), 'users/stranger/progress/p1')));
      await assertFails(setDoc(doc(stranger(), 'users/stranger/progress/p1'), { done: 1 }));
      // An arbitrary collection under its own uid, to pin the recursive wildcard rather than the
      // one collection named above. This used to be `logs`, which the site no longer writes.
      await assertFails(setDoc(doc(stranger(), 'users/stranger/anything/x1'), { x: 1 }));
      await assertFails(getDoc(doc(stranger(), 'events/e1')));
      await assertFails(getDoc(doc(stranger(), 'transitItems/t1')));
    });

    it('sees its own row and nobody else’s', async () => {
      await assertSucceeds(getDoc(doc(stranger(), 'accounts/stranger')));
      await assertFails(getDoc(doc(stranger(), 'accounts/owner')));
      await assertFails(getDocs(collection(stranger(), 'accounts')));
    });

    it('cannot admit itself, vouch for itself, or appoint itself', async () => {
      await assertFails(updateDoc(doc(stranger(), 'accounts/stranger'), { approved: true }));
      await assertFails(updateDoc(doc(stranger(), 'accounts/stranger'), { emailTrusted: true }));
      await assertFails(setDoc(doc(stranger(), 'admins/stranger'), { x: 1 }));
    });

    it('may keep its own mirror honest', async () => {
      await assertSucceeds(
        updateDoc(doc(stranger(), 'accounts/stranger'), {
          email: 'stranger@example.com',
          emailVerified: true,
          lastSeenAt: 99,
        })
      );
    });
  });

  describe('a brand new sign-up', () => {
    const fresh = () => as('fresh', 'fresh@example.com');

    it('creates its own pending row', async () => {
      await assertSucceeds(
        setDoc(doc(fresh(), 'accounts/fresh'), account('fresh@example.com', {
          approved: false,
          emailTrusted: false,
          createdAt: 10,
          lastSeenAt: 10,
        }))
      );
    });

    it('cannot create itself approved, verified, or as somebody else', async () => {
      const approved = account('fresh@example.com', { emailTrusted: false, createdAt: 10 });
      await assertFails(setDoc(doc(fresh(), 'accounts/fresh'), approved));
      await assertFails(
        setDoc(doc(fresh(), 'accounts/fresh'), account('fresh@example.com', {
          approved: false,
          emailTrusted: false,
          emailVerified: true,
          createdAt: 10,
        }))
      );
      await assertFails(
        setDoc(doc(fresh(), 'accounts/owner'), account('fresh@example.com', {
          approved: false,
          emailTrusted: false,
          createdAt: 10,
        }))
      );
    });
  });

  describe('the admin', () => {
    it('reads the queue and decides it', async () => {
      await assertSucceeds(getDocs(collection(owner(), 'accounts')));
      await assertSucceeds(updateDoc(doc(owner(), 'accounts/stranger'), { approved: true }));
      await assertSucceeds(updateDoc(doc(owner(), 'accounts/stranger'), { emailTrusted: true }));
      await assertSucceeds(deleteDoc(doc(owner(), 'accounts/stranger')));
    });

    it('cannot rewrite somebody’s address out from under them', async () => {
      await assertFails(updateDoc(doc(owner(), 'accounts/stranger'), { email: 'other@example.com' }));
    });

    it('is the only one who can decide anything', async () => {
      await assertFails(updateDoc(doc(wife(), 'accounts/stranger'), { approved: true }));
    });
  });

  it('an approved stranger becomes an ordinary user, and no more than one', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), 'accounts/stranger'),
        account('stranger@example.com', { emailVerified: true, emailTrusted: false })
      );
    });
    await assertSucceeds(setDoc(doc(stranger(), 'users/stranger/progress/p1'), { done: 1 }));
    await assertSucceeds(getDoc(doc(stranger(), 'events/e1')));
    await assertFails(getDoc(doc(stranger(), 'users/owner/progress/p1')));
  });
});
