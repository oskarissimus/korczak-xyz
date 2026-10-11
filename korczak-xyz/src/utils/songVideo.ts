/**
 * Whether a song's MDX body embeds a video. `<Video>` is what the songbook writes now; `<Youtube>`
 * is still accepted so a song added the old way keeps its toggle and its 📺 marker.
 */
export function hasSongVideo(body: string | undefined): boolean {
  return /<(Video|Youtube)\b/.test(body ?? '');
}
