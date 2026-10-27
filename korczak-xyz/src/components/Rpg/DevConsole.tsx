/*
 * The developer console, toggled with `~` (owner, Oct 2026: "active development, I want a debug view
 * as it happens"), and the small preview of what is streaming that the waiting screens show. Both
 * read `devlog.ts`; neither changes anything.
 */

import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { formatMs, formatUsd } from '../../utils/rpg/cost';
import {
  devlogVersion,
  devRequests,
  questSpend,
  questTotals,
  spendUsd,
  STAGES,
  subscribeDevlog,
  timeline,
  worldSpend,
  type DevRequest,
} from '../../utils/rpg/devlog';
import type { WorldBible } from '../../utils/rpg/genesis';
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
  else if (r.kind === 'fal') parts.unshift(r.label ?? 'landmark');
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

/** Seconds after the start, to a tenth. */
function at(ms: number): string {
  return `+${(ms / 1000).toFixed(1)} s`;
}

/**
 * Where the start's time went (owner, 27 Oct 2026: "two minutes before the game is ready"): when
 * each thing the reader waits for arrived, and every request since the click, by when it began,
 * first answered and ended — a bar per request, so the steps that ran one after another show.
 */
function StartTab({ lang, requests }: { lang: Lang; requests: readonly DevRequest[] }) {
  const t = translations[lang];
  const line = timeline();
  if (!line) return <div className="rpg-dev-list"><div className="rpg-dev-empty">{t.devStartEmpty}</div></div>;
  const mine = requests.filter((r) => r.startedAt >= line.since && r.kind !== 'voice');
  // The clock runs while something does, and stops at the last thing that came.
  const busy = mine.some((r) => r.ms === null);
  const ends = [...Object.values(line.stages), ...mine.map((r) => r.startedAt - line.since + elapsed(r))] as number[];
  const now = busy ? Date.now() - line.since : Math.max(0, ...ends);
  const span = Math.max(now, ...ends, 1);
  const reached = STAGES.filter((s) => line.stages[s] !== undefined).sort((a, b) => line.stages[a]! - line.stages[b]!);
  const waiting = STAGES.filter((s) => line.stages[s] === undefined);
  const pct = (ms: number) => `${Math.min(100, (ms / span) * 100).toFixed(2)}%`;
  return (
    <div className="rpg-dev-list rpg-dev-start">
      <div className="rpg-dev-beat">
        {line.what === 'world' ? t.devStartWorld : t.devStartQuest} · {formatMs(now)}
      </div>
      <dl>
        {reached.map((s) => (
          <React.Fragment key={s}>
            <dt>{at(line.stages[s]!)}</dt>
            <dd>{t.stageNames[s]}</dd>
          </React.Fragment>
        ))}
        {waiting.map((s) => (
          <React.Fragment key={s}>
            <dt>…</dt>
            <dd className="rpg-dev-pending">{t.stageNames[s]}</dd>
          </React.Fragment>
        ))}
      </dl>
      {mine.map((r) => {
        const from = r.startedAt - line.since;
        const took = elapsed(r);
        const what = r.kind === 'model' ? (r.beat === null ? 'world' : `beat ${r.beat + 1}`) : (r.label ?? r.kind);
        return (
          <div key={r.id} className={`rpg-dev-span rpg-dev-${r.status}`}>
            <div className="rpg-dev-span-text">
              {what} · {r.servedBy ?? r.model} · {at(from)} → {r.ms === null ? '…' : at(from + took)} ({formatMs(took)}
              {r.firstMs !== null && r.kind === 'model' ? `, 1st ${formatMs(r.firstMs)}` : ''})
            </div>
            <div className="rpg-dev-bar-track" aria-hidden="true">
              <div className="rpg-dev-bar-fill" style={{ marginLeft: pct(from), width: pct(took) }} />
            </div>
          </div>
        );
      })}
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
  const [tab, setTab] = useState<'requests' | 'start' | 'lines' | 'perf'>('requests');
  useTick(running);
  const totals = questTotals();
  const listRef = useRef<HTMLDivElement>(null);
  const [showVoice, setShowVoice] = useState(false);
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
          <button type="button" role="tab" aria-selected={tab === 'start'} onClick={() => setTab('start')}>
            {t.devStart}
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
      ) : tab === 'start' ? (
        <StartTab lang={lang} requests={requests} />
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
        {formatUsd(totals.voiceCost)} · fal.ai: {totals.falModels}× 3D{totals.falTextures > 0 ? ` + ${totals.falTextures}× tex` : ''} ≈ {formatUsd(totals.falCost)} · {t.total} ≈{' '}
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

/**
 * What the quest cost and how long it was written for, on the closing screen: every sitting of it
 * (the autosave carries the earlier ones), and the world it was played in on a line of its own.
 */
export function QuestSummary({ lang, world }: { lang: Lang; world: WorldBible | null }) {
  const t = translations[lang];
  useDevlog();
  const q = questSpend();
  const w = worldSpend(world);
  const floor = (unknown: boolean) => (unknown ? ' +?' : '');
  const questUsd = spendUsd(q);
  const worldUsd = w ? spendUsd(w) : 0;
  const worldParts = w
    ? [
        // A world from before costs were kept: what its genesis cost is not known.
        w.tokens.input + w.tokens.output + w.tokens.thoughts > 0
          ? `${tokens(w.tokens.input + w.tokens.output + w.tokens.thoughts)} ${t.worldTokens} ≈ ${formatUsd(w.modelCost)}${floor(w.unpriced || Boolean(w.partial))}`
          : w.partial
            ? `${t.tokensLine.toLowerCase()} ?`
            : null,
        w.falModels + w.falTextures > 0
          ? `fal.ai ${w.falModels}× 3D${w.falTextures > 0 ? ` + ${w.falTextures}× tex` : ''} ≈ ${formatUsd(w.falCost)}`
          : null,
        w.ms > 0 ? formatMs(w.ms) : null,
      ].filter(Boolean)
    : [];
  return (
    <>
      <dl className="rpg-summary">
        <dt>{t.genTime}</dt>
        <dd>{formatMs(q.ms)}{floor(Boolean(q.partial))}</dd>
        <dt>{t.tokensLine}</dt>
        <dd>
          {tokens(q.tokens.input + q.tokens.output + q.tokens.thoughts)} ≈ {formatUsd(q.modelCost)}
          {floor(q.unpriced || Boolean(q.partial))}
        </dd>
        <dt>ElevenLabs</dt>
        <dd>
          {q.voiceChars} {t.chars} ≈ {Math.round(q.voiceCredits)} cr ≈ {formatUsd(q.voiceCost)}
          {floor(Boolean(q.partial))}
        </dd>
        {q.falCost > 0 && (
          <>
            <dt>fal.ai</dt>
            <dd>
              {q.falModels}× 3D{q.falTextures > 0 ? ` + ${q.falTextures}× tex` : ''} ≈ {formatUsd(q.falCost)}
            </dd>
          </>
        )}
        <dt>{t.total}</dt>
        <dd>≈ {formatUsd(questUsd)}{floor(q.unpriced || Boolean(q.partial))}</dd>
        {w && (
          <>
            <dt>{t.worldLine}</dt>
            <dd>
              ≈ {formatUsd(worldUsd)}
              {floor(w.unpriced || Boolean(w.partial))}
              {worldParts.length > 0 && <span className="rpg-summary-detail"> ({worldParts.join(' · ')})</span>}
            </dd>
            <dt>{t.totalWithWorld}</dt>
            <dd>
              ≈ {formatUsd(questUsd + worldUsd)}
              {floor(q.unpriced || Boolean(q.partial) || w.unpriced || Boolean(w.partial))}
            </dd>
          </>
        )}
      </dl>
      <p className="rpg-ending-note">{t.costSittings}</p>
      {(q.partial || w?.partial) && <p className="rpg-ending-note">{t.costFloor}</p>}
    </>
  );
}
