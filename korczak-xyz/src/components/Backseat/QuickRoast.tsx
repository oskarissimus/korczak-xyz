/*
 * The roaster's demo, which is one button.
 *
 * At the owner's request (Oct 2026): somebody who opens the roaster with no key should not meet a
 * setup sheet at all — no persona, no model, no interval, no voice. They press "Roast me" and the
 * front camera roasts them in the language of the page, through Gemini Live on the site's key, a
 * remark every three seconds (`quickRoastConfig`). The language is the one choice left, and it is
 * here and on the ride screen as a flag rather than a setting.
 *
 * `onStart` is handed straight to the button with nothing awaited in between, for the reason the
 * setup sheet's Start is: the speech and Web Audio unlocks are granted only inside the gesture.
 */

import { fill, type Lang, type Translation } from './translations';
import type { DemoStatus } from '../../utils/backseat/demo';
import type { RemarkLanguage } from '../../utils/backseat/types';

interface QuickRoastProps {
  demo: DemoStatus;
  language: RemarkLanguage;
  onLanguage: (lang: RemarkLanguage) => void;
  onStart: () => void;
  onOwnKey: () => void;
  t: Translation;
  lang: Lang;
}

export default function QuickRoast({
  demo,
  language,
  onLanguage,
  onStart,
  onOwnKey,
  t,
}: QuickRoastProps) {
  const open = demo.available;

  return (
    <section className="bks-quick">
      <p className="bks-hint">{t.pitch}</p>
      <p className="bks-hint">{t.quickBlurb}</p>

      <div className="bks-quick-lang" role="group" aria-label={t.langSwitch}>
        <button
          type="button"
          className="retro-btn"
          aria-pressed={language === 'pl'}
          onClick={() => onLanguage('pl')}
        >
          🇵🇱 PL
        </button>
        <button
          type="button"
          className="retro-btn"
          aria-pressed={language === 'en'}
          onClick={() => onLanguage('en')}
        >
          🇬🇧 EN
        </button>
      </div>

      <button
        type="button"
        className="retro-btn bks-quick-go"
        onClick={onStart}
        disabled={!open}
      >
        {t.quickRoast}
      </button>

      {open ? (
        <p className="bks-note">{fill(t.demoLeft, { n: demo.remaining.ip })}</p>
      ) : (
        <p className="bks-error bks-note">{t.quickCapped}</p>
      )}

      <p className="bks-disclaimer">{t.disclaimerShort}</p>

      <button type="button" className="bks-linkish" onClick={onOwnKey}>
        {t.quickOwnKey}
      </button>
    </section>
  );
}
