/*
 * Where the reader is, and which way they are facing.
 *
 * Both are device permissions and neither is required: the map works without them - it just
 * opens where it last was rather than where you are, and the arrow points north rather than the
 * way you are walking. That is why nothing here throws. A refusal is a state the app renders,
 * not an error it reports.
 */

export type PermissionState = 'prompt' | 'granted' | 'denied' | 'unavailable';

/**
 * A compass heading out of a `deviceorientation` event, or null if the event carries none.
 *
 * TWO PLATFORMS, TWO ANSWERS. iOS gives `webkitCompassHeading`, already degrees clockwise from
 * true north, which is exactly what a map marker wants. Everyone else gives `alpha`, which is
 * counter-clockwise from the device's own zero, so it is subtracted from 360 rather than used.
 *
 * `alpha` is a rotation of the DEVICE, not of the screen, so on a phone held in landscape it is
 * off by the screen rotation. That is not corrected here and the arrow is wrong by ninety degrees
 * in that case - which is a knowable bug rather than an unknown one. Correcting it needs
 * `screen.orientation.angle`, and the fix is worth making the day somebody walks around with the
 * phone sideways; until then the untilted upright case is the one that is right.
 */
export function headingFrom(event: DeviceOrientationEvent): number | null {
  const webkit = (event as DeviceOrientationEvent & { webkitCompassHeading?: number })
    .webkitCompassHeading;
  if (typeof webkit === 'number' && Number.isFinite(webkit)) return webkit;
  if (typeof event.alpha === 'number' && Number.isFinite(event.alpha)) {
    return (360 - event.alpha) % 360;
  }
  return null;
}

/**
 * Whether the compass has to be asked for.
 *
 * iOS 13 put `DeviceOrientationEvent.requestPermission` behind a user gesture; every other
 * browser fires the events unasked. The distinction matters to the UI, not just to the call:
 * where permission is required there has to be a button, because there is no other way to get a
 * gesture, and a button that does nothing on Android would be worse than none.
 */
export function compassNeedsPermission(): boolean {
  return (
    typeof DeviceOrientationEvent !== 'undefined' &&
    typeof (DeviceOrientationEvent as unknown as { requestPermission?: unknown })
      .requestPermission === 'function'
  );
}

/** How far the heading must move before the arrow is redrawn. */
export const HEADING_EPSILON_DEG = 2;

/**
 * Redrawing the arrow replaces a Leaflet icon, which is a DOM write. The compass reports many
 * times a second and a phone's magnetometer jitters by a degree or two standing still, so without
 * this the map rewrites a node continuously while nothing is happening.
 */
export function headingChanged(previous: number | null, next: number): boolean {
  if (previous === null) return true;
  const delta = Math.abs(((next - previous + 540) % 360) - 180);
  return delta >= HEADING_EPSILON_DEG;
}

export const GEOLOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10_000,
  // A fix from the last five seconds is the same street corner, and reusing it saves the radio.
  maximumAge: 5_000,
};
