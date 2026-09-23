/*
 * The whole of `/apps/audio-guide/`, as one island.
 *
 * Ported from `oskarissimus/audio-guide-v2` (a Vite app of hand-written DOM on GitHub Pages) in
 * Sep 2026, and its Go backend followed into `audio-guide-function/` — see
 * `utils/audioGuide/narration.ts`.
 *
 * ONE ISLAND, NO ROUTES, for the same reason as sloper and the backseat driver: there is a live
 * thing here that a navigation would tear down mid-flight. Two of them, in fact — a geolocation
 * watch and an `<audio>` element that only plays because of a tap that happened before the fetch
 * that filled it. Neither survives a remount, and the second one fails *silently* on iOS, which
 * is the worst kind.
 *
 * THE LAYOUT IS THE MAP. Everything else is a strip over it that appears when it has something to
 * say: the language picker and the keys, which are the only settings; a progress bar while a
 * guide is being written; the player once there is one; a notice when something failed. Nothing
 * scrolls, because this is read standing in a square with one hand.
 *
 * SIGNED IN, AND ALMOST NOTHING IS SAVED. The app opens for approved accounts only
 * (`AudioGuideGate`). What is kept between visits is the reader's two API keys — in localStorage
 * and `users/{uid}/audioGuide/config`, like sloper's and the backseat driver's — and the narration
 * language, one localStorage key. A guide itself is megabytes of MP3 that a walk leaves behind.
 */

import { useEffect, useRef, useState } from 'react';

import { useAudioGuide } from '../../hooks/useAudioGuide';
import { useAudioGuideKeys } from '../../hooks/useAudioGuideKeys';
import { useAuth, type AuthUser } from '../../hooks/useAuth';
import { missingKeys } from '../../utils/audioGuide/keys';
import { useNearbyAttractions } from '../../hooks/useNearbyAttractions';
import { useUserPosition } from '../../hooks/useUserPosition';
import AudioGuideGate from './AudioGuideGate';
import GenerationBar from './GenerationBar';
import KeysSheet from './KeysSheet';
import LanguagePicker from './LanguagePicker';
import MapPane from './MapPane';
import PlayerBar from './PlayerBar';
import { translations, type Lang, type Translation } from './translations';

interface AudioGuideProps {
  lang: Lang;
}

function attractionsMessage(
  error: ReturnType<typeof useNearbyAttractions>['error'],
  t: Translation,
): string {
  switch (error) {
    case 'busy':
      return t.attractionsBusy;
    case 'too-big':
      return t.attractionsTooBig;
    default:
      return t.attractionsFailed;
  }
}

function guideMessage(error: ReturnType<typeof useAudioGuide>['error'], t: Translation): string {
  switch (error) {
    case 'rate-limited':
      return t.errorRateLimited;
    case 'quota':
      return t.errorQuota;
    case 'keys':
      return t.errorKeys;
    default:
      return t.errorFailed;
  }
}

export default function AudioGuide({ lang }: AudioGuideProps) {
  const auth = useAuth();
  return (
    <AudioGuideGate auth={auth} lang={lang}>
      {auth.user && <AudioGuideApp lang={lang} user={auth.user} />}
    </AudioGuideGate>
  );
}

/*
 * Behind the gate, so that none of its hooks run for a visitor who cannot use it: no location
 * prompt, no Overpass request, no silent WAV.
 */
function AudioGuideApp({ lang, user }: AudioGuideProps & { user: AuthUser }) {
  const t: Translation = translations[lang];
  const places = useNearbyAttractions();
  const position = useUserPosition();
  const keys = useAudioGuideKeys(user);
  const [keysOpen, setKeysOpen] = useState(false);
  const guide = useAudioGuide(lang, keys.keys, () => setKeysOpen(true));
  const keysMissing = missingKeys(keys.keys).length > 0;

  /*
   * Open the sheet once, by itself, when the app finds a key missing — but only after the account
   * has answered, or a phone whose keys are in the account (or borrowable from the other two apps)
   * would be asked for them for the half-second before they arrive.
   */
  const askedOnce = useRef(false);
  useEffect(() => {
    if (askedOnce.current || !keys.ready || keys.sync === 'syncing') return;
    askedOnce.current = true;
    if (keysMissing) setKeysOpen(true);
  }, [keys.ready, keys.sync, keysMissing]);

  const generating = guide.status === 'generating';

  return (
    <div className="ag-app">
      <div className="ag-bar">
        <LanguagePicker value={guide.language} onChange={guide.setLanguage} t={t} />

        <button
          type="button"
          className={keysMissing ? 'retro-btn ag-keys-btn ag-keys-btn-missing' : 'retro-btn ag-keys-btn'}
          aria-expanded={keysOpen}
          onClick={() => setKeysOpen(!keysOpen)}
        >
          {keysMissing ? t.keysButtonMissing : t.keysButton}
        </button>

        {/* Only where the platform requires a gesture to ask — that is, on iOS. Elsewhere the
            compass is already reporting and a button would do nothing but confuse. */}
        {position.compassAsk && position.compass === 'prompt' && (
          <button
            type="button"
            className="retro-btn ag-compass"
            title={t.compassHint}
            onClick={position.enableCompass}
          >
            {t.compassEnable}
          </button>
        )}

        {position.compass === 'denied' && <span className="ag-compass-off">{t.compassDenied}</span>}
      </div>

      <div className="ag-stage">
        <MapPane
          attractions={places.attractions}
          selectedKey={guide.guide?.attractionKey ?? null}
          generatingKey={generating ? (guide.selected?.key ?? null) : null}
          user={position.position ? { ...position.position } : null}
          heading={position.heading}
          onSelect={guide.select}
          onBoundsChange={places.setBounds}
          label={t.title}
        />

        {/* The strip over the map. Ordered by urgency rather than by source: what is happening
            now sits above what merely failed. */}
        <div className="ag-overlay">
          {places.loading && <p className="ag-chip">{t.attractionsLoading}</p>}
          {!places.loading && places.empty && !places.error && (
            <p className="ag-chip">{t.attractionsEmpty}</p>
          )}
          {places.zoomedOut && <p className="ag-chip">{t.attractionsZoomIn}</p>}
          {places.error && (
            <p className="ag-chip ag-chip-error">
              {attractionsMessage(places.error, t)}{' '}
              <button type="button" className="ag-link" onClick={places.retry}>
                {t.retry}
              </button>
            </p>
          )}
          {position.permission === 'denied' && <p className="ag-chip">{t.locationDenied}</p>}
          {position.permission === 'unavailable' && (
            <p className="ag-chip">{t.locationUnavailable}</p>
          )}
        </div>

        <div className="ag-dock">
          {keysOpen && <KeysSheet api={keys} onClose={() => setKeysOpen(false)} t={t} />}

          {generating && guide.startedAt !== null && (
            <GenerationBar
              startedAt={guide.startedAt}
              name={guide.selected?.name ?? ''}
              onCancel={guide.cancel}
              t={t}
            />
          )}

          {guide.status === 'error' && (
            <div className="ag-error">
              <p className="ag-error-title">{t.errorTitle}</p>
              <p className="ag-error-body">{guideMessage(guide.error, t)}</p>
              {/* The backend's own words, in English, under the translated sentence. It is what
                  you would paste into a provider's support page. */}
              {guide.errorDetail && <p className="ag-error-detail">{guide.errorDetail}</p>}
              <div className="ag-error-actions">
                <button type="button" className="retro-btn" onClick={guide.retry}>
                  {t.retry}
                </button>
                <button type="button" className="retro-btn" onClick={guide.dismissError}>
                  {t.dismiss}
                </button>
              </div>
            </div>
          )}

          {guide.status === 'ready' && guide.guide && (
            <PlayerBar
              name={guide.guide.attractionName}
              playing={guide.playing}
              ended={guide.ended}
              locationWarning={guide.guide.locationWarning !== null}
              onToggle={guide.togglePlay}
              onClose={guide.cancel}
              t={t}
            />
          )}
        </div>
      </div>

      <p className="ag-foot">
        {t.pitch} {t.costNote}
        <span className="ag-credits">{t.credits}</span>
      </p>
    </div>
  );
}
