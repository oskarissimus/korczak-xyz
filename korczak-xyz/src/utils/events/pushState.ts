/*
 * Which of the push setup's states we are in.
 *
 * A pure function over six facts, because this is where "granted but no subscription" gets
 * forgotten — and forgetting it is indistinguishable from working until three weeks later, when a
 * notification that should have arrived did not. Every combination is a table test.
 *
 * Portable: browser and Node, no imports outside this directory. See types.ts.
 */

export type PushUiState =
  /** No serviceWorker or no PushManager. An old browser, or a desktop Safari tab. */
  | 'unsupported'
  /** iOS in a Safari tab. Notification.requestPermission is not even offered here. */
  | 'needs-install'
  /** Denied. Irreversible from a page — it lives in the OS settings now. */
  | 'blocked'
  /** Never asked. Show the button. */
  | 'prompt'
  /** The request is in flight. */
  | 'arming'
  /** Permission granted but no subscription — transient, the launch check re-subscribes. */
  | 'granted-no-sub'
  /** Subscribed here, not yet recorded on the account. */
  | 'unsaved'
  /** Subscribed and recorded. */
  | 'ready';

export interface PushInputs {
  /** `serviceWorker` in navigator && `PushManager` in window. */
  supported: boolean;
  /**
   * Running as an installed app.
   *
   * Only load-bearing on iOS, which delivers push to home-screen apps and to nothing else. On a
   * desktop browser a tab is a perfectly good place to receive notifications, so this must not gate
   * everything — see `needs-install`, which is reached only when `requiresInstall` is also true.
   */
  installed: boolean;
  /** Whether this platform refuses push outside an installed app. True for iOS/iPadOS. */
  requiresInstall: boolean;
  permission: 'default' | 'granted' | 'denied' | null;
  hasSubscription: boolean;
  /** When the subscription was last written to the account, or null if never. */
  savedAt: number | null;
  /** A request is in flight. */
  busy: boolean;
}

export function pushUiState(input: PushInputs): PushUiState {
  if (!input.supported || input.permission === null) return 'unsupported';

  /*
   * The install gate comes before the permission check, and before `busy`.
   *
   * On iOS in a Safari tab there is nothing useful to say about permission: the prompt cannot be
   * shown and the subscribe would fail. Ordering it first is what makes the tab state explain
   * itself instead of offering a button that silently does nothing — which is the single most
   * confusing thing this screen could do, because it looks exactly like a bug in the app.
   */
  if (input.requiresInstall && !input.installed) return 'needs-install';

  if (input.permission === 'denied') return 'blocked';
  if (input.busy) return 'arming';
  if (input.permission === 'default') return 'prompt';

  // Granted from here on.
  if (!input.hasSubscription) return 'granted-no-sub';
  if (input.savedAt === null) return 'unsaved';
  return 'ready';
}

/**
 * Whether this state should offer a button that asks for permission.
 *
 * Only `prompt` does. `blocked` deliberately does not: a page cannot undo a denial, and a button
 * that appears to try is worse than a sentence explaining where the setting actually lives.
 */
export function canArm(state: PushUiState): boolean {
  return state === 'prompt';
}

/** Whether notifications can actually be expected to arrive. */
export function isArmed(state: PushUiState): boolean {
  return state === 'ready';
}
