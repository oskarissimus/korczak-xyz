/*
 * The menu bar, and the window it opens.
 *
 * A menu is the right shape here for the same reason the rail is: this app is a 95-era property
 * sheet, and the thing a property sheet keeps above its tabs is a menu bar. It has exactly one
 * item — File ▸ Open project… — and that is not a placeholder to be apologised for. Everything
 * else a File menu usually carries either exists already under a better name (Start Over is New)
 * or is a decision nobody has made yet (Rename, Delete, Duplicate). One item that works beats
 * four that half do.
 *
 * WHERE IT SITS. Flush under the page's own title bar, edge to edge across the client area, which
 * is the only place a menu bar has ever been: `Sloper` renders it above `.slp-app` rather than
 * inside `.slp-main`, so it spans the rail as well as the sheet. It used to sit inside that
 * column, starting where the sheet started — which read as a control belonging to the sheet
 * rather than as the window's own menu, and left the strip between the title bar and it empty.
 * The window's padding therefore lives on `.slp-app`, not on `.sloper-content`: a menu bar with
 * a gutter around it is a toolbar.
 *
 * WHY A WINDOW AND NOT A PANEL ON THE PAGE. The list is a different sitting from the one on
 * screen, and opening one throws away nothing but does replace everything. A modal is what says
 * that: the wizard behind it is visibly still there, and the only ways out are Open and Close.
 * It is also the site's own idiom — `ConflictModal` in the typing trainer is the same three
 * elements, a backdrop, a bevelled box and a navy title bar.
 *
 * ESCAPE CLOSES IT AND FOCUS MOVES INTO IT, both for the reason any modal needs them: it is drawn
 * over a form, and a dialog you can neither reach with a keyboard nor dismiss with one is a trap
 * around a screen full of text fields.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ProjectSummary, Stage } from '../../utils/sloper/types';
import { Spinner } from './fields';
import { fill, localeOf, type Lang, type Translation } from './translations';

const STAGE_LABELS: Record<Stage, keyof Translation> = {
  config: 'stepConfig',
  scenes: 'stepScenes',
  assets: 'stepAssets',
  assembly: 'stepAssembly',
  output: 'stepOutput',
};

interface ProjectMenuProps {
  /** Null signed out — the menu still draws, and the window explains why it is empty. */
  enabled: boolean;
  openId: string | null;
  openName: string | null;
  list: () => Promise<ProjectSummary[]>;
  onOpen: (id: string) => void;
  t: Translation;
  lang: Lang;
}

export default function ProjectMenu({
  enabled,
  openId,
  openName,
  list,
  onOpen,
  t,
  lang,
}: ProjectMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // A menu that stays down after a click elsewhere is the one thing everybody notices about a
  // hand-rolled one. Pointer-down rather than click, so it closes on the press that starts a
  // selection somewhere else rather than on the release.
  useEffect(() => {
    if (!menuOpen) return;
    const away = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
    };
  }, [menuOpen]);

  return (
    <div className="slp-menubar" ref={menuRef}>
      <div className="slp-menu">
        <button
          type="button"
          className={`slp-menu-title${menuOpen ? ' slp-menu-title-open' : ''}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          {t.menuFile}
        </button>

        {menuOpen && (
          <div className="slp-menu-pop" role="menu">
            <button
              type="button"
              role="menuitem"
              className="slp-menu-item"
              onClick={() => {
                setMenuOpen(false);
                setDialogOpen(true);
              }}
            >
              {t.menuOpen}
            </button>
          </div>
        )}
      </div>

      {/* The open project's name sits in the bar rather than in the status strip at the foot,
          because it answers "which one am I in" and that question is asked while looking at the
          top of the screen. The id is the title, so hovering gives you the thing in the URL. */}
      {openName && (
        <span className="slp-menubar-name" title={openId ?? undefined}>
          {openName}
        </span>
      )}

      {dialogOpen && (
        <ProjectsDialog
          enabled={enabled}
          openId={openId}
          list={list}
          onOpen={(id) => {
            setDialogOpen(false);
            onOpen(id);
          }}
          onClose={() => setDialogOpen(false)}
          t={t}
          lang={lang}
        />
      )}
    </div>
  );
}

interface ProjectsDialogProps {
  enabled: boolean;
  openId: string | null;
  list: () => Promise<ProjectSummary[]>;
  onOpen: (id: string) => void;
  onClose: () => void;
  t: Translation;
  lang: Lang;
}

function ProjectsDialog({ enabled, openId, list, onOpen, onClose, t, lang }: ProjectsDialogProps) {
  const [rows, setRows] = useState<ProjectSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const locale = localeOf(lang);

  const load = useCallback(async () => {
    setFailed(false);
    setRows(null);
    try {
      setRows(await list());
    } catch {
      // The reason is already in the log — `listProjects` goes through `runCloud`, which reports
      // a stall and recycles the client. Here it is one sentence and a button that tries again.
      setFailed(true);
    }
  }, [list]);

  useEffect(() => {
    dialogRef.current?.focus();
    if (enabled) void load();
    else setRows([]);
  }, [enabled, load]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);

  const when = (at: number) =>
    at > 0
      ? new Date(at).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
      : t.openUnknownDate;

  return (
    <div className="slp-modal-backdrop" role="presentation">
      <div
        className="slp-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="slp-open-title"
        tabIndex={-1}
        ref={dialogRef}
      >
        <div className="title-bar">
          <span id="slp-open-title">{t.openTitle}</span>
        </div>

        <div className="slp-modal-body">
          {!enabled && <p className="slp-hint">{t.openSignedOut}</p>}

          {enabled && rows === null && !failed && (
            <p className="slp-hint">
              <Spinner /> {t.openLoading}
            </p>
          )}

          {failed && (
            <>
              <p className="slp-error">{t.openFailed}</p>
              <button type="button" className="retro-btn slp-small" onClick={() => void load()}>
                {t.openRetry}
              </button>
            </>
          )}

          {enabled && rows !== null && rows.length === 0 && (
            <p className="slp-hint">{t.openEmpty}</p>
          )}

          {rows !== null && rows.length > 0 && (
            <ul className="slp-projects">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className={`slp-project${row.id === openId ? ' slp-project-here' : ''}`}
                >
                  <div className="slp-project-text">
                    <p className="slp-project-name">
                      {row.name}
                      {row.id === openId && <span className="slp-chip">{t.openCurrent}</span>}
                    </p>
                    <p className="slp-hint">{when(row.updatedAt)}</p>
                    <p className="slp-hint">
                      {t[STAGE_LABELS[row.stage]]}
                      {' · '}
                      {fill(t.openScenes, { count: row.scenes })}
                      {row.hasVideo && <> · {t.openHasVideo}</>}
                    </p>
                    {/* The topic, which is the only line here written by a person and therefore
                        the one that actually identifies the project. Clipped rather than wrapped:
                        a list of twenty is meant to be scanned down the names. */}
                    {row.prompt && <p className="slp-project-topic">{row.prompt}</p>}
                  </div>

                  <button
                    type="button"
                    className="retro-btn slp-small"
                    disabled={row.id === openId}
                    onClick={() => onOpen(row.id)}
                  >
                    {t.openButton}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="slp-actions">
            <button type="button" className="retro-btn" onClick={onClose}>
              {t.openClose}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
