/*
 * The developer console, toggled with `~` (owner, Oct 2026: "active development, I want a debug view
 * as it happens"), and the small preview of what is streaming that the waiting screens show. Both
 * read `devlog.ts`; neither changes anything.
 */

import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { formatMs, formatUsd } from '../../utils/rpg/cost';
import { devlogVersion, devRequests, questTotals, subscribeDevlog, type DevRequest } from '../../utils/rpg/devlog';
import type { Lang } from '../../utils/rpg/quest';
import { translations } from './translations';

function useDevlog(): readonly DevRequest[] {
  useSyncExternalStore(subscribeDevlog, devlogVersion, devlogVersion);
  return devRequests();
}

/** Re-renders every `ms` while `on`, for the clocks of requests still running. */
function useTick(on: boolean, ms = 250) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(() => setTick((n) => n + 1), ms);
    return () => window.clearInterval(id);
  }, [on, ms]);
}

function elapsed(r: DevRequest): number {
  return r.ms ?? Date.now() - r.startedAt;
}

function tokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function tail(text: string, lines: number): string {
  const all = text.trimEnd().split('\n');
  return all.slice(-lines).join('\n');
}

function headline(r: DevRequest): string {
  const parts = [r.servedBy && r.servedBy !== r.model ? `${r.model} → ${r.servedBy}` : r.model];
  if (r.beat !== null) parts.unshift(`beat ${r.beat + 1}`);
  parts.push(`${r.status} ${formatMs(elapsed(r))}`);
  if (r.firstMs !== null && r.kind === 'model') parts.push(`1st byte ${formatMs(r.firstMs)}`);
  if (r.usage) parts.push(`in ${tokens(r.usage.input)} out ${tokens(r.usage.output)} think ${tokens(r.usage.thoughts)}`);
  if (r.kind === 'voice' && r.status === 'ok') parts.push(`${r.chars} chars ≈ ${Math.round(r.credits)} cr`);
  if (r.kind === 'model' ? r.usage : r.status === 'ok') parts.push(formatUsd(r.cost));
  return parts.join(' · ');
}

export function DevConsole({ lang, onClose }: { lang: Lang; onClose: () => void }) {
  const t = translations[lang];
  const requests = useDevlog();
  const running = requests.some((r) => r.status === 'waiting' || r.status === 'streaming');
  useTick(running);
  const totals = questTotals();
  const listRef = useRef<HTMLDivElement>(null);
  const [showVoice, setShowVoice] = useState(false);
  const shown = showVoice ? requests : requests.filter((r) => r.kind === 'model');

  // Follows the newest output, unless the reader has scrolled up to read something.
  useEffect(() => {
    const el = listRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  });

  return (
    <div className="rpg-dev" role="log" aria-label={t.devConsole}>
      <div className="rpg-dev-bar">
        <strong>~ {t.devConsole}</strong>
        <label>
          <input type="checkbox" checked={showVoice} onChange={(e) => setShowVoice(e.target.checked)} /> ElevenLabs
        </label>
        <button type="button" onClick={onClose} aria-label={t.close}>
          ×
        </button>
      </div>
      <div className="rpg-dev-list" ref={listRef}>
        {shown.length === 0 && <div className="rpg-dev-empty">{t.devEmpty}</div>}
        {shown.map((r) => (
          <div key={r.id} className={`rpg-dev-entry rpg-dev-${r.status}`}>
            <div className="rpg-dev-head">{headline(r)}</div>
            {r.kind === 'model' && r.thoughts && <pre className="rpg-dev-thoughts">{tail(r.thoughts, 4)}</pre>}
            {r.text && <pre className="rpg-dev-text">{r.kind === 'model' ? tail(r.text, 8) : r.text}</pre>}
            {r.error && <div className="rpg-dev-error">✗ {r.error}</div>}
          </div>
        ))}
      </div>
      <div className="rpg-dev-totals">
        {t.genTime}: {formatMs(totals.generationMs)} · {t.tokensLine}: in {tokens(totals.tokens.input)} out{' '}
        {tokens(totals.tokens.output)} think {tokens(totals.tokens.thoughts)} ≈ {formatUsd(totals.modelCost)}
        {totals.unpriced ? '+?' : ''} · ElevenLabs: {totals.voiceChars} {t.chars} ≈ {Math.round(totals.voiceCredits)} cr ≈{' '}
        {formatUsd(totals.voiceCost)} · {t.total} ≈ {formatUsd(totals.modelCost + totals.voiceCost)}
        {totals.errors > 0 && <span className="rpg-dev-error"> · {t.errors(totals.errors)}</span>}
      </div>
    </div>
  );
}

/** The few last lines of the model request still running, for the waiting screens. */
export function StreamPreview() {
  const requests = useDevlog();
  const current = [...requests].reverse().find((r) => r.kind === 'model');
  const running = current?.status === 'waiting' || current?.status === 'streaming';
  useTick(running);
  if (!current) return null;
  const failed = requests.filter((r) => r.kind === 'model' && r.status === 'error' && r.beat === current.beat && r.id !== current.id);
  const body = current.text ? tail(current.text, 4) : tail(current.thoughts, 4);
  return (
    <div className="rpg-stream">
      {failed.map((r) => (
        <div key={r.id} className="rpg-dev-error">
          ✗ {r.model}: {r.error}
        </div>
      ))}
      <div className="rpg-dev-head">{headline(current)}</div>
      {body && <pre className={current.text ? 'rpg-dev-text' : 'rpg-dev-thoughts'}>{body}</pre>}
      {current.error && <div className="rpg-dev-error">✗ {current.error}</div>}
    </div>
  );
}

/** What the quest cost and how long it was written for, on the closing screen. */
export function QuestSummary({ lang }: { lang: Lang }) {
  const t = translations[lang];
  useDevlog();
  const totals = questTotals();
  return (
    <dl className="rpg-summary">
      <dt>{t.genTime}</dt>
      <dd>{formatMs(totals.generationMs)}</dd>
      <dt>{t.tokensLine}</dt>
      <dd>
        {tokens(totals.tokens.input + totals.tokens.output + totals.tokens.thoughts)} ≈ {formatUsd(totals.modelCost)}
        {totals.unpriced ? ' +?' : ''}
      </dd>
      <dt>ElevenLabs</dt>
      <dd>
        {totals.voiceChars} {t.chars} ≈ {Math.round(totals.voiceCredits)} cr ≈ {formatUsd(totals.voiceCost)}
      </dd>
      <dt>{t.total}</dt>
      <dd>≈ {formatUsd(totals.modelCost + totals.voiceCost)}</dd>
    </dl>
  );
}
