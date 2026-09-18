/*
 * The script: a topic box, and then a stack of editable scene cards that fill in while the model
 * is still writing.
 *
 * The streaming is the point. A twelve-scene script is thirty seconds of generation, and the
 * alternative — a spinner, then twelve cards at once — hides the one thing worth watching: the
 * model is answering in the format it was asked for. `parseSceneBuffer` is what makes it possible
 * (see llm.ts); this file only draws what comes out.
 *
 * Every scene stays editable afterwards, including the ones the model wrote, because the whole
 * economy of the app is that a bad `image_description` costs a picture. Fixing the sentence is
 * free; regenerating the scene is not.
 */

import { useState } from 'react';

import { targetWords } from '../../utils/sloper/llm';
import type { Scene, SloperConfig, TokenUsage } from '../../utils/sloper/types';
import { Spinner } from './fields';
import { fill, localeOf, type Lang, type Translation } from './translations';

interface SceneCardProps {
  scene: Scene;
  onUpdate: (patch: Partial<Omit<Scene, 'id' | 'index'>>) => void;
  onDelete: () => void;
  t: Translation;
  lang: Lang;
}

function SceneCard({ scene, onUpdate, onDelete, t, lang }: SceneCardProps) {
  const [open, setOpen] = useState(true);
  const words = scene.script.split(/\s+/).filter(Boolean).length;

  return (
    <li className="slp-scene">
      <div className="slp-scene-head">
        <button
          type="button"
          className="slp-scene-toggle"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span className="slp-scene-arrow" aria-hidden="true">
            {open ? '▼' : '▶'}
          </span>
          {fill(t.sceneNumber, { n: scene.index + 1 })}
          {scene.isEdited && <span className="slp-chip">{t.sceneEdited}</span>}
        </button>
        <button type="button" className="slp-scene-delete" onClick={onDelete}>
          {t.sceneDelete}
        </button>
      </div>

      {open ? (
        <div className="slp-scene-body">
          <label className="slp-label">
            {t.sceneScript}
            <textarea
              className="slp-textarea"
              value={scene.script}
              placeholder={t.sceneScriptPlaceholder}
              onChange={(e) => onUpdate({ script: e.target.value })}
            />
          </label>
          <p className="slp-hint">
            {fill(t.sceneWords, { count: words.toLocaleString(localeOf(lang)) })}
          </p>

          <label className="slp-label">
            {t.sceneImage}
            <textarea
              className="slp-textarea"
              value={scene.imageDescription}
              placeholder={t.sceneImagePlaceholder}
              onChange={(e) => onUpdate({ imageDescription: e.target.value })}
            />
          </label>
        </div>
      ) : (
        <p className="slp-scene-peek">{scene.script.trim() || `(${t.sceneEmpty})`}</p>
      )}
    </li>
  );
}

interface ScenesStageProps {
  config: SloperConfig;
  /*
   * The topic lives in `useSloperRun` rather than here, and that is not gratuitous lifting: it is
   * the one thing on this screen that is worth saving and cannot be rebuilt from anything else.
   * Held in local state it would be lost on a reload and, worse, would come back empty on a
   * project reopened from the account — leaving a stack of scenes with no record of what they
   * were asked for.
   */
  prompt: string;
  onPromptChange: (value: string) => void;
  scenes: Scene[];
  streaming: boolean;
  tokenUsage: TokenUsage | null;
  estimatedCost: number | null;
  onGenerate: (prompt: string) => void;
  onStop: () => void;
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<Omit<Scene, 'id' | 'index'>>) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onBack: () => void;
  onNext: () => void;
  t: Translation;
  lang: Lang;
}

export default function ScenesStage({
  config,
  prompt,
  onPromptChange,
  scenes,
  streaming,
  tokenUsage,
  estimatedCost,
  onGenerate,
  onStop,
  onAdd,
  onUpdate,
  onRemove,
  onClear,
  onBack,
  onNext,
  t,
  lang,
}: ScenesStageProps) {
  // A scene missing either field cannot become a pair of assets, so it is counted out here
  // rather than generated half-way and refused by the assembler later.
  const usable = scenes.filter((s) => s.script.trim() && s.imageDescription.trim());
  const skipped = scenes.length - usable.length;
  const locale = localeOf(lang);

  return (
    <div className="slp-stage">
      <div className="slp-backbar">
        <button type="button" className="slp-back" onClick={onBack}>
          {t.backToConfig}
        </button>
      </div>

      <label className="slp-label" htmlFor="slp-prompt">
        {t.promptLabel}
      </label>
      <textarea
        id="slp-prompt"
        className="slp-textarea slp-prompt"
        value={prompt}
        placeholder={t.promptPlaceholder}
        disabled={streaming}
        onChange={(e) => onPromptChange(e.target.value)}
      />
      <p className="slp-hint">
        {fill(t.promptHint, {
          scenes: config.video.numScenes,
          words: targetWords(config.video.targetDuration),
          seconds: config.video.targetDuration,
        })}
      </p>

      <div className="slp-actions">
        <button
          type="button"
          className="retro-btn slp-primary"
          disabled={!prompt.trim() || streaming}
          onClick={() => onGenerate(prompt)}
        >
          {streaming ? (
            <>
              <Spinner /> {fill(t.generating, { count: scenes.length })}
            </>
          ) : (
            t.generate
          )}
        </button>
        {streaming && (
          <button type="button" className="retro-btn" onClick={onStop}>
            {t.stop}
          </button>
        )}
        {scenes.length > 0 && !streaming && (
          <button type="button" className="retro-btn" onClick={onClear}>
            {t.clearAll}
          </button>
        )}
      </div>

      {scenes.length === 0 && !streaming ? (
        <p className="slp-empty">{t.scenesNone}</p>
      ) : (
        <ul className="slp-scenes">
          {scenes.map((scene) => (
            <SceneCard
              key={scene.id}
              scene={scene}
              onUpdate={(patch) => onUpdate(scene.id, patch)}
              onDelete={() => onRemove(scene.id)}
              t={t}
              lang={lang}
            />
          ))}
        </ul>
      )}

      {!streaming && scenes.length > 0 && (
        <button type="button" className="slp-add-scene" onClick={onAdd}>
          {t.addScene}
        </button>
      )}

      {tokenUsage && (
        <div className="slp-tokens">
          <h3 className="slp-subhead">{t.tokensTitle}</h3>
          <dl className="slp-token-grid">
            <div>
              <dt>{t.tokensPrompt}</dt>
              <dd>{tokenUsage.prompt.toLocaleString(locale)}</dd>
            </div>
            <div>
              <dt>{t.tokensCompletion}</dt>
              <dd>{tokenUsage.completion.toLocaleString(locale)}</dd>
            </div>
            <div>
              <dt>{t.tokensTotal}</dt>
              <dd>{(tokenUsage.prompt + tokenUsage.completion).toLocaleString(locale)}</dd>
            </div>
            <div>
              <dt>{t.tokensCost}</dt>
              <dd>${(estimatedCost ?? 0).toFixed(4)}</dd>
            </div>
          </dl>
        </div>
      )}

      {usable.length > 0 && !streaming && (
        <>
          {skipped > 0 && <p className="slp-note">{fill(t.scenesSkipped, { count: skipped })}</p>}
          <div className="slp-actions">
            <button type="button" className="retro-btn slp-primary" onClick={onNext}>
              {fill(t.toAssets, { count: usable.length })}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
