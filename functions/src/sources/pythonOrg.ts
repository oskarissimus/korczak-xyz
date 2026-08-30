/*
 * Python events, from python.org's public calendar.
 *
 * An iCal feed rather than a scrape, so this is the least likely of the sources to break — which is
 * why it is the one to stand the pipeline up with.
 *
 * The feed is worldwide and mostly historical: at the time of writing it carries 874 VEVENTs, plenty
 * of them from 2016. Dropping the past happens in `collect.ts`, which does it for every source;
 * geography deliberately does NOT happen here, because "PyCon US" may still be worth knowing about
 * and deciding that is the interest's job, not the collector's.
 */

import type { EventSource, RawEvent, SourceContext } from './types';
import { fetchText } from './types';
import { firstUrl, parseIcal } from './ical';
import { PYTHON_ORG_ICAL } from '../../../korczak-xyz/src/utils/events/sources';

export function toRawEvents(ics: string): RawEvent[] {
  return parseIcal(ics).map((event) => ({
    // iCal UIDs are stable by spec, which is exactly what an event id wants.
    sourceKey: event.uid,
    title: event.summary,
    url: event.url ?? firstUrl(event.description) ?? 'https://www.python.org/events/',
    startsAt: event.start,
    endsAt: event.end,
    allDay: event.allDay,
    venue: event.location,
    city: cityOf(event.location),
    tags: ['tech', 'python'],
    description: event.description,
  }));
}

/**
 * The city out of a free-text LOCATION.
 *
 * These read like "Kraków, Poland" or "Convention Center, Pittsburgh, PA, USA" — so the city is the
 * first field for a short one and the second-from-last otherwise. Wrong often enough that it must
 * only ever *narrow* an interest that asked for a city, never be shown as fact.
 */
export function cityOf(location: string | undefined): string | undefined {
  if (!location) return undefined;
  const parts = location.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return undefined;
  if (parts.length <= 2) return parts[0];
  return parts[parts.length - 2];
}

export const pythonOrg: EventSource = {
  id: 'python-org',
  label: 'python.org events',
  async fetchEvents(ctx: SourceContext): Promise<RawEvent[]> {
    return toRawEvents(await fetchText(ctx, PYTHON_ORG_ICAL, {}, 30000));
  },
};
