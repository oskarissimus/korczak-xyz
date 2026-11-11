/*
 * The providers' wallets beside the price list (owner, 10 Nov 2026): a key per provider that only
 * reads its balance or spend, with what scope to give it; a figure typed in by hand where no API
 * will say; and the drift between what the provider says was spent and what the request log priced
 * over the same window. The shapes and the arithmetic are `utils/rpg/wallets.ts`, the reads are the
 * gateway's `/admin/wallets` — the keys never come back to this page, only their last four characters.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { describeError, log } from '../../lib/logger';
import { adminWallets } from '../../utils/rpg/gateway';
import {
  driftRows,
  startOfUtcMonth,
  usdOfAmount,
  WALLET_KEY_PROVIDERS,
  WALLET_PROVIDERS,
  type WalletKeyProvider,
  type WalletKind,
  type WalletPatch,
  type WalletProvider,
  type WalletReading,
  type WalletsPage,
  type WalletUnit,
} from '../../utils/rpg/wallets';

type Lang = 'en' | 'pl';

const LABEL: Record<WalletProvider, string> = { google: 'Google (Gemini API)', openai: 'OpenAI', elevenlabs: 'ElevenLabs', fal: 'fal.ai' };
const LINK: Record<WalletProvider, string> = {
  openai: 'https://platform.openai.com/settings/organization/admin-keys',
  elevenlabs: 'https://elevenlabs.io/app/developers/api-keys',
  fal: 'https://fal.ai/dashboard/keys',
  google: 'https://console.cloud.google.com/billing/export',
};

const translations = {
  en: {
    title: 'Provider wallets',
    blurb:
      'What each provider itself says, against what the request log priced. A key here only reads — it is kept apart from the keys that spend, and never comes back to this page. Where no API will say, type the figure off the provider’s billing page. Drift is the provider’s figure minus the log’s: above zero, the log under-prices.',
    how: {
      openai:
        'An admin key: Settings → Organization → Admin keys → Create (organization owners only). A project key cannot read costs whatever its permissions. It reads what was spent this month (/v1/organization/costs). OpenAI has no API for the prepaid credit left — for that, type the balance off the billing page.',
      elevenlabs:
        'A separate key: Developers → API keys → Create, switch on “Restrict key” and give it User → Read only, everything else No access. It reads the credits left this billing period (/v1/user/subscription), and cannot spend any.',
      fal: 'A key with the ADMIN scope: Dashboard → Keys → Add key → scope ADMIN. The balance (/billing/user_balance) needs billing:usage:read, which an API-scope key does not have. fal has no read-only scope, so this key could also spend — it is kept here and used for nothing else.',
      google:
        'No API key can read it: the Gemini API is billed through Cloud Billing. The server reads the billing account’s export to BigQuery instead (dataset billing_export in korczak-rpg, already made). Switch the export on once: Billing → Billing export → BigQuery export → Standard usage cost → Edit settings → project korczak-rpg, dataset billing_export → Save (needs Billing Account Administrator). It fills from that moment, hours behind; until then, type the spend in by hand from Billing → Reports.',
    } as Record<WalletProvider, string>,
    keyLink: { openai: 'Admin keys', elevenlabs: 'API keys', fal: 'fal keys', google: 'Billing export' } as Record<WalletProvider, string>,
    set: 'set',
    noKey: 'no key',
    byHand: 'BigQuery export',
    save: 'Save keys',
    clear: 'Clear',
    clearConfirm: 'Remove this reading key?',
    saved: 'Saved.',
    check: 'Read the wallets now',
    checkBlurb: 'Asks every provider with a key, and Google’s billing export, once; each answer is kept as a reading.',
    checkResult: { ok: 'read', refused: 'refused', failed: 'failed', 'no-key': 'no key' } as Record<string, string>,
    last: 'Last reading',
    none: 'none yet',
    kindName: { balance: 'balance left', spent: 'spent' } as Record<WalletKind, string>,
    manualTitle: 'Type a figure in',
    provider: 'Provider',
    kind: 'What it is',
    kindOpt: { balance: 'balance left at that moment', spent: 'spent from a date to that moment' } as Record<WalletKind, string>,
    amount: 'Amount',
    unit: { usd: 'USD', credits: 'credits' } as Record<WalletUnit, string>,
    at: 'At',
    from: 'Spent from',
    note: 'Note (optional)',
    add: 'Add reading',
    driftTitle: 'Drift',
    driftBlurb:
      'One row per window: each “spent” reading on its own, and each pair of balance readings of one provider. Only the server’s own keys are estimated (diesel, demo, key test) — a player’s own key spends their wallet, not ours. Anything else on the same provider account is in the provider’s figure only.',
    noDrift: 'Nothing to compare yet: add a “spent” reading, or two balance readings of one provider.',
    col: { provider: 'Provider', window: 'Window', actual: 'Provider says', estimated: 'Log priced', drift: 'Drift' },
    topUp: 'balance went up — a top-up between the two readings, not comparable',
    beforeLogging: 'starts before the first logged request — the log is missing part of this window',
    unpriced: (n: number) => `${n} logged without a price`,
    calls: (n: number) => `${n} ${n === 1 ? 'request' : 'requests'}`,
    credits: (n: number) => `${n.toLocaleString('en-GB')} credits`,
    readingsTitle: 'Readings',
    source: { api: 'API', manual: 'by hand' } as Record<string, string>,
    remove: 'Remove',
    removeConfirm: 'Remove this reading?',
    loading: 'Reading…',
    failed: 'Could not read the wallets:',
  },
  pl: {
    title: 'Portfele u dostawców',
    blurb:
      'Co mówi sam dostawca, wobec tego, co wycenił log requestów. Klucz tutaj tylko czyta — trzymamy go osobno od kluczy, które wydają, i nigdy nie wraca na tę stronę. Gdzie żadne API nie powie, wpisz kwotę ze strony rozliczeń dostawcy. Drift to kwota dostawcy minus kwota z logu: powyżej zera log zaniża.',
    how: {
      openai:
        'Klucz admina: Settings → Organization → Admin keys → Create (tylko właściciel organizacji). Klucz projektu nie przeczyta kosztów, jakie by nie miał uprawnienia. Czyta, ile wydano w tym miesiącu (/v1/organization/costs). OpenAI nie ma API do pozostałego kredytu — ten wpisz ręcznie ze strony billing.',
      elevenlabs:
        'Osobny klucz: Developers → API keys → Create, włącz „Restrict key” i daj tylko User → Read, reszta No access. Czyta kredyty pozostałe w tym okresie (/v1/user/subscription) i nie może nic wydać.',
      fal: 'Klucz ze scope ADMIN: Dashboard → Keys → Add key → scope ADMIN. Saldo (/billing/user_balance) wymaga billing:usage:read, którego klucz ze scope API nie ma. fal nie ma scope tylko do odczytu, więc ten klucz mógłby też wydawać — trzymamy go tutaj i do niczego innego nie używamy.',
      google:
        'Żaden klucz API tego nie przeczyta: Gemini API rozlicza się przez Cloud Billing. Serwer czyta więc eksport konta rozliczeniowego do BigQuery (dataset billing_export w korczak-rpg, już założony). Włącz eksport raz: Billing → Billing export → BigQuery export → Standard usage cost → Edit settings → projekt korczak-rpg, dataset billing_export → Save (wymaga roli Billing Account Administrator). Dane płyną od tej chwili, z kilkugodzinnym opóźnieniem; do tego czasu wpisuj ręcznie z Billing → Reports.',
    } as Record<WalletProvider, string>,
    keyLink: { openai: 'Klucze admina', elevenlabs: 'Klucze API', fal: 'Klucze fal', google: 'Eksport billingu' } as Record<WalletProvider, string>,
    set: 'ustawiony',
    noKey: 'brak klucza',
    byHand: 'eksport do BigQuery',
    save: 'Zapisz klucze',
    clear: 'Usuń',
    clearConfirm: 'Usunąć ten klucz do odczytu?',
    saved: 'Zapisano.',
    check: 'Odczytaj portfele teraz',
    checkBlurb: 'Pyta raz każdego dostawcę, który ma klucz, oraz eksport billingu Google; każdą odpowiedź zapisuje jako odczyt.',
    checkResult: { ok: 'odczytano', refused: 'odmowa', failed: 'błąd', 'no-key': 'brak klucza' } as Record<string, string>,
    last: 'Ostatni odczyt',
    none: 'jeszcze brak',
    kindName: { balance: 'saldo', spent: 'wydano' } as Record<WalletKind, string>,
    manualTitle: 'Wpisz ręcznie',
    provider: 'Dostawca',
    kind: 'Co to jest',
    kindOpt: { balance: 'saldo w tej chwili', spent: 'wydano od daty do tej chwili' } as Record<WalletKind, string>,
    amount: 'Kwota',
    unit: { usd: 'USD', credits: 'kredyty' } as Record<WalletUnit, string>,
    at: 'Kiedy',
    from: 'Wydano od',
    note: 'Notatka (opcjonalnie)',
    add: 'Dodaj odczyt',
    driftTitle: 'Drift',
    driftBlurb:
      'Jeden wiersz na okno: każdy odczyt „wydano” osobno i każda para kolejnych odczytów salda jednego dostawcy. Szacujemy tylko klucze serwera (dizel, demo, test kluczy) — gracz na własnym kluczu wydaje ze swojego portfela, nie naszego. Wszystko inne na tym samym koncie dostawcy jest tylko w kwocie dostawcy.',
    noDrift: 'Nie ma jeszcze czego porównać: dodaj odczyt „wydano” albo dwa odczyty salda jednego dostawcy.',
    col: { provider: 'Dostawca', window: 'Okno', actual: 'Dostawca mówi', estimated: 'Log wycenił', drift: 'Drift' },
    topUp: 'saldo wzrosło — doładowanie między odczytami, nie do porównania',
    beforeLogging: 'zaczyna się przed pierwszym zalogowanym requestem — w logu brakuje części okna',
    unpriced: (n: number) => `${n} zalogowanych bez ceny`,
    calls: (n: number) => `${n} ${n === 1 ? 'request' : 'requestów'}`,
    credits: (n: number) => `${n.toLocaleString('pl-PL')} kredytów`,
    readingsTitle: 'Odczyty',
    source: { api: 'API', manual: 'ręcznie' } as Record<string, string>,
    remove: 'Usuń',
    removeConfirm: 'Usunąć ten odczyt?',
    loading: 'Czytam…',
    failed: 'Nie udało się odczytać portfeli:',
  },
};

type T = (typeof translations)['en'];

function usd(v: number): string {
  const sign = v < 0 ? '−' : '';
  const a = Math.abs(v);
  return `${sign}$${a.toFixed(a < 10 ? 4 : 2)}`;
}

/** `YYYY-MM-DDTHH:mm` in the viewer's zone, what a datetime-local input holds. */
function localInput(ms: number): string {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

function amountText(r: Pick<WalletReading, 'amount' | 'unit'>, t: T): string {
  return r.unit === 'credits' ? `${t.credits(r.amount)} (${usd(usdOfAmount(r.amount, 'credits'))})` : usd(r.amount);
}

export default function AdminWallets({ lang }: { lang: Lang }) {
  const t = translations[lang];
  const loc = lang === 'pl' ? 'pl-PL' : 'en-GB';
  const when = (ms: number) => new Date(ms).toLocaleString(loc, { dateStyle: 'short', timeStyle: 'short' });
  const [page, setPage] = useState<WalletsPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [drafts, setDrafts] = useState<Record<WalletKeyProvider, string>>({ openai: '', elevenlabs: '', fal: '' });
  const [form, setForm] = useState(() => ({
    provider: 'google' as WalletProvider,
    kind: 'spent' as WalletKind,
    unit: 'usd' as WalletUnit,
    amount: '',
    at: localInput(Date.now()),
    from: localInput(startOfUtcMonth(Date.now())),
    note: '',
  }));

  const run = useCallback(async (patch?: WalletPatch) => {
    setBusy(true);
    setError(null);
    try {
      setPage(await adminWallets(patch));
      return true;
    } catch (e) {
      log.warn('rpg.admin.wallets.failed', describeError(e));
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  const rows = useMemo(() => (page ? driftRows(page) : []), [page]);
  const changed = WALLET_KEY_PROVIDERS.filter((p) => drafts[p].trim());

  const saveKeys = async () => {
    const keys = Object.fromEntries(changed.map((p) => [p, drafts[p].trim()]));
    if (await run({ keys })) {
      setDrafts({ openai: '', elevenlabs: '', fal: '' });
      setSaved(true);
    }
  };

  const addReading = async () => {
    const amount = Number(form.amount.replace(',', '.'));
    const at = new Date(form.at).getTime();
    const from = form.kind === 'spent' ? new Date(form.from).getTime() : null;
    if (!Number.isFinite(amount) || !Number.isFinite(at)) return;
    const ok = await run({
      reading: { provider: form.provider, kind: form.kind, unit: form.provider === 'elevenlabs' ? form.unit : 'usd', amount, at, from, note: form.note || null },
    });
    if (ok) setForm({ ...form, amount: '', note: '' });
  };

  const latest = (p: WalletProvider) => page?.readings.find((r) => r.provider === p) ?? null;

  return (
    <section className="acct-section rpg-costs">
      <h2 className="acct-heading">{t.title}</h2>
      <p className="acct-dim">{t.blurb}</p>
      {error && (
        <p className="acct-warn">
          {t.failed} {error}
        </p>
      )}
      {!page && !error && <p className="acct-dim">{t.loading}</p>}
      {page &&
        WALLET_PROVIDERS.map((p) => {
          const keyed = (WALLET_KEY_PROVIDERS as readonly string[]).includes(p) ? (p as WalletKeyProvider) : null;
          const hint = keyed ? page.hints[keyed] : null;
          const last = latest(p);
          return (
            <section className="acct-card" key={p}>
              <header className="acct-card-head">
                <h3>{LABEL[p]}</h3>
                <span className={hint ? 'acct-chip acct-ok' : 'acct-chip'}>{!keyed ? t.byHand : hint ? `✓ ${t.set} ··${hint}` : t.noKey}</span>
              </header>
              <p className="acct-dim">
                {t.how[p]}{' '}
                <a href={LINK[p]} target="_blank" rel="noopener noreferrer">
                  {t.keyLink[p]}
                </a>
              </p>
              {keyed && (
                <div className="acct-field">
                  <div className="acct-field-row">
                    <input
                      type="password"
                      aria-label={`${LABEL[p]} — key`}
                      value={drafts[keyed]}
                      placeholder={hint ? `••••••••${hint}` : ''}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(e) => {
                        setSaved(false);
                        setDrafts({ ...drafts, [keyed]: e.target.value });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && changed.length > 0) void saveKeys();
                      }}
                    />
                    {hint && (
                      <button
                        type="button"
                        className="retro-btn"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm(t.clearConfirm)) void run({ keys: { [keyed]: null } });
                        }}
                      >
                        {t.clear}
                      </button>
                    )}
                  </div>
                </div>
              )}
              <p className="acct-dim">
                {t.last}: {last ? `${t.kindName[last.kind]} ${amountText(last, t)} · ${when(last.at)} · ${t.source[last.source]}` : t.none}
              </p>
            </section>
          );
        })}
      {page && (
        <>
          <p>
            <button type="button" className="retro-btn" disabled={busy || changed.length === 0} onClick={() => void saveKeys()}>
              {t.save}
            </button>{' '}
            <button type="button" className="retro-btn" disabled={busy} onClick={() => void run({ check: true })}>
              {t.check}
            </button>{' '}
            {saved && <span className="acct-dim">{t.saved}</span>}
          </p>
          <p className="acct-dim">{t.checkBlurb}</p>
          {page.checks && (
            <ul className="acct-card rpg-wallet-checks">
              {page.checks.map((c) => (
                <li key={c.provider} className={c.check === 'refused' || c.check === 'failed' ? 'acct-warn' : undefined}>
                  {LABEL[c.provider]}: {t.checkResult[c.check]}
                  {c.reason ? ` — ${c.reason}` : ''}
                </li>
              ))}
            </ul>
          )}

          <h3 className="acct-heading">{t.manualTitle}</h3>
          <div className="rpg-wallet-form">
            <label className="acct-field">
              <span>{t.provider}</span>
              <select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value as WalletProvider, unit: 'usd' })}>
                {WALLET_PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {LABEL[p]}
                  </option>
                ))}
              </select>
            </label>
            <label className="acct-field">
              <span>{t.kind}</span>
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as WalletKind })}>
                {(['spent', 'balance'] as const).map((k) => (
                  <option key={k} value={k}>
                    {t.kindOpt[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="acct-field">
              <span>{t.amount}</span>
              <span className="acct-field-row">
                <input inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                {form.provider === 'elevenlabs' ? (
                  <select aria-label={t.amount} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value as WalletUnit })}>
                    <option value="usd">{t.unit.usd}</option>
                    <option value="credits">{t.unit.credits}</option>
                  </select>
                ) : (
                  <span className="acct-prefix">USD</span>
                )}
              </span>
            </label>
            {form.kind === 'spent' && (
              <label className="acct-field">
                <span>{t.from}</span>
                <input type="datetime-local" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
              </label>
            )}
            <label className="acct-field">
              <span>{t.at}</span>
              <input type="datetime-local" value={form.at} onChange={(e) => setForm({ ...form, at: e.target.value })} />
            </label>
            <label className="acct-field">
              <span>{t.note}</span>
              <input value={form.note} maxLength={200} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </label>
          </div>
          <p>
            <button type="button" className="retro-btn" disabled={busy || !form.amount.trim()} onClick={() => void addReading()}>
              {t.add}
            </button>
          </p>

          <h3 className="acct-heading">{t.driftTitle}</h3>
          <p className="acct-dim">{t.driftBlurb}</p>
          {rows.length === 0 ? (
            <p className="acct-dim">{t.noDrift}</p>
          ) : (
            <div className="rpg-costs-scroll">
              <table className="rpg-costs-table">
                <thead>
                  <tr>
                    <th>{t.col.provider}</th>
                    <th>{t.col.window}</th>
                    <th>{t.col.actual}</th>
                    <th>{t.col.estimated}</th>
                    <th>{t.col.drift}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.readings.join('|')}>
                      <td>{LABEL[r.provider]}</td>
                      <td>
                        {when(r.from)} – {when(r.to)}
                      </td>
                      <td>
                        {r.actualUsd == null ? '—' : usd(r.actualUsd)}
                        {r.actualCredits != null && <span className="rpg-costs-typical">{t.credits(r.actualCredits)}</span>}
                      </td>
                      <td>
                        {usd(r.estimatedUsd)}
                        <span className="rpg-costs-typical">
                          {t.calls(r.calls)}
                          {r.unpriced > 0 ? ` · ${t.unpriced(r.unpriced)}` : ''}
                        </span>
                      </td>
                      <td className="rpg-costs-wrap">
                        {r.driftUsd == null ? (
                          '—'
                        ) : (
                          <strong>
                            {r.driftUsd > 0 ? '+' : ''}
                            {usd(r.driftUsd)}
                            {r.estimatedUsd > 0 ? ` (${r.driftUsd > 0 ? '+' : ''}${Math.round((r.driftUsd / r.estimatedUsd) * 100)}%)` : ''}
                          </strong>
                        )}
                        {r.topUp && <span className="rpg-costs-note">! {t.topUp}</span>}
                        {r.beforeLogging && !r.topUp && <span className="rpg-costs-note">! {t.beforeLogging}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {page.readings.length > 0 && (
            <>
              <h3 className="acct-heading">{t.readingsTitle}</h3>
              <div className="rpg-costs-scroll">
                <table className="rpg-costs-table">
                  <tbody>
                    {page.readings.map((r) => (
                      <tr key={r.id}>
                        <td>{when(r.at)}</td>
                        <td>{LABEL[r.provider]}</td>
                        <td>
                          {t.kindName[r.kind]}
                          {r.from != null ? ` ${lang === 'pl' ? 'od' : 'since'} ${when(r.from)}` : ''}
                        </td>
                        <td>{amountText(r, t)}</td>
                        <td>
                          {t.source[r.source]}
                          {r.note ? <span className="rpg-costs-typical">{r.note}</span> : null}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="retro-btn"
                            disabled={busy}
                            onClick={() => {
                              if (window.confirm(t.removeConfirm)) void run({ remove: r.id });
                            }}
                          >
                            {t.remove}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
