/*
 * The whole of `/apps/audio-guide/`, as one island.
 *
 * Ported from `oskarissimus/audio-guide-v2` (a Vite app of hand-written DOM on GitHub Pages) in
 * Sep 2026. What moved is the front half: the map, the pins, the player and the state between
 * them. What did not move is the Cloud Function that writes and records the narration — see
 * `utils/audioGuide/narration.ts` for why it stayed where it was.
 *
 * ONE ISLAND, NO ROUTES, for the same reason as sloper and the backseat driver: there is a live
 * thing here that a navigation would tear down mid-flight. Two of them, in fact — a geolocation
 * watch and an `<audio>` element that only plays because of a tap that happened before the fetch
 * that filled it. Neither survives a remount, and the second one fails *silently* on iOS, which
 * is the worst kind.
 *
 * THE LAYOUT IS THE MAP. Everything else is a strip over it that appears when it has something to
 * say: the language picker, which is the only setting; a progress bar while a guide is being
 * written; the player once there is one; a notice when something failed. Nothing scrolls, because
 * this is read standing in a square with one hand.
 *
 * NOTHING IS SIGNED IN AND NOTHING IS SAVED. There is no account here and no Firestore: the one
 * piece of state worth keeping between visits is the narration language, and that is a single
 * localStorage key. A guide itself is megabytes of MP3 that a walk leaves behind.
 */

import { useAudioGuide } from '../../hooks/useAudioGuide';
import { useNearbyAttractions } from '../../hooks/useNearbyAttractions';
import { useUserPosition } from '../../hooks/useUserPosition';
import GenerationBar from './GenerationBar';
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
    case 'rate-limited':
      return t.attractionsRateLimited;
    case 'timeout':
      return t.attractionsTimeout;
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
    case 'config':
      return t.errorConfig;
    default:
      return t.errorFailed;
  }
}

export default function AudioGuide({ lang }: AudioGuideProps) {
  const t: Translation = translations[lang];
  const places = useNearbyAttractions();
  const position = useUserPosition();
  const guide = useAudioGuide(lang);

  const generating = guide.status === 'generating';

  return (
    <div className="ag-app">
      <div className="ag-bar">
        <LanguagePicker value={guide.language} onChange={guide.setLanguage} t={t} />

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
