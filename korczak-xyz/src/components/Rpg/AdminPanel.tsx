/*
 * The game's admin panel (owner, 9 Nov 2026: "an admin panel in the game, so I can set the keys for
 * now — later other things will come in handy too"). At `/admin/` on everyrpg.korczak.xyz and as a
 * section of `/apps/admin/` on korczak.xyz.
 *
 * Everything goes through the gateway's `/admin/config` (`functions/src/rpg/admin.ts`), which checks
 * `admins/{uid}` itself — this page deciding what to draw is not the boundary. A key typed here is
 * sent once and never comes back: the answer carries its last four characters.
 *
 * A NEW SECTION is a field in `utils/rpg/adminConfig.ts` (status, patch, parser), a branch in
 * `admin.ts`, and one more `<section>` below that sends `{ <name>: … }` through `save`.
 */

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '../../hooks/useAuth';
import { describeError, log } from '../../lib/logger';
import { adminConfig } from '../../utils/rpg/gateway';
import { SERVER_KEY_NAMES, type AdminPatch, type AdminStatus, type ServerKeyName } from '../../utils/rpg/adminConfig';

type Lang = 'en' | 'pl';

const translations = {
  en: {
    siteHeading: 'Every RPG',
    loading: 'Reading…',
    signedOut: 'Sign in with an admin account first.',
    signIn: 'Sign in',
    notAdmin: 'This account is not an admin.',
    back: '← Back to the game',
    failed: 'That did not work:',
    saved: 'Saved.',
    save: 'Save',
    clear: 'Clear',
    clearConfirm: 'Clear this key? The demo stops using it at once.',
    show: 'Show',
    hide: 'Hide',
    keysTitle: 'Server keys',
    keysBlurb:
      'The game’s own keys, kept on the server and never sent back to a browser — this page sees only ' +
      'the last four characters. The demo spends these before the paying account’s; a player’s own ' +
      'key always wins over both. A field left empty leaves its key as it is.',
    noKey: 'not set',
    set: 'set',
    used: {
      google: 'the demo’s story (Gemini)',
      elevenLabs: 'the demo’s voices',
      fal: 'kept for later: pictures and models',
      openai: 'kept for later',
    } as Record<ServerKeyName, string>,
    updated: 'Last changed',
    demoTitle: 'Demo',
    demoBlurb:
      'Somebody with no account and no key plays on the server’s keys, within these caps. ' +
      'Midnight, Warsaw time, starts a new day.',
    demoOn: 'The game offers the demo',
    perIp: 'Dollars per player (address), per day',
    daily: 'Dollars for everybody, per day',
    masterOff: 'The demo’s master switch (shared with the roaster) is off, so the demo is closed anyway.',
    payer: {
      server: 'Paid with the server keys above.',
      account: 'Paid with the keys of the account named in demo/config — no server Google key is set.',
      nobody: 'No Google key is set anywhere, so the demo is closed.',
    },
  },
  pl: {
    siteHeading: 'Every RPG',
    loading: 'Czytam…',
    signedOut: 'Najpierw zaloguj się kontem admina.',
    signIn: 'Zaloguj się',
    notAdmin: 'To konto nie jest adminem.',
    back: '← Wróć do gry',
    failed: 'Nie udało się:',
    saved: 'Zapisano.',
    save: 'Zapisz',
    clear: 'Usuń',
    clearConfirm: 'Usunąć ten klucz? Demo od razu przestaje go używać.',
    show: 'Pokaż',
    hide: 'Ukryj',
    keysTitle: 'Klucze serwera',
    keysBlurb:
      'Własne klucze gry, trzymane na serwerze i nigdy nie odsyłane do przeglądarki — ta strona widzi ' +
      'tylko cztery ostatnie znaki. Demo wydaje je przed kluczami konta płatnika; własny klucz gracza ' +
      'zawsze wygrywa z obydwoma. Puste pole zostawia klucz bez zmian.',
    noKey: 'brak',
    set: 'ustawiony',
    used: {
      google: 'fabuła w demie (Gemini)',
      elevenLabs: 'głosy w demie',
      fal: 'na później: obrazy i modele',
      openai: 'na później',
    } as Record<ServerKeyName, string>,
    updated: 'Ostatnia zmiana',
    demoTitle: 'Demo',
    demoBlurb:
      'Ktoś bez konta i bez klucza gra na kluczach serwera, w tych limitach. Nowy dzień zaczyna się ' +
      'o północy czasu warszawskiego.',
    demoOn: 'Gra oferuje demo',
    perIp: 'Dolarów na gracza (adres) dziennie',
    daily: 'Dolarów dla wszystkich dziennie',
    masterOff: 'Główny włącznik demo (wspólny z roasterem) jest wyłączony, więc demo i tak jest zamknięte.',
    payer: {
      server: 'Płacą klucze serwera powyżej.',
      account: 'Płacą klucze konta wskazanego w demo/config — klucz Google serwera nie jest ustawiony.',
      nobody: 'Nigdzie nie ma klucza Google, więc demo jest zamknięte.',
    },
  },
};

type T = (typeof translations)['en'];

const LABELS: Record<ServerKeyName, string> = {
  google: 'Google AI Studio',
  elevenLabs: 'ElevenLabs',
  fal: 'fal.ai',
  openai: 'OpenAI',
};

const EMPTY_DRAFTS = Object.fromEntries(SERVER_KEY_NAMES.map((n) => [n, ''])) as Record<ServerKeyName, string>;

export default function AdminPanel({ lang, variant = 'game' }: { lang: Lang; variant?: 'site' | 'game' }) {
  const t = translations[lang];
  const { identity, isAdmin, loading } = useAuth();
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      setStatus(await adminConfig());
    } catch (e) {
      log.warn('rpg.admin.read.failed', describeError(e));
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void reload();
  }, [isAdmin, reload]);

  const save = async (section: string, patch: AdminPatch): Promise<boolean> => {
    setBusy(true);
    setError(null);
    setSavedAt(null);
    try {
      setStatus(await adminConfig(patch));
      setSavedAt(section);
      // Which keys changed, never what they are.
      log.info('rpg.admin.saved', { section, keys: Object.keys(patch.keys ?? {}).join(','), demo: Object.keys(patch.demo ?? {}).join(',') });
      return true;
    } catch (e) {
      log.warn('rpg.admin.save.failed', describeError(e));
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const home = lang === 'pl' ? '/pl/' : '/';
  const back = variant === 'game' && (
    <p>
      <a className="retro-btn" href={home}>
        {t.back}
      </a>
    </p>
  );

  if (loading) return <p className="acct-dim">{t.loading}</p>;
  if (!identity) {
    return (
      <div className="acct">
        <p>{t.signedOut}</p>
        {variant === 'game' && (
          <p>
            <a className="retro-btn" href={lang === 'pl' ? '/pl/login/' : '/login/'}>
              {t.signIn}
            </a>
          </p>
        )}
        {back}
      </div>
    );
  }
  if (!isAdmin) {
    // On korczak.xyz the panel is one section among the site's; a non-admin sees the heading's refusal there.
    return variant === 'game' ? (
      <div className="acct">
        <p>{t.notAdmin}</p>
        {back}
      </div>
    ) : null;
  }

  return (
    <div className="acct">
      {back}
      {variant === 'site' && <h2 className="admin-accounts-heading">{t.siteHeading}</h2>}
      {error && (
        <p className="acct-warn">
          {t.failed} {error}
        </p>
      )}
      {!status ? (
        !error && <p className="acct-dim">{t.loading}</p>
      ) : (
        <>
          <KeysSection status={status} t={t} lang={lang} busy={busy} saved={savedAt === 'keys'} save={save} />
          <DemoSection status={status} t={t} busy={busy} saved={savedAt === 'demo'} save={save} />
        </>
      )}
    </div>
  );
}

interface SectionProps {
  status: AdminStatus;
  t: T;
  busy: boolean;
  saved: boolean;
  save: (section: string, patch: AdminPatch) => Promise<boolean>;
}

function KeysSection({ status, t, lang, busy, saved, save }: SectionProps & { lang: Lang }) {
  const [drafts, setDrafts] = useState(EMPTY_DRAFTS);
  const [visible, setVisible] = useState(false);
  const changed = SERVER_KEY_NAMES.filter((n) => drafts[n].trim());

  const submit = async () => {
    const keys = Object.fromEntries(changed.map((n) => [n, drafts[n].trim()]));
    if (await save('keys', { keys })) setDrafts(EMPTY_DRAFTS);
  };

  return (
    <section className="acct-section">
      <div className="acct-heading-row">
        <h2 className="acct-heading">{t.keysTitle}</h2>
        <button type="button" className="retro-btn" onClick={() => setVisible(!visible)}>
          {visible ? t.hide : t.show}
        </button>
      </div>
      <p className="acct-dim">{t.keysBlurb}</p>
      {SERVER_KEY_NAMES.map((name) => {
        const hint = status.keys[name];
        return (
          <section className="acct-card" key={name}>
            <header className="acct-card-head">
              <h3>{LABELS[name]}</h3>
              <span className={hint ? 'acct-chip acct-ok' : 'acct-chip'}>{hint ? `✓ ${t.set} ··${hint}` : t.noKey}</span>
            </header>
            <p className="acct-dim">{t.used[name]}</p>
            <div className="acct-field">
              <div className="acct-field-row">
                <input
                  type={visible ? 'text' : 'password'}
                  aria-label={LABELS[name]}
                  value={drafts[name]}
                  placeholder={hint ? `••••••••${hint}` : ''}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setDrafts({ ...drafts, [name]: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && changed.length > 0) void submit();
                  }}
                />
                {hint && (
                  <button
                    type="button"
                    className="retro-btn"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(t.clearConfirm)) void save('keys', { keys: { [name]: null } });
                    }}
                  >
                    {t.clear}
                  </button>
                )}
              </div>
            </div>
          </section>
        );
      })}
      <p>
        <button type="button" className="retro-btn" disabled={busy || changed.length === 0} onClick={() => void submit()}>
          {t.save}
        </button>{' '}
        {saved && <span className="acct-dim">{t.saved}</span>}
      </p>
      {status.keysUpdatedAt > 0 && (
        <p className="acct-dim">
          {t.updated}: {new Date(status.keysUpdatedAt).toLocaleString(lang === 'pl' ? 'pl-PL' : 'en-GB')}
        </p>
      )}
    </section>
  );
}

function DemoSection({ status, t, busy, saved, save }: SectionProps) {
  const [on, setOn] = useState(status.demo.on);
  const [perIp, setPerIp] = useState(String(status.demo.perIpUsd));
  const [daily, setDaily] = useState(String(status.demo.dailyUsd));

  useEffect(() => {
    setOn(status.demo.on);
    setPerIp(String(status.demo.perIpUsd));
    setDaily(String(status.demo.dailyUsd));
  }, [status.demo.on, status.demo.perIpUsd, status.demo.dailyUsd]);

  const submit = () =>
    void save('demo', { demo: { on, perIpUsd: Number(perIp), dailyUsd: Number(daily) } });

  return (
    <section className="acct-section">
      <h2 className="acct-heading">{t.demoTitle}</h2>
      <p className="acct-dim">{t.demoBlurb}</p>
      <p className={status.demo.payer === 'nobody' ? 'acct-warn' : 'acct-dim'}>{t.payer[status.demo.payer]}</p>
      {!status.demo.enabled && <p className="acct-warn">{t.masterOff}</p>}
      <div className="acct-field">
        <label>
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /> {t.demoOn}
        </label>
      </div>
      <div className="acct-field">
        <label>{t.perIp}</label>
        <div className="acct-field-row">
          <span className="acct-prefix">$</span>
          <input
            type="number"
            aria-label={t.perIp}
            min={0}
            max={status.limits.maxPerIpUsd}
            step={0.5}
            value={perIp}
            onChange={(e) => setPerIp(e.target.value)}
          />
        </div>
      </div>
      <div className="acct-field">
        <label>{t.daily}</label>
        <div className="acct-field-row">
          <span className="acct-prefix">$</span>
          <input
            type="number"
            aria-label={t.daily}
            min={0}
            max={status.limits.maxDailyUsd}
            step={1}
            value={daily}
            onChange={(e) => setDaily(e.target.value)}
          />
        </div>
      </div>
      <p>
        <button type="button" className="retro-btn" disabled={busy} onClick={submit}>
          {t.save}
        </button>{' '}
        {saved && <span className="acct-dim">{t.saved}</span>}
      </p>
    </section>
  );
}
