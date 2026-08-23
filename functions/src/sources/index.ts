/*
 * The sources, in one list.
 *
 * Adding a fifth is one file plus one line here — that is what the thin `RawEvent` contract in
 * types.ts buys. Two of these four are already generic (`rss` is driven by a URL list, `python-org`
 * by an iCal URL), so most new watching needs no adapter at all.
 *
 * Order is the order they run in, and it matters slightly: `teatr-wielki` before `ticketmaster`
 * means that when both list the same night, the theatre's own page is the one already stored when
 * the ticketed copy arrives — and `dedupeByFingerprint` then prefers whichever has a ticket link,
 * so the reader gets the better of the two either way.
 */

import type { EventSource } from './types';
import { teatrWielki } from './teatrWielki';
import { pythonOrg } from './pythonOrg';
import { rssFeeds } from './rss';
import { ticketmaster } from './ticketmaster';

export const SOURCES: EventSource[] = [teatrWielki, pythonOrg, rssFeeds, ticketmaster];
