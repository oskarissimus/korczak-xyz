/*
 * The setup sheet: a key, a model, who the passenger is and what they sound like.
 *
 * The dropdowns that are not plain forms are the two lists fetched with a key, and they work the
 * way sloper's do — listing a provider's models IS the validation call, so typing a key either
 * fills the dropdown or says why it did not, and there is no separate "check this key" button to
 * press and forget. Debounced by half a second, because a key typed rather than pasted arrives one
 * character at a time and forty 401s is a rate limit.
 *
 * The one thing on this screen that is not a setting is the disclaimer, and it is not there for
 * the lawyers. This app puts a synthetic voice in a moving car saying things like "watch out for
 * that truck" about a photograph from several seconds ago; the one way it could do harm is by
 * being believed for a moment. So it is stated once, in full, before the first journey — and again
 * in a line on the ride screen, where it is read at a glance.
 */

import { useEffect, useRef, useState } from 'react';

import {
  INTENSITIES,
  MAX_INTERVAL,
  MIN_INTERVAL,
  PERSONAS,
  canStart,
  missingKeys,
} from '../../utils/backseat/defaults';
import {
  fetchElevenLabsVoices,
  primeVoices,
  speak,
  watchVoices,
  type DeviceVoice,
  type ElevenLabsVoice,
} from '../../utils/backseat/speech';
import type {
  BackseatConfig,
  CameraFacing,
  Intensity,
  Persona,
  VisionProvider,
  VoiceEngine,
} from '../../utils/backseat/types';
import { fetchVisionModels } from '../../utils/backseat/vision';
import { Fieldset, KeyField, Row, Select, Slider } from './fields';
import { fill, type Translation } from './translations';

const PERSONA_LABELS: Record<Persona, keyof Translation> = {
  nervous: 'personaNervous',
  instructor: 'personaInstructor',
  parent: 'personaParent',
  child: 'personaChild',
  codriver: 'personaCodriver',
};

const INTENSITY_LABELS: Record<Intensity, keyof Translation> = {
  mild: 'intensityMild',
  normal: 'intensityNormal',
  relentless: 'intensityRelentless',
};

interface FetchState<T> {
  loading: boolean;
  items: T[];
  error: string | null;
}

const IDLE = { loading: false, items: [], error: null };

interface SetupScreenProps {
  config: BackseatConfig;
  update: (patch: Partial<BackseatConfig>) => void;
  reset: () => void;
  onStart: () => void;
  /** The keys on screen came from the video generation wizard rather than from this app. */
  borrowed: boolean;
  t: Translation;
  lang: 'en' | 'pl';
}

export default function SetupScreen({
  config,
  update,
  reset,
  onStart,
  borrowed,
  t,
  lang,
}: SetupScreenProps) {
  /*
   * The auto-pick reads the current settings through refs rather than through the dependency
   * array. In the array it re-runs the fetch every time the dropdown changes — which is what the
   * fetch itself does when it picks a model — and the two take turns for ever. Same trap as
   * sloper's config screen, same way out.
   */
  const configRef = useRef(config);
  configRef.current = config;
  const updateRef = useRef(update);
  updateRef.current = update;

  // --- the vision model list --------------------------------------------------------------

  const [models, setModels] = useState<FetchState<string>>(IDLE);

  const provider = config.vision.provider;
  const visionKey = provider === 'openai' ? config.apiKeys.openai : config.apiKeys.google;

  useEffect(() => {
    if (!visionKey) {
      setModels(IDLE);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      setModels({ loading: true, items: [], error: null });

      void fetchVisionModels(provider, visionKey).then((result) => {
        if (cancelled) return;
        setModels({
          loading: false,
          items: result.models,
          error: result.success ? null : (result.error ?? null),
        });
        // Picked for you only when what is selected is not on offer — otherwise a saved choice
        // would be overwritten every time the page loads.
        if (result.models.length > 0 && !result.models.includes(configRef.current.vision.model)) {
          updateRef.current({ vision: { ...configRef.current.vision, model: result.models[0] } });
        }
      });
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [provider, visionKey]);

  // --- the voices -------------------------------------------------------------------------

  /* The device's own list, which is empty on the first read in every browser and arrives on an
     event. See `watchVoices` for why both halves are needed. */
  const [deviceVoices, setDeviceVoices] = useState<DeviceVoice[]>([]);
  useEffect(() => watchVoices(setDeviceVoices), []);

  const [elevenVoices, setElevenVoices] = useState<FetchState<ElevenLabsVoice>>(IDLE);
  const elevenKey = config.apiKeys.elevenLabs;
  const usingElevenLabs = config.voice.engine === 'elevenlabs';

  useEffect(() => {
    if (!usingElevenLabs || !elevenKey) {
      setElevenVoices(IDLE);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      setElevenVoices({ loading: true, items: [], error: null });

      void fetchElevenLabsVoices(elevenKey).then((result) => {
        if (cancelled) return;
        setElevenVoices({
          loading: false,
          items: result.voices,
          error: result.success ? null : (result.error ?? null),
        });
        if (
          result.voices.length > 0 &&
          !result.voices.some((voice) => voice.id === configRef.current.voice.voiceId)
        ) {
          updateRef.current({
            voice: { ...configRef.current.voice, voiceId: result.voices[0].id },
          });
        }
      });
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [elevenKey, usingElevenLabs]);

  /*
   * The test button, which is also how the speech engine gets unlocked on iOS ahead of the first
   * ride: it is a real click, and the utterance it speaks is spoken from inside it.
   */
  const [testError, setTestError] = useState<string | null>(null);
  const testVoice = () => {
    setTestError(null);
    // Before anything is awaited, for the reason in `speech.ts`: this click is a gesture and the
    // clip element has to be woken inside it or iOS refuses every clip that follows.
    primeVoices();
    void speak(configRef.current, {
      text: t.voiceTestLine,
      lang: lang === 'pl' ? 'pl-PL' : 'en-GB',
      rate: configRef.current.voice.rate,
    }).catch((e) => setTestError(e instanceof Error ? e.message : String(e)));
  };

  const missing = missingKeys(config);
  const ready = canStart(config);

  const deviceVoiceOptions = [
    { value: '', label: t.voiceDeviceDefault },
    ...deviceVoices.map((voice) => ({ value: voice.uri, label: `${voice.name} (${voice.lang})` })),
  ];

  return (
    <div className="bks-sheet">
      <p className="bks-pitch">{t.pitch}</p>

      {/* Said in full, once, before the first journey. The ride screen carries the short form. */}
      <aside className="bks-warning">
        <h3 className="bks-warning-title">{t.disclaimerTitle}</h3>
        <p>{t.disclaimerBody}</p>
      </aside>

      <Fieldset legend={t.keysTitle} hint={t.keysBlurb}>
        {/* A key appearing in an app you never typed it into is startling, and a key you believe
            you have revoked in one place while a copy of it works in another is worse. Both are
            said here, where the key is, rather than in a paragraph at the top. */}
        {borrowed && <p className="bks-note">{t.keysBorrowed}</p>}

        {provider === 'openai' ? (
          <KeyField
            label={t.keyOpenai}
            value={config.apiKeys.openai}
            placeholder="sk-…"
            onChange={(value) => update({ apiKeys: { ...config.apiKeys, openai: value } })}
            t={t}
          />
        ) : (
          <KeyField
            label={t.keyGoogle}
            value={config.apiKeys.google}
            placeholder="AIza…"
            onChange={(value) => update({ apiKeys: { ...config.apiKeys, google: value } })}
            t={t}
          />
        )}

        {/* Only shown when it is needed. A key field for a service the current settings never
            call is a question nobody should have to answer. */}
        {usingElevenLabs && (
          <KeyField
            label={t.keyElevenLabs}
            value={config.apiKeys.elevenLabs}
            placeholder="sk_…"
            hint={t.keyElevenLabsHint}
            onChange={(value) => update({ apiKeys: { ...config.apiKeys, elevenLabs: value } })}
            t={t}
          />
        )}
      </Fieldset>

      <Fieldset legend={t.visionTitle}>
        <Row label={t.visionProvider}>
          {(id) => (
            <Select<VisionProvider>
              id={id}
              value={config.vision.provider}
              options={[
                { value: 'openai', label: 'OpenAI' },
                { value: 'google', label: 'Google Gemini' },
              ]}
              onChange={(value) =>
                update({ vision: { ...config.vision, provider: value, model: '' } })
              }
            />
          )}
        </Row>

        <Row
          label={t.visionModel}
          hint={models.items.length > 0 ? t.visionModelsHint : undefined}
          error={models.error}
        >
          {(id) =>
            models.items.length > 0 ? (
              <Select
                id={id}
                value={config.vision.model}
                options={models.items.map((model) => ({ value: model, label: model }))}
                onChange={(value) => update({ vision: { ...config.vision, model: value } })}
              />
            ) : (
              <p className="bks-hint" id={id}>
                {models.loading ? t.visionModelsLoading : t.visionModelsEmpty}
              </p>
            )
          }
        </Row>
      </Fieldset>

      <Fieldset legend={t.personaTitle}>
        <Row label={t.personaWho}>
          {(id) => (
            <Select<Persona>
              id={id}
              value={config.remarks.persona}
              options={PERSONAS.map((persona) => ({
                value: persona,
                label: t[PERSONA_LABELS[persona]],
              }))}
              onChange={(value) => update({ remarks: { ...config.remarks, persona: value } })}
            />
          )}
        </Row>

        <Row label={t.intensityLabel}>
          {(id) => (
            <Select<Intensity>
              id={id}
              value={config.remarks.intensity}
              options={INTENSITIES.map((intensity) => ({
                value: intensity,
                label: t[INTENSITY_LABELS[intensity]],
              }))}
              onChange={(value) => update({ remarks: { ...config.remarks, intensity: value } })}
            />
          )}
        </Row>

        <Row
          label={fill(t.intervalLabel, { n: config.remarks.intervalSeconds })}
          hint={t.intervalHint}
        >
          {(id) => (
            <Slider
              id={id}
              value={config.remarks.intervalSeconds}
              min={MIN_INTERVAL}
              max={MAX_INTERVAL}
              step={1}
              lowLabel={`${MIN_INTERVAL}s`}
              highLabel={`${MAX_INTERVAL}s`}
              onChange={(value) =>
                update({ remarks: { ...config.remarks, intervalSeconds: Math.round(value) } })
              }
            />
          )}
        </Row>
      </Fieldset>

      <Fieldset legend={t.voiceTitle}>
        <Row label={t.voiceEngine}>
          {(id) => (
            <Select<VoiceEngine>
              id={id}
              value={config.voice.engine}
              options={[
                { value: 'device', label: t.voiceEngineDevice },
                { value: 'elevenlabs', label: t.voiceEngineElevenLabs },
              ]}
              onChange={(value) => update({ voice: { ...config.voice, engine: value } })}
            />
          )}
        </Row>

        {usingElevenLabs ? (
          <Row label={t.voiceElevenLabs} error={elevenVoices.error}>
            {(id) =>
              elevenVoices.items.length > 0 ? (
                <Select
                  id={id}
                  value={config.voice.voiceId}
                  options={elevenVoices.items.map((voice) => ({
                    value: voice.id,
                    label: voice.name,
                  }))}
                  onChange={(value) => update({ voice: { ...config.voice, voiceId: value } })}
                />
              ) : (
                <p className="bks-hint" id={id}>
                  {elevenVoices.loading ? t.voiceElevenLabsLoading : t.voiceElevenLabsEmpty}
                </p>
              )
            }
          </Row>
        ) : (
          <Row
            label={t.voiceDevice}
            hint={deviceVoices.length === 0 ? t.voiceDeviceEmpty : undefined}
          >
            {(id) => (
              <Select
                id={id}
                value={config.voice.deviceVoiceUri}
                options={deviceVoiceOptions}
                onChange={(value) => update({ voice: { ...config.voice, deviceVoiceUri: value } })}
              />
            )}
          </Row>
        )}

        <Row label={fill(t.voiceRate, { value: config.voice.rate.toFixed(1) })} error={testError}>
          {(id) => (
            <Slider
              id={id}
              value={config.voice.rate}
              min={0.5}
              max={2}
              step={0.1}
              lowLabel={t.voiceSlow}
              highLabel={t.voiceFast}
              onChange={(value) => update({ voice: { ...config.voice, rate: value } })}
            />
          )}
        </Row>

        <button type="button" className="retro-btn bks-test" onClick={testVoice}>
          {t.voiceTest}
        </button>
      </Fieldset>

      <Fieldset legend={t.cameraTitle}>
        <Row label={t.cameraFacing}>
          {(id) => (
            <Select<CameraFacing>
              id={id}
              value={config.camera.facing}
              options={[
                { value: 'environment', label: t.cameraBack },
                { value: 'user', label: t.cameraFront },
              ]}
              onChange={(value) => update({ camera: { ...config.camera, facing: value } })}
            />
          )}
        </Row>
      </Fieldset>

      <div className="bks-actions">
        <button type="button" className="retro-btn bks-start" onClick={onStart} disabled={!ready}>
          {t.start}
        </button>
        <button
          type="button"
          className="retro-btn"
          onClick={() => {
            if (window.confirm(t.resetConfirm)) reset();
          }}
        >
          {t.resetAll}
        </button>
      </div>

      {/* Why the button is dead, said next to the button. Keys first: picking a model is
          impossible until a key has filled the list, so naming both at once is noise. */}
      {!ready && (
        <p className="bks-note">
          {missing.length > 0 ? t.needKey : t.needModel}
        </p>
      )}
    </div>
  );
}
