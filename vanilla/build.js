#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
import { marked } from 'marked';
import Prism from 'prismjs';

// Load Prism languages
import 'prismjs/components/prism-javascript.js';
import 'prismjs/components/prism-typescript.js';
import 'prismjs/components/prism-bash.js';
import 'prismjs/components/prism-json.js';
import 'prismjs/components/prism-python.js';
import 'prismjs/components/prism-css.js';
import 'prismjs/components/prism-markup.js';

const CONTENT_DIR = './content';
const TEMPLATES_DIR = './templates';
const OUTPUT_DIR = '.';

// Configure marked
marked.setOptions({
  gfm: true,
  breaks: false,
});

// Custom renderer for code blocks
const renderer = new marked.Renderer();
const originalCodeRenderer = renderer.code.bind(renderer);

renderer.code = function(code, language) {
  // Handle song blocks specially - render as plaintext with monospace
  if (language === 'song') {
    return `<pre class="song">${escapeHtml(code)}</pre>`;
  }

  // Syntax highlighting for other code blocks
  if (language && Prism.languages[language]) {
    const highlighted = Prism.highlight(code, Prism.languages[language], language);
    return `<pre class="language-${language}"><code class="language-${language}">${highlighted}</code></pre>`;
  }

  return originalCodeRenderer(code, language);
};

marked.use({ renderer });

async function build() {
  console.log('Building site...');

  // Read templates
  const baseTemplate = await fs.readFile(`${TEMPLATES_DIR}/base.html`, 'utf-8');
  const blogPostTemplate = await fs.readFile(`${TEMPLATES_DIR}/blog-post.html`, 'utf-8');
  const songTemplate = await fs.readFile(`${TEMPLATES_DIR}/song.html`, 'utf-8');
  const blogListTemplate = await fs.readFile(`${TEMPLATES_DIR}/blog-list.html`, 'utf-8');
  const songsListTemplate = await fs.readFile(`${TEMPLATES_DIR}/songs-list.html`, 'utf-8');

  // Process blog posts
  const blogPosts = { en: [], pl: [] };
  for (const lang of ['en', 'pl']) {
    const posts = await processContentType('blog', lang, blogPostTemplate, baseTemplate);
    blogPosts[lang] = posts;
  }

  // Process songs (Polish only)
  const songs = { pl: [] };
  const songItems = await processContentType('songs', 'pl', songTemplate, baseTemplate);
  songs.pl = songItems;

  // Generate listing pages
  await generateBlogListing(blogPosts, blogListTemplate, baseTemplate);
  await generateSongsListing(songs, songsListTemplate, baseTemplate);

  // Copy static pages
  await copyStaticPages(baseTemplate);

  console.log('Build complete!');
}

async function processContentType(type, lang, template, baseTemplate) {
  const contentPath = `${CONTENT_DIR}/${type}/${lang}`;
  const items = [];

  try {
    const entries = await fs.readdir(contentPath, { withFileTypes: true });

    for (const entry of entries) {
      let filePath;
      let content;

      if (entry.isDirectory()) {
        // Look for .mdx or .md file inside the directory
        const dirPath = `${contentPath}/${entry.name}`;
        const files = await fs.readdir(dirPath);
        const mdFile = files.find(f => f.endsWith('.mdx') || f.endsWith('.md'));
        if (!mdFile) continue;
        filePath = `${dirPath}/${mdFile}`;
      } else if (entry.name.endsWith('.mdx') || entry.name.endsWith('.md')) {
        filePath = `${contentPath}/${entry.name}`;
      } else {
        continue;
      }

      content = await fs.readFile(filePath, 'utf-8');
      const { data: frontmatter, content: markdown } = matter(content);

      if (!frontmatter.published) continue;

      // Convert markdown to HTML
      let html = convertMarkdown(markdown, type);

      // Apply template
      html = template
        .replace(/\{\{title\}\}/g, frontmatter.title || '')
        .replace(/\{\{author\}\}/g, frontmatter.author || '')
        .replace(/\{\{date\}\}/g, formatDate(frontmatter.date))
        .replace(/\{\{excerpt\}\}/g, frontmatter.excerpt || '')
        .replace('{{content}}', html);

      // Handle course images
      if (type === 'courses' && frontmatter.featuredImageColor) {
        const colorImg = fixImagePath(frontmatter.featuredImageColor);
        const bwImg = fixImagePath(frontmatter.featuredImageBW || frontmatter.featuredImageColor);
        html = html.replace('{{featuredImageColor}}', colorImg);
        html = html.replace('{{featuredImageBW}}', bwImg);
      }

      // Apply base template
      const fullHtml = baseTemplate
        .replace(/\{\{title\}\}/g, `${frontmatter.title} | korczak.xyz`)
        .replace('{{lang}}', lang)
        .replace('{{content}}', html);

      // Write output
      const outputPath = lang === 'en'
        ? `${OUTPUT_DIR}/${type}/${frontmatter.slug}/index.html`
        : `${OUTPUT_DIR}/pl/${type}/${frontmatter.slug}/index.html`;

      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, fullHtml);

      // Add to items list for listing pages
      items.push({
        title: frontmatter.title,
        slug: frontmatter.slug,
        date: frontmatter.date,
        excerpt: frontmatter.excerpt || extractExcerpt(markdown),
        author: frontmatter.author,
        featuredImage: frontmatter.featuredImage ? fixImagePath(frontmatter.featuredImage) : null,
        featuredImageColor: frontmatter.featuredImageColor ? fixImagePath(frontmatter.featuredImageColor) : null,
        featuredImageBW: frontmatter.featuredImageBW ? fixImagePath(frontmatter.featuredImageBW) : null,
      });

      console.log(`  Built: ${type}/${lang}/${frontmatter.slug}`);
    }
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.error(`Error processing ${type}/${lang}:`, e);
    }
  }

  // Sort by date descending (for blog) or title (for others)
  if (type === 'blog') {
    items.sort((a, b) => new Date(b.date) - new Date(a.date));
  } else if (type === 'songs') {
    items.sort((a, b) => {
      const authorA = a.author || '';
      const authorB = b.author || '';
      if (authorA !== authorB) return authorA.localeCompare(authorB);
      return a.title.localeCompare(b.title);
    });
  } else {
    items.sort((a, b) => a.title.localeCompare(b.title));
  }

  return items;
}

function convertMarkdown(markdown, type) {
  // Remove import statements
  markdown = markdown.replace(/^import .+ from .+$/gm, '');

  // Convert Youtube component to web component
  markdown = markdown.replace(
    /<Youtube\s+videoId="([^"]+)"\s*\/>/g,
    '<youtube-embed video-id="$1"></youtube-embed>'
  );

  // Convert to HTML
  let html = marked.parse(markdown);

  // Fix image paths
  html = html.replace(/\.\.\/\.\.\/images\//g, '/assets/images/');
  html = html.replace(/\.\.\/images\//g, '/assets/images/');

  return html;
}

function fixImagePath(imagePath) {
  if (!imagePath) return '';
  return imagePath
    .replace(/^\.\.\/\.\.\/images\//, '/assets/images/')
    .replace(/^\.\.\/images\//, '/assets/images/')
    .replace(/^\.\/images\//, '/assets/images/');
}

function extractExcerpt(markdown, maxLength = 200) {
  // Remove imports, code blocks, and HTML
  let text = markdown
    .replace(/^import .+ from .+$/gm, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/#+\s+/g, '')
    .replace(/\n+/g, ' ')
    .trim();

  if (text.length > maxLength) {
    text = text.substring(0, maxLength).trim() + '...';
  }

  return text;
}

function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function generateBlogListing(blogPosts, template, baseTemplate) {
  for (const lang of ['en', 'pl']) {
    const posts = blogPosts[lang];

    const itemsHtml = posts.map(post => {
      const href = lang === 'en' ? `/blog/${post.slug}/` : `/pl/blog/${post.slug}/`;
      const imgHtml = post.featuredImage
        ? `<img src="${post.featuredImage}" alt="${post.title}" loading="lazy">`
        : '';

      return `
        <li class="blog-item">
          <h2><a href="${href}">${post.title}</a></h2>
          <div class="blog-item-content">
            ${imgHtml}
            <p>${post.excerpt}</p>
          </div>
          <hr>
          <span class="date">${formatDate(post.date)}</span>
        </li>
      `;
    }).join('');

    const html = template.replace('{{items}}', itemsHtml);
    const fullHtml = baseTemplate
      .replace(/\{\{title\}\}/g, 'Blog | korczak.xyz')
      .replace('{{lang}}', lang)
      .replace('{{content}}', html);

    const outputPath = lang === 'en'
      ? `${OUTPUT_DIR}/blog/index.html`
      : `${OUTPUT_DIR}/pl/blog/index.html`;

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, fullHtml);
    console.log(`  Built: blog/${lang}/index`);
  }
}

async function generateSongsListing(songs, template, baseTemplate) {
  // Songs are Polish only
  const items = songs.pl;

  const itemsHtml = items.map(song => {
    const href = `/pl/songs/${song.slug}/`;
    const displayText = song.author ? `${song.author}: ${song.title}` : song.title;
    return `<li><a href="${href}">${displayText}</a></li>`;
  }).join('');

  const html = template.replace('{{items}}', itemsHtml);

  // Polish version
  let fullHtml = baseTemplate
    .replace(/\{\{title\}\}/g, 'Teksty | korczak.xyz')
    .replace('{{lang}}', 'pl')
    .replace('{{content}}', html);

  await fs.mkdir(`${OUTPUT_DIR}/pl/songs`, { recursive: true });
  await fs.writeFile(`${OUTPUT_DIR}/pl/songs/index.html`, fullHtml);
  console.log('  Built: songs/pl/index');

  // English version (same content)
  fullHtml = baseTemplate
    .replace(/\{\{title\}\}/g, 'Songs | korczak.xyz')
    .replace('{{lang}}', 'en')
    .replace('{{content}}', html);

  await fs.mkdir(`${OUTPUT_DIR}/songs`, { recursive: true });
  await fs.writeFile(`${OUTPUT_DIR}/songs/index.html`, fullHtml);
  console.log('  Built: songs/en/index');
}

async function copyStaticPages(baseTemplate) {
  const staticPages = ['index', 'about', '404'];

  for (const page of staticPages) {
    try {
      const template = await fs.readFile(`${TEMPLATES_DIR}/${page}.html`, 'utf-8');

      // English version
      let fullHtml = baseTemplate
        .replace(/\{\{title\}\}/g, page === 'index' ? 'korczak.xyz' : `${capitalize(page)} | korczak.xyz`)
        .replace('{{lang}}', 'en')
        .replace('{{content}}', template);

      const enPath = page === 'index' ? `${OUTPUT_DIR}/index.html` : `${OUTPUT_DIR}/${page}/index.html`;
      await fs.mkdir(path.dirname(enPath), { recursive: true });
      await fs.writeFile(enPath, fullHtml);
      console.log(`  Built: ${page}/en`);

      // Polish version
      fullHtml = baseTemplate
        .replace(/\{\{title\}\}/g, page === 'index' ? 'korczak.xyz' : `${capitalize(page)} | korczak.xyz`)
        .replace('{{lang}}', 'pl')
        .replace('{{content}}', template);

      const plPath = page === 'index' ? `${OUTPUT_DIR}/pl/index.html` : `${OUTPUT_DIR}/pl/${page}/index.html`;
      await fs.mkdir(path.dirname(plPath), { recursive: true });
      await fs.writeFile(plPath, fullHtml);
      console.log(`  Built: ${page}/pl`);
    } catch (e) {
      if (e.code !== 'ENOENT') {
        console.error(`Error copying ${page}:`, e);
      }
    }
  }
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Run build
build().catch(console.error);
