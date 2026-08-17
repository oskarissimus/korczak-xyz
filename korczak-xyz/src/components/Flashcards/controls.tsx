/*
 * The two controls every settings row in this app is made of, shared by the merged panel and by
 * both trainers' row sets. One copy each rather than one per panel, because they were already
 * identical in the two trainers apart from the class prefix.
 *
 * Every option set here is tiny and fixed, so a row of pressed-or-raised buttons says which one is
 * current without being opened — which is what a Win95 dialog would have done and what a select
 * would not.
 */

import type { ReactNode } from 'react';

/*
 * The row label names the group as well as printing it. Without that it is loose text beside a run
 * of buttons, and several of these rows are single letters: the strings row alone announces `E`,
 * `A`, `D`, `G`, `B` and `e` with nothing said about what they are toggling.
 */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="fb-setting">
      <span className="fb-setting-label">{label}</span>
      <div className="fb-setting-controls" role="group" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

export function Choice({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={`fb-choice${active ? ' fb-choice--on' : ''}`}
      onClick={onClick}
      aria-pressed={active}
      title={title}
    >
      {children}
    </button>
  );
}
