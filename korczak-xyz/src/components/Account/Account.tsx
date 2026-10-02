/*
 * The account page: every API key the apps spend, what has gone on each and what is left, and
 * which provider each app is set to.
 *
 * The keys are the shared store (`useAccountKeys`), the same copy every app's own key fields edit,
 * so a key typed here is in sloper, the backseat driver and the audio guide at once, and clearing
 * it here clears it everywhere. The numbers come straight from each provider with that key —
 * `utils/accountKeys/balance.ts` says which provider tells what, and where one tells nothing the
 * page says so rather than showing a number it does not have.
 *
 * The provider choices stay in the apps, where the models that go with them are listed — this page
 * shows them and links there. The audio guide's one choice lives in the shared store, so it is
 * editable here too.
 */

import { useCallback, useEffect, useId, useState, type ComponentType } from 'react';

import { useAccountKeys, type AccountKeysApi } from '../../hooks/useAccountKeys';
import { useAuth } from '../../hooks/useAuth';
import { describeError, log } from '../../lib/logger';
import {
  checkGoogle,
  checkOpenAi,
  readDeepSeek,
  readElevenLabs,
  readOpenAiCosts,
  spentSince,
  startOfUtcMonth,
  type CostDay,
  type DeepSeekBalance,
  type ElevenLabsUsage,
  type Reading,
} from '../../utils/accountKeys/balance';
import type { KeyName } from '../../utils/accountKeys/keys';
import { requiredKeys as backseatKeys } from '../../utils/backseat/defaults';
import { pullConfig as pullBackseat } from '../../utils/backseat/cloud';
import { loadConfig as loadBackseat } from '../../utils/backseat/storage';
import type { BackseatConfig } from '../../utils/backseat/types';
import { requiredKeys as sloperKeys } from '../../utils/sloper/defaults';
import { pullConfig as pullSloper } from '../../utils/sloper/cloud';
import { loadConfig as loadSloper } from '../../utils/sloper/storage';
import type { SloperConfig } from '../../utils/sloper/types';
import { translations, type Lang, type Translation } from './translations';

interface AccountProps {
  lang: Lang;
}

type Provider = 'openai' | 'google' | 'elevenLabs' | 'deepseek';

const PROVIDERS: Provider[] = ['google', 'elevenLabs', 'openai', 'deepseek'];

const PLACEHOLDER: Record<KeyName, string> = {
  openai: 'sk-…',
  google: 'AIza…',
  elevenLabs: 'sk_…',
  deepseek: 'sk-…',
  openaiAdmin: 'sk-admin-…',
};

function appPath(lang: Lang, app: string): string {
  return `${lang === 'pl' ? '/pl' : ''}/apps/${app}/`;
}

function usd(amount: number, lang: Lang): string {
  return amount.toLocaleString(lang === 'pl' ? 'pl-PL' : 'en-GB', {
    style: 'currency',
    currency: 'USD',
  });
}

function money(amount: number, currency: string, lang: Lang): string {
  try {
    return amount.toLocaleString(lang === 'pl' ? 'pl-PL' : 'en-GB', { style: 'currency', currency });
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function count(n: number, lang: Lang): string {
  return n.toLocaleString(lang === 'pl' ? 'pl-PL' : 'en-GB');
}

function day(ms: number, lang: Lang): string {
  return new Date(ms).toLocaleDateString(lang === 'pl' ? 'pl-PL' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// --- Fields -----------------------------------------------------------------------------------

interface KeyFieldProps {
  label: string;
  value: string | null;
  placeholder: string;
  onCommit: (value: string | null) => void;
  t: Translation;
}

/** Masked, a Show toggle, commits on blur and Enter — each commit is a Firestore write. */
function KeyField({ label, value, placeholder, onCommit, t }: KeyFieldProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const [draft, setDraft] = useState(value ?? '');

  useEffect(() => setDraft(value ?? ''), [value]);

  const commit = () => {
    const next = draft.trim() || null;
    if (next !== value) onCommit(next);
  };

  return (
    <div className="acct-field">
      <label htmlFor={id}>{label}</label>
      <div className="acct-field-row">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={draft}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        <button type="button" className="retro-btn" onClick={() => setVisible(!visible)}>
          {visible ? t.hide : t.show}
        </button>
        {value && (
          <button
            type="button"
            className="retro-btn"
            onClick={() => {
              if (window.confirm(t.clearConfirm)) onCommit(null);
            }}
          >
            {t.clear}
          </button>
        )}
      </div>
    </div>
  );
}

/** The OpenAI credit as read off the billing page. Typed in because no API reads it. */
function CreditField({ api, t, lang }: { api: AccountKeysApi; t: Translation; lang: Lang }) {
  const id = useId();
  const credit = api.value.openaiCredit;
  const [draft, setDraft] = useState(credit ? String(credit.amount) : '');

  useEffect(() => setDraft(credit ? String(credit.amount) : ''), [credit]);

  const commit = () => {
    const text = draft.trim().replace(',', '.').replace(/^\$/, '');
    if (text === '') {
      if (credit) api.update({ openaiCredit: null });
      return;
    }
    const amount = Number(text);
    if (!Number.isFinite(amount) || amount < 0) {
      setDraft(credit ? String(credit.amount) : '');
      return;
    }
    if (amount !== credit?.amount) api.update({ openaiCredit: { amount, at: Date.now() } });
  };

  return (
    <div className="acct-field">
      <label htmlFor={id}>
        {t.creditLabel}
        {credit && <span className="acct-dim"> · {t.creditAsOf} {day(credit.at, lang)}</span>}
      </label>
      <div className="acct-field-row">
        <span className="acct-prefix">$</span>
        <input
          id={id}
          inputMode="decimal"
          value={draft}
          placeholder="0.00"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      </div>
    </div>
  );
}

// --- Readings ---------------------------------------------------------------------------------

type Loadable<T> = { state: 'idle' } | { state: 'loading' } | ({ state: 'done' } & Reading<T>);

/** Runs `read` whenever `key` changes, and again on `refresh`. Nothing at all without a key. */
function useReading<T>(
  key: string | null,
  read: (key: string, signal: AbortSignal) => Promise<Reading<T>>,
  refresh: number,
): Loadable<T> {
  const [result, setResult] = useState<Loadable<T>>({ state: 'idle' });

  useEffect(() => {
    if (!key) {
      setResult({ state: 'idle' });
      return;
    }
    const controller = new AbortController();
    setResult({ state: 'loading' });
    read(key, controller.signal)
      .then((reading) => {
        if (!controller.signal.aborted) setResult({ state: 'done', ...reading });
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        log.warn('account.reading.failed', describeError(e));
        setResult({ state: 'done', check: 'failed', reason: null });
      });
    return () => controller.abort();
    // `read` is a module function or a stable callback; the key is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refresh]);

  return result;
}

function Status<T>({ reading, t }: { reading: Loadable<T>; t: Translation }) {
  if (reading.state === 'idle') return <span className="acct-chip">{t.noKey}</span>;
  if (reading.state === 'loading') return <span className="acct-chip">{t.checking}</span>;
  if (reading.check === 'ok') return <span className="acct-chip acct-ok">✓ {t.works}</span>;
  return (
    <span className="acct-chip acct-warn">
      ! {reading.check === 'refused' ? t.refused : t.unreachable}
    </span>
  );
}

function Reason<T>({ reading }: { reading: Loadable<T> }) {
  if (reading.state !== 'done' || reading.check === 'ok' || !reading.reason) return null;
  return <p className="acct-dim acct-reason">{reading.reason}</p>;
}

// --- Provider cards ---------------------------------------------------------------------------

interface CardProps {
  api: AccountKeysApi;
  usedBy: string[];
  refresh: number;
  t: Translation;
  lang: Lang;
}

function UsedBy({ usedBy, t }: { usedBy: string[]; t: Translation }) {
  return (
    <p className="acct-dim">
      {t.usedBy}: {usedBy.length > 0 ? usedBy.join(', ') : t.usedByNone}
    </p>
  );
}

function GoogleCard({ api, usedBy, refresh, t }: CardProps) {
  const reading = useReading(api.keys.google, checkGoogle, refresh);
  return (
    <section className="acct-card">
      <header className="acct-card-head">
        <h3>Google AI Studio</h3>
        <Status reading={reading} t={t} />
      </header>
      <UsedBy usedBy={usedBy} t={t} />
      <KeyField
        label={t.key}
        value={api.keys.google}
        placeholder={PLACEHOLDER.google}
        onCommit={(v) => api.setKey('google', v)}
        t={t}
      />
      <Reason reading={reading} />
      <dl className="acct-numbers">
        <dt>{t.spent}</dt>
        <dd>{t.googleNoApi}</dd>
        <dt>{t.left}</dt>
        <dd>{t.googleFreeTier}</dd>
      </dl>
      <p className="acct-dim">
        <a href="https://aistudio.google.com/usage" target="_blank" rel="noopener">
          {t.googleUsageLink}
        </a>
      </p>
    </section>
  );
}

function ElevenLabsCard({ api, usedBy, refresh, t, lang }: CardProps) {
  const reading = useReading<ElevenLabsUsage>(api.keys.elevenLabs, readElevenLabs, refresh);
  const usage = reading.state === 'done' && reading.check === 'ok' ? reading.data : null;
  return (
    <section className="acct-card">
      <header className="acct-card-head">
        <h3>ElevenLabs</h3>
        <Status reading={reading} t={t} />
      </header>
      <UsedBy usedBy={usedBy} t={t} />
      <KeyField
        label={t.key}
        value={api.keys.elevenLabs}
        placeholder={PLACEHOLDER.elevenLabs}
        onCommit={(v) => api.setKey('elevenLabs', v)}
        t={t}
      />
      <Reason reading={reading} />
      {reading.state === 'done' && reading.check === 'refused' && (
        <p className="acct-dim">{t.elevenLabsPermission}</p>
      )}
      {usage && (
        <dl className="acct-numbers">
          <dt>{t.spent}</dt>
          <dd>
            {count(usage.used, lang)} {t.chars} · {t.plan} {usage.tier}
          </dd>
          <dt>{t.left}</dt>
          <dd>
            <strong>
              {count(Math.max(0, usage.limit - usage.used), lang)} {t.chars}
            </strong>{' '}
            {t.of} {count(usage.limit, lang)}
            {usage.resetAt && (
              <span className="acct-dim">
                {' '}
                · {t.resets} {day(usage.resetAt, lang)}
              </span>
            )}
          </dd>
        </dl>
      )}
    </section>
  );
}

function DeepSeekCard({ api, usedBy, refresh, t, lang }: CardProps) {
  const reading = useReading<DeepSeekBalance>(api.keys.deepseek, readDeepSeek, refresh);
  const balance = reading.state === 'done' && reading.check === 'ok' ? reading.data : null;
  return (
    <section className="acct-card">
      <header className="acct-card-head">
        <h3>DeepSeek</h3>
        <Status reading={reading} t={t} />
      </header>
      <UsedBy usedBy={usedBy} t={t} />
      <KeyField
        label={t.key}
        value={api.keys.deepseek}
        placeholder={PLACEHOLDER.deepseek}
        onCommit={(v) => api.setKey('deepseek', v)}
        t={t}
      />
      <Reason reading={reading} />
      {balance && (
        <dl className="acct-numbers">
          <dt>{t.spent}</dt>
          <dd>
            {t.deepseekNoSpend}{' '}
            <a href="https://platform.deepseek.com/usage" target="_blank" rel="noopener">
              platform.deepseek.com
            </a>
          </dd>
          <dt>{t.left}</dt>
          <dd>
            {balance.balances.length === 0
              ? '—'
              : balance.balances.map((b) => (
                  <span key={b.currency} className="acct-line">
                    <strong>{money(b.total, b.currency, lang)}</strong>
                    {b.granted > 0 && (
                      <span className="acct-dim">
                        {' '}
                        ({t.deepseekGranted} {money(b.granted, b.currency, lang)})
                      </span>
                    )}
                  </span>
                ))}
            {!balance.available && <span className="acct-line acct-warn">! {t.deepseekEmpty}</span>}
          </dd>
        </dl>
      )}
    </section>
  );
}

function OpenAiCard({ api, usedBy, refresh, t, lang }: CardProps) {
  const keyReading = useReading(api.keys.openai, checkOpenAi, refresh);
  const credit = api.value.openaiCredit;
  const now = Date.now();
  const from = Math.min(startOfUtcMonth(now), credit?.at ?? now);
  const readCosts = useCallback(
    (key: string, signal: AbortSignal) => readOpenAiCosts(key, from, signal),
    [from],
  );
  // `from` moves only with the credit's date, which is what should re-read the costs.
  const costs = useReading<CostDay[]>(api.keys.openaiAdmin, readCosts, refresh + (credit?.at ?? 0));
  const days = costs.state === 'done' && costs.check === 'ok' ? costs.data : null;

  const month = days ? spentSince(days, startOfUtcMonth(now)) : null;
  const sinceCredit = days && credit ? spentSince(days, credit.at) : null;

  return (
    <section className="acct-card">
      <header className="acct-card-head">
        <h3>OpenAI</h3>
        <Status reading={keyReading} t={t} />
      </header>
      <UsedBy usedBy={usedBy} t={t} />
      <KeyField
        label={t.key}
        value={api.keys.openai}
        placeholder={PLACEHOLDER.openai}
        onCommit={(v) => api.setKey('openai', v)}
        t={t}
      />
      <Reason reading={keyReading} />

      <dl className="acct-numbers">
        <dt>{t.spentMonth}</dt>
        <dd>
          {month !== null ? (
            <strong>{usd(month, lang)}</strong>
          ) : costs.state === 'loading' ? (
            t.checking
          ) : costs.state === 'done' ? (
            <span className="acct-warn">! {t.adminRefused}</span>
          ) : (
            t.openaiNeedsAdmin
          )}
        </dd>
        <dt>{t.left}</dt>
        <dd>
          {credit && sinceCredit !== null ? (
            <>
              <strong>≈ {usd(Math.max(0, credit.amount - sinceCredit), lang)}</strong>{' '}
              <span className="acct-dim">
                ({usd(credit.amount, lang)} {t.creditAsOf} {day(credit.at, lang)} −{' '}
                {usd(sinceCredit, lang)} {t.spentSince})
              </span>
            </>
          ) : credit ? (
            <>
              <strong>{usd(credit.amount, lang)}</strong>{' '}
              <span className="acct-dim">
                ({t.creditAsOf} {day(credit.at, lang)} · {t.creditNoSubtract})
              </span>
            </>
          ) : (
            t.openaiNoBalanceApi
          )}
        </dd>
      </dl>
      <Reason reading={costs} />

      <details className="acct-details">
        <summary>{t.openaiBillingTitle}</summary>
        <p className="acct-dim">{t.openaiBillingBlurb}</p>
        <KeyField
          label={t.adminKey}
          value={api.keys.openaiAdmin}
          placeholder={PLACEHOLDER.openaiAdmin}
          onCommit={(v) => api.setKey('openaiAdmin', v)}
          t={t}
        />
        <CreditField api={api} t={t} lang={lang} />
        <p className="acct-dim">
          <a
            href="https://platform.openai.com/settings/organization/billing/overview"
            target="_blank"
            rel="noopener"
          >
            {t.openaiBillingLink}
          </a>
          {' · '}
          <a
            href="https://platform.openai.com/settings/organization/admin-keys"
            target="_blank"
            rel="noopener"
          >
            {t.openaiAdminLink}
          </a>
        </p>
      </details>
    </section>
  );
}

// --- Apps -------------------------------------------------------------------------------------

const PROVIDER_NAME: Record<string, string> = {
  openai: 'OpenAI',
  google: 'Google',
  deepseek: 'DeepSeek',
  elevenLabs: 'ElevenLabs',
};

interface AppConfigs {
  sloper: SloperConfig;
  backseat: BackseatConfig;
}

/** The two apps' settings, from the account when it answers and from this browser otherwise. */
function useAppConfigs(uid: string | null): AppConfigs {
  const [configs, setConfigs] = useState<AppConfigs>(() => ({
    sloper: loadSloper().config,
    backseat: loadBackseat().config,
  }));

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    const local = { sloper: loadSloper(), backseat: loadBackseat() };
    void Promise.allSettled([pullSloper(uid), pullBackseat(uid)]).then(([sloper, backseat]) => {
      if (cancelled) return;
      const remoteSloper = sloper.status === 'fulfilled' ? sloper.value : null;
      const remoteBackseat = backseat.status === 'fulfilled' ? backseat.value : null;
      setConfigs({
        sloper:
          remoteSloper && remoteSloper.updatedAt > local.sloper.updatedAt
            ? remoteSloper.config
            : local.sloper.config,
        backseat:
          remoteBackseat && remoteBackseat.updatedAt > local.backseat.updatedAt
            ? remoteBackseat.config
            : local.backseat.config,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  return configs;
}

function withModel(provider: string, model: string): string {
  const name = PROVIDER_NAME[provider] ?? provider;
  return model ? `${name} (${model})` : name;
}

function AppsSection({
  api,
  apps,
  t,
  lang,
}: {
  api: AccountKeysApi;
  apps: AppConfigs;
  t: Translation;
  lang: Lang;
}) {
  const id = useId();
  const { sloper, backseat } = apps;
  return (
    <section className="acct-section">
      <h2 className="acct-heading">{t.appsTitle}</h2>
      <p className="acct-dim">{t.appsBlurb}</p>

      <div className="acct-card">
        <header className="acct-card-head">
          <h3>
            <a href={appPath(lang, 'sloper')}>{t.appSloper}</a>
          </h3>
        </header>
        <dl className="acct-numbers">
          <dt>{t.roleScript}</dt>
          <dd>{withModel(sloper.llm.provider, sloper.llm.model)}</dd>
          <dt>{t.roleImages}</dt>
          <dd>{withModel(sloper.image.provider, sloper.image.model)}</dd>
          <dt>{t.roleVoice}</dt>
          <dd>{withModel('elevenLabs', sloper.tts.model)}</dd>
        </dl>
        <p className="acct-dim">
          <a href={appPath(lang, 'sloper')}>{t.changeInApp}</a>
        </p>
      </div>

      <div className="acct-card">
        <header className="acct-card-head">
          <h3>
            <a href={appPath(lang, 'backseat')}>{t.appBackseat}</a>
          </h3>
        </header>
        <dl className="acct-numbers">
          <dt>{t.roleEyes}</dt>
          <dd>{withModel(backseat.vision.provider, backseat.vision.model)}</dd>
          <dt>{t.roleVoice}</dt>
          <dd>{backseat.voice.engine === 'elevenlabs' ? 'ElevenLabs' : t.deviceVoice}</dd>
        </dl>
        <p className="acct-dim">
          <a href={appPath(lang, 'backseat')}>{t.changeInApp}</a>
        </p>
      </div>

      <div className="acct-card">
        <header className="acct-card-head">
          <h3>
            <a href={appPath(lang, 'audio-guide')}>{t.appAudioGuide}</a>
          </h3>
        </header>
        <div className="acct-field">
          <label htmlFor={id}>{t.roleWriter}</label>
          <select
            id={id}
            value={api.value.audioGuideWriter}
            onChange={(e) =>
              api.update({ audioGuideWriter: e.target.value === 'openai' ? 'openai' : 'google' })
            }
          >
            <option value="google">Google (Gemini)</option>
            <option value="openai">OpenAI</option>
          </select>
        </div>
        <dl className="acct-numbers">
          <dt>{t.roleVoice}</dt>
          <dd>ElevenLabs</dd>
        </dl>
      </div>

      <div className="acct-card acct-card-server">
        <header className="acct-card-head">
          <h3>{t.serverTitle}</h3>
        </header>
        <p className="acct-dim">{t.serverBlurb}</p>
        <dl className="acct-numbers">
          <dt>
            <a href={appPath(lang, 'events')}>{t.appEvents}</a>
          </dt>
          <dd>{t.serverEvents}</dd>
          <dt>
            <a href={appPath(lang, 'transit')}>{t.appTransit}</a>
          </dt>
          <dd>{t.serverTransit}</dd>
        </dl>
      </div>
    </section>
  );
}

/** Which apps, as configured right now, spend each provider's key. */
function usedBy(apps: AppConfigs, writer: 'google' | 'openai', t: Translation): Record<Provider, string[]> {
  const result: Record<Provider, string[]> = { openai: [], google: [], elevenLabs: [], deepseek: [] };
  for (const key of sloperKeys(apps.sloper)) result[key].push(t.appSloper);
  for (const key of backseatKeys(apps.backseat)) result[key].push(t.appBackseat);
  result[writer].push(t.appAudioGuide);
  result.elevenLabs.push(t.appAudioGuide);
  return result;
}

const SYNC_LABEL = {
  local: 'syncLocal',
  syncing: 'syncSyncing',
  synced: 'syncSynced',
  error: 'syncError',
} as const;

export default function Account({ lang }: AccountProps) {
  const t = translations[lang];
  const auth = useAuth();
  const api = useAccountKeys(auth.user);
  const apps = useAppConfigs(auth.user?.uid ?? null);
  const [refresh, setRefresh] = useState(0);

  if (auth.loading) return <p className="acct-dim">{t.checking}</p>;

  if (!auth.user) {
    return (
      <div className="acct">
        <p>{t.signedOut}</p>
        <p>
          <a className="retro-btn" href={lang === 'pl' ? '/pl/login/' : '/login/'}>
            {t.signIn}
          </a>
        </p>
      </div>
    );
  }

  const uses = usedBy(apps, api.value.audioGuideWriter, t);
  const cards: Record<Provider, ComponentType<CardProps>> = {
    google: GoogleCard,
    elevenLabs: ElevenLabsCard,
    openai: OpenAiCard,
    deepseek: DeepSeekCard,
  };

  return (
    <div className="acct">
      <p className="acct-dim">
        {t.signedInAs} <strong>{auth.user.email}</strong>
      </p>

      <section className="acct-section">
        <div className="acct-heading-row">
          <h2 className="acct-heading">{t.keysTitle}</h2>
          <button type="button" className="retro-btn" onClick={() => setRefresh((n) => n + 1)}>
            {t.refresh}
          </button>
        </div>
        <p className="acct-dim">{t.keysBlurb}</p>
        <p className={api.sync === 'error' ? 'acct-dim acct-warn' : 'acct-dim'}>
          {t[SYNC_LABEL[api.sync]]}
        </p>
        {api.ready &&
          PROVIDERS.map((provider) => {
            const Card = cards[provider];
            return (
              <Card
                key={provider}
                api={api}
                usedBy={uses[provider]}
                refresh={refresh}
                t={t}
                lang={lang}
              />
            );
          })}
      </section>

      <AppsSection api={api} apps={apps} t={t} lang={lang} />
    </div>
  );
}
