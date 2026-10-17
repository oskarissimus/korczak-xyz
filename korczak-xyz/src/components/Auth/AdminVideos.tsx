/*
 * The songbook's videos: pick a song, pick a recording, and it is on the site a run later.
 *
 * This panel only gets the file as far as the inbox — `videoInbox/<slug>/…` in the sloper bucket,
 * straight from the browser with a resumable upload, because a phone's recording of a song is
 * hundreds of megabytes and nothing in between should have to hold it. Everything after that is
 * `.github/workflows/song-video-inbox.yml`: it looks every ten minutes, transcodes to 720p with the
 * same `scripts/song-videos.mjs` a laptop would run, uploads to R2, commits `songVideos.json`,
 * redeploys, and deletes the original. So what this panel can show is the inbox itself: a file
 * still listed is waiting, and a file under *could not use* is one the workflow gave up on.
 *
 * WHY NOT STRAIGHT TO R2. The site has no server to sign an upload with, and the Cloudflare token
 * cannot go in a browser. Firebase Storage already takes uploads from here, with `storage.rules`
 * as the gate — admins only, for this path — and the workflow already holds both credentials.
 *
 * Like the other panels, the `isAdmin` check decides what to draw; `storage.rules` is the gate.
 */

import { useCallback, useEffect, useState } from 'react';
import { deleteObject, listAll, ref, uploadBytesResumable, type StorageReference } from 'firebase/storage';

import { useAuth } from '../../hooks/useAuth';
import { getStorageClient } from '../../lib/firebase';
import { describeError, log } from '../../lib/logger';
import {
  FAILED,
  INBOX,
  inboxPath,
  parseInboxPath,
  videoContentType,
  type InboxItem,
} from '../../utils/songVideoInbox';

export interface SongOption {
  slug: string;
  title: string;
  hasVideo: boolean;
}

interface AdminVideosProps {
  lang: 'en' | 'pl';
  songs: SongOption[];
}

const translations = {
  en: {
    heading: 'Song videos',
    intro:
      'Pick a song and a recording of it. The file waits below until the next run picks it up — ' +
      'every ten minutes — turns it into 720p, puts it on media.korczak.xyz and redeploys. ' +
      'Expect it on the song’s page within about twenty minutes. A song that already has a video ' +
      'gets the new one instead.',
    signedOut: 'Sign in first.',
    loading: 'Reading…',
    song: 'Song',
    choose: 'Choose a song',
    hasVideo: 'has a video',
    file: 'Recording',
    upload: 'Upload',
    uploading: 'Uploading',
    uploaded: 'Uploaded. It is waiting for the next run.',
    failed: 'That did not work. Try again.',
    waiting: 'Waiting for the next run',
    rejected: 'Could not use these',
    rejectedHint: 'The run could not read the file, or the song no longer exists. Upload it again or remove it.',
    nothingWaiting: 'Nothing waiting.',
    cancel: 'Cancel',
    remove: 'Remove',
    refresh: 'Refresh',
    noStorage: 'Uploads are not configured on this build.',
    locale: 'en-GB',
  },
  pl: {
    heading: 'Filmy do śpiewnika',
    intro:
      'Wybierz piosenkę i nagranie. Plik czeka poniżej, aż następne przejście — co dziesięć minut — ' +
      'zrobi z niego 720p, wrzuci na media.korczak.xyz i przebuduje stronę. Na stronie piosenki ' +
      'powinien być w ciągu około dwudziestu minut. Piosenka, która ma już film, dostaje nowy w miejsce starego.',
    signedOut: 'Najpierw się zaloguj.',
    loading: 'Czytam…',
    song: 'Piosenka',
    choose: 'Wybierz piosenkę',
    hasVideo: 'ma film',
    file: 'Nagranie',
    upload: 'Wyślij',
    uploading: 'Wysyłam',
    uploaded: 'Wysłane. Czeka na następne przejście.',
    failed: 'Nie udało się. Spróbuj jeszcze raz.',
    waiting: 'Czeka na następne przejście',
    rejected: 'Tych nie dało się użyć',
    rejectedHint: 'Przejście nie umiało przeczytać pliku albo piosenki już nie ma. Wyślij go jeszcze raz albo usuń.',
    nothingWaiting: 'Nic nie czeka.',
    cancel: 'Anuluj',
    remove: 'Usuń',
    refresh: 'Odśwież',
    noStorage: 'Wysyłanie plików nie jest skonfigurowane w tej wersji.',
    locale: 'pl-PL',
  },
};

/** Every file under a folder, two levels down: `<folder>/<slug>/<file>`. */
async function listFolder(root: StorageReference): Promise<InboxItem[]> {
  const top = await listAll(root);
  const nested = await Promise.all(top.prefixes.map((prefix) => listAll(prefix)));
  return nested
    .flatMap((listing) => listing.items)
    .flatMap((item) => parseInboxPath(item.fullPath) ?? [])
    .sort((a, b) => b.uploadedAt - a.uploadedAt);
}

export default function AdminVideos({ lang, songs }: AdminVideosProps) {
  const t = translations[lang];
  const { identity, isAdmin, loading: authLoading } = useAuth();
  const storage = getStorageClient();

  const [slug, setSlug] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<InboxItem[] | null>(null);
  const [rejected, setRejected] = useState<InboxItem[]>([]);

  const reload = useCallback(async () => {
    if (!storage) return;
    try {
      const [inbox, failed] = await Promise.all([
        listFolder(ref(storage, INBOX)),
        listFolder(ref(storage, FAILED)),
      ]);
      setWaiting(inbox);
      setRejected(failed);
    } catch (e) {
      log.warn('songVideo.inbox.list.failed', describeError(e));
      setError(t.failed);
      setWaiting([]);
    }
  }, [storage, t.failed]);

  useEffect(() => {
    if (isAdmin) void reload();
  }, [isAdmin, reload]);

  if (authLoading) return <p className="auth-note">{t.loading}</p>;
  if (!identity) return <p className="auth-note">{t.signedOut}</p>;
  if (!isAdmin) return null;
  if (!storage) return <p className="auth-note">{t.noStorage}</p>;

  const titleOf = (s: string) => songs.find((song) => song.slug === s)?.title ?? s;

  const upload = () => {
    if (!slug || !file) return;
    setError(null);
    setMessage(null);
    setProgress(0);
    const path = inboxPath(slug, file.name, Date.now());
    const task = uploadBytesResumable(ref(storage, path), file, {
      contentType: videoContentType(file),
    });
    task.on(
      'state_changed',
      (snapshot) => setProgress(snapshot.bytesTransferred / Math.max(snapshot.totalBytes, 1)),
      (e) => {
        log.warn('songVideo.upload.failed', { slug, size: file.size, ...describeError(e) });
        setError(t.failed);
        setProgress(null);
      },
      () => {
        log.info('songVideo.uploaded', { slug, size: file.size });
        setProgress(null);
        setFile(null);
        setMessage(t.uploaded);
        void reload();
      },
    );
  };

  const remove = async (item: InboxItem) => {
    try {
      await deleteObject(ref(storage, item.path));
    } catch (e) {
      log.warn('songVideo.inbox.delete.failed', describeError(e));
      setError(t.failed);
    }
    void reload();
  };

  const row = (item: InboxItem, action: string) => (
    <li key={item.path} className="admin-video-row">
      <span>
        <strong>{titleOf(item.slug)}</strong> · {item.fileName} ·{' '}
        {new Date(item.uploadedAt).toLocaleString(t.locale)}
      </span>
      <button className="retro-btn" onClick={() => void remove(item)}>
        {action}
      </button>
    </li>
  );

  const sorted = [...songs].sort((a, b) => a.title.localeCompare(b.title, lang));
  const busy = progress !== null;

  return (
    <section className="admin-demo">
      <h2 className="admin-accounts-heading">{t.heading}</h2>
      <p className="auth-subtitle">{t.intro}</p>

      <label className="admin-demo-field">
        <span className="admin-demo-label">{t.song}</span>
        <select value={slug} disabled={busy} onChange={(e) => setSlug(e.target.value)}>
          <option value="">{t.choose}</option>
          {sorted.map((song) => (
            <option key={song.slug} value={song.slug}>
              {song.title}
              {song.hasVideo ? ` — ${t.hasVideo}` : ''}
            </option>
          ))}
        </select>
      </label>

      <label className="admin-demo-field">
        <span className="admin-demo-label">{t.file}</span>
        <input
          type="file"
          accept="video/*"
          disabled={busy}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>

      <div className="auth-links">
        <button className="retro-btn" disabled={busy || !slug || !file} onClick={upload}>
          {busy ? `${t.uploading} ${Math.round((progress ?? 0) * 100)}%` : t.upload}
        </button>
      </div>
      {busy && <progress max={1} value={progress ?? 0} />}
      {error && <p className="auth-error">{error}</p>}
      {message && !error && <p className="auth-note">{message}</p>}

      <h3 className="admin-demo-label">{t.waiting}</h3>
      {waiting === null ? (
        <p className="auth-note">{t.loading}</p>
      ) : waiting.length === 0 ? (
        <p className="admin-demo-hint">{t.nothingWaiting}</p>
      ) : (
        <ul className="admin-video-list">{waiting.map((item) => row(item, t.cancel))}</ul>
      )}

      {rejected.length > 0 && (
        <>
          <h3 className="admin-demo-label">{t.rejected}</h3>
          <p className="admin-demo-hint">{t.rejectedHint}</p>
          <ul className="admin-video-list">{rejected.map((item) => row(item, t.remove))}</ul>
        </>
      )}

      <div className="auth-links">
        <button className="retro-btn" onClick={() => void reload()}>
          {t.refresh}
        </button>
      </div>
    </section>
  );
}
