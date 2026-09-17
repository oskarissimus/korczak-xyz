/*
 * The one thing a browser cannot do for sloper: turn N stills and N narrations into one MP4.
 *
 * A port of sloper's `backend/src/services/ffmpeg.py`, same four-step pipeline and the same
 * flags, because those flags are load-bearing:
 *
 *   scale=...:force_original_aspect_ratio=decrease,pad=...   The image models serve their own
 *       sizes (DALL-E 3 will not draw 1024x1536; Gemini takes a ratio, not pixels), so the frame
 *       almost never matches the requested resolution. Fit inside and letterbox, rather than
 *       stretch — a stretched face is the most obvious kind of wrong.
 *   -pix_fmt yuv420p   Without it, libx264 picks yuv444p for some inputs and QuickTime, Safari
 *       and every social platform refuse to play the result.
 *   concat demuxer + -c copy   The segments were all encoded here with identical settings, so
 *       the concatenation is a remux. Re-encoding at this step would cost minutes and a
 *       generation of quality for nothing.
 *   -shortest on the merge   The video is built to the audio's own durations, but rounding to a
 *       whole number of frames leaves the two a few milliseconds apart; without this the file
 *       ends with a frozen frame or a clipped word.
 *
 * ONE DIFFERENCE FROM THE PYTHON. It probed the finished file with `ffprobe` to report a
 * duration. `ffmpeg-static` ships ffmpeg and not ffprobe, and the number is only ever displayed,
 * so the duration reported here is the sum of the scene durations the client sent — which is
 * what the video was built to, to within the rounding `-shortest` then trims.
 */

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import ffmpegPath from 'ffmpeg-static';

/** Longer than any single step should take; the caller bounds the whole request separately. */
const STEP_TIMEOUT_MS = 240_000;

/**
 * FFmpeg is loud on stderr — a progress line per frame — and none of it is wanted unless the
 * command failed, at which point the tail of it is the only thing that says why.
 */
const MAX_STDERR_BYTES = 256 * 1024;

function ffmpegBinary(): string {
  if (!ffmpegPath) {
    throw new Error('ffmpeg-static did not resolve a binary for this platform');
  }
  return ffmpegPath;
}

function run(args: string[], what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      ffmpegBinary(),
      args,
      { timeout: STEP_TIMEOUT_MS, maxBuffer: MAX_STDERR_BYTES },
      (error, _stdout, stderr) => {
        if (!error) {
          resolve();
          return;
        }
        // The last few lines carry the actual complaint; the rest is the banner and progress.
        const tail = String(stderr || '').trim().split('\n').slice(-6).join('\n');
        reject(new Error(`${what}: ${tail || error.message}`));
      },
    );
  });
}

/** One still, held for `duration` seconds, letterboxed into the output frame. */
async function createImageSegment(
  imagePath: string,
  duration: number,
  resolution: { width: number; height: number },
  frameRate: number,
  outputPath: string,
): Promise<void> {
  const { width, height } = resolution;
  await run(
    [
      '-y',
      '-loop', '1',
      '-i', imagePath,
      '-t', String(duration),
      '-vf',
      `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
      '-r', String(frameRate),
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      outputPath,
    ],
    'Could not build a video segment from one of the images',
  );
}

/**
 * Join the segments without re-encoding.
 *
 * `-safe 0` is needed because the list holds absolute paths, which the demuxer refuses by
 * default. The paths are ours — a temp directory this process made — not anything a caller named.
 */
async function concatSegments(
  segmentPaths: string[],
  listPath: string,
  outputPath: string,
): Promise<void> {
  await fs.writeFile(listPath, segmentPaths.map((p) => `file '${p}'\n`).join(''), 'utf8');
  await run(
    ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath],
    'Could not join the video segments',
  );
}

/** Join the narrations end to end into one AAC track. */
async function concatAudio(audioPaths: string[], outputPath: string): Promise<void> {
  const inputs = audioPaths.flatMap((p) => ['-i', p]);
  const streams = audioPaths.map((_, i) => `[${i}:a]`).join('');
  await run(
    [
      '-y',
      ...inputs,
      '-filter_complex', `${streams}concat=n=${audioPaths.length}:v=0:a=1[out]`,
      '-map', '[out]',
      '-c:a', 'aac',
      outputPath,
    ],
    'Could not join the narration',
  );
}

async function mergeVideoAudio(
  videoPath: string,
  audioPath: string,
  outputPath: string,
): Promise<void> {
  await run(
    [
      '-y',
      '-i', videoPath,
      '-i', audioPath,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-shortest',
      outputPath,
    ],
    'Could not lay the narration over the video',
  );
}

export interface AssembleArgs {
  imagePaths: string[];
  audioPaths: string[];
  sceneDurations: number[];
  resolution: { width: number; height: number };
  frameRate: number;
  workDir: string;
  outputPath: string;
}

/** Runs the four steps and returns the video's duration in seconds. */
export async function assemble(args: AssembleArgs): Promise<number> {
  const { imagePaths, audioPaths, sceneDurations, resolution, frameRate, workDir, outputPath } = args;

  // Sequential rather than parallel on purpose: libx264 already uses every core the instance
  // has, so N encodes at once only compete for the same CPU and multiply peak memory.
  const segmentPaths: string[] = [];
  for (let i = 0; i < imagePaths.length; i++) {
    const segmentPath = path.join(workDir, `segment_${i}.mp4`);
    await createImageSegment(imagePaths[i], sceneDurations[i], resolution, frameRate, segmentPath);
    segmentPaths.push(segmentPath);
  }

  const silentPath = path.join(workDir, 'silent.mp4');
  await concatSegments(segmentPaths, path.join(workDir, 'segments.txt'), silentPath);

  const audioPath = path.join(workDir, 'narration.m4a');
  await concatAudio(audioPaths, audioPath);

  await mergeVideoAudio(silentPath, audioPath, outputPath);

  return sceneDurations.reduce((sum, d) => sum + d, 0);
}
