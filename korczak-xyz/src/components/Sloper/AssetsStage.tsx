/*
 * Watching the pictures and the narrations arrive.
 *
 * Every card is a scene and every scene has two independent halves, which is the whole reason
 * this screen is a grid of small statuses rather than one bar: they come from two providers with
 * two rate limits, either can fail on its own, and either can be retried on its own. A single
 * "generating assets…" would make a run where nine pictures worked and three did not look
 * identical to one where nothing did.
 *
 * The picture is shown as soon as it lands, at thumbnail size. It is the only honest check on the
 * one setting nobody can predict — whether the image model draws what the description says.
 */

import type { Asset, AssetStatus, Scene } from '../../utils/sloper/types';
import { Spinner } from './fields';
import { fill, type Translation } from './translations';

function statusLabel(status: AssetStatus, t: Translation): string {
  if (status === 'pending') return t.statusPending;
  if (status === 'generating') return t.statusGenerating;
  if (status === 'complete') return t.statusComplete;
  return t.statusFailed;
}

interface HalfProps {
  title: string;
  asset: Asset | undefined;
  onRetry: () => void;
  t: Translation;
  children: (asset: Asset) => React.ReactNode;
}

function Half({ title, asset, onRetry, t, children }: HalfProps) {
  return (
    <div className="slp-half">
      <div className="slp-half-head">
        <span className="slp-half-title">{title}</span>
        {asset && (
          <span className={`slp-status slp-status-${asset.status}`}>
            {statusLabel(asset.status, t)}
          </span>
        )}
      </div>

      <div className="slp-half-body">
        {!asset && <span className="slp-hint">—</span>}
        {asset?.status === 'pending' && <span className="slp-hint">{t.statusPending}</span>}
        {asset?.status === 'generating' && <Spinner />}
        {asset?.status === 'complete' && children(asset)}
        {asset?.status === 'failed' && (
          <div className="slp-fail">
            {/* The provider's own sentence, verbatim: it is what you would paste into their
                support page, and translating it would make it unsearchable. */}
            <p className="slp-error">{asset.error}</p>
            <button type="button" className="retro-btn slp-small" onClick={onRetry}>
              {t.retry}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface AssetsStageProps {
  scenes: Scene[];
  assetsFor: (sceneId: string) => { image?: Asset; audio?: Asset };
  assets: Map<string, Asset>;
  generating: boolean;
  onRetry: (assetId: string) => void;
  onBack: () => void;
  onNext: () => void;
  t: Translation;
}

export default function AssetsStage({
  scenes,
  assetsFor,
  assets,
  generating,
  onRetry,
  onBack,
  onNext,
  t,
}: AssetsStageProps) {
  const all = [...assets.values()];
  const done = all.filter((a) => a.status === 'complete').length;
  const failed = all.filter((a) => a.status === 'failed').length;
  const percent = all.length > 0 ? Math.round((done / all.length) * 100) : 0;

  const images = all.filter((a) => a.type === 'image');
  const audio = all.filter((a) => a.type === 'audio');

  // A scene needs BOTH halves to reach the assembler, so the button counts pairs rather than
  // assets — nine of twelve done can still mean nothing is assemblable.
  const ready = scenes.filter((scene) => {
    const { image, audio: voice } = assetsFor(scene.id);
    return image?.status === 'complete' && voice?.status === 'complete';
  }).length;

  return (
    <div className="slp-stage">
      <div className="slp-backbar">
        <button type="button" className="slp-back" onClick={onBack} disabled={generating}>
          {t.backToScenes}
        </button>
      </div>

      <p className="slp-hint">{t.assetsBlurb}</p>

      <div className="slp-progress">
        <div className="slp-progress-line">
          <span>
            {fill(t.assetsProgress, { done, total: all.length })}
            {generating && (
              <>
                {' '}
                <Spinner />
              </>
            )}
          </span>
          <strong>{percent}%</strong>
        </div>
        {/* Blocks rather than a smooth fill — a 1995 progress bar is discrete, and the count of
            blocks is legible at a glance where a bar's length is not. */}
        <div
          className="slp-bar"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="slp-bar-fill" style={{ width: `${percent}%` }} />
        </div>
        <p className="slp-hint">
          {t.assetsImages}: {images.filter((a) => a.status === 'complete').length}/{images.length}
          {' · '}
          {t.assetsAudio}: {audio.filter((a) => a.status === 'complete').length}/{audio.length}
          {failed > 0 && <> · {fill(t.assetsFailed, { count: failed })}</>}
        </p>
      </div>

      <ul className="slp-assets">
        {scenes.map((scene) => {
          const { image, audio: voice } = assetsFor(scene.id);
          if (!image && !voice) return null;

          return (
            <li key={scene.id} className="slp-asset">
              <h3 className="slp-subhead">
                {fill(t.sceneNumber, { n: scene.index + 1 })}
                <span className="slp-scene-peek"> {scene.script.slice(0, 90)}</span>
              </h3>

              <div className="slp-halves">
                <Half
                  title={t.assetsImages}
                  asset={image}
                  onRetry={() => image && onRetry(image.id)}
                  t={t}
                >
                  {(asset) =>
                    asset.dataUrl ? (
                      <img
                        className="slp-thumb"
                        src={asset.dataUrl}
                        alt={scene.imageDescription.slice(0, 120)}
                      />
                    ) : null
                  }
                </Half>

                <Half
                  title={t.assetsAudio}
                  asset={voice}
                  onRetry={() => voice && onRetry(voice.id)}
                  t={t}
                >
                  {(asset) => (
                    <div className="slp-audio">
                      {asset.dataUrl && <audio src={asset.dataUrl} controls preload="none" />}
                      {asset.duration !== null && (
                        <span className="slp-hint">{asset.duration.toFixed(1)}s</span>
                      )}
                    </div>
                  )}
                </Half>
              </div>
            </li>
          );
        })}
      </ul>

      {!generating && (
        <>
          {failed > 0 && <p className="slp-note">{t.assetsSomeFailed}</p>}
          <div className="slp-actions">
            <button
              type="button"
              className="retro-btn slp-primary"
              disabled={ready === 0}
              onClick={onNext}
            >
              {failed > 0 ? t.toAssemblyPartial : t.toAssembly}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
