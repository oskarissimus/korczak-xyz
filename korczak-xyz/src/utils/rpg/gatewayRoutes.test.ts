import { describe, expect, it } from 'vitest';

import { tokenCost, USD_PER_VOICE_CREDIT } from './cost';
import { FAL_PRICES, imageCost } from './falPrompts';
import {
  COST_EVENT,
  costUpfront,
  credentialHeaders,
  falCost,
  gatewayTarget,
  isFalFollowUp,
  ledgerId,
  readCostEvent,
  UsageMeter,
  voiceCostFromHeader,
} from './gatewayRoutes';

describe('gatewayTarget', () => {
  it('lets through what the game sends', () => {
    expect(gatewayTarget('/generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent', 'POST')).toEqual({
      provider: 'google',
      host: 'generativelanguage.googleapis.com',
      path: '/v1beta/models/gemini-3.8-flash:streamGenerateContent',
    });
    expect(gatewayTarget('/api.openai.com/v1/chat/completions', 'POST')?.provider).toBe('openai');
    expect(gatewayTarget('/api.elevenlabs.io/v1/text-to-speech/abc123', 'POST')?.provider).toBe('elevenlabs');
    expect(gatewayTarget('/api.elevenlabs.io/v1/music/stream', 'POST')?.provider).toBe('elevenlabs');
    expect(gatewayTarget('/api.elevenlabs.io/v1/shared-voices', 'GET')?.provider).toBe('elevenlabs');
    expect(gatewayTarget('/api.elevenlabs.io/v1/voices/abc', 'DELETE')?.provider).toBe('elevenlabs');
    expect(gatewayTarget('/fal.run/fal-ai/flux/schnell', 'POST')?.provider).toBe('fal');
    expect(gatewayTarget('/queue.fal.run/fal-ai/trellis', 'POST')?.provider).toBe('fal');
    expect(gatewayTarget('/queue.fal.run/fal-ai/trellis/requests/1b2c-3d/status', 'GET')?.provider).toBe('fal');
    expect(gatewayTarget('/queue.fal.run/tripo3d/tripo/v2.5/image-to-3d', 'POST')?.provider).toBe('fal');
    expect(gatewayTarget('/rest.alpha.fal.ai/storage/upload/initiate', 'POST')?.provider).toBe('fal');
  });

  it('refuses anything else: another host, another path, another method, a climb out of the path', () => {
    expect(gatewayTarget('/evil.example.com/v1/anything', 'POST')).toBeNull();
    expect(gatewayTarget('/generativelanguage.googleapis.com/v1beta/files', 'POST')).toBeNull();
    expect(gatewayTarget('/generativelanguage.googleapis.com/v1beta/models/x:generateContent', 'GET')).toBeNull();
    expect(gatewayTarget('/api.elevenlabs.io/v1/user/subscription', 'GET')).toBeNull();
    expect(gatewayTarget('/api.elevenlabs.io/v1/voices/abc', 'POST')).toBeNull();
    expect(gatewayTarget('/api.openai.com/v1/files', 'POST')).toBeNull();
    expect(gatewayTarget('/fal.run/fal-ai/../../admin', 'POST')).toBeNull();
    expect(gatewayTarget('/queue.fal.run//fal-ai/x', 'POST')).toBeNull();
    expect(gatewayTarget('', 'POST')).toBeNull();
  });
});

describe('credentialHeaders', () => {
  it('puts the key where each provider reads it', () => {
    expect(credentialHeaders('google', 'k')).toEqual({ 'x-goog-api-key': 'k' });
    expect(credentialHeaders('openai', 'k')).toEqual({ Authorization: 'Bearer k' });
    expect(credentialHeaders('elevenlabs', 'k')).toEqual({ 'xi-api-key': 'k' });
    expect(credentialHeaders('fal', 'k')).toEqual({ Authorization: 'Key k' });
  });
});

describe('prices', () => {
  it('prices a fal.ai request by its model, as the console does', () => {
    expect(falCost('fal-ai/flux/schnell', { image_size: { width: 512, height: 512 } })).toBe(imageCost(512, 512));
    expect(falCost('fal-ai/trellis', {})).toBe(FAL_PRICES.mesh);
    expect(falCost('fal-ai/meshy/v6/image-to-3d', { enable_rigging: true })).toBe(FAL_PRICES.meshyMesh + FAL_PRICES.rig);
    expect(falCost('fal-ai/meshy/v6/image-to-3d', {})).toBe(FAL_PRICES.meshyMesh);
    expect(falCost('fal-ai/unknown', {})).toBeNull();
  });

  it('prices a clip by its characters and the score by its length, before it is made', () => {
    const tts = gatewayTarget('/api.elevenlabs.io/v1/text-to-speech/v1', 'POST')!;
    expect(costUpfront(tts, { text: 'x'.repeat(200), model_id: 'eleven_flash_v2_5' })).toBeCloseTo(100 * USD_PER_VOICE_CREDIT);
    const dialogue = gatewayTarget('/api.elevenlabs.io/v1/text-to-dialogue', 'POST')!;
    expect(costUpfront(dialogue, { inputs: [{ text: 'x'.repeat(50) }], model_id: 'eleven_v3' })).toBeCloseTo(50 * USD_PER_VOICE_CREDIT);
    const music = gatewayTarget('/api.elevenlabs.io/v1/music/stream', 'POST')!;
    expect(costUpfront(music, { music_length_ms: 60_000 })).toBeCloseTo(900 * USD_PER_VOICE_CREDIT);
  });

  it('charges a fal.ai job when it is asked for, not each time it is followed', () => {
    const submit = gatewayTarget('/queue.fal.run/fal-ai/trellis', 'POST')!;
    const status = gatewayTarget('/queue.fal.run/fal-ai/trellis/requests/abc/status', 'GET')!;
    const result = gatewayTarget('/queue.fal.run/fal-ai/trellis/requests/abc', 'GET')!;
    expect(costUpfront(submit, {})).toBe(FAL_PRICES.mesh);
    expect(costUpfront(status, {})).toBeNull();
    expect(costUpfront(result, {})).toBeNull();
    expect(isFalFollowUp('/fal-ai/trellis/requests/abc/cancel')).toBe(true);
  });

  it('reads ElevenLabs’ own count where it gives one', () => {
    expect(voiceCostFromHeader('100')).toBeCloseTo(100 * USD_PER_VOICE_CREDIT);
    expect(voiceCostFromHeader(null)).toBeNull();
  });
});

describe('UsageMeter', () => {
  it('prices a Google stream by the model that answered', () => {
    const target = gatewayTarget('/generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:streamGenerateContent', 'POST')!;
    const meter = new UsageMeter('google', UsageMeter.asked(target, {}));
    expect(meter.model).toBe('gemini-flash-latest');
    const first = 'data: {"candidates":[{"content":{"parts":[{"text":"{"}]}}],"modelVersion":"gemini-3.8-flash"}\n\ndata: {"usageMetadata":{"promptTokenCount":10';
    let rest = meter.feedEvents(first);
    rest = meter.feedEvents(`${rest},"candidatesTokenCount":20,"thoughtsTokenCount":5}}\n\n`);
    expect(rest).toBe('');
    expect(meter.model).toBe('gemini-3.8-flash');
    expect(meter.cost()).toBeCloseTo(tokenCost('gemini-3.8-flash', { input: 10, output: 20, thoughts: 5 })!);
  });

  it('prices an OpenAI stream from its closing usage', () => {
    const meter = new UsageMeter('openai', 'gpt-4.1');
    meter.feedEvents('data: {"model":"gpt-4.1-2025","choices":[]}\ndata: {"usage":{"prompt_tokens":100,"completion_tokens":50}}\ndata: [DONE]\n');
    expect(meter.cost()).toBeCloseTo(tokenCost('gpt-4.1', { input: 100, output: 50, thoughts: 0 })!);
  });

  it('prices a Gemini picture at the image rate', () => {
    const meter = new UsageMeter('google', 'gemini-3.1-flash-lite-image');
    meter.feed({ usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 1290, candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1290 }] } });
    expect(meter.cost()).toBeCloseTo((100 * 0.25 + 1290 * 30) / 1_000_000);
  });

  it('says nothing when nothing was reported', () => {
    expect(new UsageMeter('google', 'gemini-3.8-flash').cost()).toBeNull();
  });
});

describe('the cost line', () => {
  it('is read back, and nothing else is', () => {
    expect(readCostEvent(`${COST_EVENT}{"usd":0.0123,"model":"m"}`)).toBe(0.0123);
    expect(readCostEvent('data: {"usd":1}')).toBeNull();
    expect(readCostEvent(': keep-alive')).toBeNull();
  });
});

describe('ledgerId', () => {
  it('makes a document id of anything, or nothing', () => {
    expect(ledgerId('w-abc123')).toBe('w-abc123');
    expect(ledgerId('a/b c')).toBe('a_b_c');
    expect(ledgerId('__name__')).toBeNull();
    expect(ledgerId('')).toBeNull();
    expect(ledgerId(null)).toBeNull();
    expect(ledgerId('x'.repeat(300))).toHaveLength(120);
  });
});
