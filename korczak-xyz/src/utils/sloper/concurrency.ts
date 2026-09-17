/*
 * A fixed-width queue.
 *
 * Split out of sloper's `services/images.ts` so it can be tested without a canvas: the file it
 * came from reaches for `document.createElement('canvas')`, and there is no jsdom in this project.
 *
 * Why it exists at all: twelve scenes means twelve image requests and twelve TTS requests, and
 * firing them all at once earns a 429 from both providers. The ElevenLabs width is a setting
 * (`config.tts.concurrency`) because their limit is per plan; the image width is not, because
 * DALL-E's is per key and twelve has never been the thing that hit it.
 */

/**
 * The queue holds *settled* work, not results: `add` closes over its own promise's `resolve` and
 * `reject` and the queue only ever sees a `() => Promise<void>`. That is what lets the generic
 * live on `add` rather than on the class — one limiter can run tasks of different shapes, which
 * the image queue does the moment a retry is queued beside a first attempt.
 */
type QueuedJob = () => Promise<void>;

export class ConcurrencyLimiter {
  private queue: QueuedJob[] = [];
  private running = 0;

  constructor(private readonly maxConcurrent: number) {}

  add<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(() =>
        // The extra async wrapper is not ceremony: `task()` can throw synchronously, and a throw
        // out of the job would escape `pump` rather than rejecting the promise `add` handed back,
        // leaving that promise pending for ever.
        (async () => task())().then(resolve, reject),
      );
      this.pump();
    });
  }

  private pump(): void {
    while (this.running < this.maxConcurrent && this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) break;

      this.running += 1;
      void job().finally(() => {
        this.running -= 1;
        this.pump();
      });
    }
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  get runningCount(): number {
    return this.running;
  }
}
