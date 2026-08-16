/*
 * Reading the songbook at build time.
 *
 * Lives here rather than inline in the four pages so all of them index the same way, and so the
 * only thing that crosses into the island is the compact `LibraryIndex` — a few hundred bytes of
 * titles and slugs, not the song texts.
 *
 * `astro:content` is a build-time module, which is why this file is not imported by anything under
 * `src/utils/transpose/` that the browser loads.
 */

import { getCollection } from 'astro:content';
import { analyseSongs } from './library';
import type { LibraryIndex } from './library';

export async function songLibrary(): Promise<LibraryIndex> {
  const songs = await getCollection('songs', ({ data }) => data.published);
  return analyseSongs(
    songs.map((entry) => ({
      title: entry.data.title,
      author: entry.data.author,
      slug: entry.data.slug,
      body: entry.body ?? '',
    }))
  );
}
