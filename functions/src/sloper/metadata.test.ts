import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ALLOWED_ORIGINS,
  BadRequestError,
  checkCounts,
  corsOrigin,
  parseMetadata,
} from './metadata';

const valid = {
  scenes: [
    { index: 0, imageDuration: 4.2 },
    { index: 1, imageDuration: 3 },
  ],
  resolution: { width: 1024, height: 1536 },
  frameRate: 24,
};

const json = (over: Record<string, unknown> = {}) => JSON.stringify({ ...valid, ...over });

describe('parseMetadata', () => {
  it('reads a well-formed request', () => {
    const meta = parseMetadata(json());
    expect(meta.scenes).toHaveLength(2);
    expect(meta.scenes[0].imageDuration).toBeCloseTo(4.2);
    expect(meta.resolution).toEqual({ width: 1024, height: 1536 });
    expect(meta.frameRate).toBe(24);
  });

  it('refuses a missing or unparseable body', () => {
    expect(() => parseMetadata(undefined)).toThrow(BadRequestError);
    expect(() => parseMetadata('not json')).toThrow(BadRequestError);
    expect(() => parseMetadata('[]')).toThrow(BadRequestError);
  });

  it('refuses an empty scene list', () => {
    expect(() => parseMetadata(json({ scenes: [] }))).toThrow(/non-empty/);
  });

  /*
   * The three that reach ffmpeg's argv. Each one used to be a Pydantic constraint in the FastAPI
   * backend and is nothing at all in a Cloud Function unless it is written here.
   */
  it('refuses a resolution that would exhaust the instance', () => {
    expect(() => parseMetadata(json({ resolution: { width: 1e9, height: 1080 } }))).toThrow(
      /resolution\.width/,
    );
  });

  it('refuses a non-finite duration rather than passing NaN to -t', () => {
    expect(() => parseMetadata(json({ scenes: [{ index: 0, imageDuration: null }] }))).toThrow(
      /imageDuration/,
    );
    // A zero-length segment has no frames, and the concat that follows fails with a message
    // about the segment rather than about the duration.
    expect(() => parseMetadata(json({ scenes: [{ index: 0, imageDuration: 0 }] }))).toThrow(
      /imageDuration/,
    );
  });

  it('refuses a frame rate outside what libx264 is asked for here', () => {
    expect(() => parseMetadata(json({ frameRate: 0 }))).toThrow(/frameRate/);
    expect(() => parseMetadata(json({ frameRate: 120 }))).toThrow(/frameRate/);
  });

  /* yuv420p subsamples chroma 2x2, so libx264 refuses an odd dimension outright. */
  it('rounds an odd dimension down to even', () => {
    const meta = parseMetadata(json({ resolution: { width: 1081, height: 1921 } }));
    expect(meta.resolution).toEqual({ width: 1080, height: 1920 });
  });
});

describe('checkCounts', () => {
  const meta = parseMetadata(json());

  it('accepts one image and one narration per scene', () => {
    expect(() => checkCounts(meta, 2, 2)).not.toThrow();
  });

  /*
   * The failure this exists for is not a crash: with one image too few, every scene after the
   * gap is paired with the previous scene's narration and the video drifts further out of step
   * with every cut. A refusal is better than a video nobody can tell is wrong until they watch it.
   */
  it('refuses counts that do not line up with the scenes', () => {
    expect(() => checkCounts(meta, 1, 2)).toThrow(/Expected 2 images/);
    expect(() => checkCounts(meta, 2, 3)).toThrow(/Expected 2 audio/);
  });
});

describe('corsOrigin', () => {
  it('echoes an allowed origin and refuses anything else', () => {
    expect(corsOrigin('https://korczak.xyz')).toBe('https://korczak.xyz');
    expect(corsOrigin('http://localhost:4321')).toBe('http://localhost:4321');
    expect(corsOrigin('https://korczak.xyz.evil.test')).toBeNull();
    expect(corsOrigin(undefined)).toBeNull();
  });
});

/*
 * The other copy of that allowlist, in `terraform/storage.tf`.
 *
 * This is the repo's usual idiom for one fact in two files — read the other one as text and assert
 * agreement — and it is here because the two halves fail in opposite directions and neither is
 * visible from the other. An origin in the bucket's `cors` block and not in `ALLOWED_ORIGINS` can
 * read every asset it owns and then be refused by the assembler. An origin here and not there can
 * reach the assembler and arrive with nothing to send, because gathering the assets is itself a
 * cross-origin `fetch` the bucket has not been told to allow.
 *
 * That second one is not hypothetical: it is the bug this block was written for. It cost a
 * reopened project its video and failed every assembly from one, while a sitting done in a single
 * visit — where nothing is ever fetched back — went on working, and the only thing on screen was
 * Safari's `TypeError: Load failed`.
 */
describe('the bucket and the assembler agree about origins', () => {
  it('lists the same origins in terraform/storage.tf', () => {
    const hcl = readFileSync(
      join(new URL('.', import.meta.url).pathname, '../../../terraform/storage.tf'),
      'utf8',
    );

    const block = /\bcors\s*\{[\s\S]*?\borigin\s*=\s*\[([\s\S]*?)\]/.exec(hcl);
    expect(block, 'no cors { origin = [...] } block in terraform/storage.tf').not.toBeNull();

    const declared = [...block![1].matchAll(/"([^"]+)"/g)].map(([, origin]) => origin);

    expect([...declared].sort()).toEqual([...ALLOWED_ORIGINS].sort());
  });
});
