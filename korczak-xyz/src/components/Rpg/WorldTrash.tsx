/*
 * The trash (owner, 1 Nov 2026: "a soft delete of worlds … a trash in the menu with the deleted
 * worlds, but not in the main menu"). Reached from Settings and from the foot of My worlds, never from
 * the main menu. Lists what `worldSave.ts` holds as `deleted`, newest first, each with Restore; nothing
 * here deletes anything for good. At the foot, the clean slate: every world to the trash at once.
 */

import { useState } from 'react';
import type { Lang } from '../../utils/rpg/quest';
import type { LibraryEntry } from '../../utils/rpg/worldSave';
import { translations } from './translations';

export default function WorldTrash({
  lang,
  entries,
  canSweep,
  onRestore,
  onSweep,
  onBack,
}: {
  lang: Lang;
  entries: LibraryEntry[];
  /** Whether there is anything the clean slate would move. */
  canSweep: boolean;
  onRestore: (worldId: string) => void;
  onSweep: () => void;
  onBack: () => void;
}) {
  const t = translations[lang];
  const [asking, setAsking] = useState(false);
  const date = (at: number) =>
    new Date(at).toLocaleDateString(lang === 'pl' ? 'pl-PL' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className="rpg-library rpg-trash">
      <div className="rpg-library-head">
        <h2>🗑 {t.trashTitle}</h2>
        <button type="button" onClick={onBack}>
          ← {t.libraryBack}
        </button>
      </div>
      <p className="rpg-library-note">{t.trashNote}</p>
      {entries.length === 0 && <p>{t.trashEmpty}</p>}
      <ul>
        {entries.map((entry) => {
          const w = entry.world;
          return (
            <li key={w.id}>
              <div className="rpg-library-name">
                <strong>{entry.classicOf ? `${w.name}: ${t.trashClassic}` : w.name}</strong>{' '}
                <span className="rpg-library-lang">{w.lang.toUpperCase()}</span>
              </div>
              {!entry.classicOf && <p className="rpg-library-pitch">{w.pitch}</p>}
              <p className="rpg-library-meta">
                {t.trashDeleted(date(entry.deleted ?? 0))}
                {!entry.classicOf && ` · ${t.libraryPlayed(date(entry.played))}`}
              </p>
              <div className="rpg-library-actions">
                <button type="button" onClick={() => onRestore(w.id)}>
                  ↩ {t.trashRestore}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {canSweep && (
        <div className="rpg-trash-sweep">
          {asking ? (
            <>
              <p>{t.trashAllConfirm}</p>
              <div className="rpg-library-actions">
                <button
                  type="button"
                  onClick={() => {
                    setAsking(false);
                    onSweep();
                  }}
                >
                  🗑 {t.trashAll}
                </button>
                <button type="button" onClick={() => setAsking(false)}>
                  {t.libraryBack}
                </button>
              </div>
            </>
          ) : (
            <button type="button" onClick={() => setAsking(true)}>
              🗑 {t.trashAll}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
