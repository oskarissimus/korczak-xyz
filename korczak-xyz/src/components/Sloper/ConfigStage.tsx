/*
 * The settings sheet: four keys, four groups of settings, and a running estimate of what pressing
 * the button will cost.
 *
 * The model dropdowns are the one part that is not a plain form. A provider's model list is
 * fetched with the key itself — listing the models *is* the validation call — so typing a key
 * either fills the dropdown or says why it did not, and there is no separate "check this key"
 * button to press and forget. It is debounced by half a second because the key arrives one
 * character at a time when it is typed rather than pasted, and forty 401s is a rate limit.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DEFAULT_CONFIG, TTS_PLANS, missingKeys } from '../../utils/sloper/defaults';
import {
  SCRAPED_AT,
  estimateImageCost,
  estimateLlmCost,
  estimateTotalCost,
  estimateTtsCost,
  formatUsd,
} from '../../utils/sloper/pricing';
import {
  fetchDeepSeekModels,
  fetchGeminiImageModels,
  fetchOpenAiModels,
  validateElevenLabsKey,
} from '../../utils/sloper/validation';
import type {
  ImageProvider,
  ImageQuality,
  KeyName,
  LlmProvider,
  SloperConfig,
  TtsPlan,
} from '../../utils/sloper/types';
import { CostLine, Fieldset, KeyField, NumberField, Row, Select, Slider, Spinner } from './fields';
import { fill, localeOf, type Lang, type Translation } from './translations';

const RESOLUTIONS = [
  { label: '1024×1536 — portrait', width: 1024, height: 1536 },
  { label: '1080×1920 — portrait HD', width: 1080, height: 1920 },
  { label: '1920×1080 — landscape', width: 1920, height: 1080 },
  { label: '1280×720 — 720p', width: 1280, height: 720 },
];

const OPENAI_IMAGE_MODELS = [
  { value: 'gpt-image-1', label: 'gpt-image-1 (DALL·E 3)' },
  { value: 'dall-e-3', label: 'dall-e-3' },
  { value: 'dall-e-2', label: 'dall-e-2' },
];

const ASPECT_RATIOS = ['16:9', '9:16', '4:3', '3:4', '1:1'];

const TTS_MODELS = [
  { value: 'eleven_multilingual_v2', label: 'Multilingual v2' },
  { value: 'eleven_turbo_v2_5', label: 'Turbo v2.5' },
  { value: 'eleven_turbo_v2', label: 'Turbo v2' },
  { value: 'eleven_monolingual_v1', label: 'Monolingual v1' },
];

const VOICES = [
  { value: 'Bx2lBwIZJBilRBVc3AGO', label: 'Daniel' },
  { value: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel' },
  { value: 'AZnzlk1XvdvUeBnXmlld', label: 'Domi' },
  { value: 'EXAVITQu4vr4xnSDxMaL', label: 'Bella' },
];

const KEY_LABELS: Record<KeyName, keyof Translation> = {
  openai: 'keyOpenai',
  deepseek: 'keyDeepseek',
  google: 'keyGoogle',
  elevenLabs: 'keyElevenLabs',
};

interface ModelList {
  loading: boolean;
  models: string[];
  error: string | null;
}

const IDLE: ModelList = { loading: false, models: [], error: null };

interface ConfigStageProps {
  config: SloperConfig;
  update: (patch: Partial<SloperConfig>) => void;
  reset: () => void;
  onStart: () => void;
  t: Translation;
  lang: Lang;
}

export default function ConfigStage({ config, update, reset, onStart, t, lang }: ConfigStageProps) {
  const [checking, setChecking] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const scrapedOn = useMemo(
    () => new Date(SCRAPED_AT).toLocaleDateString(localeOf(lang)),
    [lang],
  );

  // --- the model lists --------------------------------------------------------------------

  const [llmModels, setLlmModels] = useState<ModelList>(IDLE);
  const [imageModels, setImageModels] = useState<ModelList>(IDLE);
  const [showAllModels, setShowAllModels] = useState(false);

  /*
   * The auto-pick reads the current model through a ref rather than a dependency. In the
   * dependency array it would re-run the fetch every time the dropdown changed — which is what
   * the fetch itself does when it picks one, so the two would take turns for ever.
   */
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);
  const updateRef = useRef(update);
  useEffect(() => {
    updateRef.current = update;
  }, [update]);

  const llmProvider = config.llm.provider;
  const llmKey = llmProvider === 'openai' ? config.apiKeys.openai : config.apiKeys.deepseek;

  useEffect(() => {
    if (!llmKey) {
      setLlmModels(IDLE);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      setLlmModels({ loading: true, models: [], error: null });
      const fetcher = llmProvider === 'openai' ? fetchOpenAiModels : fetchDeepSeekModels;

      void fetcher(llmKey, showAllModels).then((result) => {
        if (cancelled) return;
        setLlmModels({
          loading: false,
          models: result.models,
          error: result.success ? null : (result.error ?? null),
        });
        // Picked for you only when what is selected is not on offer — otherwise a saved choice
        // would be overwritten every time the page loads.
        if (result.models.length > 0 && !result.models.includes(configRef.current.llm.model)) {
          updateRef.current({ llm: { ...configRef.current.llm, model: result.models[0] } });
        }
      });
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [llmKey, llmProvider, showAllModels]);

  const imageProvider = config.image.provider;
  const googleKey = config.apiKeys.google;

  useEffect(() => {
    // OpenAI's image models are a fixed list of three; only Google's is worth asking for.
    if (imageProvider !== 'google' || !googleKey) {
      setImageModels(IDLE);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      setImageModels({ loading: true, models: [], error: null });

      void fetchGeminiImageModels(googleKey).then((result) => {
        if (cancelled) return;
        setImageModels({
          loading: false,
          models: result.models,
          error: result.success ? null : (result.error ?? null),
        });
        if (result.models.length > 0 && !result.models.includes(configRef.current.image.model)) {
          updateRef.current({ image: { ...configRef.current.image, model: result.models[0] } });
        }
      });
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [googleKey, imageProvider]);

  // --- the estimate -----------------------------------------------------------------------

  const llmEstimate = useMemo(
    () => estimateLlmCost(config.llm.model, config.video.targetDuration, config.video.numScenes),
    [config.llm.model, config.video.targetDuration, config.video.numScenes],
  );
  const imageEstimate = useMemo(
    () =>
      estimateImageCost(
        config.image.provider,
        config.image.model,
        config.image.quality,
        config.video.resolution,
        config.video.numScenes,
      ),
    [config.image, config.video.resolution, config.video.numScenes],
  );
  const ttsEstimate = useMemo(
    () => estimateTtsCost(config.tts.model, config.tts.plan, config.video.targetDuration),
    [config.tts.model, config.tts.plan, config.video.targetDuration],
  );
  const total = useMemo(
    () => estimateTotalCost(llmEstimate, imageEstimate, ttsEstimate),
    [llmEstimate, imageEstimate, ttsEstimate],
  );

  // --- starting ---------------------------------------------------------------------------

  const missing = missingKeys(config);
  const blocked =
    missing.length > 0 ? fill(t.startMissingKeys, { keys: missing.map((k) => t[KEY_LABELS[k]]).join(', ') })
    : !config.llm.model ? t.startNoModel
    : null;

  const start = useCallback(async () => {
    setStartError(null);
    setChecking(true);
    try {
      /*
       * Only ElevenLabs is checked here. The two model lists above have already proved the
       * script and picture keys by listing with them — a key that produced a dropdown is a key
       * that works — and ElevenLabs has no list worth showing, so it has nothing that would have
       * proved it along the way.
       */
      const result = await validateElevenLabsKey(config.apiKeys.elevenLabs ?? '');
      if (!result.valid) {
        setStartError(result.error ?? 'ElevenLabs refused that key.');
        return;
      }
      onStart();
    } finally {
      setChecking(false);
    }
  }, [config.apiKeys.elevenLabs, onStart]);

  const modelOptions = (list: ModelList) =>
    list.loading
      ? [{ value: '', label: t.llmModelsLoading }]
      : list.models.length === 0
        ? [{ value: '', label: t.llmModelsEmpty }]
        : list.models.map((m) => ({ value: m, label: m }));

  return (
    <div className="slp-stage">
      <Fieldset legend={t.keysTitle} hint={t.keysBlurb}>
        <KeyField
          label={t.keyOpenai}
          value={config.apiKeys.openai}
          placeholder="sk-…"
          onChange={(v) => update({ apiKeys: { ...config.apiKeys, openai: v } })}
          t={t}
        />
        {llmProvider === 'deepseek' && (
          <KeyField
            label={t.keyDeepseek}
            value={config.apiKeys.deepseek}
            placeholder="sk-…"
            onChange={(v) => update({ apiKeys: { ...config.apiKeys, deepseek: v } })}
            t={t}
          />
        )}
        {imageProvider === 'google' && (
          <KeyField
            label={t.keyGoogle}
            value={config.apiKeys.google}
            placeholder="AIza…"
            onChange={(v) => update({ apiKeys: { ...config.apiKeys, google: v } })}
            t={t}
          />
        )}
        <KeyField
          label={t.keyElevenLabs}
          value={config.apiKeys.elevenLabs}
          placeholder="sk_…"
          onChange={(v) => update({ apiKeys: { ...config.apiKeys, elevenLabs: v } })}
          t={t}
        />
      </Fieldset>

      <Fieldset legend={t.llmTitle}>
        <Row label={t.llmProvider}>
          {(id) => (
            <Select<LlmProvider>
              id={id}
              value={llmProvider}
              options={[
                { value: 'openai', label: 'OpenAI' },
                { value: 'deepseek', label: 'DeepSeek' },
              ]}
              onChange={(provider) => {
                // The model belongs to the provider, so it cannot survive the switch.
                update({ llm: { provider, model: '' } });
                setLlmModels(IDLE);
              }}
            />
          )}
        </Row>

        <Row label={t.llmModel} error={llmModels.error}>
          {(id) => (
            <Select
              id={id}
              value={config.llm.model}
              options={modelOptions(llmModels)}
              disabled={llmModels.loading || llmModels.models.length === 0}
              onChange={(model) => update({ llm: { ...config.llm, model } })}
            />
          )}
        </Row>

        {llmModels.models.length > 0 && (
          <label className="slp-check">
            <input
              type="checkbox"
              checked={showAllModels}
              onChange={(e) => setShowAllModels(e.target.checked)}
            />
            {t.llmShowAll}
          </label>
        )}

        <Row label={fill(t.llmTemperature, { value: config.temperature.toFixed(1) })}>
          {(id) => (
            <Slider
              id={id}
              value={config.temperature}
              min={0}
              max={1}
              step={0.1}
              onChange={(temperature) => update({ temperature })}
              lowLabel={t.llmFocused}
              highLabel={t.llmWild}
            />
          )}
        </Row>

        <CostLine
          label={t.costLlm}
          amount={llmEstimate.totalCost}
          variesLabel={t.costVaries}
          detail={`${llmEstimate.promptTokens.toLocaleString(localeOf(lang))} + ${llmEstimate.completionTokens.toLocaleString(localeOf(lang))} tokens`}
          note={
            llmEstimate.modelFound
              ? fill(t.costScraped, { date: scrapedOn })
              : fill(t.costUnknownModel, { model: config.llm.model || '—' })
          }
        />
      </Fieldset>

      <Fieldset legend={t.imageTitle}>
        <Row label={t.imageProvider}>
          {(id) => (
            <Select<ImageProvider>
              id={id}
              value={imageProvider}
              options={[
                { value: 'openai', label: 'OpenAI' },
                { value: 'google', label: 'Google' },
              ]}
              onChange={(provider) => {
                update({
                  image: {
                    ...config.image,
                    provider,
                    model: provider === 'openai' ? DEFAULT_CONFIG.image.model : '',
                  },
                });
                setImageModels(IDLE);
              }}
            />
          )}
        </Row>

        <Row
          label={t.imageModel}
          error={imageModels.error}
          hint={imageProvider === 'openai' ? t.keyShared : undefined}
        >
          {(id) =>
            imageProvider === 'openai' ? (
              <Select
                id={id}
                value={config.image.model}
                options={OPENAI_IMAGE_MODELS}
                onChange={(model) => update({ image: { ...config.image, model } })}
              />
            ) : (
              <Select
                id={id}
                value={config.image.model}
                options={modelOptions(imageModels)}
                disabled={imageModels.loading || imageModels.models.length === 0}
                onChange={(model) => update({ image: { ...config.image, model } })}
              />
            )
          }
        </Row>

        {imageProvider === 'openai' ? (
          <Row label={t.imageQuality}>
            {(id) => (
              <Select<ImageQuality>
                id={id}
                value={config.image.quality}
                options={[
                  { value: 'low', label: t.imageQualityLow },
                  { value: 'medium', label: t.imageQualityMedium },
                  { value: 'high', label: t.imageQualityHigh },
                ]}
                onChange={(quality) => update({ image: { ...config.image, quality } })}
              />
            )}
          </Row>
        ) : (
          <Row label={t.imageAspect} hint={t.imageAspectHint}>
            {(id) => (
              <Select
                id={id}
                value={config.image.aspectRatio ?? ''}
                options={[
                  { value: '', label: t.imageAspectAuto },
                  ...ASPECT_RATIOS.map((r) => ({ value: r, label: r })),
                ]}
                onChange={(aspectRatio) =>
                  update({
                    image: { ...config.image, aspectRatio: aspectRatio || undefined },
                  })
                }
              />
            )}
          </Row>
        )}

        <CostLine
          label={t.costImage}
          amount={imageEstimate.total}
          variesLabel={t.costVaries}
          detail={
            imageEstimate.perImage !== null
              ? fill(t.costPerImage, {
                  each: formatUsd(imageEstimate.perImage),
                  count: config.video.numScenes,
                })
              : fill(t.costUnlisted, { model: config.image.model || '—' })
          }
          note={imageEstimate.modelFound ? fill(t.costScraped, { date: scrapedOn }) : undefined}
        />
      </Fieldset>

      <Fieldset legend={t.videoTitle}>
        <Row label={t.videoResolution}>
          {(id) => (
            <Select
              id={id}
              value={`${config.video.resolution.width}x${config.video.resolution.height}`}
              options={RESOLUTIONS.map((r) => ({
                value: `${r.width}x${r.height}`,
                label: r.label,
              }))}
              onChange={(value) => {
                const [width, height] = value.split('x').map(Number);
                update({ video: { ...config.video, resolution: { width, height } } });
              }}
            />
          )}
        </Row>

        <div className="slp-pair">
          <Row label={t.videoScenes}>
            {(id) => (
              <NumberField
                id={id}
                value={config.video.numScenes}
                min={1}
                max={100}
                onChange={(numScenes) => update({ video: { ...config.video, numScenes } })}
              />
            )}
          </Row>
          <Row label={t.videoDuration}>
            {(id) => (
              <NumberField
                id={id}
                value={config.video.targetDuration}
                min={1}
                max={3600}
                onChange={(targetDuration) => update({ video: { ...config.video, targetDuration } })}
              />
            )}
          </Row>
        </div>

        <Row label={t.videoFrameRate}>
          {(id) => (
            <NumberField
              id={id}
              value={config.video.frameRate}
              min={1}
              max={60}
              onChange={(frameRate) => update({ video: { ...config.video, frameRate } })}
            />
          )}
        </Row>
      </Fieldset>

      <Fieldset legend={t.ttsTitle}>
        <div className="slp-pair">
          <Row label={t.ttsModel}>
            {(id) => (
              <Select
                id={id}
                value={config.tts.model}
                options={TTS_MODELS}
                onChange={(model) => update({ tts: { ...config.tts, model } })}
              />
            )}
          </Row>
          <Row label={t.ttsVoice}>
            {(id) => (
              <Select
                id={id}
                value={VOICES.some((v) => v.value === config.tts.voiceId) ? config.tts.voiceId : ''}
                options={[...VOICES, { value: '', label: '—' }]}
                onChange={(voiceId) =>
                  voiceId && update({ tts: { ...config.tts, voiceId } })
                }
              />
            )}
          </Row>
        </div>

        <Row label={t.ttsVoiceCustom} hint={t.ttsVoiceCustomHint}>
          {(id) => (
            <input
              id={id}
              className="slp-input"
              type="text"
              value={config.tts.voiceId}
              spellCheck={false}
              onChange={(e) => update({ tts: { ...config.tts, voiceId: e.target.value.trim() } })}
            />
          )}
        </Row>

        <Row label={fill(t.ttsSpeed, { value: config.tts.speed.toFixed(1) })}>
          {(id) => (
            <Slider
              id={id}
              value={config.tts.speed}
              min={0.5}
              max={2}
              step={0.1}
              onChange={(speed) => update({ tts: { ...config.tts, speed } })}
              lowLabel={t.ttsSlow}
              highLabel={t.ttsFast}
            />
          )}
        </Row>

        <Row label={fill(t.ttsConcurrency, { value: config.tts.concurrency })}>
          {(id) => (
            <Slider
              id={id}
              value={config.tts.concurrency}
              min={1}
              max={10}
              step={1}
              onChange={(concurrency) => update({ tts: { ...config.tts, concurrency } })}
              lowLabel={t.ttsConcurrencyLow}
              highLabel={t.ttsConcurrencyHigh}
            />
          )}
        </Row>

        <Row label={t.ttsPlan} hint={t.ttsPlanHint}>
          {(id) => (
            <Select<TtsPlan>
              id={id}
              value={config.tts.plan}
              options={TTS_PLANS.map((plan) => ({
                value: plan,
                label: plan.charAt(0).toUpperCase() + plan.slice(1),
              }))}
              onChange={(plan) => update({ tts: { ...config.tts, plan } })}
            />
          )}
        </Row>

        <CostLine
          label={t.costTts}
          amount={ttsEstimate.totalCost}
          variesLabel={t.costVaries}
          detail={
            config.tts.plan === 'free'
              ? t.costFreePlan
              : ttsEstimate.perKChars !== null
                ? fill(t.costChars, {
                    chars: ttsEstimate.totalChars.toLocaleString(localeOf(lang)),
                    rate: formatUsd(ttsEstimate.perKChars),
                  })
                : ''
          }
        />
      </Fieldset>

      <div className="slp-total">
        <div className="slp-cost-line">
          <strong>{t.costTotal}</strong>
          <strong className="slp-cost-amount">
            {total !== null ? `~${formatUsd(total)}` : t.costVaries}
          </strong>
        </div>
        <p className="slp-note">{t.costEstimateOnly}</p>
      </div>

      {startError && <p className="slp-error slp-error-block">{startError}</p>}
      {blocked && <p className="slp-note">{blocked}</p>}

      <div className="slp-actions">
        <button
          type="button"
          className="retro-btn slp-primary"
          disabled={Boolean(blocked) || checking}
          onClick={() => void start()}
        >
          {checking ? (
            <>
              <Spinner /> {t.startChecking}
            </>
          ) : (
            t.startButton
          )}
        </button>
        <button
          type="button"
          className="retro-btn"
          onClick={() => {
            if (window.confirm(t.resetConfirm)) reset();
          }}
        >
          {t.reset}
        </button>
      </div>
    </div>
  );
}
