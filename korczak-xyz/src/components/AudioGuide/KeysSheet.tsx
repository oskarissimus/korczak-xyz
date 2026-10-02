/*
 * The keys a guide is paid with, and who writes it.
 *
 * A panel over the map rather than a screen of its own: there is one island and no routes here
 * (see `AudioGuide.tsx`), and the map behind it is what the keys are for. It opens by itself the
 * first time the app finds either key missing, when a tap is made without them, and when a
 * provider refuses one; otherwise it is the Keys button in the bar.
 *
 * The fields are the backseat driver's `KeyField` in this app's chrome — masked, a Show toggle, a
 * set/not-set chip — with one difference: they commit on blur and Enter, not per keystroke, the
 * way the language box does. Each commit is a Firestore write, and a key typed rather than pasted
 * would otherwise be forty of them.
 */

import { useEffect, useId, useState } from 'react';

import type { AudioGuideKeysApi } from '../../hooks/useAudioGuideKeys';
import { accountPath } from '../../utils/accountKeys/keys';
import { missingKeys, requiredKeys, type KeyName } from '../../utils/audioGuide/keys';
import type { Translation } from './translations';

interface KeyFieldProps {
  label: string;
  value: string | null;
  placeholder: string;
  onCommit: (value: string | null) => void;
  t: Translation;
}

function KeyField({ label, value, placeholder, onCommit, t }: KeyFieldProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const [draft, setDraft] = useState(value ?? '');

  // A key arriving from the account, or cleared, after the first render.
  useEffect(() => setDraft(value ?? ''), [value]);

  const commit = () => {
    const next = draft.trim() || null;
    if (next !== value) onCommit(next);
  };

  return (
    <div className="ag-key">
      <label className="ag-key-label" htmlFor={id}>
        <span>{label}</span>
        <span className={value ? 'ag-key-chip ag-key-chip-on' : 'ag-key-chip'}>
          {value ? t.keySet : t.keyNotSet}
        </span>
      </label>
      <div className="ag-key-row">
        <input
          id={id}
          className="ag-input ag-key-input"
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
        <button type="button" className="ag-key-toggle" onClick={() => setVisible(!visible)}>
          {visible ? t.keyHide : t.keyShow}
        </button>
      </div>
    </div>
  );
}

interface KeysSheetProps {
  api: AudioGuideKeysApi;
  onClose: () => void;
  t: Translation;
  lang: 'en' | 'pl';
}

const SYNC_LABEL = {
  local: 'syncLocal',
  syncing: 'syncSyncing',
  synced: 'syncSynced',
  error: 'syncError',
} as const;

const KEY_FIELD = {
  google: { label: 'keyGoogle', placeholder: 'AIza…' },
  openai: { label: 'keyOpenai', placeholder: 'sk-…' },
  elevenLabs: { label: 'keyElevenLabs', placeholder: 'sk_…' },
} as const;

export default function KeysSheet({ api, onClose, t, lang }: KeysSheetProps) {
  const id = useId();
  const set = (name: KeyName) => (value: string | null) => api.setKey(name, value);
  const missing = missingKeys(api.keys).length > 0;

  return (
    <section className="ag-keys" aria-label={t.keysTitle}>
      <p className="ag-gate-title">{t.keysTitle}</p>
      <p className="ag-keys-blurb">{t.keysBlurb}</p>

      <div className="ag-key">
        <label className="ag-key-label" htmlFor={id}>
          <span>{t.writerLabel}</span>
        </label>
        <select
          id={id}
          className="ag-select"
          value={api.keys.writer}
          onChange={(e) => api.setWriter(e.target.value === 'openai' ? 'openai' : 'google')}
        >
          <option value="google">{t.writerGoogle}</option>
          <option value="openai">{t.writerOpenai}</option>
        </select>
      </div>

      {/* Only the keys the chosen writer needs: a field for a service this app will not call is a
          question nobody should have to answer. The rest are on the account page. */}
      {requiredKeys(api.keys).map((name) => (
        <KeyField
          key={name}
          label={t[KEY_FIELD[name].label]}
          value={api.keys[name]}
          placeholder={KEY_FIELD[name].placeholder}
          onCommit={set(name)}
          t={t}
        />
      ))}

      {/* Said where the key is: a key typed here is the one every other app uses too, and
          clearing it here clears it there. */}
      <p className="ag-keys-note">
        {t.keysShared} <a href={accountPath(lang)}>{t.keysSharedLink}</a>
      </p>

      {missing && <p className="ag-keys-note">{t.keysNeeded}</p>}
      <p className={api.sync === 'error' ? 'ag-keys-sync ag-keys-sync-error' : 'ag-keys-sync'}>
        {t[SYNC_LABEL[api.sync]]}
      </p>

      <div className="ag-error-actions">
        <button type="button" className="retro-btn" onClick={onClose}>
          {t.keysDone}
        </button>
      </div>
    </section>
  );
}
