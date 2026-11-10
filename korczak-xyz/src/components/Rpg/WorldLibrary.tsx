/*
 * The worlds played before, on the intro screen (owner, Oct 2026: "browse the earlier worlds and the
 * games in them, and load such a saved game"). Every invented world in the library (`worldSave.ts`),
 * the most recently played first, in both languages, as a card of its picture (the landmark's FLUX
 * picture; the world's sky and ground colours without one) and its name — since 10 Nov 2026 nothing
 * more. A tap continues the quest in progress if there is one, here or on the account (`cloud.ts`),
 * else starts a new quest there; picking one makes it the current world of its language.
 */

import { useState } from 'react';
import type { SaveInfo } from '../../utils/rpg/cloud';
import type { ChronicleEntry, Lang } from '../../utils/rpg/quest';
import type { LibraryEntry } from '../../utils/rpg/worldSave';
import { ui } from './ui';

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
  onTrash,
  onOpenTrash,
  trashCount,
  onBack,
}: {
  lang: Lang;
  rows: LibraryRow[];
  signedIn: boolean;
  canPlay: boolean;
  onOpen: (worldId: string, continueQuest: boolean) => void;
  /** Moves a world to the trash (`worldSave.ts`'s `trashWorld`). */
  onTrash: (worldId: string) => void;
  onOpenTrash: () => void;
  trashCount: number;
  onBack: () => void;
}) {
  const t = ui(lang);
  const [busy, setBusy] = useState<string | null>(null);
  const open = (id: string, cont: boolean) => {
    setBusy(id);
    onOpen(id, cont);
  };

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
      {/* A picture and a name each, nothing else (owner, 10 Nov 2026: "only the title and the picture, without
          the description"). A tap goes in: the quest in progress if there is one, else a new quest there. */}
      <ul className="rpg-library-grid">
        {rows.map(({ entry, quest, current }) => {
          const w = entry.world;
          const picture = w.landmarkModel?.image;
          return (
            <li key={w.id} className={`rpg-library-card${current ? ' rpg-library-current' : ''}`}>
              <button
                type="button"
                className="rpg-library-open"
                disabled={!canPlay || busy !== null}
                onClick={() => open(w.id, Boolean(quest))}
                title={quest ? t.libraryContinue(quest.title) : t.libraryNewQuest}
                style={{ background: `linear-gradient(160deg, ${w.look.sky}, ${w.look.ground})` }}
              >
                <span className="rpg-library-picture" aria-hidden="true">
                  {picture && <img src={picture} alt="" loading="lazy" decoding="async" />}
                </span>
                <strong>{busy === w.id ? t.wait : w.name}</strong>
              </button>
              <button
                type="button"
                className="rpg-library-trash"
                disabled={busy !== null}
                onClick={() => onTrash(w.id)}
                aria-label={`${t.libraryTrash}: ${w.name}`}
                title={t.libraryTrash}
              >
                🗑
              </button>
            </li>
          );
        })}
      </ul>
      <p className="rpg-library-foot">
        <button type="button" onClick={onOpenTrash}>
          🗑 {t.menuTrash} · {t.menuTrashCount(trashCount)}
        </button>
      </p>
    </div>
  );
}
