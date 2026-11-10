/*
 * The four proposed worlds along the bottom of the home screen (`utils/rpg/proposals.ts`, drawn from the server's
 * daily pool): a small card each, its cover and its idea ("pirates on a sea of sand"); a tap puts the idea in
 * the field (owner, 10 Nov 2026: "proposals with a picture, but with the texts that used to sit under the
 * prompt"). An item from before ideas shows its name and a tap makes it as it did.
 *
 * Always four cards of one fixed size (owner, 9 Nov 2026: "everything on this screen loads at once,
 * and what cannot has a placeholder, so nothing shifts"): a card with no proposal yet is the same box
 * pulsing, a cover not yet loaded is the card's two colours, and the text box is a fixed height
 * whatever the pitch (`.rpg-proposal-text` in rpg.css).
 */

import React, { useSyncExternalStore } from 'react';
import { proposalsView, subscribeProposals } from '../../utils/rpg/proposals';
import { PROPOSAL_COUNT } from '../../utils/rpg/proposalScript';
import type { PoolItem } from '../../utils/rpg/proposalPool';
import type { Lang } from '../../utils/rpg/quest';
import { ui } from './ui';

interface Props {
  lang: Lang;
  /** Nothing can make a world now (no key, no demo): the cards show but do not take a tap. */
  disabled: boolean;
  /** A proposal from before ideas: a tap makes the world from its name and pitch. */
  onPick: (p: PoolItem) => void;
  /** A proposal with an idea: a tap puts the idea in the field. */
  onIdea: (p: PoolItem) => void;
  onRefresh: () => void;
}

/** The cover, faded in once it has loaded, over the card's own colours. */
function Cover({ src }: { src: string }) {
  const [loaded, setLoaded] = React.useState(false);
  return <img src={src} alt="" decoding="async" className={loaded ? 'rpg-proposal-loaded' : undefined} onLoad={() => setLoaded(true)} />;
}

export default function WorldProposals({ lang, disabled, onPick, onIdea, onRefresh }: Props) {
  const t = ui(lang);
  const v = useSyncExternalStore(subscribeProposals, proposalsView, proposalsView);
  const items = v.lang === lang ? v.items : [];
  const slots = Array.from({ length: PROPOSAL_COUNT }, (_, i) => items[i] ?? null);
  const failed = v.lang === lang && v.error && !items.length && !v.loading;
  return (
    <section className="rpg-proposals" aria-label={t.proposalsTitle} aria-busy={!items.length}>
      <div className="rpg-proposals-head">
        <h3>{t.homeOrTry}</h3>
        <div className="rpg-proposals-tools">
          <button type="button" className="rpg-proposals-refresh" onClick={onRefresh} disabled={v.pool.length <= PROPOSAL_COUNT} title={t.proposalsRefresh} aria-label={t.proposalsRefresh}>
            ↻
          </button>
        </div>
      </div>
      <div className="rpg-proposals-grid">
        {slots.map((p, i) =>
          p ? (
            <button
              key={p.id}
              type="button"
              className="rpg-proposal"
              // An idea only fills the field, which needs no keys; a proposal from before makes a world.
              disabled={disabled && !p.idea}
              onClick={() => (p.idea ? onIdea(p) : onPick(p))}
              title={p.idea ? p.pitch : undefined}
              style={{ background: `linear-gradient(160deg, ${p.colors[0]}, ${p.colors[1]})` }}
            >
              <span className="rpg-proposal-cover" aria-hidden="true">
                {p.image && <Cover src={p.image} />}
              </span>
              <span className="rpg-proposal-text">
                <strong>{p.idea || p.name}</strong>
              </span>
            </button>
          ) : (
            <div key={`empty-${i}`} className={`rpg-proposal rpg-proposal-empty${failed ? ' rpg-proposal-failed' : ''}`} aria-hidden="true">
              <span className="rpg-proposal-cover" />
              <span className="rpg-proposal-text">{failed && i === 0 ? <span>✗ {t.proposalsFailed(String(v.error).slice(0, 80))}</span> : null}</span>
            </div>
          ),
        )}
      </div>
    </section>
  );
}
