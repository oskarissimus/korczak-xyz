// Parse a Wolne Lektury plain-text book into typeable passages.
import type { Book } from './types';

// Passages longer than this are split at sentence boundaries so a single
// passage stays comfortably typeable in one sitting.
const MAX_PASSAGE_LENGTH = 240;

interface ParseOptions {
  id: string;
  title: string;
  author: string;
}

// Strip the Wolne Lektury header (author / title / translator / ISBN) and the
// trailing license block, returning only the narrative body.
function extractBody(raw: string): string {
  let text = raw.replace(/\r\n/g, '\n');

  // Footer: everything from the separator line ("-----") onward is licensing.
  const separator = text.search(/\n-{3,}\n/);
  if (separator !== -1) {
    text = text.slice(0, separator);
  }

  // Header: drop everything up to and including the ISBN line.
  const lines = text.split('\n');
  const isbnIndex = lines.findIndex((line) => /^ISBN/i.test(line.trim()));
  const bodyLines = isbnIndex !== -1 ? lines.slice(isbnIndex + 1) : lines;

  return bodyLines.join('\n');
}

// Remove inline markup and normalize whitespace within a paragraph.
function normalizeParagraph(paragraph: string): string {
  return paragraph
    .replace(/\*/g, '') // *emphasis* markers
    .replace(/\s+/g, ' ') // collapse intra-paragraph line wraps
    .trim();
}

// Greedily split an over-long paragraph at sentence boundaries.
function splitLongParagraph(paragraph: string): string[] {
  if (paragraph.length <= MAX_PASSAGE_LENGTH) return [paragraph];

  // Keep the punctuation attached to each sentence.
  const sentences = paragraph.match(/[^.!?…]+[.!?…]+["'”’)]*\s*|[^.!?…]+$/g);
  if (!sentences) return [paragraph];

  const passages: string[] = [];
  let current = '';
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if (current && (current.length + 1 + sentence.length) > MAX_PASSAGE_LENGTH) {
      passages.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) passages.push(current);
  return passages;
}

export function parseBook(raw: string, options: ParseOptions): Book {
  const body = extractBody(raw);

  const passages = body
    .split(/\n\s*\n/) // paragraphs are separated by blank lines
    .map(normalizeParagraph)
    .filter((p) => p.length > 0)
    .flatMap(splitLongParagraph);

  return {
    id: options.id,
    title: options.title,
    author: options.author,
    passages,
  };
}
