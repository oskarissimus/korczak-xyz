import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Separate collections for each language to avoid ID conflicts
const blogEnCollection = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/blog/en' }),
  schema: ({ image }) => z.object({
    title: z.string(),
    slug: z.string(),
    date: z.coerce.date(),
    published: z.boolean(),
    featuredImage: image().optional(),
    language: z.enum(['en', 'pl']),
  }),
});

const blogPlCollection = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/blog/pl' }),
  schema: ({ image }) => z.object({
    title: z.string(),
    slug: z.string(),
    date: z.coerce.date(),
    published: z.boolean(),
    featuredImage: image().optional(),
    language: z.enum(['en', 'pl']),
  }),
});

const coursesEnCollection = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/courses/en' }),
  schema: ({ image }) => z.object({
    title: z.string(),
    slug: z.string(),
    date: z.coerce.date(),
    published: z.boolean(),
    excerpt: z.string().optional(),
    featuredImageColor: image().optional(),
    featuredImageBW: image().optional(),
    language: z.enum(['en', 'pl']),
  }),
});

const coursesPlCollection = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/courses/pl' }),
  schema: ({ image }) => z.object({
    title: z.string(),
    slug: z.string(),
    date: z.coerce.date(),
    published: z.boolean(),
    excerpt: z.string().optional(),
    featuredImageColor: image().optional(),
    featuredImageBW: image().optional(),
    language: z.enum(['en', 'pl']),
  }),
});

const songsCollection = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/songs' }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    author: z.string(),
    published: z.boolean(),
    language: z.literal('pl'),
    dateAdded: z.coerce.date(),
  }),
});

export const collections = {
  'blog-en': blogEnCollection,
  'blog-pl': blogPlCollection,
  'courses-en': coursesEnCollection,
  'courses-pl': coursesPlCollection,
  songs: songsCollection,
};
