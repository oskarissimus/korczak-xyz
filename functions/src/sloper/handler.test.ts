import { describe, expect, it } from 'vitest';
import type { Request } from 'firebase-functions/v2/https';

import { AssemblyStream, parseMultipart, STREAM_CONTENT_TYPE } from './handler';
import { checkCounts, parseMetadata } from './metadata';

/*
 * The seam neither side can test alone.
 *
 * `src/utils/sloper/assemble.ts` builds a `FormData` in the browser and this function reads it in
 * Node, and nothing in between is typed: the part names (`metadata`, `images`, `audio`) and the
 * ordering of the files are a contract written down twice in two languages. So the bodies below
 * are built with the platform's own `FormData` and `Request` — the same serializer `fetch` uses —
 * and handed to the real parser, exactly as they would arrive.
 *
 * The ordering case is the one that matters most. The pipeline pairs `images[i]` with `audio[i]`
 * with `scenes[i]`, so a parser that returned the files in any other order would produce a video
 * whose narration drifts one scene further out of step with every cut — correct-looking output
 * that is wrong, which is worse than a crash.
 */

/** Serialize a FormData the way `fetch` would, and wrap it as Cloud Functions hands it over. */
async function asRequest(form: FormData): Promise<Request> {
  const encoded = new globalThis.Request('https://example.test/', { method: 'POST', body: form });
  const rawBody = Buffer.from(await encoded.arrayBuffer());

  return {
    method: 'POST',
    headers: { 'content-type': encoded.headers.get('content-type') ?? '' },
    rawBody,
  } as unknown as Request;
}

const metadata = {
  scenes: [
    { index: 0, imageDuration: 2.4 },
    { index: 1, imageDuration: 1.7 },
  ],
  resolution: { width: 1024, height: 1536 },
  frameRate: 24,
};

/** Bytes that differ per file, so "in order" is a claim the assertions can actually check. */
const image = (i: number) => new Blob([new Uint8Array([0xff, 0xd8, i])], { type: 'image/jpeg' });
const audio = (i: number) => new Blob([new Uint8Array([0x49, 0x44, 0x33, i])], { type: 'audio/mpeg' });

function clientForm(count: number): FormData {
  // Mirrors assemble.ts exactly: the metadata field, then every image, then every narration.
  const form = new FormData();
  form.append('metadata', JSON.stringify(metadata));
  for (let i = 0; i < count; i++) form.append('images', image(i), `image_${i}.jpg`);
  for (let i = 0; i < count; i++) form.append('audio', audio(i), `audio_${i}.mp3`);
  return form;
}

describe('parseMultipart', () => {
  it('reads the metadata field and both file fields the client sends', async () => {
    const parsed = await parseMultipart(await asRequest(clientForm(2)));

    expect(parsed.metadata).toBe(JSON.stringify(metadata));
    expect(parsed.files.filter((f) => f.field === 'images')).toHaveLength(2);
    expect(parsed.files.filter((f) => f.field === 'audio')).toHaveLength(2);
  });

  it('keeps the files in the order they were appended', async () => {
    const parsed = await parseMultipart(await asRequest(clientForm(3)));

    const images = parsed.files.filter((f) => f.field === 'images').map((f) => f.data[2]);
    const audios = parsed.files.filter((f) => f.field === 'audio').map((f) => f.data[3]);
    expect(images).toEqual([0, 1, 2]);
    expect(audios).toEqual([0, 1, 2]);
  });

  it('reads the stream opt-in the client sends beside the metadata', async () => {
    const form = clientForm(1);
    form.append('stream', '1');

    expect((await parseMultipart(await asRequest(form))).stream).toBe('1');
    // An older page does not send it, and gets the unframed answer it knows how to read.
    expect((await parseMultipart(await asRequest(clientForm(1)))).stream).toBeUndefined();
  });

  it('ignores a part the handler does not know about, without stalling', async () => {
    const form = clientForm(2);
    form.append('somethingElse', new Blob(['nope']), 'nope.txt');

    const parsed = await parseMultipart(await asRequest(form));
    expect(parsed.files).toHaveLength(4);
    expect(parsed.metadata).toBeTruthy();
  });

  it('yields no metadata at all when the field is missing, which the validator then refuses', async () => {
    const form = new FormData();
    form.append('images', image(0), 'image_0.jpg');

    const parsed = await parseMultipart(await asRequest(form));
    expect(parsed.metadata).toBeUndefined();
    expect(() => parseMetadata(parsed.metadata)).toThrow(/No metadata/);
  });
});

describe('the round trip', () => {
  it('a body the client would build passes the validator it is checked against', async () => {
    const parsed = await parseMultipart(await asRequest(clientForm(2)));
    const meta = parseMetadata(parsed.metadata);

    const images = parsed.files.filter((f) => f.field === 'images');
    const audios = parsed.files.filter((f) => f.field === 'audio');

    expect(() => checkCounts(meta, images.length, audios.length)).not.toThrow();
    expect(meta.scenes.map((s) => s.imageDuration)).toEqual([2.4, 1.7]);
  });

  it('a scene count that disagrees with the files is caught', async () => {
    // Three scenes' worth of files against two scenes of metadata — the drift case.
    const parsed = await parseMultipart(await asRequest(clientForm(3)));
    const meta = parseMetadata(parsed.metadata);

    const images = parsed.files.filter((f) => f.field === 'images').length;
    const audios = parsed.files.filter((f) => f.field === 'audio').length;
    expect(() => checkCounts(meta, images, audios)).toThrow(/Expected 2 images/);
  });
});

/*
 * The other half of the same seam: what the function writes back.
 *
 * `src/utils/sloper/assemble.ts` reads these frames, and the reason they exist at all is that
 * encoding takes longer than WebKit will wait in silence — sixty seconds, after which a fetch dies
 * as `TypeError: Load failed` however well the function is doing. So the head goes out first, a
 * heartbeat goes out every ten seconds, and the video arrives behind a frame that says how many
 * bytes of it to expect. The count is not decoration: without it a connection cut near the end
 * becomes a video file that plays until it does not, which the page would save as the finished one.
 */

/** Just enough of an Express response to collect what was written, in order. */
function fakeResponse() {
  const chunks: (string | Buffer)[] = [];
  const headers: Record<string, string> = {};

  const res = {
    writableEnded: false,
    destroyed: false,
    statusCode: 0,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    set(name: string, value: string) {
      headers[name] = value;
      return res;
    },
    flushHeaders() {},
    on() {
      return res;
    },
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
    end(chunk?: Buffer) {
      if (chunk) chunks.push(chunk);
      res.writableEnded = true;
    },
  };

  return { res, chunks, headers };
}

/** Reads the written chunks the way the browser's reader does: lines, then the bytes behind them. */
function readBack(chunks: (string | Buffer)[]) {
  const frames: Record<string, unknown>[] = [];
  let video: Buffer | undefined;

  for (const chunk of chunks) {
    if (typeof chunk === 'string') {
      for (const line of chunk.split('\n')) {
        if (line) frames.push(JSON.parse(line));
      }
    } else {
      video = video ? Buffer.concat([video, chunk]) : chunk;
    }
  }

  return { frames, video };
}

describe('AssemblyStream', () => {
  it('sends the head and a first heartbeat before ffmpeg has finished anything', () => {
    const { res, chunks, headers } = fakeResponse();
    const stream = new AssemblyStream(res as never, Date.now());

    stream.begin();

    expect(res.statusCode).toBe(200);
    expect(headers['Content-Type']).toBe(STREAM_CONTENT_TYPE);
    // Anything that buffers this has put the sixty seconds of silence back.
    expect(headers['X-Accel-Buffering']).toBe('no');
    expect(readBack(chunks).frames).toEqual([{ status: 'working', elapsedMs: expect.any(Number) }]);

    stream.failed('cleanup');
  });

  it('ends with a frame carrying the byte count, then exactly those bytes', () => {
    const { res, chunks } = fakeResponse();
    const stream = new AssemblyStream(res as never, Date.now());
    const video = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);

    stream.begin();
    stream.done(video, 54.1, 'slop-video-2026-09-18.mp4');

    const { frames, video: read } = readBack(chunks);
    expect(frames.at(-1)).toEqual({
      status: 'done',
      duration: 54.1,
      bytes: video.length,
      filename: 'slop-video-2026-09-18.mp4',
    });
    expect(read).toEqual(video);
    expect(res.writableEnded).toBe(true);
  });

  it('reports a failure as a frame, because the status code has already gone', () => {
    const { res, chunks } = fakeResponse();
    const stream = new AssemblyStream(res as never, Date.now());

    stream.begin();
    stream.failed('Could not join the narration');

    const { frames, video } = readBack(chunks);
    expect(frames.at(-1)).toEqual({ status: 'error', message: 'Could not join the narration' });
    expect(video).toBeUndefined();
    // A 200 all the same: the head went out before ffmpeg was asked to do anything.
    expect(res.statusCode).toBe(200);
  });

  it('writes nothing to a reader that hung up mid-encode, rather than throwing into a timer', () => {
    const { res, chunks } = fakeResponse();
    const stream = new AssemblyStream(res as never, Date.now());

    stream.begin();
    res.destroyed = true;
    expect(() => stream.done(Buffer.from([1, 2, 3]), 1, 'v.mp4')).not.toThrow();
    expect(readBack(chunks).video).toBeUndefined();
  });
});
