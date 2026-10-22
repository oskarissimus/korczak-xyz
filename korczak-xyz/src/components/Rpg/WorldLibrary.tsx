/*
 * The worlds played before, on the intro screen (owner, Oct 2026: "browse the earlier worlds and the
 * games in them, and load such a saved game"). Every invented world in the library (`worldSave.ts`),
 * the most recently played first, in both languages: what it is, the quests finished there (its
 * chronicle), and the quest in progress if there is one, here or on the account (`cloud.ts`). Picking
 * one makes it the current world of its language; `Rpg.tsx` does the rest.
 */

import { useState } from 'react';
import type { SaveInfo } from '../../utils/rpg/cloud';
import type { ChronicleEntry, Lang } from '../../utils/rpg/quest';
import type { LibraryEntry } from '../../utils/rpg/worldSave';
import { translations } from './translations';

export interface LibraryRow {
  entry: LibraryEntry;
  chronicle: ChronicleEntry[];
  quest: SaveInfo | null;
  current: boolean;
}

export default function WorldLibrary({
  lang,
  rows,
  signedIn,
  canPlay,
  onOpen,
  onBack,
}: {
  lang: Lang;
  rows: LibraryRow[];
  signedIn: boolean;
  canPlay: boolean;
  onOpen: (worldId: string, continueQuest: boolean) => void;
  onBack: () => void;
}) {
  const t = translations[lang];
  const [busy, setBusy] = useState<string | null>(null);
  const open = (id: string, cont: boolean) => {
    setBusy(id);
    onOpen(id, cont);
  };
  const date = (at: number) =>
    new Date(at).toLocaleDateString(lang === 'pl' ? 'pl-PL' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className="rpg-library">
      <div className="rpg-library-head">
        <h2>{t.libraryTitle}</h2>
        <button type="button" onClick={onBack}>
          ← {t.libraryBack}
        </button>
      </div>
      <p className="rpg-library-note">{signedIn ? t.librarySynced : t.librarySignedOut}</p>
      {rows.length === 0 && <p>{t.libraryEmpty}</p>}
      <ul>
        {rows.map(({ entry, chronicle, quest, current }) => {
          const w = entry.world;
          return (
            <li key={w.id} className={current ? 'rpg-library-current' : undefined}>
              <div className="rpg-library-name">
                <strong>{w.name}</strong> <span className="rpg-library-lang">{w.lang.toUpperCase()}</span>
                {current && <span className="rpg-library-tag"> · {t.libraryPlaying}</span>}
              </div>
              <p className="rpg-library-pitch">{w.pitch}</p>
              <p className="rpg-library-meta">{t.libraryPlayed(date(entry.played))}</p>
              {chronicle.length > 0 && (
                <details>
                  <summary>{t.libraryQuests(chronicle.length)}</summary>
                  <ol>
                    {chronicle.map((c) => (
                      <li key={`${c.at}-${c.title}`}>
                        {c.title} <span className="rpg-library-meta">· {date(c.at)}</span>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
              <div className="rpg-library-actions">
                {quest && (
                  <button type="button" className="rpg-start" disabled={!canPlay || busy !== null} onClick={() => open(w.id, true)}>
                    ▶ {t.libraryContinue(quest.title)}
                  </button>
                )}
                <button type="button" disabled={!canPlay || busy !== null} onClick={() => open(w.id, false)}>
                  {busy === w.id ? t.wait : t.libraryNewQuest}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
