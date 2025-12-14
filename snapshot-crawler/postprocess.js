#!/usr/bin/env node
/**
 * Postprocess existing HTML snapshot files to normalize framework-specific artifacts.
 * Use this to re-apply cleaning rules to already-captured snapshots without re-crawling.
 *
 * Usage: node postprocess.js <directory>
 * Example: node postprocess.js snapshots/gatsby
 */

import fs from 'fs/promises';
import path from 'path';
import { JSDOM } from 'jsdom';
import prettier from 'prettier';

async function postprocessHtml(html) {
  const dom = new JSDOM(html);
  const document = dom.window.document;

  // Unwrap <astro-island> elements (keep children)
  document.querySelectorAll('astro-island').forEach(island => {
    while (island.firstChild) {
      island.parentNode.insertBefore(island.firstChild, island);
    }
    island.remove();
  });

  // Unwrap Gatsby wrapper divs (keep children)
  ['#___gatsby', '#gatsby-focus-wrapper'].forEach(selector => {
    const wrapper = document.querySelector(selector);
    if (wrapper) {
      while (wrapper.firstChild) {
        wrapper.parentNode.insertBefore(wrapper.firstChild, wrapper);
      }
      wrapper.remove();
    }
  });
  document.querySelector('#gatsby-announcer')?.remove();

  // Normalize favicon URLs (strip query strings)
  document.querySelectorAll('link[rel="icon"]').forEach(link => {
    const href = link.getAttribute('href');
    if (href) link.setAttribute('href', href.split('?')[0]);
  });

  // Remove cosmetic SVG attributes (keep content)
  document.querySelectorAll('svg').forEach(svg => {
    ['xmlns', 'aria-hidden', 'focusable', 'role'].forEach(attr =>
      svg.removeAttribute(attr)
    );
  });

  // Remove aria-current attributes
  document.querySelectorAll('[aria-current]').forEach(el =>
    el.removeAttribute('aria-current')
  );

  // Remove element IDs
  document.querySelectorAll('[id]').forEach(el =>
    el.removeAttribute('id')
  );

  // Remove hreflang attributes
  document.querySelectorAll('[hreflang]').forEach(el =>
    el.removeAttribute('hreflang')
  );

  // Remove tabindex attributes
  document.querySelectorAll('[tabindex]').forEach(el =>
    el.removeAttribute('tabindex')
  );

  // Get the processed HTML
  let processedHtml = dom.serialize();

  // Format with Prettier
  processedHtml = await prettier.format(processedHtml, {
    parser: 'html',
    printWidth: 120,
    tabWidth: 2,
    useTabs: false,
  });

  return processedHtml;
}

async function findHtmlFiles(dir) {
  const files = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findHtmlFiles(fullPath));
    } else if (entry.name.endsWith('.html')) {
      files.push(fullPath);
    }
  }

  return files;
}

async function main() {
  const targetDir = process.argv[2];

  if (!targetDir) {
    console.error('Usage: node postprocess.js <directory>');
    console.error('Example: node postprocess.js snapshots/gatsby');
    process.exit(1);
  }

  const resolvedDir = path.resolve(targetDir);

  try {
    await fs.access(resolvedDir);
  } catch {
    console.error(`Error: Directory not found: ${resolvedDir}`);
    process.exit(1);
  }

  console.log(`Postprocessing HTML files in: ${resolvedDir}`);

  const htmlFiles = await findHtmlFiles(resolvedDir);
  console.log(`Found ${htmlFiles.length} HTML files`);

  let processed = 0;
  for (const file of htmlFiles) {
    try {
      const html = await fs.readFile(file, 'utf-8');
      const processedHtml = await postprocessHtml(html);
      await fs.writeFile(file, processedHtml);
      processed++;
      process.stdout.write(`\r[${processed}/${htmlFiles.length}] ${path.relative(resolvedDir, file)}`);
      process.stdout.write(' '.repeat(Math.max(0, 60 - file.length)));
    } catch (error) {
      console.error(`\nError processing ${file}: ${error.message}`);
    }
  }

  console.log(`\n\nPostprocessing complete: ${processed} files updated`);
}

main();
