/*
 * The map, which is the one part of this app React does not own.
 *
 * Leaflet keeps its own DOM and its own event loop, so this component is a shell around a `div`
 * that React is told never to touch again: the map is created once in an effect, and everything
 * after that — markers appearing, a pin turning blue, the arrow swinging round — is an imperative
 * update driven by props. Rendering markers as React children of a Leaflet layer is the obvious
 * alternative and it is how you get two frameworks writing to the same nodes.
 *
 * MARKERS ARE DIFFED, NOT REDRAWN. Panning a block changes a handful of the hundred pins on
 * screen; clearing the layer and adding them all back drops the selection, restarts the
 * animation on the pin currently generating, and janks the pan itself. So the map holds a
 * `Map<key, marker>` and adds and removes against it.
 *
 * WHY DIVICON AND NOT A REAL MARKER IMAGE. Each pin carries its name — a map of identical
 * speaker icons tells you there is something here but not whether it is worth twenty seconds —
 * and the label has to be styled and truncated, which an image cannot be. The cost is that every
 * pin is real DOM, which is exactly why `MAX_MARKERS` exists.
 */

import { useEffect, useRef } from 'react';
import L from 'leaflet';

import type { Attraction, Bounds } from '../../utils/audioGuide/types';

/** Where the map opens before it knows better: Warsaw's old town. */
const FALLBACK_CENTER: [number, number] = [52.2497, 21.0122];
const FALLBACK_ZOOM = 15;

/** Close enough to read street names, which is the zoom an audio guide is used at. */
const LOCATED_ZOOM = 16;

interface MapPaneProps {
  attractions: Attraction[];
  selectedKey: string | null;
  generatingKey: string | null;
  user: { lat: number; lon: number; accuracy: number } | null;
  heading: number | null;
  onSelect: (attraction: Attraction) => void;
  /** The rectangle on screen and the zoom it is drawn at, after every pan and zoom. */
  onBoundsChange: (bounds: Bounds, zoom: number) => void;
  /** For the tile layer's `alt` and the map container's label. */
  label: string;
}

function speakerIcon(name: string, selected: boolean): L.DivIcon {
  // Truncated in the markup rather than by CSS: an ellipsis on one line is the whole point, and
  // a label that wraps to three lines covers the pin beside it.
  const shown = name.length > 22 ? `${name.slice(0, 20)}…` : name;
  const colour = selected ? '#000080' : '#202020';

  return L.divIcon({
    className: `ag-marker${selected ? ' ag-marker-selected' : ''}`,
    html: `<span class="ag-marker-body">
        <span class="ag-marker-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18">
            <path d="M3 9v6h4l5 5V4L7 9H3z" fill="${colour}"/>
            <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" fill="${colour}"/>
          </svg>
        </span>
        <span class="ag-marker-label">${escapeHtml(shown)}</span>
      </span>`,
    iconSize: [104, 34],
    // Anchored on the speaker glyph, not on the middle of the pill: the point is the place, and
    // a pill centred on it puts its icon half a label to the left of the building it names. The
    // label then runs to the right of the spot, the way a caption does.
    iconAnchor: [15, 17],
  });
}

/** Names come from OSM, which is to say from strangers. */
function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

function arrowIcon(heading: number | null): L.DivIcon {
  // No heading means no claim about which way you are facing: a dot, not an arrow pointing north
  // and being wrong about it.
  const html =
    heading === null ?
      '<span class="ag-user-dot"></span>'
    : `<span class="ag-user-arrow" style="transform: rotate(${heading}deg)">
         <svg viewBox="0 0 24 24" width="26" height="26">
           <path d="M12 2 5 20l7-4 7 4z" fill="#0040ff" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>
         </svg>
       </span>`;

  return L.divIcon({ className: 'ag-user', html, iconSize: [26, 26], iconAnchor: [13, 13] });
}

export default function MapPane({
  attractions,
  selectedKey,
  generatingKey,
  user,
  heading,
  onSelect,
  onBoundsChange,
  label,
}: MapPaneProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef(new Map<string, L.Marker>());
  const userMarker = useRef<L.Marker | null>(null);
  const accuracyRing = useRef<L.Circle | null>(null);
  const centred = useRef(false);

  // Props the Leaflet callbacks read. They are registered once — re-registering `moveend` on
  // every render would mean a handler per render, all still attached.
  const latest = useRef({ onSelect, onBoundsChange });
  latest.current = { onSelect, onBoundsChange };

  useEffect(() => {
    if (!container.current || map.current) return;

    const instance = L.map(container.current, {
      center: FALLBACK_CENTER,
      zoom: FALLBACK_ZOOM,
      // Leaflet's own zoom buttons are 26px squares in the corner the player bar covers, and a
      // phone pinches. The keyboard still zooms, which is what they were there for.
      zoomControl: false,
      tapTolerance: 15,
    });

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      // Required by the tile usage policy, and the reason this string is not in translations:
      // it is a licence notice, not a sentence about the app.
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(instance);

    const report = () => {
      const bounds = instance.getBounds();
      latest.current.onBoundsChange(
        {
          south: bounds.getSouth(),
          west: bounds.getWest(),
          north: bounds.getNorth(),
          east: bounds.getEast(),
        },
        instance.getZoom(),
      );
    };

    instance.on('moveend', report);
    instance.on('zoomend', report);
    map.current = instance;
    report();

    // Leaflet measures its container once and then only on a window resize. Going full screen
    // resizes the container without one, and a map that does not know leaves grey where the new
    // space is and pins placed for the old size. Its `moveend` then reports the larger bounds.
    const resized = new ResizeObserver(() => instance.invalidateSize());
    resized.observe(container.current);

    return () => {
      resized.disconnect();
      instance.remove();
      map.current = null;
      markers.current.clear();
      userMarker.current = null;
      accuracyRing.current = null;
    };
  }, []);

  // --- the pins ---------------------------------------------------------------------------
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;

    const wanted = new Map(attractions.map((a) => [a.key, a]));

    for (const [key, marker] of markers.current) {
      if (!wanted.has(key)) {
        marker.remove();
        markers.current.delete(key);
      }
    }

    for (const attraction of attractions) {
      if (markers.current.has(attraction.key)) continue;
      const marker = L.marker([attraction.lat, attraction.lon], {
        icon: speakerIcon(attraction.name, false),
        // A tap on a pin must not also be a tap on the map underneath it.
        bubblingMouseEvents: false,
        // The name is on the pin, but a screen reader reads the marker, not the label.
        alt: attraction.name,
        keyboard: true,
      })
        .addTo(instance)
        .on('click', () => latest.current.onSelect(attraction));
      markers.current.set(attraction.key, marker);
    }
  }, [attractions]);

  // Selection and the generating pulse are icon and class changes on existing markers, kept out
  // of the diff above so panning during a generation does not restart its animation.
  useEffect(() => {
    for (const [key, marker] of markers.current) {
      const attraction = attractions.find((a) => a.key === key);
      if (attraction) marker.setIcon(speakerIcon(attraction.name, key === selectedKey));
      marker.getElement()?.classList.toggle('ag-marker-generating', key === generatingKey);
    }
  }, [attractions, selectedKey, generatingKey]);

  // --- the arrow --------------------------------------------------------------------------
  useEffect(() => {
    const instance = map.current;
    if (!instance || !user) return;

    const point: [number, number] = [user.lat, user.lon];

    if (!userMarker.current) {
      userMarker.current = L.marker(point, {
        icon: arrowIcon(heading),
        // Above every pin: it is the one marker whose position is a fact rather than a label.
        zIndexOffset: 1000,
        interactive: false,
      }).addTo(instance);
    } else {
      userMarker.current.setLatLng(point);
      userMarker.current.setIcon(arrowIcon(heading));
    }

    // The accuracy ring is not decoration. A first fix off a cell tower can be a kilometre wide,
    // and an arrow drawn without one says "you are here" about a place you are not.
    if (!accuracyRing.current) {
      accuracyRing.current = L.circle(point, {
        radius: user.accuracy,
        color: '#0040ff',
        weight: 1,
        fillOpacity: 0.08,
        interactive: false,
      }).addTo(instance);
    } else {
      accuracyRing.current.setLatLng(point);
      accuracyRing.current.setRadius(user.accuracy);
    }

    // Centre on the first fix only. After that the map belongs to whoever is panning it —
    // recentring on every position update makes the map fight the hand dragging it.
    if (!centred.current) {
      centred.current = true;
      instance.setView(point, LOCATED_ZOOM);
    }
  }, [user, heading]);

  return <div ref={container} className="ag-map" role="application" aria-label={label} />;
}
