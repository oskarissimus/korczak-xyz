/*
 * The wait.
 *
 * Nothing on this screen is decorative. A dozen scenes is a few minutes of libx264 on a shared
 * core, and the two facts that make that bearable are what it is doing and how long it has been
 * at it — so the phase and a running clock are the whole screen. Without the clock, three minutes
 * of silence and a hung request look the same.
 *
 * SINCE THE ASSEMBLY MOVED INTO THE ACCOUNT this screen is usually not a wait at all, it is a
 * progress report on work happening elsewhere, and the note at the bottom says which of the two
 * it is. That is the one sentence on the page somebody acts on: it is the difference between
 * sitting here for three minutes and closing the laptop.
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
 * Which of the waits this is. `encoding` is knowable because the assembler says so — a heartbeat
 * down the response on the in-page route, a heartbeat into the job document on the other — and it
 * is the longest of them by a wide margin, so it is the one the line is worth being honest about.
 */
function waitLine(phase: AssemblyPhase, uploadMB: string | null, t: Translation): string {
  if (phase === 'encoding') return t.assemblyEncoding;
  if (phase === 'queued') return t.assemblyQueued;
  if (phase === 'uploading' && uploadMB) return fill(t.assemblyUploading, { mb: uploadMB });
  return t.assemblyPreparing;
}

interface AssemblyStageProps {
  phase: AssemblyPhase;
  /** Whether the encode is the account's rather than this page's. Changes what the note says. */
  background: boolean;
  uploadMB: string | null;
  error: string | null;
  onRetry: () => void;
  onBack: () => void;
  t: Translation;
}

export default function AssemblyStage({
  phase,
  background,
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
            {/* The two sentences are opposites and only one of them can be true: either this page
                is the only thing holding the encode up, or it is a spectator that may leave. */}
            <p className="slp-note">{background ? t.assemblyLeaveOk : t.assemblyWait}</p>
          </>
        )}
      </div>
    </div>
  );
}
