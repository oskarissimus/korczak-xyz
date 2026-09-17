/*
 * The video, and the two ways out of the page with it.
 *
 * The blob URL is the one thing here worth care. It is minted from a `useMemo` and revoked when
 * the component unmounts or the blob changes — a URL that is revoked while the `<video>` is still
 * pointed at it stops playback dead, and one that is never revoked holds tens of megabytes for
 * the life of the tab. The download link mints its own, short-lived one rather than sharing this,
 * because Safari revoking the player's URL mid-save produces a truncated file.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import {
  driveClientId,
  loadGisScript,
  requestAccessToken,
  uploadToDrive,
  videoFilename,
} from '../../utils/sloper/drive';
import { Spinner } from './fields';
import { fill, type Translation } from './translations';

type DriveStatus = 'idle' | 'loading' | 'authenticating' | 'uploading' | 'done' | 'error';

function DriveButton({ video, t }: { video: Blob; t: Translation }) {
  const clientId = driveClientId();
  const [status, setStatus] = useState<DriveStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The token outlives one upload but never the page, and is deliberately not stored anywhere.
  const tokenRef = useRef<{ value: string; expiresAt: number } | null>(null);

  useEffect(() => {
    // Warmed on mount so the click that follows opens Google's popup without a load in between —
    // a popup opened after an await is the one browsers block.
    if (clientId) void loadGisScript().catch(() => undefined);
  }, [clientId]);

  // The whole control disappears where no OAuth client is configured, which is every deploy that
  // has not set one up. Downloading is unaffected.
  if (!clientId) return null;

  const upload = async () => {
    try {
      setError(null);
      setStatus('loading');
      await loadGisScript();

      const now = Date.now();
      if (!tokenRef.current || tokenRef.current.expiresAt < now) {
        setStatus('authenticating');
        const token = await requestAccessToken(clientId);
        // A minute of slack, so a token cannot expire between the check and the last chunk.
        tokenRef.current = {
          value: token.access_token,
          expiresAt: now + (token.expires_in - 60) * 1000,
        };
      }

      setStatus('uploading');
      setProgress(0);
      const result = await uploadToDrive(
        tokenRef.current.value,
        video,
        videoFilename(),
        setProgress,
      );

      setLink(result.webViewLink);
      setStatus('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
      setStatus('error');
    }
  };

  if (status === 'done' && link) {
    return (
      <a className="retro-btn" href={link} target="_blank" rel="noopener noreferrer">
        {t.driveOpen}
      </a>
    );
  }

  if (status === 'error') {
    return (
      <button type="button" className="retro-btn" title={error ?? undefined} onClick={() => void upload()}>
        {t.driveFailed}
      </button>
    );
  }

  if (status === 'idle') {
    return (
      <button type="button" className="retro-btn" onClick={() => void upload()}>
        {t.driveUpload}
      </button>
    );
  }

  return (
    <button type="button" className="retro-btn" disabled>
      <Spinner />{' '}
      {status === 'loading'
        ? t.driveLoading
        : status === 'authenticating'
          ? t.driveAuth
          : fill(t.driveUploading, { percent: Math.round(progress * 100) })}
    </button>
  );
}

interface OutputStageProps {
  video: Blob;
  onStartOver: () => void;
  t: Translation;
}

export default function OutputStage({ video, onStartOver, t }: OutputStageProps) {
  const url = useMemo(() => URL.createObjectURL(video), [video]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  const download = () => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(video);
    link.download = videoFilename();
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Long enough for Safari, which starts the save asynchronously after the click.
    setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
  };

  return (
    <div className="slp-stage">
      <p className="slp-hint">{t.outputBlurb}</p>

      <div className="slp-player">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- there is no caption track:
            the narration was generated from the script on the previous screen. */}
        <video src={url} controls playsInline preload="metadata" />
      </div>

      <div className="slp-actions">
        <button type="button" className="retro-btn slp-primary" onClick={download}>
          {t.download}
        </button>
        <DriveButton video={video} t={t} />
        <button
          type="button"
          className="retro-btn"
          onClick={() => {
            if (window.confirm(t.startOverConfirm)) onStartOver();
          }}
        >
          {t.startOver}
        </button>
      </div>
    </div>
  );
}
