import Youtube from './Youtube';
import songVideos from '@/data/songVideos.json';

/*
 * A songbook video, served from our own R2 bucket once it has been uploaded and from YouTube
 * until then. The MDX names the YouTube id either way, because that is the one key both sides
 * share: `scripts/song-videos.mjs` reads it out of the song file, uploads the transcode, and
 * records it in `songVideos.json` — so a song switches over in the commit that adds its entry,
 * and a song nobody has uploaded yet goes on playing from YouTube. See .claude/rules/songbook.md.
 */
export const MEDIA_ORIGIN = 'https://media.korczak.xyz';

type SongVideo = { file: string; width: number; height: number };
const videos: Record<string, SongVideo> = songVideos;

export default function Video({ youtubeId }: { youtubeId: string }) {
  const video = videos[youtubeId];
  if (!video) return <Youtube videoId={youtubeId} />;

  const base = `${MEDIA_ORIGIN}/songs/${video.file}`;
  return (
    // The inline aspect-ratio is load-bearing: song.css hides the video toggle's target by it.
    <div className="video-embed" style={{
      position: 'relative',
      width: '100%',
      aspectRatio: `${video.width}/${video.height}`,
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
