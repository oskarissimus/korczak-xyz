/*
 * Taking the ride screen full screen, and the three ways browsers disagree about it.
 *
 * It is here because the ride screen is read at arm's length: the remark is already as large as
 * the window allows, and the window is a Win95 frame inside a page with a navbar and a taskbar.
 * Full screen is the one change that makes the sentence bigger without redesigning anything —
 * and in the roaster's case it is also how you hand the phone to somebody.
 *
 * THREE DISAGREEMENTS, AND THE THIRD IS THE ONE THAT MATTERS:
 *
 *  1. **The prefixes.** Safari still answers to `webkitRequestFullscreen` and friends, and the
 *     unprefixed names are absent there rather than failing. So every call goes through a lookup
 *     rather than being typed out, and the element and document types are widened by hand because
 *     the DOM lib knows only the standard half.
 *  2. **The request must happen inside a gesture**, like the audio unlocks in `speech.ts` and
 *     `live.ts`. It is called straight from the button's handler, with nothing awaited first.
 *  3. **The iPhone has no element full screen at all.** `document.fullscreenEnabled` is false in
 *     Safari on iOS for anything but a `<video>`, and `requestFullscreen` does not exist — so the
 *     button is not drawn there rather than drawn and broken. `supportsFullscreen` is what the
 *     screen asks, and it is a question about the browser, not about the moment.
 *
 * Nothing here throws at the caller. A refusal — a browser that changed its mind, a permission
 * policy in an iframe — leaves the screen exactly as it was, which is a working ride screen.
 */

interface FullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
}

interface FullscreenDocument extends Document {
  webkitFullscreenElement?: Element | null;
  msFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void> | void;
  msExitFullscreen?: () => Promise<void> | void;
}

function doc(): FullscreenDocument | null {
  return typeof document === 'undefined' ? null : (document as FullscreenDocument);
}

/** Whether to draw the button at all. False on an iPhone, where only a `<video>` may go full screen. */
export function supportsFullscreen(): boolean {
  const d = doc();
  if (!d) return false;
  if (d.fullscreenEnabled === false && d.webkitFullscreenEnabled !== true) return false;
  const probe = d.documentElement as FullscreenElement;
  return typeof probe.requestFullscreen === 'function'
    || typeof probe.webkitRequestFullscreen === 'function'
    || typeof probe.msRequestFullscreen === 'function';
}

/** Whatever is full screen now, by any of the three spellings. */
export function fullscreenElement(): Element | null {
  const d = doc();
  if (!d) return null;
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? d.msFullscreenElement ?? null;
}

export function isFullscreen(element?: HTMLElement | null): boolean {
  const current = fullscreenElement();
  if (!current) return false;
  return element ? current === element : true;
}

/**
 * In, or out, in one call — which is what a single button wants. Called straight from the click
 * handler, because the request is only granted inside a gesture.
 */
export function toggleFullscreen(element: HTMLElement | null): void {
  const d = doc();
  if (!d || !element) return;

  if (isFullscreen()) {
    const exit = d.exitFullscreen ?? d.webkitExitFullscreen ?? d.msExitFullscreen;
    try {
      void Promise.resolve(exit?.call(d)).catch(() => undefined);
    } catch {
      // Already out, or refused. Either way there is nothing to do and nothing to say.
    }
    return;
  }

  const target = element as FullscreenElement;
  const request =
    target.requestFullscreen ?? target.webkitRequestFullscreen ?? target.msRequestFullscreen;
  try {
    void Promise.resolve(request?.call(target)).catch(() => undefined);
  } catch {
    // A browser that lists the method and refuses the call. The ride is unaffected.
  }
}

/** Every spelling of the change event, so the button's label follows Escape as well as itself. */
export function watchFullscreen(onChange: () => void): () => void {
  const d = doc();
  if (!d) return () => undefined;
  const events = ['fullscreenchange', 'webkitfullscreenchange', 'MSFullscreenChange'];
  for (const name of events) d.addEventListener(name, onChange);
  return () => {
    for (const name of events) d.removeEventListener(name, onChange);
  };
}
