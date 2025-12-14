#!/usr/bin/env node
import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import prettier from 'prettier';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    url: 'http://localhost:9000',
    output: path.resolve(__dirname, 'snapshots'),
    startPaths: ['/'],
    concurrency: 5,
    clean: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) {
      config.url = args[i + 1];
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      config.output = path.resolve(args[i + 1]);
      i++;
    } else if (args[i] === '--start' && args[i + 1]) {
      config.startPaths = args[i + 1].split(',');
      i++;
    } else if (args[i] === '--concurrency' && args[i + 1]) {
      config.concurrency = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--clean') {
      config.clean = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Snapshot Crawler - Capture HTML snapshots of a website

Usage: node crawler.js [options]

Options:
  --url <url>           Base URL of the site to crawl (default: http://localhost:9000)
  --output <dir>        Output directory for snapshots (default: ./snapshots)
  --start <paths>       Comma-separated start paths (default: /)
  --concurrency <n>     Number of parallel requests (default: 5)
  --clean               Strip scripts, styles, and class attributes for clean HTML
  --help, -h            Show this help message

Examples:
  node crawler.js --url http://localhost:3000 --output ./snapshots-next
  node crawler.js --url http://localhost:9000 --start /,/pl/ --output ./snapshots-gatsby
  node crawler.js --concurrency 10 --url http://localhost:3000
`);
      process.exit(0);
    }
  }

  return config;
}

// Normalize a path for consistent comparison and file naming
function normalizePath(urlOrPath, baseUrl) {
  try {
    const url = new URL(urlOrPath, baseUrl);
    let pathname = url.pathname;
    if (pathname !== '/' && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    return pathname;
  } catch {
    let pathname = urlOrPath;
    if (pathname !== '/' && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    return pathname;
  }
}

// Convert a path to a filename
function pathToFilename(urlPath, baseUrl) {
  const normalized = normalizePath(urlPath, baseUrl);
  if (normalized === '/') {
    return 'index.html';
  }
  return normalized.slice(1) + '.html';
}

// Clean HTML by removing scripts, styles, and class attributes
async function cleanHtml(page) {
  return await page.evaluate(() => {
    // Remove script tags
    document.querySelectorAll('script').forEach(el => el.remove());

    // Remove style tags
    document.querySelectorAll('style').forEach(el => el.remove());

    // Remove noscript tags (often contain duplicate content)
    document.querySelectorAll('noscript').forEach(el => el.remove());

    // Remove stylesheet links
    document.querySelectorAll('link[rel="stylesheet"]').forEach(el => el.remove());

    // Clean up head - keep only essential meta tags
    const head = document.head;
    if (head) {
      [...head.children].forEach(el => {
        const tagName = el.tagName.toLowerCase();
        // Keep charset meta
        if (tagName === 'meta' && el.getAttribute('charset')) return;
        // Keep viewport meta
        if (tagName === 'meta' && el.getAttribute('name') === 'viewport') return;
        // Keep description meta
        if (tagName === 'meta' && el.getAttribute('name') === 'description') return;
        // Keep image meta
        if (tagName === 'meta' && el.getAttribute('name') === 'image') return;
        // Keep icon link
        if (tagName === 'link' && el.getAttribute('rel') === 'icon') return;
        // Keep title
        if (tagName === 'title') return;
        // Remove everything else
        el.remove();
      });
    }

    // Simplify picture elements - replace with simple img
    document.querySelectorAll('picture').forEach(picture => {
      const img = picture.querySelector('img');
      if (img) {
        const alt = img.getAttribute('alt') || '';
        const simpleImg = document.createElement('img');
        simpleImg.setAttribute('alt', alt);
        picture.replaceWith(simpleImg);
      } else {
        picture.remove();
      }
    });

    // Simplify figure elements - extract img and caption as separate elements
    document.querySelectorAll('figure').forEach(figure => {
      const img = figure.querySelector('img');
      const figcaption = figure.querySelector('figcaption');
      const parent = figure.parentNode;

      if (img) {
        const alt = img.getAttribute('alt') || (figcaption ? figcaption.textContent.trim() : '');
        const simpleImg = document.createElement('img');
        simpleImg.setAttribute('alt', alt);
        // Wrap in p like Astro does
        const p = document.createElement('p');
        p.appendChild(simpleImg);
        parent.insertBefore(p, figure);
      }
      figure.remove();
    });

    // Simplify remaining img elements - keep only alt attribute, remove empty alt images
    document.querySelectorAll('img').forEach(img => {
      const alt = img.getAttribute('alt') || '';
      // Remove images with empty alt (spacer/placeholder images)
      if (!alt.trim()) {
        img.remove();
        return;
      }
      // Remove all attributes except alt
      [...img.attributes].forEach(attr => {
        if (attr.name !== 'alt') {
          img.removeAttribute(attr.name);
        }
      });
      img.setAttribute('alt', alt);
    });

    // Remove class attributes from all elements
    document.querySelectorAll('[class]').forEach(el => el.removeAttribute('class'));

    // Remove style attributes from all elements
    document.querySelectorAll('[style]').forEach(el => el.removeAttribute('style'));

    // Remove data-* attributes (framework artifacts)
    document.querySelectorAll('*').forEach(el => {
      [...el.attributes]
        .filter(attr => attr.name.startsWith('data-'))
        .forEach(attr => el.removeAttribute(attr.name));
    });

    // Remove aria-hidden divs that are just placeholders
    document.querySelectorAll('div[aria-hidden="true"]').forEach(el => {
      if (!el.textContent.trim()) {
        el.remove();
      }
    });

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

    // Remove HTML comments
    const walker = document.createTreeWalker(
      document.documentElement,
      NodeFilter.SHOW_COMMENT,
      null,
      false
    );
    const comments = [];
    while (walker.nextNode()) {
      comments.push(walker.currentNode);
    }
    comments.forEach(comment => comment.remove());

    // 1. Remove dev toolbars (gatsby-qod, astro-dev-toolbar, etc.)
    document.querySelectorAll('gatsby-qod, astro-dev-toolbar').forEach(el => el.remove());

    // 2. Remove checked attribute from checkboxes (runtime state, not markup)
    document.querySelectorAll('input[type="checkbox"]').forEach(el =>
      el.removeAttribute('checked')
    );

    // 3. Normalize SVG fill - remove fill from both svg and path (visual noise)
    document.querySelectorAll('svg').forEach(svg => {
      svg.removeAttribute('fill');
      svg.querySelectorAll('path').forEach(path => {
        path.removeAttribute('fill');
      });
    });

    // 4. Remove empty divs
    function removeEmptyDivs() {
      let removed;
      do {
        removed = false;
        document.querySelectorAll('div').forEach(div => {
          if (!div.innerHTML.trim() || (div.children.length === 0 && !div.textContent.trim())) {
            div.remove();
            removed = true;
          }
        });
      } while (removed);
    }
    removeEmptyDivs();

    // 5. Unwrap single-child wrapper divs (collapse redundant nesting)
    function unwrapSingleChildDivs() {
      let unwrapped;
      do {
        unwrapped = false;
        document.querySelectorAll('div').forEach(div => {
          // If div has only one child element and no text content
          if (div.children.length === 1 && !div.textContent.replace(div.children[0].textContent, '').trim()) {
            const child = div.children[0];
            // Don't unwrap if parent needs the div for structure
            if (child.tagName === 'DIV' || child.tagName === 'IMG') {
              div.replaceWith(child);
              unwrapped = true;
            }
          }
        });
      } while (unwrapped);
    }
    unwrapSingleChildDivs();

    // Unwrap spans that only contain block elements (no text siblings)
    document.querySelectorAll('span').forEach(span => {
      // Skip spans with meaningful attributes
      if (span.getAttribute('role') || span.getAttribute('aria-label')) return;
      // Skip spans with direct text content
      const hasDirectText = [...span.childNodes].some(
        node => node.nodeType === 3 && node.textContent.trim()
      );
      if (hasDirectText) return;
      // Unwrap if contains only block elements
      const blockTags = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'TABLE', 'FIGURE'];
      const allBlockChildren = [...span.children].every(child => blockTags.includes(child.tagName));
      if (span.children.length > 0 && allBlockChildren) {
        while (span.firstChild) {
          span.parentNode.insertBefore(span.firstChild, span);
        }
        span.remove();
      }
    });

    // Remove lang attribute from html (or normalize it)
    document.documentElement.removeAttribute('lang');

    return document.documentElement.outerHTML;
  });
}

// Normalize quotes (curly to straight)
function normalizeQuotes(text) {
  return text
    .replace(/[\u2018\u2019]/g, "'")  // curly single quotes to straight
    .replace(/[\u201C\u201D]/g, '"'); // curly double quotes to straight
}

// Format HTML using Prettier
async function formatHtml(html) {
  // Normalize quotes before formatting
  html = normalizeQuotes(html);

  return await prettier.format(html, {
    parser: 'html',
    printWidth: 120,
    tabWidth: 2,
    useTabs: false,
    htmlWhitespaceSensitivity: 'ignore',  // Ignore whitespace differences
    bracketSameLine: true,                 // Keep > on same line
    singleAttributePerLine: false,         // Keep attributes together
  });
}

// Check if a path should be crawled
function shouldCrawl(pathname) {
  if (!pathname) return false;
  if (!pathname.startsWith('/')) return false;
  const ext = path.extname(pathname.split('?')[0]);
  if (ext && !['.html', '.htm', ''].includes(ext)) {
    return false;
  }
  return true;
}

// Fetch a single page and extract links
async function fetchPage(page, urlPath, config) {
  const url = new URL(urlPath, config.url).href;
  const normalizedPath = normalizePath(urlPath, config.url);

  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Wait for content to render (SPAs like Gatsby/React need time to hydrate)
    await page.waitForTimeout(2000);

    if (!response || response.status() >= 400) {
      return { path: normalizedPath, status: response?.status() || 0, links: [] };
    }

    // Extract links BEFORE cleaning (cleanHtml modifies the DOM)
    const currentUrl = page.url();
    const links = await page.$$eval('a[href]', (anchors, pageUrl) => {
      return anchors.map((a) => {
        const href = a.getAttribute('href');
        if (!href) return null;
        try {
          const resolved = new URL(href, pageUrl);
          return resolved.pathname;
        } catch {
          return null;
        }
      }).filter(Boolean);
    }, currentUrl);

    // Get HTML content
    let html = config.clean ? await cleanHtml(page) : await page.content();

    // Format HTML if clean mode is enabled
    if (config.clean) {
      html = await formatHtml(html);
    }

    // Save HTML file
    const filename = pathToFilename(normalizedPath, config.url);
    const filePath = path.join(config.output, filename);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, html);

    return {
      path: normalizedPath,
      file: filename,
      status: response.status(),
      links: links.filter(shouldCrawl),
    };

  } catch (error) {
    return { path: normalizedPath, status: 0, error: error.message, links: [] };
  }
}

// Crawl the site with parallel workers
async function crawlSite(browser, config) {
  const visited = new Set();
  const queue = [...config.startPaths];
  const results = [];
  let inFlight = 0;
  let completed = 0;

  // Create output directory
  await fs.mkdir(config.output, { recursive: true });

  // Create a pool of pages
  const context = await browser.newContext();
  const pages = await Promise.all(
    Array(config.concurrency).fill(null).map(() => context.newPage())
  );
  const availablePages = [...pages];

  console.log(`\nCrawling ${config.url} (${config.concurrency} parallel workers)`);
  console.log(`Output: ${config.output}\n`);

  return new Promise((resolve) => {
    const processQueue = async () => {
      // Start new fetches while we have capacity and queue items
      while (availablePages.length > 0 && queue.length > 0) {
        const urlPath = queue.shift();
        const normalizedPath = normalizePath(urlPath, config.url);

        if (visited.has(normalizedPath)) continue;
        visited.add(normalizedPath);

        const page = availablePages.pop();
        inFlight++;

        fetchPage(page, urlPath, config).then((result) => {
          inFlight--;
          completed++;
          availablePages.push(page);

          if (result.status >= 200 && result.status < 400) {
            results.push({
              path: result.path,
              file: result.file,
              linksFound: result.links.length,
            });
            process.stdout.write(`\r[${completed}] ${result.path}`);
            process.stdout.write(' '.repeat(Math.max(0, 60 - result.path.length)));

            // Add new links to queue
            for (const link of result.links) {
              const normalized = normalizePath(link, config.url);
              if (!visited.has(normalized) && !queue.includes(link)) {
                queue.push(link);
              }
            }
          }

          // Continue processing
          processQueue();
        });
      }

      // Check if we're done
      if (inFlight === 0 && queue.length === 0) {
        console.log('\n');
        await context.close();
        resolve(results);
      }
    };

    processQueue();
  });
}

// Generate manifest
async function generateManifest(results, config) {
  const manifest = {
    timestamp: new Date().toISOString(),
    baseUrl: config.url,
    totalPages: results.length,
    routes: results,
  };

  const manifestPath = path.join(config.output, 'manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return manifest;
}

// Main function
async function main() {
  const config = parseArgs();
  let browser = null;
  const startTime = Date.now();

  try {
    // Check if server is reachable
    const testResponse = await fetch(config.url).catch(() => null);
    if (!testResponse || !testResponse.ok) {
      console.error(`Error: Cannot reach ${config.url}`);
      console.error('Make sure the server is running before crawling.');
      process.exit(1);
    }

    browser = await chromium.launch({ headless: true });
    const results = await crawlSite(browser, config);
    const manifest = await generateManifest(results, config);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('=== Crawl Complete ===');
    console.log(`Pages captured: ${manifest.totalPages}`);
    console.log(`Time: ${elapsed}s`);
    console.log(`Output: ${config.output}`);

  } catch (error) {
    console.error('Crawl failed:', error.message);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
}

main();
