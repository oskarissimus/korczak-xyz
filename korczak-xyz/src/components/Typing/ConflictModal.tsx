import React, { useEffect, useRef, useState } from 'react';
import { downloadJSON } from '../../utils/typing/download';
import type { SyncConflict } from '../../utils/typing/syncEngine';
import type { TypingProgress } from '../../utils/typing/types';
import { translations, type Lang } from './translations';

interface ConflictModalProps {
  conflict: SyncConflict;
  passageCount: number;
  lang: Lang;
  onChoose: (choice: 'local' | 'cloud') => void;
}

/*
 * Two versions of the same book's progress, and only the user can say which is theirs.
 *
 * This is deliberately blocking. Typing on top of a state that is about to be replaced adds
 * keystrokes to a branch the user may be seconds away from discarding, and the previous
 * behaviour - picking a side by timestamp and saying nothing - is the whole reason this
 * exists. A dialog is the honest response to a question the code genuinely cannot answer.
 *
 * The side that loses is downloaded before it goes, the same courtesy the reset button
 * already extends.
 */
export default function ConflictModal({
  conflict,
  passageCount,
  lang,
  onChoose,
}: ConflictModalProps) {
  const t = translations[lang];
  const locale = lang === 'pl' ? 'pl-PL' : 'en-US';
  const [choice, setChoice] = useState<'local' | 'cloud'>(conflict.suggested);
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Move focus into the dialog so keyboard users are not left typing at a passage they can
  // no longer see, and so screen readers announce it.
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const describe = (p: TypingProgress) => ({
    section: p.passageIndex + 1,
    percent: passageCount === 0 ? 0 : Math.round((p.passageIndex / passageCount) * 100),
    keystrokes: p.totalKeystrokes,
    lastPlayed: p.lastPlayedAt
      ? new Date(p.lastPlayedAt).toLocaleString(locale, {
          dateStyle: 'short',
          timeStyle: 'short',
        })
      : t.conflictUnknown,
  });

  // The choice is passed in rather than read from state: the two buttons commit a side
  // directly, and reading `choice` here would see the value from before their own click.
  const submit = (selected: 'local' | 'cloud') => {
    if (submitting) return;
    setSubmitting(true);
    setChoice(selected);
    const losing = selected === 'local' ? conflict.cloud : conflict.local;
    const label = selected === 'local' ? 'account' : 'device';
    downloadJSON(
      `typing-progress-backup-${losing.bookId}-${label}-${Date.now()}.json`,
      JSON.stringify({ version: 1, discardedProgress: losing }, null, 2)
    );
    onChoose(selected);
  };

  const sides: { key: 'local' | 'cloud'; label: string; progress: TypingProgress }[] = [
    { key: 'local', label: t.conflictThisDevice, progress: conflict.local },
    { key: 'cloud', label: t.conflictCloud, progress: conflict.cloud },
  ];

  return (
    <div className="typing-modal-backdrop" role="presentation">
      <div
        className="typing-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="typing-conflict-title"
        tabIndex={-1}
        ref={dialogRef}
      >
        <div className="title-bar">
          <span id="typing-conflict-title">{t.conflictTitle}</span>
        </div>
        <div className="typing-modal-body">
          <p className="typing-modal-text">{t.conflictBody}</p>

          <div className="typing-conflict-sides">
            {sides.map(({ key, label, progress }) => {
              const d = describe(progress);
              return (
                <label
                  key={key}
                  className={`typing-conflict-side${choice === key ? ' is-selected' : ''}`}
                >
                  <span className="typing-conflict-side-head">
                    <input
                      type="radio"
                      name="typing-conflict-choice"
                      value={key}
                      checked={choice === key}
                      onChange={() => setChoice(key)}
                    />
                    <span className="typing-conflict-side-name">{label}</span>
                    {conflict.suggested === key && (
                      <span className="typing-conflict-badge">{t.conflictFurther}</span>
                    )}
                  </span>
                  <dl className="typing-conflict-facts">
                    <div>
                      <dt>{t.conflictSection}</dt>
                      <dd>
                        {d.section} {t.conflictOf} {passageCount} ({d.percent}%)
                      </dd>
                    </div>
                    <div>
                      <dt>{t.conflictKeystrokes}</dt>
                      <dd>{d.keystrokes.toLocaleString(locale)}</dd>
                    </div>
                    <div>
                      <dt>{t.conflictLastPlayed}</dt>
                      <dd>{d.lastPlayed}</dd>
                    </div>
                  </dl>
                </label>
              );
            })}
          </div>

          <div className="typing-modal-actions">
            <button
              type="button"
              className="retro-btn"
              disabled={submitting}
              onClick={() => submit('local')}
            >
              {t.conflictKeepLocal}
            </button>
            <button
              type="button"
              className="retro-btn"
              disabled={submitting}
              onClick={() => submit('cloud')}
            >
              {t.conflictKeepCloud}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
