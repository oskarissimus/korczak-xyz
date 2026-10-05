/*
 * What a Live session is set up with, in one place both runtimes compile.
 *
 * `live.ts` opens a session from the browser and sends this as its `setup`. Since Oct 2026 the
 * roaster's demo opens one too, on the owner's key, and there the setup is NOT the browser's to
 * send: the function mints a single-use ephemeral token with this exact config locked into it
 * (`functions/src/demo/handler.ts`), so whatever the browser puts in its own `setup` is ignored by
 * Google. Two copies of these numbers would be one that drifts — a temperature tuned for the rides
 * and not for the demo, a thinking switch fixed in one — so both import this file. It imports
 * nothing, which is what lets it into the function (`functions/tsconfig.json`).
 */

/** Same warmth as the Gemini vision call (`vision.ts`), for the same reason. */
export const LIVE_TEMPERATURE = 1.3;

/** Room for one sentence of speech: audio tokens are ~25 a second, and a remark is under ten. */
export const LIVE_MAX_TOKENS = 600;

/**
 * Whether to send `thinkingBudget: 0` in `setup`. Only to a `flash-live` model, where the test
 * showed it changes nothing for the worse: the 09-2025 native-audio model answered this prompt
 * with an empty turn every time it was sent, and spoke (after thinking for three seconds) every
 * time it was not.
 */
export function wantsThinkingOff(model: string): boolean {
  return model.includes('flash-live');
}

/**
 * The `generationConfig` of a session, in the wire's own field names (the Live API's JSON is
 * camelCase both in a browser's `setup` and in the SDK's `LiveConnectConfig`).
 */
export function liveGenerationConfig(voice: string, withThinkingConfig: boolean) {
  return {
    responseModalities: ['AUDIO'],
    temperature: LIVE_TEMPERATURE,
    maxOutputTokens: LIVE_MAX_TOKENS,
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    /*
     * MEDIUM reads the frame as ~266 tokens instead of 1064 on a flash-live model. On 4 Oct 2026
     * it was measured beside the default and LOW (8 rounds each, real prompt): first audio 769 ms
     * against 816 ms — noise, not a speed-up — and 8/8 answered, where LOW (63 tokens) lost the
     * sound twice. It is here for the quota: a quarter of the input tokens for the same remarks.
     */
    mediaResolution: 'MEDIA_RESOLUTION_MEDIUM',
    ...(withThinkingConfig ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
  };
}
