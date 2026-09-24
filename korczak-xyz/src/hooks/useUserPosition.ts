/*
 * The blue arrow: where the reader is and which way they are pointing.
 *
 * Two permissions with different manners. Geolocation can be asked for on load and the browser
 * shows its own prompt; the compass, on iOS, can only be asked for from inside a user gesture -
 * `DeviceOrientationEvent.requestPermission()` called on load rejects, silently, and the arrow
 * then points north for the whole walk with nothing to say why. That is a bug this app was ported
 * with: the original asked for the compass from inside the geolocation callback, which is not a
 * gesture. Here it is a button, shown only on the platform that needs one.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { describeError, log } from '../lib/logger';
import { recordMeasurement } from '../lib/sentry';
import {
  compassNeedsPermission,
  GEOLOCATION_OPTIONS,
  headingChanged,
  headingFrom,
  type PermissionState,
} from '../utils/audioGuide/geo';

export interface UserPosition {
  lat: number;
  lon: number;
  /** Metres. Drawn as the circle around the arrow, so a 2km city-level fix does not read as a fix. */
  accuracy: number;
}

export interface UserPositionState {
  position: UserPosition | null;
  permission: PermissionState;
  heading: number | null;
  /** True only where the compass must be asked for - that is, on iOS. */
  compassAsk: boolean;
  compass: PermissionState;
  enableCompass: () => void;
}

export function useUserPosition(): UserPositionState {
  const [position, setPosition] = useState<UserPosition | null>(null);
  const [permission, setPermission] = useState<PermissionState>('prompt');
  const [heading, setHeading] = useState<number | null>(null);
  const [compass, setCompass] = useState<PermissionState>('prompt');
  /*
   * Decided once, at first render rather than in an effect. The island is `client:only`, so there
   * is a `window` here; and a value that arrives one render late would let the "no permission
   * needed" branch below run first and grant a compass this platform will not give unasked.
   */
  const [compassAsk] = useState(() => compassNeedsPermission());

  // Read by the orientation listener, which is registered once and must not be re-registered on
  // every degree; state alone would make it a dependency of its own effect.
  const lastHeading = useRef<number | null>(null);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setPermission('unavailable');
      return;
    }

    // The first answer is measured: until it arrives the map sits on the fallback centre, and the
    // pins the reader came for are not even asked for yet. It includes the permission prompt.
    const startedAt = performance.now();
    let measured = false;
    const measure = (outcome: string, accuracy?: number) => {
      if (measured) return;
      measured = true;
      recordMeasurement('audioGuide.position.first', {
        outcome,
        ms: Math.round(performance.now() - startedAt),
        accuracyM: accuracy === undefined ? undefined : Math.round(accuracy),
      });
    };

    const id = navigator.geolocation.watchPosition(
      (fix) => {
        measure('fix', fix.coords.accuracy);
        setPermission('granted');
        setPosition({
          lat: fix.coords.latitude,
          lon: fix.coords.longitude,
          accuracy: fix.coords.accuracy,
        });
      },
      (error) => {
        // A denial is permanent until the reader changes it in browser settings; a timeout or an
        // unavailable position may well answer on the next tick, so it must not be latched.
        if (error.code === error.PERMISSION_DENIED) {
          measure('denied');
          setPermission('denied');
        } else {
          setPermission((current) => (current === 'granted' ? current : 'prompt'));
        }
        log.info('audioGuide.location.error', { code: error.code, message: error.message });
      },
      GEOLOCATION_OPTIONS,
    );

    return () => navigator.geolocation.clearWatch(id);
  }, []);

  const listen = useCallback(() => {
    const onOrientation = (event: DeviceOrientationEvent) => {
      const next = headingFrom(event);
      if (next === null) return;
      if (!headingChanged(lastHeading.current, next)) return;
      lastHeading.current = next;
      setHeading(next);
    };

    // `true` for the capture phase, matching what iOS documents for this event.
    window.addEventListener('deviceorientation', onOrientation, true);
    return () => window.removeEventListener('deviceorientation', onOrientation, true);
  }, []);

  /*
   * Where no permission is needed the compass is simply on — this only records that, so the one
   * effect below has a single condition to watch. It must not also attach the listener: setting
   * state from an effect that owns the listener tears it straight back down on the re-render, and
   * the symptom is an arrow that works for one frame on Android and never again.
   */
  useEffect(() => {
    if (compassAsk) return;
    setCompass(
      typeof window !== 'undefined' && 'DeviceOrientationEvent' in window ?
        'granted'
      : 'unavailable',
    );
  }, [compassAsk]);

  // The one place the listener is attached, on both platforms. Where permission was required,
  // `granted` arrives from the button; where it was not, from the effect above.
  useEffect(() => {
    if (compass !== 'granted') return;
    return listen();
  }, [compass, listen]);

  /*
   * Called straight from the button's onClick with nothing awaited before it. iOS checks that the
   * call is inside a gesture, and a single `await` before this point loses it - which is the same
   * trap the speech engine has in the backseat app.
   */
  const enableCompass = useCallback(() => {
    const request = (
      DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }
    ).requestPermission;
    if (typeof request !== 'function') {
      setCompass('granted');
      return;
    }

    request()
      .then((state) => setCompass(state === 'granted' ? 'granted' : 'denied'))
      .catch((e) => {
        setCompass('denied');
        log.warn('audioGuide.compass.refused', describeError(e));
      });
  }, []);

  return { position, permission, heading, compassAsk, compass, enableCompass };
}
