/*
 * Assembling a video for a page that is not watching.
 *
 * THE DIFFERENCE FROM THE HANDLER NEXT DOOR. `handleAssembleVideo`'s multipart mode is a
 * conversation: the browser sends thirty megabytes, waits through the encode on a streamed
 * heartbeat, and catches the MP4 on the way back. Every byte of that is in flight, so closing the
 * tab throws away an encode that was already paid for — which is the one step of that wizard
 * where leaving cost anything, since the pictures and the narrations were saved the moment they
 * existed.
 *
 * Here the browser sends a project id. Everything the assembler needs is already in the account —
 * the job document says which objects to use and for how long, the bucket holds the bytes — so
 * nothing about this depends on the caller still being there. The finished video goes into the
 * bucket and its path goes into the job document and into the project, and the page reads the
 * answer whenever it next looks, which may be on another device a day later.
 *
 * THE CLAIM IS A TRANSACTION, AND THAT IS WHAT MAKES A SECOND POKE FREE. A job is started by an
 * HTTP request, and there is no queue in front of it: a page reopened while an encode is running
 * pokes again, a user pressing Assemble twice pokes twice, and a retried request after a network
 * wobble pokes a third time. Exactly one of those may run ffmpeg. `claim` is the whole of that —
 * `queued` (or a `running` whose heartbeat has stopped) becomes `running` inside a transaction,
 * and everybody else is told, truthfully, that it is already being dealt with.
 *
 * WHY THERE IS NO SWEEPER. Nothing polls for abandoned jobs, and the omission is deliberate: the
 * only moment anybody cares whether a video got made is the moment they come back to look at it,
 * and that is exactly the moment there is a page present to ask again. A scheduled function would
 * be a permanent bill for a case the reopening already covers. `jobNeedsStarting` is the rule
 * both ends read.
 *
 * WHAT IT WRITES WHERE, AND THE ONE RACE IN IT. The job document is this function's; the project
 * document is the browser's, written whole with `setDoc` and no merge (see `projects.ts`). So the
 * video goes into the job document as the record of what happened, and into the project with a
 * `merge` of two fields, which a browser autosave that was already in flight can still overwrite.
 * That heals itself and is meant to: the page learns the video from the JOB, which makes its own
 * next save carry it. A page that was closed never races at all, and the merge is what the Open
 * window reads for its "has a video" mark.
 */

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getStorage } from 'firebase-admin/storage';

import { db, SLOPER_BUCKET } from '../runtime';
import { assemble } from './ffmpeg';
import { BadRequestError } from './metadata';
import {
  ASSEMBLY_JOBS,
  AssemblyJobError,
  MAX_ATTEMPTS,
  assemblyJobId,
  isInProjectFolder,
  jobIsStale,
  readAssemblyJob,
  videoObjectPath,
  type AssemblyJob,
} from '../../../korczak-xyz/src/utils/sloper/job';

/**
 * How much may be fetched out of the bucket for one video.
 *
 * `/tmp` on Cloud Run is memory, and this instance has 2 GiB for the inputs, the per-scene
 * segments, the joined track and the output at once. The multipart path's 32 MiB was a limit on
 * what an HTTP request could carry rather than on what ffmpeg could stand, so it does not apply
 * here — but "no limit" would mean a hand-edited job document can decide how much memory to ask
 * for, and that ends as an instance kill rather than a message.
 */
const MAX_INPUT_BYTES = 256 * 1024 * 1024;

/** The same argument on the way out. A video over this is not one this app can have made. */
const MAX_VIDEO_BYTES = 512 * 1024 * 1024;

/** Often enough that `STALE_MS` can be minutes rather than hours; rare enough to be free. */
const HEARTBEAT_MS = 15_000;

/** Long enough to be useful, short enough not to put ffmpeg's whole stderr in a document. */
const MAX_ERROR_CHARS = 500;

export type JobOutcome =
  /** This call did the work. */
  | { started: true; scenes: number; bytes: number; durationS: number }
  /** Somebody else is, or it is already finished. Not a failure, and not worth a retry. */
  | { started: false; reason: 'running' | 'done' | 'failed' | 'exhausted' };

function jobRef(uid: string, projectId: string) {
  return db.collection('users').doc(uid).collection(ASSEMBLY_JOBS).doc(assemblyJobId(projectId));
}

function projectRef(uid: string, projectId: string) {
  return db.collection('users').doc(uid).collection('sloperProjects').doc(projectId);
}

/**
 * Take the job, or report who has it.
 *
 * `attempts` is incremented here rather than on success, which is the only way round that bounds
 * anything: a job that kills its instance never reaches a success path to count itself, and a page
 * that re-offered it on every open would re-run it for ever. Three claims and it stops.
 */
async function claim(uid: string, projectId: string, now: number): Promise<AssemblyJob | JobOutcome> {
  const ref = jobRef(uid, projectId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new BadRequestError('There is no assembly waiting for that project.');

    const job = readAssemblyJob(snap.data());

    if (job.status === 'done') return { started: false, reason: 'done' } as JobOutcome;
    if (job.status === 'error') return { started: false, reason: 'failed' } as JobOutcome;
    if (job.status === 'running' && !jobIsStale(job, now)) {
      return { started: false, reason: 'running' } as JobOutcome;
    }
    if (job.attempts >= MAX_ATTEMPTS) {
      // Said out loud in the document rather than left at `running` for ever: a page that reopens
      // this project has to be able to show a failure and a button, not a spinner.
      tx.update(ref, {
        status: 'error',
        error: 'The assembler tried this video three times and did not finish it. Try fewer scenes or a smaller resolution.',
        finishedAt: now,
      });
      return { started: false, reason: 'exhausted' } as JobOutcome;
    }

    const attempts = job.attempts + 1;
    tx.update(ref, {
      status: 'running',
      startedAt: now,
      heartbeatAt: now,
      attempts,
      error: null,
    });

    return { ...job, status: 'running', startedAt: now, heartbeatAt: now, attempts };
  });
}

/**
 * Run the job named by a project id, if it is there to be run.
 *
 * The caller is `handleAssembleVideo`, which has already turned a bearer token into `uid`. Nothing
 * below trusts the document any further than that: every path in it is checked against this
 * account's own folder, because the Admin SDK reads the bucket outside `storage.rules` entirely
 * and a job document is written by a browser.
 */
export async function runAssemblyJob(
  uid: string,
  projectId: string,
  now = Date.now(),
): Promise<JobOutcome> {
  const claimed = await claim(uid, projectId, now);
  if ('started' in claimed) return claimed;

  const job = claimed;
  const ref = jobRef(uid, projectId);
  const bucket = getStorage().bucket(SLOPER_BUCKET);

  let workDir: string | undefined;
  const beat = setInterval(() => {
    // A failed heartbeat is not a reason to stop encoding: the worst it costs is a job that looks
    // stale to a page reopened fifteen minutes later, and that page's remedy is one more request.
    ref.update({ heartbeatAt: Date.now() }).catch(() => undefined);
  }, HEARTBEAT_MS);

  try {
    for (const [i, scene] of job.scenes.entries()) {
      for (const objectPath of [scene.imagePath, scene.audioPath]) {
        if (!isInProjectFolder(objectPath, uid, projectId)) {
          throw new BadRequestError(`Scene ${i + 1} names a file that is not part of this project.`);
        }
      }
    }

    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sloper-job-'));

    const imagePaths: string[] = [];
    const audioPaths: string[] = [];
    let inputBytes = 0;

    for (const [i, scene] of job.scenes.entries()) {
      const image = path.join(workDir, `image_${i}.jpg`);
      const audio = path.join(workDir, `audio_${i}.mp3`);

      // Sequential, and to disk rather than into a Buffer: the point of reading these out of the
      // bucket instead of out of a request body is that they never all exist in memory at once.
      inputBytes += await fetchObject(bucket, scene.imagePath, image);
      inputBytes += await fetchObject(bucket, scene.audioPath, audio);

      if (inputBytes > MAX_INPUT_BYTES) {
        throw new BadRequestError(
          `The pictures and narrations come to more than ${MAX_INPUT_BYTES / 1024 / 1024} MB, which is more than the assembler will load.`,
        );
      }

      imagePaths.push(image);
      audioPaths.push(audio);
    }

    const outputPath = path.join(workDir, 'output.mp4');
    const duration = await assemble({
      imagePaths,
      audioPaths,
      sceneDurations: job.scenes.map((s) => s.imageDuration),
      resolution: job.resolution,
      frameRate: job.frameRate,
      workDir,
      outputPath,
    });

    const { size } = await fs.stat(outputPath);
    if (size > MAX_VIDEO_BYTES) {
      throw new BadRequestError(
        `The finished video is ${(size / 1024 / 1024).toFixed(1)} MB, which is more than this account will store for one project. Use a smaller resolution or fewer scenes.`,
      );
    }

    const video = {
      ...(await uploadVideo(bucket, outputPath, uid, projectId)),
      bytes: size,
      duration,
    };

    const finishedAt = Date.now();
    await ref.update({ status: 'done', video, error: null, finishedAt, heartbeatAt: finishedAt });

    /*
     * And into the project, so the Open window's "has a video" mark and a reopening that never
     * looks at the job are both right. `merge`, because this document belongs to the browser —
     * see the header. An autosave already in flight can still land on top of this, which is why
     * the page takes the video from the job rather than from here.
     */
    await projectRef(uid, projectId)
      .set({ video, updatedAt: finishedAt }, { merge: true })
      .catch(() => undefined);

    console.log(
      'assembleVideo.job',
      JSON.stringify({
        uid,
        projectId,
        scenes: job.scenes.length,
        attempt: job.attempts,
        inputMB: +(inputBytes / 1024 / 1024).toFixed(2),
        outputMB: +(size / 1024 / 1024).toFixed(2),
        durationS: +duration.toFixed(1),
        elapsedMs: Date.now() - now,
      }),
    );

    return { started: true, scenes: job.scenes.length, bytes: size, durationS: duration };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Video assembly failed';
    console.error(
      'assembleVideo.job.failed',
      JSON.stringify({ uid, projectId, attempt: job.attempts, message, elapsedMs: Date.now() - now }),
    );

    /*
     * The refusal goes in the document, because that is the only place a page which has been
     * closed for an hour can read it. A bad job is `error` outright — trying it twice more says
     * the same thing twice more — where anything else is put back to `queued` for the attempts it
     * has left, which is what makes a killed instance or an ffmpeg that died on a bad frame worth
     * another go.
     */
    const permanent = error instanceof BadRequestError || error instanceof AssemblyJobError;
    const exhausted = job.attempts >= MAX_ATTEMPTS;
    await ref
      .update({
        status: permanent || exhausted ? 'error' : 'queued',
        error: message.slice(0, MAX_ERROR_CHARS),
        finishedAt: Date.now(),
      })
      .catch(() => undefined);

    throw error;
  } finally {
    clearInterval(beat);
    // The instance is reused between requests, so a temp directory left behind is a leak that
    // eventually fills /tmp — which on Cloud Run is memory.
    if (workDir) await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

type Bucket = ReturnType<ReturnType<typeof getStorage>['bucket']>;

/** One object onto local disk, and how big it turned out to be. */
async function fetchObject(bucket: Bucket, objectPath: string, destination: string): Promise<number> {
  try {
    await bucket.file(objectPath).download({ destination });
  } catch (error) {
    // Naming the object is the whole value of this message: the usual cause is an upload that
    // failed months ago and a project reopened since, and "which one" is the next question.
    const reason = error instanceof Error ? error.message : String(error);
    throw new BadRequestError(`Could not read ${objectPath} back out of your account (${reason}).`);
  }
  const { size } = await fs.stat(destination);
  return size;
}

/**
 * Put the MP4 in the bucket and hand back a URL the page can fetch.
 *
 * THE TOKEN IS THE WHOLE OF IT. `getDownloadURL()` in the browser resolves a URL of exactly this
 * shape, and what makes such a URL work is the `firebaseStorageDownloadTokens` metadata — an
 * object written by the Admin SDK has none unless it is given one, and the page would then have
 * nothing to point an `<video src>` at. A fresh uuid per assembly is also what stops a
 * re-assembled project serving the previous video out of some cache: the path is the same, the
 * URL is not.
 */
async function uploadVideo(
  bucket: Bucket,
  localPath: string,
  uid: string,
  projectId: string,
): Promise<{ path: string; url: string }> {
  const destination = videoObjectPath(uid, projectId);
  const token = randomUUID();

  await bucket.upload(localPath, {
    destination,
    resumable: false,
    metadata: {
      contentType: 'video/mp4',
      // The same as the browser's own uploads: the bytes at a path never change without the path
      // changing, and this one is only ever fetched by somebody who owns it.
      cacheControl: 'private, max-age=31536000',
      metadata: { firebaseStorageDownloadTokens: token },
    },
  });

  return {
    path: destination,
    url: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(destination)}?alt=media&token=${token}`,
  };
}
