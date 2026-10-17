import Youtube from './Youtube';
import videoManifest from '@/data/videos.json';

/*
 * One of our own blog videos, served from our R2 bucket once it has been uploaded and from YouTube
 * until then. The MDX names the YouTube id, because that is the one key both sides share:
 * `scripts/song-videos.mjs` reads it out of the MDX, uploads the transcode, and records it in
 * `videos.json`. Somebody else's video (a recorded talk) stays a plain `<Youtube>`.
 *
 * The songs' videos are not embedded in their MDX at all: `SongPostPage` draws them from
 * `songVideos.json` by slug, so a new recording needs no edit to the song. Both go through
 * `SelfHostedVideo` below. See .claude/rules/songbook.md, *Videos*.
 */
export const MEDIA_ORIGIN = 'https://media.korczak.xyz';

// `file` is the object key without its extension: `songs/<slug>.<hash>` or `blog/<id>.<hash>`.
export type VideoEntry = { file: string; width: number; height: number };
const videos: Record<string, VideoEntry> = videoManifest;

export default function Video({ youtubeId }: { youtubeId: string }) {
  const video = videos[youtubeId];
  if (!video) return <Youtube videoId={youtubeId} />;
  return <SelfHostedVideo video={video} />;
}

export function SelfHostedVideo({ video }: { video: VideoEntry }) {
  const base = `${MEDIA_ORIGIN}/${video.file}`;
  return (
    // The inline aspect-ratio is load-bearing: song.css hides the video toggle's target by it.
    <div className="video-embed" style={{
      position: 'relative',
      width: '100%',
      aspectRatio: `${video.width}/${video.height}`,
      // A phone clip filmed upright would otherwise be twice as tall as the screen at full width;
      // capped, it letterboxes on the black background the way the YouTube player did.
      maxHeight: '80vh',
      marginBottom: '2rem',
      border: '3px inset #808080',
      background: '#000'
    }}>
      <video
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
        src={`${base}.mp4`}
        poster={`${base}.jpg`}
        width={video.width}
        height={video.height}
        controls
        playsInline
        preload="none"
      />
    </div>
  );
}
