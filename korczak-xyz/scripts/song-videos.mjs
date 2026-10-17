#!/usr/bin/env node
/**
 * Moves our own videos off YouTube and into the R2 bucket behind media.korczak.xyz: every song's,
 * under songs/<slug>, and every blog post's `<Video>`, under blog/<youtubeId> (a post can carry
 * several and has no better name for each). A blog `<Youtube>` is somebody else's and is left alone.
 *
 * Runs on a laptop, not in CI: it needs yt-dlp signed in as the channel's owner (or the original
 * files), ffmpeg, and a `wrangler login` with R2 access. The bucket and its domain are not made
 * here — terraform/cloudflare/media.tf declares them and CI applies it. Nothing in the build depends on it — the
 * site only reads src/data/videos.json, and a video missing from that file still plays from
 * YouTube (src/components/Video.tsx). So the run can stop anywhere and be started again: the
 * manifest is written after every video, and a video already in it is skipped.
 *
 *   node scripts/song-videos.mjs                         every video not yet in the manifest
 *   node scripts/song-videos.mjs --only barka            one video (song slug or YouTube id)
 *   node scripts/song-videos.mjs --src ~/Videos/songs    originals named <slug>.* or <youtubeId>.*
 *   node scripts/song-videos.mjs --browser firefox       which browser yt-dlp takes cookies from
 *   node scripts/song-videos.mjs --force                 redo videos already in the manifest
 *   node scripts/song-videos.mjs --dry-run               download and transcode, upload nothing
 *
 * Then commit src/data/videos.json and push: each entry flips its video over on that deploy.
 *
 * Why it looks like this is in .claude/rules/songbook.md, *Videos*.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SONGS_DIR = join(ROOT, 'src/content/songs/pl');
const BLOG_DIR = join(ROOT, 'src/content/blog');
const MANIFEST = join(ROOT, 'src/data/videos.json');
const WORK = join(ROOT, '.song-videos');

const BUCKET = 'korczak-xyz-media';
const DOMAIN = 'media.korczak.xyz';
// The file name carries a hash of its contents, so it can be cached forever: a re-encode is a
// new name, and the manifest commit is what points the page at it.
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};

function run(cmd, cmdArgs, { capture = false } = {}) {
  const result = spawnSync(cmd, cmdArgs, {
    cwd: ROOT,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
  });
  if (result.error) throw new Error(`${cmd}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${cmd} ${cmdArgs.join(' ')} exited ${result.status}`);
  return result.stdout;
}

function requireTool(cmd, hint) {
  const result = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
  if (result.error) {
    console.error(`${cmd} not found. ${hint}`);
    process.exit(1);
  }
}

const wrangler = (wranglerArgs) => run('npx', ['wrangler', ...wranglerArgs]);

/**
 * Every video to self-host: `dir` and `name` make its object key, and `youtubeId` is what the MDX
 * names. A song is named by its slug; a blog video by its id, once however many locales embed it.
 */
function videos() {
  const songs = readdirSync(SONGS_DIR)
    .filter((name) => name.endsWith('.mdx'))
    .flatMap((name) => {
      const text = readFileSync(join(SONGS_DIR, name), 'utf8');
      const youtubeId = text.match(/<Video youtubeId="([^"]+)"/)?.[1];
      const slug = text.match(/^slug:\s*(\S+)\s*$/m)?.[1];
      return youtubeId && slug ? [{ dir: 'songs', name: slug, youtubeId }] : [];
    });
  const blogIds = new Set(
    readdirSync(BLOG_DIR, { recursive: true })
      .filter((name) => name.endsWith('.mdx'))
      .flatMap((name) => [...readFileSync(join(BLOG_DIR, name), 'utf8').matchAll(/<Video youtubeId="([^"]+)"/g)])
      .map((match) => match[1]),
  );
  const blog = [...blogIds].map((youtubeId) => ({ dir: 'blog', name: youtubeId, youtubeId }));
  return [...songs, ...blog].sort((a, b) => `${a.dir}/${a.name}`.localeCompare(`${b.dir}/${b.name}`));
}

function readManifest() {
  return existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
}

function writeManifest(manifest) {
  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(MANIFEST, `${JSON.stringify(sorted, null, 2)}\n`);
}

function findOriginal(srcDir, { name, youtubeId }) {
  if (!srcDir) return undefined;
  const match = readdirSync(srcDir).find((entry) => {
    const stem = entry.replace(/\.[^.]+$/, '');
    return stem === name || stem === youtubeId;
  });
  return match && join(srcDir, match);
}

function download({ youtubeId }) {
  const dir = join(WORK, 'source');
  mkdirSync(dir, { recursive: true });
  const existing = readdirSync(dir).find((name) => name.startsWith(`${youtubeId}.`));
  if (existing) return join(dir, existing);
  run('yt-dlp', [
    // Signed in, because YouTube asks anonymous downloaders to prove they are not a bot after a
    // couple of dozen videos, and because the channel's owner is the one doing the asking.
    '--cookies-from-browser', option('browser') ?? 'chrome',
    '-f', 'bv*[height<=1080]+ba/b[height<=1080]',
    '--merge-output-format', 'mp4',
    '-o', join(dir, '%(id)s.%(ext)s'),
    `https://www.youtube.com/watch?v=${youtubeId}`,
  ]);
  return join(dir, readdirSync(dir).find((name) => name.startsWith(`${youtubeId}.`)));
}

function transcode(input, slug) {
  const dir = join(WORK, 'out');
  mkdirSync(dir, { recursive: true });
  const mp4 = join(dir, `${slug}.mp4`);
  const jpg = join(dir, `${slug}.jpg`);
  // 720p is enough to read a chord shape off the fretboard, and a static shot of one guitarist
  // compresses well at CRF 23. H.264/AAC plays natively everywhere, iOS included, with no player
  // script; +faststart moves the index to the front so playback starts before the download ends.
  run('ffmpeg', [
    '-y', '-loglevel', 'error', '-stats', '-i', input,
    '-vf', "scale=-2:'min(720,ih)'",
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    mp4,
  ]);
  run('ffmpeg', [
    '-y', '-loglevel', 'error', '-ss', '3', '-i', mp4,
    '-frames:v', '1', '-q:v', '3', jpg,
  ]);
  const [width, height] = run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', mp4,
  ], { capture: true }).trim().split(',').map(Number);
  return { mp4, jpg, width, height };
}

function upload(localPath, key, contentType) {
  wrangler([
    'r2', 'object', 'put', `${BUCKET}/${key}`,
    '--file', localPath, '--content-type', contentType, '--cache-control', CACHE_CONTROL, '--remote',
  ]);
}

function migrate() {
  const srcDir = option('src') && resolve(option('src'));
  const only = option('only');
  const dryRun = flag('dry-run');
  const force = flag('force');

  if (!srcDir) requireTool('yt-dlp', 'brew install yt-dlp (or pass --src with the original files).');
  requireTool('ffmpeg', 'brew install ffmpeg');

  const manifest = readManifest();
  const todo = videos().filter((video) =>
    (only ? video.name === only || video.youtubeId === only : true) &&
    (force || !manifest[video.youtubeId]));

  if (todo.length === 0) {
    console.log(only ? `Nothing to do for ${only}.` : 'Every video is already in the manifest.');
    return;
  }

  const failed = [];
  for (const [i, video] of todo.entries()) {
    console.log(`\n[${i + 1}/${todo.length}] ${video.dir}/${video.name} (${video.youtubeId})`);
    try {
      const input = findOriginal(srcDir, video) ?? download(video);
      const { mp4, jpg, width, height } = transcode(input, video.name);
      const hash = createHash('sha256').update(readFileSync(mp4)).digest('hex').slice(0, 8);
      const file = `${video.dir}/${video.name}.${hash}`;
      if (dryRun) {
        console.log(`  would upload ${file}.mp4 and .jpg (${width}×${height})`);
        continue;
      }
      upload(mp4, `${file}.mp4`, 'video/mp4');
      upload(jpg, `${file}.jpg`, 'image/jpeg');
      manifest[video.youtubeId] = { file, width, height };
      writeManifest(manifest);
      console.log(`  https://${DOMAIN}/${file}.mp4`);
    } catch (error) {
      console.error(`  failed: ${error.message}`);
      failed.push(video.name);
    }
  }

  if (failed.length) console.error(`\nFailed: ${failed.join(', ')} — run again to retry just these.`);
  if (!dryRun) console.log('\nCommit src/data/videos.json and push to switch these videos over.');
}

migrate();
