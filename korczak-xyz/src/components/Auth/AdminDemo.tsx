/*
 * The demo's dials: whose key pays, how much of it, and for which apps.
 *
 * `/apps/backseat/` and `/apps/roaster/` run in the browser on the reader's own API key, which is
 * the whole architecture — except for the demo, where a stranger with no account hears a few
 * remarks on the owner's key (`.claude/rules/backseat.md`, and `functions/src/demo/handler.ts`).
 * That is the one thing on this site that spends somebody's money without them doing anything, so
 * it gets a panel rather than a hand-edited document in the Firestore console at two in the
 * morning.
 *
 * WHAT TURNS IT ON IS THE KEY, NOT THE SWITCH. `enabled` ships true and `keyUid` ships empty, so
 * the state out of the box is "ready, nobody is paying" and the demo refuses every call. Pressing
 * *Use my key* writes this account's uid, and from then on the function reads the Google key out of
 * `users/{uid}/keys/config` at call time — the account's own shared key store, where it is already
 * edited and cleared. There is no copy here and nothing to rotate: clearing the key on the account
 * page closes the demo, and so does pressing *Nobody*.
 *
 * LIKE THE ADMISSIONS PANEL, THIS IS NOT A SECURITY BOUNDARY. What stops a stranger writing these
 * numbers is `firestore.rules`, where `demo/config` is admins-only; the `isAdmin` check below
 * decides what to draw.
 */

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '../../hooks/useAuth';
import { describeError, log } from '../../lib/logger';
import {
  DEMO_APPS,
  DEMO_DEFAULTS,
  MAX_MIN_INTERVAL,
  MAX_PER_APP_DAILY,
  MAX_PER_IP_DAILY,
  normalizeSettings,
  type DemoApp,
  type DemoSettings,
} from '../../utils/backseat/demoLimits';
import { pullDemoSettings, pushDemoSettings } from '../../utils/backseat/demoConfig';

interface AdminDemoProps {
  lang: 'en' | 'pl';
}

const translations = {
  en: {
    heading: 'The demo',
    intro:
      'The passenger and the roaster let somebody with no account hear a few remarks on one of ' +
      'your own API keys. Nothing is spent until a key is named below.',
    signedOut: 'Sign in first.',
    notAdmin: 'This page is not for this account.',
    loading: 'Reading…',
    failed: 'That did not work. Try again.',
    saved: 'Saved.',
    save: 'Save',
    enabled: 'Demo switched on',
    enabledHint: 'Off refuses every demo call, whatever the rest of this says.',
    payer: 'Whose key pays',
    payerNobody: 'Nobody — the demo is closed',
    payerMine: 'Mine',
    payerOther: 'Another account',
    payerHint:
      'Read at call time from that account’s own key store. Clearing the Google key there closes ' +
      'the demo too.',
    model: 'Model',
    modelHint: 'A cheap one. The demo is free to whoever uses it and should be nearly free to you.',
    perIp: 'Per device, per day',
    perIpHint: 'Enough to see what the app is. Counted per address, which is per household.',
    perApp: 'Per app, per day',
    perAppHint: 'Everybody trying it shares this. Resets at midnight, Warsaw time.',
    interval: 'Shortest gap between remarks (seconds)',
    intervalHint: 'The floor the demo puts under the slider, so one phone cannot loop.',
    apps: 'Which apps offer it',
    appBackseat: 'Annoying passenger',
    appRoaster: 'Roaster',
    uidLabel: 'Account id of the payer',
    nobodyNote: 'No key is named, so every demo call is refused.',
    minePrefix: 'Paid for by this account',
    otherPrefix: 'Paid for by',
  },
  pl: {
    heading: 'Demo',
    intro:
      'Pasażer i roaster pozwalają komuś bez konta usłyszeć kilka uwag na jednym z twoich ' +
      'kluczy API. Nic się nie wydaje, dopóki nie wskażesz klucza poniżej.',
    signedOut: 'Najpierw się zaloguj.',
    notAdmin: 'Ta strona nie jest dla tego konta.',
    loading: 'Czytam…',
    failed: 'Nie udało się. Spróbuj jeszcze raz.',
    saved: 'Zapisano.',
    save: 'Zapisz',
    enabled: 'Demo włączone',
    enabledHint: 'Wyłączone odrzuca każde wywołanie demo, niezależnie od reszty.',
    payer: 'Czyj klucz płaci',
    payerNobody: 'Niczyj — demo zamknięte',
    payerMine: 'Mój',
    payerOther: 'Inne konto',
    payerHint:
      'Czytany w momencie wywołania z magazynu kluczy tego konta. Usunięcie tam klucza Google ' +
      'też zamyka demo.',
    model: 'Model',
    modelHint: 'Tani. Demo jest darmowe dla gościa i powinno być prawie darmowe dla ciebie.',
    perIp: 'Na urządzenie, dziennie',
    perIpHint: 'Tyle, żeby zobaczyć, o co chodzi. Liczone na adres, czyli na dom.',
    perApp: 'Na aplikację, dziennie',
    perAppHint: 'Wspólne dla wszystkich próbujących. Zeruje się o północy, czasu warszawskiego.',
    interval: 'Najkrótsza przerwa między uwagami (sekundy)',
    intervalHint: 'Dolna granica suwaka w demie, żeby jeden telefon nie zrobił pętli.',
    apps: 'Które aplikacje je oferują',
    appBackseat: 'Natrętny pasażer',
    appRoaster: 'Roaster',
    uidLabel: 'Identyfikator konta płatnika',
    nobodyNote: 'Żaden klucz nie jest wskazany, więc każde wywołanie demo jest odrzucane.',
    minePrefix: 'Płaci to konto',
    otherPrefix: 'Płaci',
  },
};

const APP_LABELS: Record<DemoApp, 'appBackseat' | 'appRoaster'> = {
  backseat: 'appBackseat',
  roaster: 'appRoaster',
};

export default function AdminDemo({ lang }: AdminDemoProps) {
  const t = translations[lang];
  const { identity, isAdmin, loading: authLoading } = useAuth();

  const [settings, setSettings] = useState<DemoSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const reload = useCallback(async () => {
    setError(null);
    try {
      setSettings(await pullDemoSettings());
    } catch (e) {
      log.warn('demo.settings.read.failed', describeError(e));
      setError(t.failed);
      setSettings(DEMO_DEFAULTS);
    }
  }, [t.failed]);

  useEffect(() => {
    if (isAdmin) void reload();
  }, [isAdmin, reload]);

  if (authLoading) return <p className="auth-note">{t.loading}</p>;
  if (!identity) return <p className="auth-note">{t.signedOut}</p>;
  if (!isAdmin) return null;
  if (!settings) return <p className="auth-note">{t.loading}</p>;

  /** Every edit goes through here, so the maxima are applied as they are typed, not on save. */
  const edit = (patch: Partial<DemoSettings>) => {
    setSaved(false);
    setSettings((previous) => normalizeSettings({ ...(previous ?? DEMO_DEFAULTS), ...patch }));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await pushDemoSettings(settings);
      setSaved(true);
      log.info('demo.settings.saved', {
        enabled: settings.enabled,
        hasKey: settings.keyUid !== '',
      });
    } catch (e) {
      log.warn('demo.settings.save.failed', describeError(e));
      setError(t.failed);
    } finally {
      setBusy(false);
    }
  };

  const payer =
    settings.keyUid === '' ? 'nobody' : settings.keyUid === identity.uid ? 'mine' : 'other';

  const number = (
    label: string,
    hint: string,
    value: number,
    max: number,
    onChange: (n: number) => void,
  ) => (
    <label className="admin-demo-field">
      <span className="admin-demo-label">{label}</span>
      <input
       
        type="number"
        min={0}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="admin-demo-hint">{hint}</span>
    </label>
  );

  return (
    <section className="admin-demo">
      <h2 className="admin-accounts-heading">{t.heading}</h2>
      <p className="auth-subtitle">{t.intro}</p>

      <label className="admin-demo-field">
        <span className="admin-demo-label">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => edit({ enabled: e.target.checked })}
          />{' '}
          {t.enabled}
        </span>
        <span className="admin-demo-hint">{t.enabledHint}</span>
      </label>

      <fieldset className="admin-demo-group">
        <legend className="admin-demo-label">{t.payer}</legend>
        {/* Three states and not a switch: "my key", "somebody else's", and nobody's — which is
            the shipped state and the one that closes the demo without touching anything else. */}
        <label className="admin-demo-radio">
          <input
            type="radio"
            name="demo-payer"
            checked={payer === 'nobody'}
            onChange={() => edit({ keyUid: '' })}
          />{' '}
          {t.payerNobody}
        </label>
        <label className="admin-demo-radio">
          <input
            type="radio"
            name="demo-payer"
            checked={payer === 'mine'}
            onChange={() => edit({ keyUid: identity.uid })}
          />{' '}
          {t.payerMine}
        </label>
        <label className="admin-demo-radio">
          <input
            type="radio"
            name="demo-payer"
            checked={payer === 'other'}
            /* Selecting this cannot invent a uid, so it starts from this account's and waits for
               the field below to be edited. */
            onChange={() => edit({ keyUid: identity.uid })}
          />{' '}
          {t.payerOther}
        </label>
        {payer !== 'nobody' && (
          <label className="admin-demo-field">
            <span className="admin-demo-label">{t.uidLabel}</span>
            <input
             
              type="text"
              value={settings.keyUid}
              onChange={(e) => edit({ keyUid: e.target.value })}
            />
            <span className="admin-demo-hint">{t.payerHint}</span>
          </label>
        )}
        {payer === 'nobody' && <p className="admin-demo-hint">{t.nobodyNote}</p>}
      </fieldset>

      <label className="admin-demo-field">
        <span className="admin-demo-label">{t.model}</span>
        <input
         
          type="text"
          value={settings.model}
          onChange={(e) => edit({ model: e.target.value })}
        />
        <span className="admin-demo-hint">{t.modelHint}</span>
      </label>

      {number(t.perIp, t.perIpHint, settings.perIpDaily, MAX_PER_IP_DAILY, (n) =>
        edit({ perIpDaily: n }),
      )}
      {number(t.perApp, t.perAppHint, settings.perAppDaily, MAX_PER_APP_DAILY, (n) =>
        edit({ perAppDaily: n }),
      )}
      {number(t.interval, t.intervalHint, settings.minIntervalSeconds, MAX_MIN_INTERVAL, (n) =>
        edit({ minIntervalSeconds: n }),
      )}

      <fieldset className="admin-demo-group">
        <legend className="admin-demo-label">{t.apps}</legend>
        {DEMO_APPS.map((app) => (
          <label className="admin-demo-radio" key={app}>
            <input
              type="checkbox"
              checked={settings.apps[app]}
              onChange={(e) => edit({ apps: { ...settings.apps, [app]: e.target.checked } })}
            />{' '}
            {t[APP_LABELS[app]]}
          </label>
        ))}
      </fieldset>

      <div className="auth-links">
        <button className="retro-btn" disabled={busy} onClick={() => void save()}>
          {t.save}
        </button>
      </div>
      {error && <p className="auth-error">{error}</p>}
      {saved && !error && <p className="auth-note">{t.saved}</p>}
    </section>
  );
}
