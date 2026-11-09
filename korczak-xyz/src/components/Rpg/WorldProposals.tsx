/*
 * The four proposed worlds on top of the menu (`utils/rpg/proposals.ts`): a card each with its
 * cover, name, genre and pitch; a tap makes that world. While they are written the cards come one by
 * one, the rest are placeholders; the line under them says what the set took and cost, as the `~`
 * console does in full.
 */

import React, { useSyncExternalStore } from 'react';
import { proposalsView, proposalTotals, subscribeProposals } from '../../utils/rpg/proposals';
import { PROPOSAL_COUNT, type Proposal } from '../../utils/rpg/proposalScript';
import { formatMs, formatUsd } from '../../utils/rpg/cost';
import type { Lang } from '../../utils/rpg/quest';
import { ui } from './ui';

interface Props {
  lang: Lang;
  disabled: boolean;
  onPick: (p: Proposal) => void;
  onRefresh: () => void;
}

export default function WorldProposals({ lang, disabled, onPick, onRefresh }: Props) {
  const t = ui(lang);
  const v = useSyncExternalStore(subscribeProposals, proposalsView, proposalsView);
  if (v.lang !== lang) return null;
  const busy = v.writing || v.drawing > 0;
  const slots = Array.from({ length: PROPOSAL_COUNT }, (_, i) => v.items[i] ?? null);
  const totals = proposalTotals(v);
  const fresh = v.since > 0;
  return (
    <section className="rpg-proposals" aria-label={t.proposalsTitle} aria-busy={busy}>
      <div className="rpg-proposals-head">
        <h3>{t.proposalsTitle}</h3>
        <button type="button" className="rpg-proposals-refresh" onClick={onRefresh} disabled={v.writing} title={t.proposalsRefresh}>
          ↻ {t.proposalsRefresh}
        </button>
      </div>
      {v.error && !v.items.length ? (
        <p className="rpg-proposals-error" role="alert">
          ✗ {t.proposalsFailed(v.error.slice(0, 140))}
        </p>
      ) : (
        <div className="rpg-proposals-grid">
          {slots.map((p, i) =>
            p ? (
              <button
                key={i}
                type="button"
                className="rpg-proposal"
                disabled={disabled}
                onClick={() => onPick(p)}
                style={{ background: `linear-gradient(160deg, ${p.colors[0]}, ${p.colors[1]})` }}
              >
                <span className="rpg-proposal-cover" aria-hidden="true">
                  {p.image ? <img src={p.image} alt="" loading="lazy" /> : p.picture && v.drawing > 0 ? <span className="rpg-proposal-drawing">⏳</span> : null}
                  {p.genre && <span className="rpg-proposal-genre">{p.genre}</span>}
                </span>
                <span className="rpg-proposal-text">
                  <strong>{p.name}</strong>
                  <span>{p.pitch}</span>
                </span>
              </button>
            ) : (
              <div key={i} className="rpg-proposal rpg-proposal-empty" aria-hidden="true">
                <span className="rpg-proposal-cover" />
                <span className="rpg-proposal-text">{v.writing ? '…' : ''}</span>
              </div>
            ),
          )}
        </div>
      )}
      {fresh && (
        <p className="rpg-proposals-figures">
          {busy ? `⏳ ${t.proposalsWriting} · ` : ''}
          {v.model ?? ''}
          {v.writtenMs !== null ? ` · ${formatMs(v.writtenMs)}` : ''}
          {v.coversMs !== null ? ` · ${t.proposalsCovers} ${formatMs(v.coversMs)}` : ''}
          {` · ≈ ${formatUsd(totals.total)}`}
          {totals.errors > 0 ? ` · ✗ ${totals.errors}` : ''}
        </p>
      )}
    </section>
  );
}
