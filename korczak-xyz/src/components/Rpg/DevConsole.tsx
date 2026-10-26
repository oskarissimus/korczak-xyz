/*
 * The developer console, toggled with `~` (owner, Oct 2026: "active development, I want a debug view
 * as it happens"), and the small preview of what is streaming that the waiting screens show. Both
 * read `devlog.ts`; neither changes anything.
 */

import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { formatMs, formatUsd } from '../../utils/rpg/cost';
import { devlogVersion, devRequests, questTotals, subscribeDevlog, type DevRequest } from '../../utils/rpg/devlog';
import type { Lang } from '../../utils/rpg/quest';
import { subscribeTranscript, transcript, transcriptVersion, type TranscriptLine } from '../../utils/rpg/transcript';
import { PIXEL_RATIOS, saveQuality, type FrameStats } from './frames';
import type { RpgScene } from './RpgScene';
import { translations } from './translations';

function useDevlog(): readonly DevRequest[] {
  useSyncExternalStore(subscribeDevlog, devlogVersion, devlogVersion);
  return devRequests();
}

function useTranscript(): readonly TranscriptLine[] {
  useSyncExternalStore(subscribeTranscript, transcriptVersion, transcriptVersion);
  return transcript();
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
  else if (r.kind === 'model') parts.unshift('world');
  else if (r.kind === 'fal') parts.unshift('landmark');
  parts.push(`${r.status} ${formatMs(elapsed(r))}`);
  if (r.firstMs !== null && r.kind === 'model') parts.push(`1st byte ${formatMs(r.firstMs)}`);
  if (r.usage) parts.push(`in ${tokens(r.usage.input)} out ${tokens(r.usage.output)} think ${tokens(r.usage.thoughts)}`);
  if (r.kind === 'voice' && r.status === 'ok') parts.push(`${r.chars} chars ≈ ${Math.round(r.credits)} cr`);
  if (r.kind === 'model' ? r.usage : r.status === 'ok') parts.push(formatUsd(r.cost));
  return parts.join(' · ');
}

function thousands(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

/** The badge's one line: what a frame is now. */
export function frameLine(f: FrameStats): string {
  return `${Math.round(f.fps)} fps · ${f.frameMs.toFixed(0)}/${f.slowMs.toFixed(0)} ms · ${f.calls} dc · ${thousands(f.triangles)} △`;
}

/** The FPS counter over the game, refreshed twice a second. */
export function FpsBadge({ scene }: { scene: RpgScene | null }) {
  useTick(true, 500);
  if (!scene) return null;
  return <div className="rpg-fps">{frameLine(scene.frameStats())}</div>;
}

function PerfTab({ lang, scene, badge, onBadge }: { lang: Lang; scene: RpgScene | null; badge: boolean; onBadge: (on: boolean) => void }) {
  const t = translations[lang];
  useTick(true, 500);
  const [, setVersion] = useState(0);
  if (!scene) return <div className="rpg-dev-list" />;
  const f = scene.frameStats();
  const q = scene.getQuality();
  const set = (patch: Partial<typeof q>) => {
    const next = { ...q, ...patch };
    scene.setQuality(next);
    saveQuality(next);
    setVersion((n) => n + 1);
  };
  const device = Math.min(window.devicePixelRatio, 2);
  const rows: [string, string][] = [
    ['FPS', Math.round(f.fps).toString()],
    [t.perfFrame, `${f.frameMs.toFixed(1)} · ${f.slowMs.toFixed(1)}`],
    [t.perfScript, f.cpuMs.toFixed(1)],
    ['draw calls', String(f.calls)],
    ['△', thousands(f.triangles)],
    ['points', thousands(f.points)],
    ['px', `${f.width}×${f.height} @ ${f.pixelRatio}×`],
    [t.perfPlaces, String(scene.placeCount())],
  ];
  return (
    <div className="rpg-dev-list rpg-dev-perf">
      <dl>
        {rows.map(([k, v]) => (
          <React.Fragment key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </React.Fragment>
        ))}
      </dl>
      <label>
        <input type="checkbox" checked={badge} onChange={(e) => onBadge(e.target.checked)} /> {t.perfBadge}
      </label>
      <label>
        <input type="checkbox" checked={q.shadows} onChange={(e) => set({ shadows: e.target.checked })} /> {t.perfShadows}
      </label>
      <label>
        <input type="checkbox" checked={q.weather} onChange={(e) => set({ weather: e.target.checked })} /> {t.perfWeather}
      </label>
      <label>
        {t.perfResolution}{' '}
        <select value={String(q.pixelRatio)} onChange={(e) => set({ pixelRatio: e.target.value === 'null' ? null : Number(e.target.value) })}>
          {PIXEL_RATIOS.map((r) => (
            <option key={String(r)} value={String(r)}>
              {r === null ? t.perfDevice(device) : `${r}×`}
            </option>
          ))}
        </select>
      </label>
      <p className="rpg-dev-empty">{t.perfHint}</p>
    </div>
  );
}

export function DevConsole({
  lang,
  onClose,
  scene = null,
  badge = false,
  onBadge = () => {},
}: {
  lang: Lang;
  onClose: () => void;
  scene?: RpgScene | null;
  badge?: boolean;
  onBadge?: (on: boolean) => void;
}) {
  const t = translations[lang];
  const requests = useDevlog();
  const running = requests.some((r) => r.status === 'waiting' || r.status === 'streaming');
  useTick(running);
  const totals = questTotals();
  const listRef = useRef<HTMLDivElement>(null);
  const [showVoice, setShowVoice] = useState(false);
  const [tab, setTab] = useState<'requests' | 'lines' | 'perf'>('requests');
  const lines = useTranscript();
  const shown = showVoice ? requests : requests.filter((r) => r.kind !== 'voice');

  // Follows the newest output, unless the reader has scrolled up to read something.
  useEffect(() => {
    const el = listRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  });

  return (
    <div className="rpg-dev" role="log" aria-label={t.devConsole}>
      <div className="rpg-dev-bar">
        <strong>~ {t.devConsole}</strong>
        <div className="rpg-dev-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'requests'} onClick={() => setTab('requests')}>
            {t.devRequests}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'lines'} onClick={() => setTab('lines')}>
            {t.devLines}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'perf'} onClick={() => setTab('perf')}>
            {t.devPerf}
          </button>
        </div>
        {tab === 'requests' && (
          <label>
            <input type="checkbox" checked={showVoice} onChange={(e) => setShowVoice(e.target.checked)} /> ElevenLabs
          </label>
        )}
        <button type="button" className="rpg-dev-close" onClick={onClose} aria-label={t.close}>
          ×
        </button>
      </div>
      {tab === 'perf' ? (
        <PerfTab lang={lang} scene={scene} badge={badge} onBadge={onBadge} />
      ) : tab === 'lines' ? (
        <div className="rpg-dev-list rpg-dev-lines" ref={listRef}>
          {lines.length === 0 && <div className="rpg-dev-empty">{t.devNoLines}</div>}
          {lines.map((l, i) =>
            l.kind === 'beat' ? (
              <div key={i} className="rpg-dev-beat">
                {t.devBeat(l.beat + 1)} · {l.speaker}
                <span>{l.text}</span>
              </div>
            ) : (
              <div key={i} className={`rpg-dev-line rpg-dev-line-${l.kind}`}>
                <b>{l.kind === 'decision' ? `${l.speaker} ⚑` : l.speaker}:</b> {l.text}
              </div>
            ),
          )}
        </div>
      ) : (
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
      )}
      <div className="rpg-dev-totals">
        {t.genTime}: {formatMs(totals.generationMs)} · {t.tokensLine}: in {tokens(totals.tokens.input)} out{' '}
        {tokens(totals.tokens.output)} think {tokens(totals.tokens.thoughts)} ≈ {formatUsd(totals.modelCost)}
        {totals.unpriced ? '+?' : ''} · ElevenLabs: {totals.voiceChars} {t.chars} ≈ {Math.round(totals.voiceCredits)} cr ≈{' '}
        {formatUsd(totals.voiceCost)} · fal.ai ≈ {formatUsd(totals.falCost)} · {t.total} ≈{' '}
        {formatUsd(totals.modelCost + totals.voiceCost + totals.falCost)}
        {totals.errors > 0 && <span className="rpg-dev-error"> · {t.errors(totals.errors)}</span>}
      </div>
    </div>
  );
}

/**
 * One line about the model request still running, under the journal while a beat is written in
 * the background: which model, how long so far, and the last line it wrote or thought.
 */
export function StreamLine() {
  const requests = useDevlog();
  const current = [...requests].reverse().find((r) => r.kind === 'model');
  const running = current?.status === 'waiting' || current?.status === 'streaming';
  useTick(running, 500);
  if (!current || !running) return null;
  const last = tail(current.text || current.thoughts, 1).trim();
  return (
    <div className="rpg-journal-stream">
      {current.servedBy ?? current.model} · {formatMs(elapsed(current))}
      {last ? ` · ${last}` : ''}
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
      {totals.falCost > 0 && (
        <>
          <dt>fal.ai</dt>
          <dd>≈ {formatUsd(totals.falCost)}</dd>
        </>
      )}
      <dt>{t.total}</dt>
      <dd>≈ {formatUsd(totals.modelCost + totals.voiceCost + totals.falCost)}</dd>
    </dl>
  );
}
