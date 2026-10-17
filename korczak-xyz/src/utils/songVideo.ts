import songVideos from '../data/songVideos.json';
import type { VideoEntry } from '../components/Video';

const bySlug: Record<string, VideoEntry> = songVideos;

/**
 * A song's video, by slug. Not embedded in the song's MDX: `songVideos.json` is the whole record,
 * written by `scripts/song-videos.mjs` — on a laptop or, for a recording uploaded from
 * `/apps/admin/`, by `.github/workflows/song-video-inbox.yml`. See .claude/rules/songbook.md, *Videos*.
 */
export function songVideo(slug: string): VideoEntry | undefined {
  return bySlug[slug];
}

/**
 * Whether a song has a video — the page's toggle and the 📺 marker in the list. A `<Youtube>` left
 * in a song's body by hand still counts, so a song added the old way keeps both.
 */
export function hasSongVideo(slug: string, body: string | undefined): boolean {
  return songVideo(slug) !== undefined || /<(Video|Youtube)\b/.test(body ?? '');
}
