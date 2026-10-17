/**
 * The songbook's video inbox: where a recording uploaded from /apps/admin/ waits in the sloper
 * bucket until `.github/workflows/song-video-inbox.yml` transcodes it into R2. Pure on purpose —
 * the path is the whole contract between the panel, `storage.rules` and the workflow, and all
 * three read it the same way: `videoInbox/<slug>/<uploaded-at>-<file name>`.
 */

export const INBOX = 'videoInbox';
export const FAILED = 'videoFailed';

/** The slug shape `storage.rules` accepts. A song's slug in its frontmatter always matches it. */
const SLUG = /^[a-z0-9-]+$/;

/**
 * Where an upload goes. The time comes first in the name so two takes of one song never collide
 * and the workflow, taking the newest, can tell them apart without asking for metadata.
 */
export function inboxPath(slug: string, fileName: string, uploadedAt: number): string {
  if (!SLUG.test(slug)) throw new Error(`not a song slug: ${slug}`);
  const safe = fileName.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80) || 'video';
  return `${INBOX}/${slug}/${uploadedAt}-${safe}`;
}

export interface InboxItem {
  path: string;
  slug: string;
  fileName: string;
  uploadedAt: number;
}

/** Reads a path back, from either folder. Anything not of the shape above is not ours: undefined. */
export function parseInboxPath(path: string): InboxItem | undefined {
  const match = path.match(/^(?:videoInbox|videoFailed)\/([a-z0-9-]+)\/(\d+)-(.+)$/);
  if (!match) return undefined;
  return { path, slug: match[1], uploadedAt: Number(match[2]), fileName: match[3] };
}

/**
 * The content type the upload declares. `storage.rules` refuses anything that is not `video/*`,
 * and a browser hands over an empty `type` for an extension it does not know — which an Android
 * gallery does for some recordings. Those are videos the picker already filtered to, so say so.
 */
export function videoContentType(file: { type: string }): string {
  return file.type.startsWith('video/') ? file.type : 'video/mp4';
}
