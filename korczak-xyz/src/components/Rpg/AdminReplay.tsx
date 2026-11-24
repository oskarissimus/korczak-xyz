/*
 * The admin's *Replay* tab (owner, 24 Nov 2026: "a replay mode in the admin, so I can see how people
 * play, what they need, where they get stuck — and when each asset was made and shown to the player,
 * so I see the delay and what it does to the game"). The sessions of a range, then one session laid
 * out on a timeline you can play or scrub: what was on screen, what the player did, what held them
 * and for how long, and every asset from being asked for to standing in front of them.
 *
 * Reads `GET /admin/replays` and `GET /admin/replay?id` (`functions/src/rpg/replay.ts`); the events
 * are read back by `utils/rpg/replayTimeline.ts`. Nothing is fetched until the tab is first opened.
 *
 * Nothing moves when something loads: the list and the session keep their boxes while they are read
 * (a fixed `min-height`, rows of "…"), the readout has one fixed row per fact, and the timeline's
 * height is set by its lanes before any event is drawn.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';

import { describeError, log } from '../../lib/logger';
import { adminReplay, adminReplayFrame, adminReplays } from '../../utils/rpg/gateway';
import type { ReplayDetail, ReplayEvent, ReplayMeta, ReplaysPage } from '../../utils/rpg/replay';
import { buildTimeline, clock, delay, stateAt, type Span, type Timeline } from '../../utils/rpg/replayTimeline';

type Lang = 'en' | 'pl';

const RANGES = [1, 7, 30] as const;
const SPEEDS = [1, 10, 60] as const;

const translations = {
  en: {
    title: 'Replay',
    blurb:
      'Every session of the game, recorded as it is played: the screens, the steps, the lines, the choices, ' +
      'the waits and every asset from being asked for to standing in front of the player. Kept 30 days. ' +
      'No key, address or e-mail is recorded; the e-mail beside a session is looked up for this page.',
    range: (d: number) => (d === 1 ? '24 h' : `${d} days`),
    reload: 'Reload',
    loading: 'Reading…',
    empty: 'No sessions in this range.',
    failed: 'That did not work:',
    cols: ['Started', 'Length', 'Who', 'Steps', 'Choices', 'Waited (longest)', 'Slowest asset', 'Stalls', 'Left at'],
    guest: 'guest',
    phone: 'phone',
    ended: 'quest finished',
    back: '← All sessions',
    play: '▶ Play',
    pause: '❚❚ Pause',
    speed: 'Speed',
    at: 'At',
    lanes: { screens: 'Screen', beats: 'Step', waits: 'Held', idle: 'Idle / hidden', requests: 'Requests', assets: 'Assets', marks: 'Actions' },
    state: {
      screen: 'Screen',
      beat: 'Step',
      goal: 'Goal',
      line: 'Last line',
      act: 'Last action',
      waiting: 'Held by',
      pending: 'Being made',
      loading: 'Loading into the scene',
      at: 'Where',
    },
    none: '—',
    insights: 'Where it went',
    insight: {
      length: (t: string, active: string) => `${t} in all, ${active} with the page in front of the player`,
      waited: (t: string, n: number) => `Held ${t} in ${n} wait${n === 1 ? '' : 's'}`,
      longest: (t: string, why: string) => `longest ${t}: ${why}`,
      idle: (t: string) => `Did nothing for ${t} (stretches of 30 s or more)`,
      stalls: (n: number) => `${n} step${n === 1 ? '' : 's'} could not be written`,
      reached: (n: number, ended: boolean) => (ended ? `Finished the quest after ${n} steps` : n ? `Got to step ${n} and stopped there` : 'Never reached the first step'),
      assets: (n: number, slow: string) => `${n} assets shown, the slowest after ${slow}`,
    },
    waitsTitle: 'What held the player',
    waitCols: ['From', 'For', 'Why', 'Made meanwhile'],
    why: {
      opening: 'writing the opening',
      unfolding: 'writing the next step',
      world: 'inventing the world',
      free: 'answering a typed line',
      stalled: 'an error, waiting on the player',
    } as Record<string, string>,
    stillOpen: 'still waiting when the recording ends',
    assetsTitle: 'Assets: asked for → made → standing',
    assetCols: ['Asset', 'Step', 'Asked', 'Made after', 'Loaded after', 'In all', ''],
    kept: 'kept (made before)',
    notShown: 'never stood',
    eventsTitle: 'Every event',
    mapTitle: 'The hero’s way',
    noMap: 'No movement recorded.',
    screenTitle: 'What the player saw',
    screenBlurb:
      'A picture of the 3D scene every 10 s and at every step, dialogue and wait; the game’s words over it ' +
      '(the dialogue, the waiting, a banner) are drawn back from the events, as they were at that moment.',
    frameAge: (s: string) => `picture from ${s} earlier`,
    frameNow: 'picture from this moment',
    noFrame: 'no picture yet',
    frameFailed: 'the picture would not load',
    onScreen: (s: string) => `On screen: ${s}`,
    stepOf: (n: number) => `Step ${n}`,
    willPick: 'picks next',
  },
  pl: {
    title: 'Replay',
    blurb:
      'Każda sesja gry, nagrana w trakcie: ekrany, kroki, kwestie, wybory, czekanie i każdy asset od zlecenia ' +
      'do pokazania graczowi. Trzymane 30 dni. Nie zapisujemy kluczy, adresów ani e-maili; e-mail przy sesji ' +
      'jest doczytywany tylko na potrzeby tej strony.',
    range: (d: number) => (d === 1 ? '24 h' : `${d} dni`),
    reload: 'Odśwież',
    loading: 'Czytam…',
    empty: 'Brak sesji w tym zakresie.',
    failed: 'Nie udało się:',
    cols: ['Start', 'Długość', 'Kto', 'Kroki', 'Wybory', 'Czekał (najdłużej)', 'Najwolniejszy asset', 'Błędy', 'Skończył na'],
    guest: 'gość',
    phone: 'telefon',
    ended: 'quest ukończony',
    back: '← Wszystkie sesje',
    play: '▶ Odtwórz',
    pause: '❚❚ Pauza',
    speed: 'Tempo',
    at: 'Moment',
    lanes: { screens: 'Ekran', beats: 'Krok', waits: 'Czeka', idle: 'Bezczynny / ukryta', requests: 'Zapytania', assets: 'Assety', marks: 'Akcje' },
    state: {
      screen: 'Ekran',
      beat: 'Krok',
      goal: 'Cel',
      line: 'Ostatnia kwestia',
      act: 'Ostatnia akcja',
      waiting: 'Czeka na',
      pending: 'W generowaniu',
      loading: 'Ładuje się do sceny',
      at: 'Gdzie',
    },
    none: '—',
    insights: 'Jak poszło',
    insight: {
      length: (t: string, active: string) => `${t} w sumie, ${active} z otwartą kartą`,
      waited: (t: string, n: number) => `Czekał ${t} w ${n} ${n === 1 ? 'oczekiwaniu' : 'oczekiwaniach'}`,
      longest: (t: string, why: string) => `najdłużej ${t}: ${why}`,
      idle: (t: string) => `Nic nie robił przez ${t} (przerwy od 30 s)`,
      stalls: (n: number) => `${n} ${n === 1 ? 'krok się nie napisał' : 'kroków się nie napisało'}`,
      reached: (n: number, ended: boolean) => (ended ? `Ukończył quest po ${n} krokach` : n ? `Doszedł do kroku ${n} i tam skończył` : 'Nie doszedł do pierwszego kroku'),
      assets: (n: number, slow: string) => `${n} assetów pokazanych, najwolniejszy po ${slow}`,
    },
    waitsTitle: 'Na co gracz czekał',
    waitCols: ['Od', 'Ile', 'Dlaczego', 'Co się w tym czasie generowało'],
    why: {
      opening: 'pisanie otwarcia',
      unfolding: 'pisanie następnego kroku',
      world: 'tworzenie świata',
      free: 'odpowiedź na wpisaną kwestię',
      stalled: 'błąd, czeka na decyzję gracza',
    } as Record<string, string>,
    stillOpen: 'wciąż czekał, gdy nagranie się kończy',
    assetsTitle: 'Assety: zlecony → wygenerowany → pokazany',
    assetCols: ['Asset', 'Krok', 'Zlecony', 'Wygenerowany po', 'Załadowany po', 'Razem', ''],
    kept: 'z pamięci (zrobiony wcześniej)',
    notShown: 'nie pojawił się',
    eventsTitle: 'Wszystkie zdarzenia',
    mapTitle: 'Droga bohatera',
    noMap: 'Brak zapisanego ruchu.',
    screenTitle: 'Co gracz widział',
    screenBlurb:
      'Zrzut sceny 3D co 10 s i przy każdym kroku, dialogu i oczekiwaniu; słowa gry na nim (dialog, ekran ' +
      'oczekiwania, komunikat) są odtworzone ze zdarzeń, tak jak wyglądały w tym momencie.',
    frameAge: (s: string) => `zrzut sprzed ${s}`,
    frameNow: 'zrzut z tej chwili',
    noFrame: 'jeszcze bez zrzutu',
    frameFailed: 'zrzut się nie wczytał',
    onScreen: (s: string) => `Na ekranie: ${s}`,
    stepOf: (n: number) => `Krok ${n}`,
    willPick: 'zaraz wybierze',
  },
};

type T = (typeof translations)['en'];

export default function AdminReplay({ lang, active }: { lang: Lang; active: boolean }) {
  const t = translations[lang];
  const [days, setDays] = useState<(typeof RANGES)[number]>(7);
  const [page, setPage] = useState<ReplaysPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const opened = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const to = Date.now();
      setPage(await adminReplays(to - days * 86_400_000, to));
    } catch (e) {
      log.warn('rpg.admin.replays.failed', describeError(e));
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    if (!active && !opened.current) return;
    opened.current = true;
    void load();
  }, [active, load]);

  if (picked) return <SessionView id={picked} t={t} lang={lang} back={() => setPicked(null)} />;

  return (
    <section className="acct-section rpg-costs rpg-replay">
      <div className="acct-heading-row">
        <h2 className="acct-heading">{t.title}</h2>
        <button type="button" className="retro-btn" disabled={loading} onClick={() => void load()}>
          {t.reload}
        </button>
      </div>
      <p className="acct-dim">{t.blurb}</p>
      <div className="rpg-costs-controls">
        <div className="rpg-costs-toggle" role="group">
          {RANGES.map((d) => (
            <button key={d} type="button" className="retro-btn" aria-pressed={days === d} onClick={() => setDays(d)}>
              {t.range(d)}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p className="acct-warn">
          {t.failed} {error}
        </p>
      )}
      <div className="rpg-costs-scroll rpg-replay-list" tabIndex={0} role="region" aria-label={t.title}>
        <table className="rpg-costs-table">
          <thead>
            <tr>
              {t.cols.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!page
              ? Array.from({ length: 5 }, (_, i) => (
                  <tr key={i}>
                    {t.cols.map((c) => (
                      <td key={c}>…</td>
                    ))}
                  </tr>
                ))
              : page.sessions.map((s) => <SessionRow key={s.id} s={s} t={t} lang={lang} open={() => setPicked(s.id)} />)}
            {page && page.sessions.length === 0 && (
              <tr>
                <td colSpan={t.cols.length} className="acct-dim">
                  {t.empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function whoOf(s: ReplayMeta, t: T): string {
  if (s.uid) return s.email ?? `${s.uid.slice(0, 8)}…`;
  return `${t.guest} ${s.guest ? s.guest.slice(0, 6) : '?'}`;
}

function SessionRow({ s, t, lang, open }: { s: ReplayMeta; t: T; lang: Lang; open: () => void }) {
  const m = s.summary;
  const when = new Date(s.startedAt).toLocaleString(lang === 'pl' ? 'pl-PL' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return (
    <tr>
      <td>
        <button type="button" className="rpg-costs-link" onClick={open}>
          ▶ {when}
        </button>
      </td>
      <td>{clock(m.ms)}</td>
      <td className="rpg-costs-wrap">
        {whoOf(s, t)}
        <span className="acct-dim">
          {' '}
          · {s.lang || '?'}
          {s.mobile ? ` · ${t.phone}` : ''}
        </span>
      </td>
      <td>
        {m.beats}
        {m.ended ? ' ✓' : ''}
      </td>
      <td>{m.choices}</td>
      <td>
        {delay(m.waitMs)} <span className="acct-dim">({delay(m.longestWaitMs)})</span>
      </td>
      <td>{m.longestAssetMs ? delay(m.longestAssetMs) : t.none}</td>
      <td>{m.stalls || t.none}</td>
      <td>{m.last || t.none}</td>
    </tr>
  );
}

function SessionView({ id, t, lang, back }: { id: string; t: T; lang: Lang; back: () => void }) {
  const [detail, setDetail] = useState<ReplayDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(10);

  useEffect(() => {
    const controller = new AbortController();
    adminReplay(id, controller.signal)
      .then((d) => {
        if (!controller.signal.aborted) setDetail(d);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        log.warn('rpg.admin.replay.failed', describeError(e));
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => controller.abort();
  }, [id]);

  const events = detail?.events ?? [];
  const tl = useMemo(() => buildTimeline(events), [events]);

  useEffect(() => {
    if (!playing) return;
    const step = window.setInterval(() => {
      setAt((now) => {
        const next = now + speed * 100;
        if (next >= tl.ms) {
          setPlaying(false);
          return tl.ms;
        }
        return next;
      });
    }, 100);
    return () => window.clearInterval(step);
  }, [playing, speed, tl.ms]);

  const state = useMemo(() => stateAt(events, at), [events, at]);
  const meta = detail?.meta;

  return (
    <section className="acct-section rpg-costs rpg-replay">
      <div className="acct-heading-row">
        <h2 className="acct-heading">
          {t.title}
          {meta ? ` · ${whoOf(meta, t)}` : ''}
        </h2>
        <button type="button" className="retro-btn" onClick={back}>
          {t.back}
        </button>
      </div>
      <p className="acct-dim rpg-replay-sub">
        {meta
          ? `${new Date(meta.startedAt).toLocaleString(lang === 'pl' ? 'pl-PL' : 'en-GB')} · ${meta.host} · ${meta.lang || '?'}${meta.mobile ? ` · ${t.phone}` : ''}`
          : t.loading}
      </p>
      {error && (
        <p className="acct-warn">
          {t.failed} {error}
        </p>
      )}
      <Insights tl={tl} meta={meta ?? null} t={t} />
      <div className="rpg-replay-controls">
        <button type="button" className="retro-btn" disabled={!detail} onClick={() => (at >= tl.ms ? (setAt(0), setPlaying(true)) : setPlaying(!playing))}>
          {playing ? t.pause : t.play}
        </button>
        <div className="rpg-costs-toggle" role="group" aria-label={t.speed}>
          {SPEEDS.map((s) => (
            <button key={s} type="button" className="retro-btn" aria-pressed={speed === s} onClick={() => setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
        <label className="rpg-replay-scrub">
          <span className="acct-dim">{t.at}</span>
          <input type="range" min={0} max={Math.max(1, tl.ms)} step={100} value={at} disabled={!detail} onChange={(e) => setAt(Number(e.target.value))} />
          <span className="rpg-replay-clock">
            {clock(at)} / {clock(tl.ms)}
          </span>
        </label>
      </div>
      <ScreenView id={id} frames={detail?.frames ?? []} events={events} state={state} at={at} t={t} />
      <TimelineChart tl={tl} at={at} setAt={setAt} t={t} />
      <div className="rpg-replay-now">
        <StatePanel state={state} t={t} />
        <PathMap tl={tl} at={at} t={t} />
      </div>
      <WaitsTable tl={tl} t={t} setAt={setAt} />
      <AssetsTable tl={tl} t={t} setAt={setAt} />
      <EventList events={events} at={at} setAt={setAt} t={t} />
    </section>
  );
}

function Insights({ tl, meta, t }: { tl: Timeline; meta: ReplayMeta | null; t: T }) {
  const i = t.insight;
  const waited = tl.waits.reduce((sum, w) => sum + (w.to - w.from), 0);
  const longest = tl.waits.reduce<Span | null>((best, w) => (!best || w.to - w.from > best.to - best.from ? w : best), null);
  const idle = tl.idle.reduce((sum, w) => sum + (w.to - w.from), 0);
  const shown = tl.assets.filter((a) => a.shownAt !== null);
  const slowest = shown.reduce((m, a) => Math.max(m, a.totalMs ?? 0), 0);
  const rows = meta
    ? [
        i.length(clock(meta.summary.ms), clock(meta.summary.activeMs)),
        i.reached(meta.summary.beats, meta.summary.ended),
        `${i.waited(delay(waited), tl.waits.length)}${longest ? `, ${i.longest(delay(longest.to - longest.from), t.why[longest.label] ?? longest.label)}` : ''}`,
        i.idle(delay(idle)),
        i.stalls(meta.summary.stalls),
        i.assets(shown.length, delay(slowest)),
      ]
    : Array.from({ length: 6 }, () => '…');
  return (
    <div className="rpg-replay-insights">
      <h3 className="acct-heading">{t.insights}</h3>
      <ul>
        {rows.map((r, n) => (
          <li key={n} title={r}>
            {r}
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- the timeline ------------------------------------------------------------------------------

const W = 1000;
const LEFT = 120;
const ROW = 16;
const GAP = 6;
const PACK = 5;

/** Spans into at most `PACK` rows, each span in the first row where it does not overlap. */
function pack(spans: readonly Span[]): Span[][] {
  const rows: Span[][] = [];
  for (const s of spans) {
    let row = rows.find((r) => r[r.length - 1].to <= s.from);
    if (!row) {
      if (rows.length < PACK) rows.push((row = []));
      else row = rows[rows.length - 1];
    }
    row.push(s);
  }
  // Always `PACK` rows, used or not: the chart is as tall before the session is read as after.
  while (rows.length < PACK) rows.push([]);
  return rows;
}

function TimelineChart({ tl, at, setAt, t }: { tl: Timeline; at: number; setAt: (n: number) => void; t: T }) {
  const span = Math.max(1, tl.ms);
  const x = (ms: number) => LEFT + ((W - LEFT - 8) * ms) / span;
  const reqRows = pack(tl.requests);
  const assetSpans: Span[] = tl.assets.map((a) => ({
    from: a.askedAt ?? a.showAt,
    to: a.shownAt ?? tl.ms,
    label: `${a.what}${a.name !== a.what ? ` · ${a.name}` : ''} — ${delay(a.totalMs)}`,
    open: a.shownAt === null,
    bad: a.shownAt !== null && !a.ok,
  }));
  const assetRows = pack(assetSpans);
  const lanes: { key: string; label: string; rows: Span[][]; kind: 'solid' | 'hatch' | 'thin' }[] = [
    { key: 'screens', label: t.lanes.screens, rows: [tl.screens], kind: 'thin' },
    { key: 'beats', label: t.lanes.beats, rows: [tl.beats], kind: 'thin' },
    { key: 'waits', label: t.lanes.waits, rows: [tl.waits.map((w) => ({ ...w, label: t.why[w.label] ?? w.label }))], kind: 'hatch' },
    { key: 'idle', label: t.lanes.idle, rows: [[...tl.idle, ...tl.hidden]], kind: 'thin' },
    { key: 'requests', label: t.lanes.requests, rows: reqRows, kind: 'solid' },
    { key: 'assets', label: t.lanes.assets, rows: assetRows, kind: 'solid' },
  ];
  let y = 18;
  const placed = lanes.map((l) => {
    const top = y;
    y += l.rows.length * ROW + GAP;
    return { ...l, top };
  });
  const marksTop = y;
  const height = marksTop + ROW + 22;

  const pick = (e: MouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    if (px < LEFT) return;
    setAt(Math.max(0, Math.min(tl.ms, ((px - LEFT) / (W - LEFT - 8)) * span)));
  };

  const ticks = Array.from({ length: 6 }, (_, i) => (span * i) / 5);
  const markShape: Record<string, string> = { choice: '◆', free: '✎', stall: '✖', death: '☠', ending: '★', error: '!', progress: '+' };

  return (
    <div className="rpg-replay-chart">
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label={t.title} onClick={pick}>
        <defs>
          <pattern id="rpg-replay-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="currentColor" opacity="0.25" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeWidth="3" />
          </pattern>
        </defs>
        {ticks.map((ms) => (
          <g key={ms}>
            <line x1={x(ms)} x2={x(ms)} y1={12} y2={height - 18} className="rpg-replay-grid" />
            <text x={x(ms)} y={height - 4} textAnchor="middle" className="rpg-replay-tick">
              {clock(ms)}
            </text>
          </g>
        ))}
        {placed.map((l) => (
          <g key={l.key}>
            <text x={4} y={l.top + ROW - 4} className="rpg-replay-lane">
              {l.label}
            </text>
            {l.rows.map((row, r) =>
              row.map((s, n) => {
                const x0 = x(s.from);
                const w = Math.max(2, x(s.to) - x0);
                const top = l.top + r * ROW + 2;
                const h = ROW - 4;
                return (
                  <g key={`${r}-${n}`}>
                    <title>{`${s.label} · ${clock(s.from)}–${clock(s.to)} (${delay(s.to - s.from)})`}</title>
                    {l.kind === 'hatch' ? (
                      <rect x={x0} y={top} width={w} height={h} fill="url(#rpg-replay-hatch)" stroke="currentColor" strokeDasharray={s.open ? '3 2' : undefined} />
                    ) : l.kind === 'thin' ? (
                      <rect x={x0} y={top} width={w} height={h} fill="none" stroke="currentColor" strokeDasharray={s.open ? '3 2' : undefined} opacity={0.85} />
                    ) : (
                      <rect
                        x={x0}
                        y={top + 2}
                        width={w}
                        height={h - 4}
                        fill={s.bad ? 'none' : 'currentColor'}
                        stroke="currentColor"
                        strokeDasharray={s.open || s.bad ? '3 2' : undefined}
                        opacity={s.bad ? 1 : 0.6}
                      />
                    )}
                    {l.kind !== 'solid' && w > 40 && (
                      <text x={x0 + 3} y={top + h - 3} className="rpg-replay-span-text">
                        {s.label.length > w / 6 ? `${s.label.slice(0, Math.max(1, Math.floor(w / 6) - 1))}…` : s.label}
                      </text>
                    )}
                  </g>
                );
              }),
            )}
          </g>
        ))}
        <text x={4} y={marksTop + ROW - 4} className="rpg-replay-lane">
          {t.lanes.marks}
        </text>
        {tl.markers.map((m, n) => (
          <text key={n} x={x(m.t)} y={marksTop + ROW - 3} textAnchor="middle" className="rpg-replay-mark">
            <title>{`${clock(m.t)} ${m.kind}: ${m.label}`}</title>
            {markShape[m.kind] ?? '•'}
          </text>
        ))}
        <line x1={x(at)} x2={x(at)} y1={8} y2={height - 18} className="rpg-replay-head" />
      </svg>
    </div>
  );
}

function StatePanel({ state, t }: { state: ReturnType<typeof stateAt>; t: T }) {
  const s = t.state;
  const list = (items: string[]) => (items.length ? items.join(', ') : t.none);
  const rows: [string, string][] = [
    [s.screen, state.screen || t.none],
    [s.beat, state.beat ? `${state.beat.n + 1}. ${state.beat.title}` : t.none],
    [s.goal, state.beat ? `${state.beat.goal}${state.beat.place ? ` (${state.beat.place})` : ''}` : t.none],
    [s.line, state.line ? `${state.line.who}: ${state.line.text}` : t.none],
    [s.act, state.act ? state.act.label : t.none],
    [s.waiting, list(state.waiting.map((w) => t.why[w] ?? w))],
    [s.pending, list(state.pending)],
    [s.loading, list(state.loading)],
    [s.at, state.at ? `${state.at.x.toFixed(0)}, ${state.at.z.toFixed(0)}` : t.none],
  ];
  return (
    <dl className="rpg-replay-state">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd title={v}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function PathMap({ tl, at, t }: { tl: Timeline; at: number; t: T }) {
  const pts = tl.path;
  const size = 200;
  let body: ReactNode = (
    <text x={size / 2} y={size / 2} textAnchor="middle" className="rpg-replay-tick">
      {t.noMap}
    </text>
  );
  if (pts.length) {
    const xs = pts.map((p) => p.x);
    const zs = pts.map((p) => p.z);
    const minX = Math.min(...xs);
    const minZ = Math.min(...zs);
    const extent = Math.max(10, Math.max(...xs) - minX, Math.max(...zs) - minZ);
    const px = (p: { x: number; z: number }) => `${(8 + ((p.x - minX) / extent) * (size - 16)).toFixed(1)},${(8 + ((p.z - minZ) / extent) * (size - 16)).toFixed(1)}`;
    const done = pts.filter((p) => p.t <= at);
    const last = done[done.length - 1];
    body = (
      <>
        <polyline points={pts.map(px).join(' ')} fill="none" stroke="currentColor" strokeDasharray="2 3" opacity="0.5" />
        {done.length > 1 && <polyline points={done.map(px).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" />}
        {last && (
          <circle cx={Number(px(last).split(',')[0])} cy={Number(px(last).split(',')[1])} r="4" fill="currentColor" />
        )}
      </>
    );
  }
  return (
    <figure className="rpg-replay-map">
      <figcaption className="acct-dim">{t.mapTitle}</figcaption>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={t.mapTitle}>
        {body}
      </svg>
    </figure>
  );
}

function WaitsTable({ tl, t, setAt }: { tl: Timeline; t: T; setAt: (n: number) => void }) {
  const rows = [...tl.waits].sort((a, b) => b.to - b.from - (a.to - a.from));
  if (!rows.length) return null;
  return (
    <>
      <h3 className="acct-heading">{t.waitsTitle}</h3>
      <div className="rpg-costs-scroll">
        <table className="rpg-costs-table">
          <thead>
            <tr>
              {t.waitCols.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((w, n) => {
              const made = tl.requests.filter((r) => r.from < w.to && r.to > w.from).map((r) => r.label);
              return (
                <tr key={n}>
                  <td>
                    <button type="button" className="rpg-costs-link" onClick={() => setAt(w.from)}>
                      {clock(w.from)}
                    </button>
                  </td>
                  <td>
                    {delay(w.to - w.from)}
                    {w.open ? ' …' : ''}
                  </td>
                  <td className="rpg-costs-wrap">
                    {t.why[w.label] ?? w.label}
                    {w.open && <span className="acct-dim"> ({t.stillOpen})</span>}
                  </td>
                  <td className="rpg-costs-wrap acct-dim">{made.length ? [...new Set(made)].join(', ') : t.none}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AssetsTable({ tl, t, setAt }: { tl: Timeline; t: T; setAt: (n: number) => void }) {
  const rows = [...tl.assets].sort((a, b) => (b.totalMs ?? Infinity) - (a.totalMs ?? Infinity));
  if (!rows.length) return null;
  return (
    <>
      <h3 className="acct-heading">{t.assetsTitle}</h3>
      <div className="rpg-costs-scroll rpg-replay-assets">
        <table className="rpg-costs-table">
          <thead>
            <tr>
              {t.assetCols.map((c, n) => (
                <th key={n}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((a, n) => (
              <tr key={n}>
                <td className="rpg-costs-wrap">
                  <button type="button" className="rpg-costs-link" onClick={() => setAt(a.askedAt ?? a.showAt)}>
                    {a.what}
                    {a.name !== a.what ? ` · ${a.name}` : ''}
                  </button>
                </td>
                <td>{a.beat === null ? t.none : a.beat + 1}</td>
                <td>{a.askedAt === null ? <span className="acct-dim">{t.kept}</span> : clock(a.askedAt)}</td>
                <td>{a.askedAt !== null && a.madeAt !== null ? delay(a.madeAt - a.askedAt) : t.none}</td>
                <td>{a.shownAt !== null ? delay(a.shownAt - a.showAt) : t.none}</td>
                <td>
                  <strong>{delay(a.totalMs)}</strong>
                </td>
                <td>{a.shownAt === null ? t.notShown : a.ok ? '✓' : '✗'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** One event in a few words, for the list. */
function describeEvent(e: ReplayEvent, t: T): string {
  const f = (k: string) => (e[k] === undefined || e[k] === null ? '' : String(e[k]));
  switch (e.k) {
    case 'open':
      return `${f('path')} ${f('w')}×${f('h')}${e.mobile ? ` ${t.phone}` : ''}${e.from ? ` ← ${f('from')}` : ''}`;
    case 'screen':
      return f('s');
    case 'world':
      return f('name');
    case 'quest':
      return `${f('mode')}${e.tone ? ` · ${f('tone')}` : ''}`;
    case 'beat':
      return `${Number(e.n ?? 0) + 1}. ${f('title')} — ${f('goal')}`;
    case 'line':
      return `${f('who')}: ${f('text')}`;
    case 'choice':
      return `${f('label')}${e.kind && e.kind !== 'menu' ? ` (${f('kind')})` : ''}`;
    case 'free':
      return `→ ${f('to')}: ${f('text')}`;
    case 'wait':
      return t.why[f('r')] ?? f('r');
    case 'waited':
      return `${t.why[f('r')] ?? f('r')} · ${delay(Number(e.ms))}`;
    case 'stall':
      return f('why');
    case 'req':
      return `#${f('id')} ${f('kind')} · ${f('label') || f('model')}`;
    case 'res':
      return `#${f('id')} ${e.ok === false ? `✗ ${f('err')}` : '✓'} · ${delay(Number(e.ms))}${e.usd ? ` · $${f('usd')}` : ''}`;
    case 'stage':
      return `${f('s')} · ${delay(Number(e.ms))}`;
    case 'show':
      return `${f('what')} · ${f('name')}`;
    case 'shown':
      return `${f('id')} ${e.ok === false ? '✗' : '✓'} · ${delay(Number(e.ms))}`;
    case 'voice':
      return `${f('who')} · ${delay(Number(e.lag))}${e.cached ? ' (cache)' : ''}`;
    case 'pos':
      return `${f('x')}, ${f('z')}`;
    case 'idle':
      return delay(Number(e.ms));
    case 'progress':
      return `${f('n')}/${f('of')}`;
    case 'ending':
      return f('title');
    default:
      return '';
  }
}

function EventList({ events, at, setAt, t }: { events: ReplayEvent[]; at: number; setAt: (n: number) => void; t: T }) {
  const box = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => events.filter((e) => e.k !== 'pos'), [events]);
  let current = -1;
  for (let i = 0; i < shown.length && shown[i].t <= at; i++) current = i;
  // Follows the playhead inside its own box; the page itself never scrolls.
  useEffect(() => {
    const el = box.current;
    const row = el?.querySelector<HTMLElement>(`[data-i="${current}"]`);
    if (el && row) el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top - el.clientHeight / 2;
  }, [current]);
  return (
    <>
      <h3 className="acct-heading">{t.eventsTitle}</h3>
      <div ref={box} className="rpg-costs-scroll rpg-replay-events" tabIndex={0} role="region" aria-label={t.eventsTitle}>
        <table className="rpg-costs-table">
          <tbody>
            {shown.map((e, i) => (
              <tr key={i} data-i={i} className={i === current ? 'rpg-costs-picked' : undefined}>
                <td>
                  <button type="button" className="rpg-costs-link" onClick={() => setAt(e.t)}>
                    {i === current ? '▶ ' : ''}
                    {clock(e.t)}
                  </button>
                </td>
                <td>{e.k}</td>
                <td className="rpg-costs-wrap">{describeEvent(e, t)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** The latest picture taken at or before `at`, or null. */
function frameAt(frames: readonly number[], at: number): number | null {
  let found: number | null = null;
  for (const f of frames) {
    if (f > at) break;
    found = f;
  }
  return found;
}

/**
 * What the player saw at the playhead: the scene's latest picture, with the game's own words drawn
 * back over it from the events. A 16:9 box from the first frame, whatever the player's screen was
 * (a phone's picture is pillarboxed inside it), so nothing moves when the pictures arrive.
 */
function ScreenView({
  id,
  frames,
  events,
  state,
  at,
  t,
}: {
  id: string;
  frames: number[];
  events: ReplayEvent[];
  state: ReturnType<typeof stateAt>;
  at: number;
  t: T;
}) {
  const [urls, setUrls] = useState<Map<number, string | 'failed'>>(new Map());
  const asked = useRef(new Set<number>());
  const current = frameAt(frames, at);

  // The picture at the playhead and the next few, each fetched once and kept for the session.
  useEffect(() => {
    if (current === null) return;
    const i = frames.indexOf(current);
    const want = frames.slice(i, i + 4).filter((f) => !asked.current.has(f));
    for (const f of want) {
      asked.current.add(f);
      adminReplayFrame(id, f)
        .then((blob) => setUrls((m) => new Map(m).set(f, URL.createObjectURL(blob))))
        .catch(() => setUrls((m) => new Map(m).set(f, 'failed')));
    }
  }, [current, frames, id]);
  const urlsRef = useRef(urls);
  urlsRef.current = urls;
  useEffect(
    () => () => {
      for (const u of urlsRef.current.values()) if (u !== 'failed') URL.revokeObjectURL(u);
    },
    [],
  );

  const url = current === null ? null : urls.get(current);
  const inGame = state.screen === 'game' || state.screen === 'ending';
  const next = events.find((e) => e.t > at && e.k === 'choice');
  const picks = typeof next?.label === 'string' ? next.label : null;
  const age = current === null ? null : at - current;

  return (
    <figure className="rpg-replay-screen-wrap">
      <figcaption className="acct-dim">
        <strong>{t.screenTitle}</strong> · {t.screenBlurb}
      </figcaption>
      <div className="rpg-replay-screen">
        {inGame && url && url !== 'failed' && <img src={url} alt="" />}
        <div className="rpg-replay-hud">
          <span>
            {state.beat ? `${t.stepOf(state.beat.n + 1)}: ${state.beat.title}` : t.onScreen(state.screen || '—')}
            {state.beat?.goal ? <small>{state.beat.goal}</small> : null}
          </span>
          <span className="rpg-replay-age">
            {!inGame ? '' : url === 'failed' ? t.frameFailed : age === null ? t.noFrame : age < 1000 ? t.frameNow : t.frameAge(delay(age))}
          </span>
        </div>
        {state.notice && (
          <div className="rpg-replay-notice">
            <strong>{state.notice.title}</strong> {state.notice.text}
          </div>
        )}
        {(state.waiting.length > 0 || state.stall) && (
          <div className="rpg-replay-wait">
            {state.stall ? `✖ ${state.stall}` : `⏳ ${state.waiting.map((w) => t.why[w] ?? w).join(', ')}…`}
          </div>
        )}
        {!inGame && !state.waiting.length && <div className="rpg-replay-wait">{t.onScreen(state.screen || '—')}</div>}
        {state.dialog && (
          <div className="rpg-replay-dialog">
            <p>
              <strong>{state.dialog.who}:</strong> {state.dialog.text}
            </p>
            {state.dialog.opts.length > 0 && (
              <ol>
                {state.dialog.opts.map((o, n) => (
                  <li key={n} className={o === picks ? 'rpg-replay-pick' : undefined}>
                    {o}
                    {o === picks ? ` ← ${t.willPick}` : ''}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </figure>
  );
}
