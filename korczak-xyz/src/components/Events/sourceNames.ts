/**
 * What a source is called and what it covers, in the reader's language.
 *
 * These cannot live in `src/utils/events/sources.ts` with the URLs: that file compiles into the
 * Cloud Function, which has no locale, and the catalogue's own `label` is the source's *server-side
 * identity* — the string a health row and a "this source has stopped working" push are written
 * under. Most of them are proper nouns and read the same in both languages; `Watched feeds` is a
 * description, and it rendered in English on the Polish page until this existed.
 *
 * Both tables are keyed by `SourceId` rather than looked up loosely, so a new source is a compile
 * error until somebody names it and says what it covers — the second being the only part of a
 * source a reader cannot work out from the URL beside it.
 *
 * Shared by the Sources tab and the Alerts tab's health table, because two tabs naming one source
 * differently is worse than either name.
 */
import type { SourceId } from '../../utils/events/types';
import type { Translation } from './translations';

const NAME_KEYS: Record<SourceId, keyof Translation> = {
  'teatr-wielki': 'sourceNameTeatrWielki',
  'python-org': 'sourceNamePythonOrg',
  'elektroniczne-zapisy': 'sourceNameElektroniczneZapisy',
  feed: 'sourceNameFeed',
  ticketmaster: 'sourceNameTicketmaster',
};

const NOTE_KEYS: Record<SourceId, keyof Translation> = {
  'teatr-wielki': 'noteTeatrWielki',
  'python-org': 'notePythonOrg',
  'elektroniczne-zapisy': 'noteElektroniczneZapisy',
  feed: 'noteFeed',
  ticketmaster: 'noteTicketmaster',
};

/**
 * A source's name, given whatever the collector wrote.
 *
 * `fallback` is the health row's own label, which is what an id nothing here describes is left
 * with — the classifier, or a source removed from the catalogue and still collecting. Naming it
 * from the record rather than printing the raw id is what keeps that row readable.
 */
export function sourceName(id: string, fallback: string, t: Translation): string {
  const key = NAME_KEYS[id as SourceId];
  return key ? t[key] : fallback;
}

/** What a source covers. Only the catalogue's own sources have one. */
export function sourceNote(id: SourceId, t: Translation): string {
  return t[NOTE_KEYS[id]];
}
