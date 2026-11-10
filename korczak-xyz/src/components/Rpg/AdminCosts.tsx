/*
 * The admin panel's costs (owner, 10 Nov 2026): a dashboard of what the paid requests cost over
 * time, broken down by account, world, quest, provider, model or payer; under it every request with
 * its price in dollars, litres and złoty and the arithmetic behind it, each openable down to what was
 * sent and what came back; and the price list — the provider's words verbatim beside what we charge
 * for a whole request and the diesel it costs.
 *
 * Everything comes from the request log (`utils/rpg/requestLog.ts`) through the gateway's
 * `/admin/requests` and `/admin/request`, which check `admins/{uid}`; the price list is
 * `utils/rpg/priceList.ts`, computed by the same functions that price a real request.
 *
 * Kept apart from `AdminPanel.tsx`, which only mounts it, so the panel's own sections and this one
 * can change without touching each other.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { describeError, log } from '../../lib/logger';
import { adminRequest, adminRequests } from '../../utils/rpg/gateway';
import { CHECKED, grossUsd, litresOf, priceRows, VAT_PL, type PriceRow } from '../../utils/rpg/priceList';
import {
  dailyCosts,
  groupCosts,
  groupKey,
  type CostDay,
  type GroupBy,
  type RequestBodies,
  type RequestLogEntry,
  type RequestsPage,
} from '../../utils/rpg/requestLog';
import AdminWallets from './AdminWallets';
import CostChart from './CostChart';

type Lang = 'en' | 'pl';

const RANGES = [1, 7, 30, 90] as const;
const GROUPS: GroupBy[] = ['provider', 'model', 'user', 'world', 'quest', 'payer'];
const PAGE = 100;

const translations = {
  en: {
    dashTitle: 'Costs',
    dashBlurb:
      'Every paid request to an outside API, from the request log: the server’s keys (diesel, the demo, the key test) and the game’s requests on a signed-in player’s own key. Prices are net list prices in US dollars; złoty at the NBP rate of the day each request was made.',
    range: (d: number) => (d === 1 ? '24 h' : `${d} days`),
    groupBy: 'Break down by',
    group: { provider: 'provider', model: 'model', user: 'account', world: 'world', quest: 'quest', payer: 'payer' } as Record<GroupBy, string>,
    total: 'Total',
    calls: (n: number) => `${n} ${n === 1 ? 'request' : 'requests'}`,
    callsHead: 'Requests',
    unpriced: (n: number) => `${n} without a price`,
    reload: 'Refresh',
    loading: 'Reading the log…',
    failed: 'Could not read the log:',
    empty: 'Nothing logged in this range yet. Requests are logged from this deploy on.',
    truncated: 'More requests than one answer carries — shorten the range for the whole picture.',
    chartLabel: 'Cost per day',
    chartHint: 'Point at a day for its cost.',
    selected: 'Showing only',
    clear: 'Show all',
    share: 'share',
    reqTitle: 'Requests',
    reqBlurb: 'Newest first. Open one for the arithmetic, and for what was sent and what came back.',
    more: 'Show more',
    col: { when: 'When', who: 'Account', what: 'Provider · model', status: 'Status', usage: 'Usage', usd: 'USD', litres: 'Diesel', pln: 'PLN' },
    source: { provider: 'provider said', usage: 'usage × price list', list: 'price list', none: 'no price' } as Record<string, string>,
    payer: { diesel: 'diesel', demo: 'demo', test: 'key test', account: 'own key' } as Record<string, string>,
    basis: 'How',
    reserved: 'Reserved first',
    rate: 'Rate',
    world: 'World',
    quest: 'Quest',
    took: 'Took',
    size: 'Sent / received',
    reused: 'Answered from the bucket — nothing paid.',
    bodies: 'Show request and response',
    hideBodies: 'Hide',
    noBodies: 'The bodies were not kept for this one.',
    requestHead: 'Request',
    responseHead: 'Response',
    pricesTitle: 'Price list',
    pricesBlurb: (d: string) =>
      `Every endpoint and model the game pays for. “Verbatim” is the provider’s page, copied on ${d}; “per request” is what the gateway charges for one typical request, worked out by the same code that prices a real one — where the two disagree, the code is what is billed. Net = as listed, without tax; gross adds ${Math.round(VAT_PL * 100)}% VAT.`,
    p: { model: 'Endpoint · model', verbatim: 'Verbatim', method: 'How we compute it', price: 'What we charge', typical: 'Typical request', net: 'Per request, net', gross: 'Gross', pln: 'PLN, gross', litres: 'Diesel (net)' },
    noPrice: 'no price',
    rateLine: (r: number, d: string) => `USD/PLN ${r.toFixed(4)} (NBP, ${d})`,
    noRate: 'No NBP rate yet.',
  },
  pl: {
    dashTitle: 'Koszty',
    dashBlurb:
      'Każdy płatny request do zewnętrznego API, z logu requestów: klucze serwera (dizel, demo, test kluczy) i requesty gry na własnym kluczu zalogowanego gracza. Ceny to ceny netto z cenników, w dolarach; złotówki po kursie NBP z dnia requestu.',
    range: (d: number) => (d === 1 ? '24 h' : `${d} dni`),
    groupBy: 'Rozbij na',
    group: { provider: 'dostawcę', model: 'model', user: 'konto', world: 'świat', quest: 'quest', payer: 'płatnika' } as Record<GroupBy, string>,
    total: 'Razem',
    calls: (n: number) => `${n} ${n === 1 ? 'request' : 'requestów'}`,
    callsHead: 'Requesty',
    unpriced: (n: number) => `${n} bez ceny`,
    reload: 'Odśwież',
    loading: 'Czytam log…',
    failed: 'Nie udało się przeczytać logu:',
    empty: 'W tym zakresie nic jeszcze nie zapisano. Requesty są logowane od tego wdrożenia.',
    truncated: 'Requestów jest więcej, niż mieści jedna odpowiedź — skróć zakres, żeby zobaczyć całość.',
    chartLabel: 'Koszt dziennie',
    chartHint: 'Wskaż dzień, żeby zobaczyć koszt.',
    selected: 'Tylko',
    clear: 'Pokaż wszystko',
    share: 'udział',
    reqTitle: 'Requesty',
    reqBlurb: 'Najnowsze na górze. Otwórz request, żeby zobaczyć rachunek oraz co poszło i co wróciło.',
    more: 'Pokaż więcej',
    col: { when: 'Kiedy', who: 'Konto', what: 'Dostawca · model', status: 'Status', usage: 'Zużycie', usd: 'USD', litres: 'Dizel', pln: 'PLN' },
    source: { provider: 'podał dostawca', usage: 'zużycie × cennik', list: 'cennik', none: 'brak ceny' } as Record<string, string>,
    payer: { diesel: 'dizel', demo: 'demo', test: 'test kluczy', account: 'własny klucz' } as Record<string, string>,
    basis: 'Jak',
    reserved: 'Zarezerwowano',
    rate: 'Kurs',
    world: 'Świat',
    quest: 'Quest',
    took: 'Trwało',
    size: 'Wysłano / odebrano',
    reused: 'Odpowiedź z bucketa — nic nie zapłacono.',
    bodies: 'Pokaż request i response',
    hideBodies: 'Ukryj',
    noBodies: 'Treści tego requestu nie zostały zapisane.',
    requestHead: 'Request',
    responseHead: 'Response',
    pricesTitle: 'Cennik',
    pricesBlurb: (d: string) =>
      `Każdy endpoint i model, za który gra płaci. „Verbatim” to strona dostawcy, skopiowana ${d}; „za request” to ile bramka liczy za jeden typowy request, tym samym kodem, który wycenia prawdziwe — gdy się różnią, rozliczany jest kod. Netto = jak w cenniku, bez podatku; brutto dolicza ${Math.round(VAT_PL * 100)}% VAT.`,
    p: { model: 'Endpoint · model', verbatim: 'Verbatim', method: 'Jak liczymy', price: 'Ile liczymy', typical: 'Typowy request', net: 'Za request, netto', gross: 'Brutto', pln: 'PLN, brutto', litres: 'Dizel (od netto)' },
    noPrice: 'brak ceny',
    rateLine: (r: number, d: string) => `USD/PLN ${r.toFixed(4)} (NBP, ${d})`,
    noRate: 'Brak kursu NBP.',
  },
};

type T = (typeof translations)['en'];

const locale = (lang: Lang) => (lang === 'pl' ? 'pl-PL' : 'en-GB');

function usdText(v: number | null): string {
  if (v === null) return '?';
  if (v === 0) return '$0';
  if (Math.abs(v) < 0.01) return `$${v.toFixed(5)}`;
  return `$${v.toFixed(v < 10 ? 4 : 2)}`;
}

function litresText(usd: number | null, lang: Lang): string {
  if (usd === null) return '?';
  const l = litresOf(usd);
  return `${l.toLocaleString(locale(lang), { maximumFractionDigits: l < 1 ? 3 : 1 })} L`;
}

function plnText(v: number | null, lang: Lang): string {
  if (v === null) return '—';
  return `${v.toLocaleString(locale(lang), { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 })} zł`;
}

function usageText(e: RequestLogEntry): string {
  const u = e.usage;
  if (!u) return '';
  const parts: string[] = [];
  if (u.input !== undefined) parts.push(`${u.input} in`);
  if (u.output !== undefined) parts.push(`${u.output + (u.thoughts ?? 0)} out`);
  if (u.chars !== undefined) parts.push(`${u.chars} chars`);
  if (u.credits !== undefined) parts.push(`${u.credits} cr`);
  if (u.seconds !== undefined) parts.push(`${u.seconds} s`);
  return parts.join(' · ');
}

export default function AdminCosts({ lang }: { lang: Lang }) {
  const t = translations[lang];
  const [days, setDays] = useState<(typeof RANGES)[number]>(7);
  const [by, setBy] = useState<GroupBy>('provider');
  const [picked, setPicked] = useState<string | null>(null);
  const [page, setPage] = useState<RequestsPage | null>(null);
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const to = Date.now();
    const from = to - days * 86_400_000;
    setLoading(true);
    setError(null);
    try {
      setPage(await adminRequests(from, to));
      setRange({ from, to });
    } catch (e) {
      log.warn('rpg.admin.costs.failed', describeError(e));
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => setPicked(null), [by]);

  const rate = page?.fx?.usdPln ?? null;
  const name = useCallback(
    (key: string) => {
      if (by === 'user') return page?.users[key] ?? key;
      if (by === 'payer') return t.payer[key] ?? key;
      return key;
    },
    [by, page, t],
  );

  return (
    <>
      <section className="acct-section rpg-costs">
        <div className="acct-heading-row">
          <h2 className="acct-heading">{t.dashTitle}</h2>
          <button type="button" className="retro-btn" disabled={loading} onClick={() => void load()}>
            {t.reload}
          </button>
        </div>
        <p className="acct-dim">{t.dashBlurb}</p>
        <div className="rpg-costs-controls">
          <div className="rpg-costs-toggle" role="group">
            {RANGES.map((d) => (
              <button key={d} type="button" className="retro-btn" aria-pressed={days === d} onClick={() => setDays(d)}>
                {t.range(d)}
              </button>
            ))}
          </div>
          <label className="acct-field rpg-costs-by">
            <span className="acct-dim">{t.groupBy}</span>
            <select value={by} onChange={(e) => setBy(e.target.value as GroupBy)}>
              {GROUPS.map((g) => (
                <option key={g} value={g}>
                  {t.group[g]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && (
          <p className="acct-warn">
            {t.failed} {error}
          </p>
        )}
        {!page && !error && <p className="acct-dim">{t.loading}</p>}
        {page && range && <Dashboard page={page} range={range} by={by} picked={picked} setPicked={setPicked} name={name} t={t} lang={lang} />}
      </section>
      {page && <RequestList page={page} by={by} picked={picked} t={t} lang={lang} />}
      <PriceList rate={rate} fxDate={page?.fx?.date ?? null} t={t} lang={lang} />
      <AdminWallets lang={lang} />
    </>
  );
}

function Dashboard({
  page,
  range,
  by,
  picked,
  setPicked,
  name,
  t,
  lang,
}: {
  page: RequestsPage;
  range: { from: number; to: number };
  by: GroupBy;
  picked: string | null;
  setPicked: (k: string | null) => void;
  name: (k: string) => string;
  t: T;
  lang: Lang;
}) {
  const rate = page.fx?.usdPln ?? null;
  const groups = useMemo(() => groupCosts(page.entries, by, rate), [page, by, rate]);
  const total = useMemo(() => dailyCosts(page.entries, range.from, range.to), [page, range]);
  const part = useMemo(
    () => (picked === null ? null : dailyCosts(page.entries.filter((e) => groupKey(e, by) === picked), range.from, range.to)),
    [page, by, picked, range],
  );
  const sum = groups.reduce((a, g) => ({ usd: a.usd + g.usd, pln: a.pln + g.pln, calls: a.calls + g.calls, unpriced: a.unpriced + g.unpriced }), {
    usd: 0,
    pln: 0,
    calls: 0,
    unpriced: 0,
  });
  const describe = (d: CostDay, whole: CostDay, r: number | null) =>
    `${d.day} · ${usdText(d.usd)} · ${litresText(d.usd, lang)} · ${plnText(r === null ? null : d.usd * r, lang)} · ${t.calls(d.calls)}` +
    (picked !== null ? ` (${t.total.toLowerCase()} ${usdText(whole.usd)})` : '');

  if (page.entries.length === 0) return <p className="acct-dim">{t.empty}</p>;
  return (
    <>
      <p className="rpg-costs-total">
        <strong>
          {t.total}: {usdText(sum.usd)} · {litresText(sum.usd, lang)} · {plnText(sum.pln, lang)}
        </strong>{' '}
        <span className="acct-dim">
          · {t.calls(sum.calls)}
          {sum.unpriced > 0 ? ` · ${t.unpriced(sum.unpriced)}` : ''}
        </span>
      </p>
      {page.fx ? <p className="acct-dim">{t.rateLine(page.fx.usdPln, page.fx.date)}</p> : <p className="acct-dim">{t.noRate}</p>}
      {page.truncated && <p className="acct-warn">! {t.truncated}</p>}
      <CostChart total={total} part={part} rate={rate} ariaLabel={t.chartLabel} hint={t.chartHint} describe={describe} lang={lang} />
      {picked !== null && (
        <p>
          {t.selected}: <strong>{name(picked)}</strong>{' '}
          <button type="button" className="retro-btn" onClick={() => setPicked(null)}>
            {t.clear}
          </button>
        </p>
      )}
      <div className="rpg-costs-scroll">
        <table className="rpg-costs-table">
          <thead>
            <tr>
              <th>{t.group[by]}</th>
              <th>{t.col.usd}</th>
              <th>{t.col.litres}</th>
              <th>{t.col.pln}</th>
              <th>{t.callsHead}</th>
              <th>{t.share}</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const share = sum.usd > 0 ? g.usd / sum.usd : 0;
              return (
                <tr key={g.key} className={picked === g.key ? 'rpg-costs-picked' : undefined}>
                  <td>
                    <button type="button" className="rpg-costs-link" aria-pressed={picked === g.key} onClick={() => setPicked(picked === g.key ? null : g.key)}>
                      {picked === g.key ? '▶ ' : ''}
                      {name(g.key)}
                    </button>
                  </td>
                  <td>{usdText(g.usd)}</td>
                  <td>{litresText(g.usd, lang)}</td>
                  <td>{plnText(g.pln, lang)}</td>
                  <td>
                    {g.calls}
                    {g.unpriced ? ` (${g.unpriced} ?)` : ''}
                  </td>
                  <td>
                    <span className="rpg-costs-share" style={{ width: `${Math.round(share * 60)}px` }} aria-hidden="true" /> {Math.round(share * 100)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function RequestList({ page, by, picked, t, lang }: { page: RequestsPage; by: GroupBy; picked: string | null; t: T; lang: Lang }) {
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo(() => (picked === null ? page.entries : page.entries.filter((e) => groupKey(e, by) === picked)), [page, by, picked]);
  useEffect(() => setLimit(PAGE), [page, picked]);
  const rate = page.fx?.usdPln ?? null;
  const who = (e: RequestLogEntry) => (e.uid ? (page.users[e.uid] ?? e.uid) : e.ip ? `demo ${e.ip.slice(0, 8)}` : '—');

  return (
    <section className="acct-section rpg-costs">
      <h2 className="acct-heading">{t.reqTitle}</h2>
      <p className="acct-dim">{t.reqBlurb}</p>
      <div className="rpg-costs-scroll">
        <table className="rpg-costs-table rpg-costs-requests">
          <thead>
            <tr>
              <th>{t.col.when}</th>
              <th>{t.col.who}</th>
              <th>{t.col.what}</th>
              <th>{t.col.status}</th>
              <th>{t.col.usage}</th>
              <th>{t.col.usd}</th>
              <th>{t.col.litres}</th>
              <th>{t.col.pln}</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((e) => (
              <RequestRow key={e.id} e={e} who={who(e)} open={open === e.id} toggle={() => setOpen(open === e.id ? null : e.id)} rate={rate} t={t} lang={lang} />
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <p>
          <button type="button" className="retro-btn" onClick={() => setLimit(limit + PAGE)}>
            {t.more} ({rows.length - limit})
          </button>
        </p>
      )}
    </section>
  );
}

function RequestRow({ e, who, open, toggle, rate, t, lang }: { e: RequestLogEntry; who: string; open: boolean; toggle: () => void; rate: number | null; t: T; lang: Lang }) {
  const [bodies, setBodies] = useState<RequestBodies | null | 'loading' | 'none'>(null);
  const [error, setError] = useState<string | null>(null);
  const when = new Date(e.at).toLocaleString(locale(lang), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const ownRate = e.usdPln ?? rate;
  const fetchBodies = async () => {
    if (bodies && bodies !== 'loading') {
      setBodies(null);
      return;
    }
    setBodies('loading');
    setError(null);
    try {
      const r = await adminRequest(e.id);
      setBodies(r.bodies ?? 'none');
    } catch (err) {
      setBodies(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <>
      <tr className={open ? 'rpg-costs-picked' : undefined}>
        <td>
          <button type="button" className="rpg-costs-link" aria-expanded={open} onClick={toggle}>
            {open ? '▼' : '▶'} {when}
          </button>
        </td>
        <td className="rpg-costs-wrap">
          {who}
          <br />
          <span className="acct-dim">{t.payer[e.payer] ?? e.payer}</span>
        </td>
        <td className="rpg-costs-wrap">
          {e.provider} · {e.model}
        </td>
        <td>{e.status >= 400 ? `! ${e.status}` : e.status}</td>
        <td className="rpg-costs-wrap">{usageText(e)}</td>
        <td>
          {usdText(e.usd)}
          <br />
          <span className="acct-dim">{t.source[e.source] ?? e.source}</span>
        </td>
        <td>{litresText(e.usd, lang)}</td>
        <td>{plnText(e.usd !== null && ownRate !== null ? e.usd * ownRate : null, lang)}</td>
      </tr>
      {open && (
        <tr className="rpg-costs-detail">
          <td colSpan={8}>
            <dl className="acct-numbers">
              <dt>{t.basis}</dt>
              <dd>
                {e.basis} = <strong>{usdText(e.usd)}</strong>
              </dd>
              {e.reused && (
                <>
                  <dt />
                  <dd>{t.reused}</dd>
                </>
              )}
              {e.reservedUsd !== undefined && (
                <>
                  <dt>{t.reserved}</dt>
                  <dd>
                    {usdText(e.reservedUsd)} · {litresText(e.reservedUsd, lang)}
                  </dd>
                </>
              )}
              <dt>{t.rate}</dt>
              <dd>{e.usdPln !== null ? t.rateLine(e.usdPln, e.fxDate ?? '?') : rate !== null ? `${t.rateLine(rate, '—')} *` : t.noRate}</dd>
              <dt>Endpoint</dt>
              <dd>
                {e.method} {e.host}
                {e.path}
              </dd>
              {e.world && (
                <>
                  <dt>{t.world}</dt>
                  <dd>{e.world}</dd>
                </>
              )}
              {e.quest && (
                <>
                  <dt>{t.quest}</dt>
                  <dd>{e.quest}</dd>
                </>
              )}
              <dt>{t.took}</dt>
              <dd>{(e.ms / 1000).toFixed(1)} s</dd>
              <dt>{t.size}</dt>
              <dd>
                {e.requestBytes.toLocaleString(locale(lang))} B / {e.responseBytes.toLocaleString(locale(lang))} B{e.contentType ? ` · ${e.contentType}` : ''}
              </dd>
              <dt>id</dt>
              <dd>{e.id}</dd>
            </dl>
            {e.bodies && (
              <p>
                <button type="button" className="retro-btn" disabled={bodies === 'loading'} onClick={() => void fetchBodies()}>
                  {bodies && bodies !== 'loading' ? t.hideBodies : t.bodies}
                </button>
              </p>
            )}
            {!e.bodies && !e.reused && <p className="acct-dim">{t.noBodies}</p>}
            {error && <p className="acct-warn">! {error}</p>}
            {bodies === 'none' && <p className="acct-dim">{t.noBodies}</p>}
            {bodies && typeof bodies === 'object' && (
              <div className="rpg-costs-bodies">
                <h4>{t.requestHead}</h4>
                <pre>{JSON.stringify(bodies.request, null, 2)}</pre>
                <h4>{t.responseHead}</h4>
                <pre>{JSON.stringify({ status: bodies.response.status, headers: bodies.response.headers }, null, 2)}</pre>
                <pre>{typeof bodies.response.body === 'string' ? bodies.response.body : JSON.stringify(bodies.response.body, null, 2)}</pre>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function PriceList({ rate, fxDate, t, lang }: { rate: number | null; fxDate: string | null; t: T; lang: Lang }) {
  const rows = useMemo(() => priceRows(), []);
  const providers: PriceRow['provider'][] = ['google', 'openai', 'elevenlabs', 'fal'];
  const label = { google: 'Google (Gemini API)', openai: 'OpenAI', elevenlabs: 'ElevenLabs', fal: 'fal.ai' };
  return (
    <section className="acct-section rpg-costs">
      <h2 className="acct-heading">{t.pricesTitle}</h2>
      <p className="acct-dim">{t.pricesBlurb(CHECKED)}</p>
      <p className="acct-dim">{rate !== null && fxDate ? t.rateLine(rate, fxDate) : t.noRate}</p>
      {providers.map((p) => (
        <div key={p} className="rpg-costs-scroll">
          <h3 className="rpg-costs-provider">{label[p]}</h3>
          <table className="rpg-costs-table rpg-costs-prices">
            <thead>
              <tr>
                <th>{t.p.model}</th>
                <th>{t.p.verbatim}</th>
                <th>{t.p.method}</th>
                <th>{t.p.price}</th>
              </tr>
            </thead>
            <tbody>
              {rows
                .filter((r) => r.provider === p)
                .map((r) => (
                  <tr key={`${r.endpoint} ${r.model}`}>
                    <td className="rpg-costs-wrap">
                      <strong>{r.model}</strong>
                      <br />
                      <span className="acct-dim">{r.endpoint}</span>
                    </td>
                    <td className="rpg-costs-wrap rpg-costs-verbatim">
                      {r.verbatim.map((v) => (
                        <q key={v}>{v}</q>
                      ))}
                      <a href={r.source} target="_blank" rel="noopener noreferrer">
                        {new URL(r.source).host}
                      </a>
                    </td>
                    <td className="rpg-costs-wrap">
                      {r.method}
                      <span className="rpg-costs-typical">
                        {t.p.typical}: {r.typical[lang]}
                      </span>
                      {r.note && <span className="rpg-costs-note">! {r.note[lang]}</span>}
                    </td>
                    <td>
                      {r.usd === null ? (
                        t.noPrice
                      ) : (
                        <dl className="rpg-costs-price">
                          <dt>{t.p.net}</dt>
                          <dd>
                            <strong>{usdText(r.usd)}</strong>
                          </dd>
                          <dt>{t.p.gross}</dt>
                          <dd>{usdText(grossUsd(r.usd))}</dd>
                          <dt>{t.p.pln}</dt>
                          <dd>{rate === null ? '—' : plnText(grossUsd(r.usd) * rate, lang)}</dd>
                          <dt>{t.p.litres}</dt>
                          <dd>
                            <strong>{litresText(r.usd, lang)}</strong>
                          </dd>
                        </dl>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
