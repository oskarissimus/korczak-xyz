/*
 * What the audio guide passes around.
 *
 * An attraction is an OpenStreetMap element that survived `transformAttractions` - it has a name
 * and a position, which are the two things the rest of the app cannot do without. Everything else
 * OSM knows about it is kept in `tags` and used only to name a category for the prompt.
 */

/** The map's current rectangle, in the order Overpass writes one. */
export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface Attraction {
  /** OSM element id. Unique only within its `type`, which is why `key` exists. */
  id: number;
  type: 'node' | 'way' | 'relation';
  /**
   * `${type}/${id}` - the stable identity used for marker bookkeeping and for deciding whether
   * a tap is a re-tap. OSM reuses the same numeric id across the three element types, so a node
   * and a way in the same viewport can collide on `id` alone; the loser of that collision never
   * gets a marker.
   */
  key: string;
  name: string;
  lat: number;
  lon: number;
  /** An OSM tag value (`museum`, `historic:castle`), handed to the model as-is. */
  category: string;
}

/**
 * The generation state machine, in the order it runs.
 *
 * `generating` is one state rather than the three the backend actually goes through (facts,
 * script, voice). The browser cannot see those transitions - the Cloud Function answers once,
 * with an MP3 - so a status that claimed to know them would be a lie told by a timer. The
 * progress bar tells that story instead, and is honest about being an estimate.
 */
export type GuideStatus = 'idle' | 'generating' | 'ready' | 'error';

export interface AudioGuide {
  attractionKey: string;
  attractionName: string;
  /** Object URL for the MP3. Revoked when the guide is replaced - see `useAudioGuide`. */
  audioUrl: string;
  /**
   * Set when the backend could not reverse-geocode the coordinates, in which case the narration
   * was written from the name and category alone and is more likely to be generic or wrong.
   */
  locationWarning: string | null;
}
