/*
 * The four proposed worlds on top of the menu (`utils/rpg/proposals.ts`, drawn from the server's
 * daily pool): a card each with its cover, name, genre and pitch; a tap makes that world.
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
  onPick: (p: PoolItem) => void;
  onRefresh: () => void;
}

/** The cover, faded in once it has loaded, over the card's own colours. */
function Cover({ src }: { src: string }) {
  const [loaded, setLoaded] = React.useState(false);
  return <img src={src} alt="" decoding="async" className={loaded ? 'rpg-proposal-loaded' : undefined} onLoad={() => setLoaded(true)} />;
}

export default function WorldProposals({ lang, disabled, onPick, onRefresh }: Props) {
  const t = ui(lang);
  const v = useSyncExternalStore(subscribeProposals, proposalsView, proposalsView);
  const items = v.lang === lang ? v.items : [];
  const slots = Array.from({ length: PROPOSAL_COUNT }, (_, i) => items[i] ?? null);
  const failed = v.lang === lang && v.error && !items.length && !v.loading;
  return (
    <section className="rpg-proposals" aria-label={t.proposalsTitle} aria-busy={!items.length}>
      <div className="rpg-proposals-head">
        <h3>{t.proposalsTitle}</h3>
        <button type="button" className="rpg-proposals-refresh" onClick={onRefresh} disabled={v.pool.length <= PROPOSAL_COUNT} title={t.proposalsRefresh}>
          ↻ {t.proposalsRefresh}
        </button>
      </div>
      <div className="rpg-proposals-grid">
        {slots.map((p, i) =>
          p ? (
            <button
              key={p.id}
              type="button"
              className="rpg-proposal"
              disabled={disabled}
              onClick={() => onPick(p)}
              style={{ background: `linear-gradient(160deg, ${p.colors[0]}, ${p.colors[1]})` }}
            >
              <span className="rpg-proposal-cover" aria-hidden="true">
                {p.image && <Cover src={p.image} />}
                {p.genre && <span className="rpg-proposal-genre">{p.genre}</span>}
              </span>
              <span className="rpg-proposal-text">
                <strong>{p.name}</strong>
                <span>{p.pitch}</span>
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
