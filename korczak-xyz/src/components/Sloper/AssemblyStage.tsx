/*
 * The wait.
 *
 * Nothing on this screen is decorative. A dozen scenes is a 20 MB upload and a few minutes of
 * libx264 on a shared core, and the two facts that make that bearable are which of those two it
 * is doing and how long it has been at it — so the phase and a running clock are the whole
 * screen. Without the clock, three minutes of silence and a hung request look the same.
 */

import { useEffect, useState } from 'react';

import { Spinner } from './fields';
import { fill, type Translation } from './translations';
import type { AssemblyPhase } from '../../hooks/useSloperRun';

function Elapsed({ t }: { t: Translation }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const mm = Math.floor(seconds / 60);
  const ss = String(seconds % 60).padStart(2, '0');
  return <p className="slp-hint">{fill(t.assemblyElapsed, { time: `${mm}:${ss}` })}</p>;
}

/**
 * Which of the three waits this is. `encoding` is knowable only because the function heartbeats —
 * see `AssemblyPhase` — and it is the longest of the three by a wide margin, so it is the one the
 * line is worth being honest about.
 */
function waitLine(phase: AssemblyPhase, uploadMB: string | null, t: Translation): string {
  if (phase === 'encoding') return t.assemblyEncoding;
  if (phase === 'uploading' && uploadMB) return fill(t.assemblyUploading, { mb: uploadMB });
  return t.assemblyPreparing;
}

interface AssemblyStageProps {
  phase: AssemblyPhase;
  uploadMB: string | null;
  error: string | null;
  onRetry: () => void;
  onBack: () => void;
  t: Translation;
}

export default function AssemblyStage({
  phase,
  uploadMB,
  error,
  onRetry,
  onBack,
  t,
}: AssemblyStageProps) {
  const failed = phase === 'error';

  return (
    <div className="slp-stage">
      <div className="slp-backbar">
        <button type="button" className="slp-back" onClick={onBack} disabled={!failed}>
          {t.backToAssets}
        </button>
      </div>

      <div className="slp-wait">
        {failed ? (
          <>
            <p className="slp-error slp-error-block">{t.assemblyFailed}</p>
            {error && <p className="slp-error">{error}</p>}
            <div className="slp-actions">
              <button type="button" className="retro-btn slp-primary" onClick={onRetry}>
                {t.assemblyRetry}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="slp-wait-line">
              <Spinner /> {waitLine(phase, uploadMB, t)}
            </p>
            <Elapsed t={t} />
            <p className="slp-note">{t.assemblyWait}</p>
          </>
        )}
      </div>
    </div>
  );
}
