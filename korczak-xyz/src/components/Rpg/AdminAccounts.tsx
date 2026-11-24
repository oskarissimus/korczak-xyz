/*
 * The admin panel's accounts (owner, 24 Nov 2026: "a tab where I see how many accounts there are, the
 * list of e-mails and how much time was spent in the game over different ranges"). One answer from
 * the gateway's `/admin/accounts` (`functions/src/rpg/playtime.ts`): every account in Firebase Auth
 * with its tank and its time in the game, today / 7 days / 30 days / all (Warsaw days), and the totals.
 *
 * Nothing moves when it answers: the totals table has its rows and columns from the first frame with
 * "…" in every cell, and the list sits under everything else in the tab.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { describeError, log } from '../../lib/logger';
import { adminAccounts } from '../../utils/rpg/gateway';
import { WINDOWS, formatPlay, type AccountsPage, type PlayWindow } from '../../utils/rpg/playtime';

type Lang = 'en' | 'pl';
type PanelProps = {
  id: string;
  role: string;
  'aria-labelledby': string;
  hidden: boolean;
  className: string;
};

const translations = {
  en: {
    title: 'Accounts',
    blurb:
      'Every account that signed up, and the time spent in the game: seconds with the game on screen and somebody at it ' +
      '(an input in the last 5 minutes), counted by Warsaw day. Signed-in play only, counted from 24 Nov 2026.',
    reload: 'Refresh',
    loading: 'Reading…',
    failed: 'Could not read the accounts:',
    windows: {
      today: 'Today',
      d7: '7 days',
      d30: '30 days',
      all: 'All',
    } as Record<PlayWindow, string>,
    rows: {
      created: 'New',
      active: 'Played',
      seconds: 'Time',
      perPlayer: 'each',
    },
    allAccounts: (n: number) => `${n} in all`,
    listTitle: 'E-mails',
    filter: 'Filter by e-mail',
    copy: 'Copy e-mails',
    copied: (n: number) => `${n} copied.`,
    shown: (n: number, all: number) => (n === all ? `${all} accounts` : `${n} of ${all} accounts`),
    col: {
      email: 'E-mail',
      created: 'Signed up',
      last: 'Last played',
      diesel: 'Diesel',
    },
    noEmail: '(no e-mail)',
    admin: 'admin',
    disabled: 'disabled',
    truncated: 'More accounts than one answer lists — the oldest are left out.',
  },
  pl: {
    title: 'Konta',
    blurb:
      'Każde założone konto i czas spędzony w grze: sekundy z grą na ekranie i kimś przy niej (jakiś ruch w ostatnich ' +
      '5 minutach), liczone dniami czasu warszawskiego. Tylko gra zalogowana, liczona od 24 listopada 2026.',
    reload: 'Odśwież',
    loading: 'Czytam…',
    failed: 'Nie udało się odczytać kont:',
    windows: {
      today: 'Dziś',
      d7: '7 dni',
      d30: '30 dni',
      all: 'Całość',
    } as Record<PlayWindow, string>,
    rows: {
      created: 'Nowe',
      active: 'Grało',
      seconds: 'Czas',
      perPlayer: 'po',
    },
    allAccounts: (n: number) => `${n} łącznie`,
    listTitle: 'E-maile',
    filter: 'Filtruj po e-mailu',
    copy: 'Kopiuj e-maile',
    copied: (n: number) => `Skopiowano ${n}.`,
    shown: (n: number, all: number) => (n === all ? `${all} kont` : `${n} z ${all} kont`),
    col: {
      email: 'E-mail',
      created: 'Założone',
      last: 'Ostatnio grał(a)',
      diesel: 'Dizel',
    },
    noEmail: '(bez e-maila)',
    admin: 'admin',
    disabled: 'zablokowane',
    truncated: 'Kont jest więcej, niż mieści jedna odpowiedź — najstarsze pominięto.',
  },
};

export default function AdminAccounts({ lang, panel }: { lang: Lang; panel: PanelProps }) {
  const t = translations[lang];
  const locale = lang === 'pl' ? 'pl-PL' : 'en-GB';
  const [page, setPage] = useState<AccountsPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPage(await adminAccounts());
    } catch (e) {
      log.warn('rpg.admin.accounts.failed', describeError(e));
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = page?.accounts ?? [];
    return q ? all.filter((a) => (a.email ?? '').toLowerCase().includes(q)) : all;
  }, [page, query]);

  const date = (at: number | null) =>
    at === null
      ? '—'
      : new Date(at).toLocaleString(locale, {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
  const totals = page?.totals;
  const cell = (v: string | null) => v ?? '…';

  const copy = async () => {
    const emails = shown.map((a) => a.email).filter((e): e is string => Boolean(e));
    try {
      await navigator.clipboard.writeText(emails.join('\n'));
      setCopied(emails.length);
    } catch {
      setCopied(null);
    }
  };

  return (
    <div {...panel}>
      <section className="acct-section rpg-costs">
        <div className="acct-heading-row">
          <h2 className="acct-heading">{t.title}</h2>
          <button type="button" className="retro-btn" disabled={loading} onClick={() => void load()}>
            {t.reload}
          </button>
        </div>
        <p className="acct-dim">{t.blurb}</p>
        {error && (
          <p className="acct-warn">
            {t.failed} {error}
          </p>
        )}
        <div className="rpg-costs-scroll">
          <table className="rpg-costs-table rpg-accounts-totals">
            <thead>
              <tr>
                <th scope="col">
                  <span className="acct-dim">{totals ? t.allAccounts(totals.accounts) : '…'}</span>
                </th>
                <th scope="col" className="rpg-costs-num">
                  {t.rows.created}
                </th>
                <th scope="col" className="rpg-costs-num">
                  {t.rows.active}
                </th>
                <th scope="col" className="rpg-costs-num rpg-accounts-time">
                  {t.rows.seconds}
                </th>
              </tr>
            </thead>
            <tbody>
              {WINDOWS.map((w) => (
                <tr key={w}>
                  <th scope="row">{t.windows[w]}</th>
                  <td className="rpg-costs-num">{cell(totals ? String(totals.created[w]) : null)}</td>
                  <td className="rpg-costs-num">{cell(totals ? String(totals.active[w]) : null)}</td>
                  <td className="rpg-costs-num rpg-accounts-time">
                    {cell(totals ? formatPlay(totals.seconds[w]) : null)}
                    <span className="acct-dim rpg-accounts-per">
                      {totals
                        ? totals.active[w]
                          ? `${t.rows.perPlayer} ${formatPlay(totals.seconds[w] / totals.active[w])}`
                          : '\u00a0'
                        : '…'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="acct-section rpg-costs">
        <h2 className="acct-heading">{t.listTitle}</h2>
        <div className="acct-field rpg-accounts-controls">
          <div className="acct-field-row">
            <input
              type="search"
              aria-label={t.filter}
              placeholder={t.filter}
              value={query}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button type="button" className="retro-btn" disabled={!page || shown.length === 0} onClick={() => void copy()}>
              {t.copy}
            </button>
          </div>
        </div>
        <p className="acct-dim">
          {page ? t.shown(shown.length, page.accounts.length) : t.loading}
          {copied !== null ? ` · ${t.copied(copied)}` : ''}
        </p>
        {page?.truncated && <p className="acct-warn">! {t.truncated}</p>}
        {page && (
          <div className="rpg-costs-scroll" tabIndex={0} role="region" aria-label={t.listTitle}>
            <table className="rpg-costs-table rpg-accounts-list">
              <thead>
                <tr>
                  <th scope="col">{t.col.email}</th>
                  <th scope="col">{t.col.created}</th>
                  <th scope="col">{t.col.last}</th>
                  {WINDOWS.map((w) => (
                    <th key={w} scope="col" className="rpg-costs-num">
                      {t.windows[w]}
                    </th>
                  ))}
                  <th scope="col" className="rpg-costs-num">
                    {t.col.diesel}
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((a) => (
                  <tr key={a.uid}>
                    <td>
                      {a.email ?? <span className="acct-dim">{t.noEmail}</span>}
                      {a.admin && <span className="acct-dim"> · {t.admin}</span>}
                      {a.disabled && <span className="acct-warn"> · {t.disabled}</span>}
                    </td>
                    <td>{date(a.createdAt)}</td>
                    <td>{date(a.lastPlayedAt)}</td>
                    {WINDOWS.map((w) => (
                      <td key={w} className="rpg-costs-num">
                        {formatPlay(a.play[w])}
                      </td>
                    ))}
                    <td className="rpg-costs-num">
                      {a.balanceUsd === null ? '—' : `${Math.round(a.balanceUsd * 100).toLocaleString(locale)} L`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
