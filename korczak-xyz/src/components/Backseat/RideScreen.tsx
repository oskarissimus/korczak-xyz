/*
 * The screen you actually drive with, which is the one screen on this site designed to be read at
 * arm's length in a cradle, in daylight, by somebody who must not look at it for long.
 *
 * Everything here follows from that:
 *
 *  - **The camera preview is small and the words are large.** The obvious layout is the opposite —
 *    a viewfinder filling the screen with a caption over it — and it is wrong twice over: the
 *    driver can see the road through the windscreen far better than through a phone, and a caption
 *    over moving video is the least legible arrangement there is. The preview is here to confirm
 *    the phone is pointed at the road and for nothing else, so it is a strip, and the remark is the
 *    page.
 *  - **Two buttons, both enormous.** Stop and Hush. A control that needs aiming is a control that
 *    is used at the wrong moment.
 *  - **Nothing is read by colour alone**, the same rule the charts are built on: the speaking
 *    state is a word and a moving marker, not a green dot.
 *  - **The disclaimer is on the screen the whole time**, in its short form. This is the screen
 *    where a synthetic voice is saying "mind that lorry", and the line saying it is a joke belongs
 *    where that is being heard rather than two screens back.
 */

import { useEffect, useState } from 'react';

import { cameraMessage, localeOf, type Lang, type Translation } from './translations';
import type { CameraFailure } from '../../utils/backseat/frame';
import type { Remark, RideStatus } from '../../utils/backseat/types';
import type { PendingRound } from '../../hooks/useBackseatRide';

interface RideScreenProps {
  status: RideStatus;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  remarks: Remark[];
  current: Remark | null;
  speaking: boolean;
  pending: PendingRound | null;
  lastLatencyMs: number | null;
  error: string | null;
  cameraError: CameraFailure | null;
  onStop: () => void;
  onHush: () => void;
  onDismissError: () => void;
  t: Translation;
  lang: Lang;
}

function seconds(ms: number, lang: Lang): string {
  return (ms / 1000).toLocaleString(localeOf(lang), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/**
 * Seconds since the photograph, counting until the first sound — the latency as it happens, so a
 * ride shows where the wait is without anybody reading a record afterwards. Once the voice starts
 * the count stops and the last value stays, dimmed, until the next photograph.
 */
function LatencyClock({
  pending,
  lastLatencyMs,
  t,
  lang,
}: {
  pending: PendingRound | null;
  lastLatencyMs: number | null;
  t: Translation;
  lang: Lang;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!pending) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [pending]);

  if (pending) {
    return (
      <p className="bks-clock bks-clock-live">
        <span className="bks-clock-value">{seconds(Math.max(0, now - pending.at), lang)} s</span>
        <span className="bks-clock-label">
          {pending.stage === 'looking' ? t.clockLooking : t.clockVoicing}
        </span>
      </p>
    );
  }
  if (lastLatencyMs === null) return null;
  return (
    <p className="bks-clock">
      <span className="bks-clock-value">{seconds(lastLatencyMs, lang)} s</span>
      <span className="bks-clock-label">{t.clockLast}</span>
    </p>
  );
}

export default function RideScreen({
  status,
  videoRef,
  remarks,
  current,
  speaking,
  pending,
  lastLatencyMs,
  error,
  cameraError,
  onStop,
  onHush,
  onDismissError,
  t,
  lang,
}: RideScreenProps) {
  const timeOf = (at: number) =>
    new Date(at).toLocaleTimeString(localeOf(lang), { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="bks-ride">
      {/* The preview. `playsInline` is not decoration: without it iOS Safari takes the video
          fullscreen the moment it plays, which puts a viewfinder over the whole app and hides
          every control on this screen. `muted` goes with it — the stream has no audio track, and
          iOS refuses to autoplay a video that is not muted anyway. */}
      <div className="bks-viewport">
        <video
          ref={videoRef}
          className="bks-video"
          playsInline
          muted
          autoPlay
          /* The preview carries no information a screen reader needs, and describing a live
             camera feed it cannot see would be an invention. */
          aria-hidden="true"
        />
        {status === 'starting' && <p className="bks-viewport-note">{t.cameraStarting}</p>}
      </div>

      <LatencyClock pending={pending} lastLatencyMs={lastLatencyMs} t={t} lang={lang} />

      {/*
        The remark, as large as it goes. `aria-live="polite"` rather than assertive: it is spoken
        aloud already, and a screen reader interrupting itself to repeat what the speaker is
        halfway through saying is two voices over one another.
      */}
      <div className="bks-current" aria-live="polite">
        {current ? (
          <p className="bks-current-text">{current.text}</p>
        ) : (
          <p className="bks-current-waiting">{t.waitingFirst}</p>
        )}
        {/* A word, not a colour. The bar beside it is confirmation. */}
        {speaking && (
          <p className="bks-speaking">
            <span className="bks-speaking-mark" aria-hidden="true" />
            {t.speakingNow}
          </p>
        )}
      </div>

      <div className="bks-controls">
        <button type="button" className="retro-btn bks-big" onClick={onStop}>
          {t.stop}
        </button>
        <button
          type="button"
          className="retro-btn bks-big"
          onClick={onHush}
          disabled={!speaking}
        >
          {t.hush}
        </button>
      </div>

      <p className="bks-disclaimer">{t.disclaimerShort}</p>

      {cameraError && <p className="bks-error">{cameraMessage(t, cameraError)}</p>}

      {error && (
        <div className="bks-banner">
          {/* The provider's own words, quoted rather than translated — it is the string you
              would paste into their support page. */}
          <p className="bks-error">{error}</p>
          <button type="button" className="bks-banner-close" onClick={onDismissError}>
            {t.errorDismiss}
          </button>
        </div>
      )}

      <section className="bks-log">
        <h3 className="bks-log-title">{t.remarksTitle}</h3>
        {remarks.length === 0 ? (
          <p className="bks-hint">{t.remarksEmpty}</p>
        ) : (
          <ol className="bks-log-list">
            {remarks.map((remark) => (
              <li key={remark.id} className="bks-log-item">
                <span className="bks-log-time">{timeOf(remark.at)}</span>
                {/* How long the photograph waited for a voice: the number the passenger's timing
                    lives on, on the screen so a ride shows whether a change made it better. */}
                {typeof remark.latencyMs === 'number' && (
                  <span className="bks-log-latency" title={t.remarkLatency}>
                    {seconds(remark.latencyMs, lang)} s
                  </span>
                )}
                <span className="bks-log-text">{remark.text}</span>
                {/* A line that was written but never heard. Said in words, because "it is grey"
                    is not a message. */}
                {remark.error && <span className="bks-log-failed">{t.remarkFailed}</span>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
