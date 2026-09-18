import { describe, expect, it, vi } from 'vitest';

import { readAssemblyStream, STREAM_CONTENT_TYPE } from './assemble';

/*
 * The protocol that keeps a real project from failing at exactly sixty seconds.
 *
 * Encoding runs at roughly real time, WebKit abandons a request that has gone 60 s without a byte,
 * and it says only `TypeError: Load failed` when it does — so the function heartbeats while ffmpeg
 * runs and the video arrives behind a frame that says how long it is. That frame format is written
 * down twice, here and in `functions/src/sloper/handler.ts`, with nothing but these tests and that
 * file's comment keeping the two honest.
 *
 * The case worth having most is the truncated one. Without the byte count a connection cut at nine
 * tenths of the way through produces a file that plays until it stops and is then saved to the
 * account as the finished article — correct-looking output that is wrong, which is the failure this
 * app's other seam (`parseMultipart`'s ordering) is tested against for the same reason.
 */

/** Frames and bytes the way the function writes them, chunked however the test asks for. */
function streamed(parts: (string | Uint8Array)[], contentType = STREAM_CONTENT_TYPE): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(typeof part === 'string' ? encoder.encode(part) : part);
      }
      controller.close();
    },
  });

  return new Response(body, { status: 200, headers: { 'Content-Type': contentType } });
}

const mp4 = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
const doneFrame = `{"status":"done","duration":54.1,"bytes":${mp4.length},"filename":"v.mp4"}\n`;

describe('readAssemblyStream', () => {
  it('reads heartbeats, then the frame, then the video behind it', async () => {
    const result = await readAssemblyStream(
      streamed([
        '{"status":"working","elapsedMs":0}\n',
        '{"status":"working","elapsedMs":10000}\n',
        doneFrame,
        mp4,
      ]),
    );

    expect(result.duration).toBe(54.1);
    expect(new Uint8Array(await result.video.arrayBuffer())).toEqual(mp4);
    expect(result.video.type).toBe('video/mp4');
  });

  it('takes the video when it arrives in the same chunk as the frame it follows', async () => {
    const encoder = new TextEncoder();
    const together = new Uint8Array(encoder.encode(doneFrame).length + mp4.length);
    together.set(encoder.encode(doneFrame), 0);
    together.set(mp4, encoder.encode(doneFrame).length);

    const result = await readAssemblyStream(streamed([together]));
    expect(new Uint8Array(await result.video.arrayBuffer())).toEqual(mp4);
  });

  it('takes the video when it arrives in pieces', async () => {
    const result = await readAssemblyStream(
      streamed([doneFrame, mp4.subarray(0, 3), mp4.subarray(3, 5), mp4.subarray(5)]),
    );
    expect(new Uint8Array(await result.video.arrayBuffer())).toEqual(mp4);
  });

  it('reads a frame that was split across two chunks', async () => {
    const half = doneFrame.slice(0, 20);
    const rest = doneFrame.slice(20);

    const result = await readAssemblyStream(streamed(['{"status":"wor', 'king"}\n', half, rest, mp4]));
    expect(result.duration).toBe(54.1);
  });

  it('refuses a video that arrived shorter than the frame said', async () => {
    await expect(readAssemblyStream(streamed([doneFrame, mp4.subarray(0, 4)]))).rejects.toThrow(
      /4 bytes of the 8/,
    );
  });

  it('raises the function’s own message when it ends in an error frame', async () => {
    await expect(
      readAssemblyStream(
        streamed(['{"status":"working"}\n', '{"status":"error","message":"Could not join the narration"}\n']),
      ),
    ).rejects.toThrow('Could not join the narration');
  });

  it('says so when the connection ended before any frame said the video was ready', async () => {
    await expect(readAssemblyStream(streamed(['{"status":"working"}\n']))).rejects.toThrow(
      /stopped answering/,
    );
  });

  it('announces the encode on the first heartbeat and only once', async () => {
    const onEncoding = vi.fn();
    await readAssemblyStream(
      streamed(['{"status":"working"}\n', '{"status":"working"}\n', doneFrame, mp4]),
      onEncoding,
    );
    expect(onEncoding).toHaveBeenCalledTimes(1);
  });
});
