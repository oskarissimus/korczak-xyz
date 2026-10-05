/*
 * Full screen, against the three browsers that spell it differently.
 *
 * The cases worth pinning are the ones that were failures first: an iPhone, where element full
 * screen does not exist at all and a button must not be drawn; Safari, where only the `webkit`
 * names are there; and a browser that lists a method and then refuses the call, which must leave a
 * working ride screen rather than an exception in the click handler.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fullscreenElement,
  isFullscreen,
  supportsFullscreen,
  toggleFullscreen,
  watchFullscreen,
} from './fullscreen';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A document with only the names the browser being imitated actually has. */
function stubDocument(doc: Record<string, unknown>) {
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), ...doc });
}

describe('supportsFullscreen', () => {
  it('is true where the standard names are there', () => {
    stubDocument({ fullscreenEnabled: true, documentElement: { requestFullscreen: () => {} } });
    expect(supportsFullscreen()).toBe(true);
  });

  it('is true on Safari, which has only the prefixed ones', () => {
    stubDocument({
      webkitFullscreenEnabled: true,
      documentElement: { webkitRequestFullscreen: () => {} },
    });
    expect(supportsFullscreen()).toBe(true);
  });

  /* The iPhone: `fullscreenEnabled` is false and nothing but a `<video>` may take the screen. The
     button is not drawn there, because a button that does nothing is worse than no button. */
  it('is false on an iPhone', () => {
    stubDocument({ fullscreenEnabled: false, documentElement: {} });
    expect(supportsFullscreen()).toBe(false);
  });

  it('is false while there is no document at all', () => {
    vi.stubGlobal('document', undefined);
    expect(supportsFullscreen()).toBe(false);
    expect(fullscreenElement()).toBeNull();
    expect(isFullscreen()).toBe(false);
  });
});

describe('isFullscreen', () => {
  it('reads any of the three spellings', () => {
    const element = {} as HTMLElement;
    stubDocument({ webkitFullscreenElement: element });
    expect(isFullscreen()).toBe(true);
    expect(isFullscreen(element)).toBe(true);
    expect(isFullscreen({} as HTMLElement)).toBe(false);
  });
});

describe('toggleFullscreen', () => {
  it('asks the element, by whichever name it answers to', () => {
    const request = vi.fn().mockResolvedValue(undefined);
    stubDocument({ fullscreenElement: null });
    toggleFullscreen({ webkitRequestFullscreen: request } as unknown as HTMLElement);
    expect(request).toHaveBeenCalled();
  });

  it('exits when something is already full screen', () => {
    const exit = vi.fn().mockResolvedValue(undefined);
    const element = { requestFullscreen: vi.fn() } as unknown as HTMLElement;
    stubDocument({ fullscreenElement: element, exitFullscreen: exit });
    toggleFullscreen(element);
    expect(exit).toHaveBeenCalled();
    expect((element as unknown as { requestFullscreen: () => void }).requestFullscreen)
      .not.toHaveBeenCalled();
  });

  /* A permission policy in an iframe, or a browser that changed its mind: the ride screen is
     unaffected and nothing reaches the caller. */
  it('swallows a refusal, thrown or rejected', () => {
    stubDocument({ fullscreenElement: null });
    expect(() =>
      toggleFullscreen({
        requestFullscreen: () => {
          throw new Error('refused');
        },
      } as unknown as HTMLElement),
    ).not.toThrow();
    expect(() =>
      toggleFullscreen({
        requestFullscreen: () => Promise.reject(new Error('refused')),
      } as unknown as HTMLElement),
    ).not.toThrow();
  });

  it('does nothing without an element', () => {
    stubDocument({ fullscreenElement: null });
    expect(() => toggleFullscreen(null)).not.toThrow();
  });
});

describe('watchFullscreen', () => {
  it('listens for every spelling and removes every one it added', () => {
    const add = vi.fn();
    const remove = vi.fn();
    vi.stubGlobal('document', { addEventListener: add, removeEventListener: remove });

    const stop = watchFullscreen(() => {});
    // Escape and the browser's own exit are changes nobody told us about; the label follows them.
    expect(add.mock.calls.map((call) => call[0])).toEqual([
      'fullscreenchange',
      'webkitfullscreenchange',
      'MSFullscreenChange',
    ]);
    stop();
    expect(remove).toHaveBeenCalledTimes(3);
  });
});
