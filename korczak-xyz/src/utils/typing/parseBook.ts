// Parse a Wolne Lektury plain-text book into typeable passages.
import type { Book } from './types';

// Passages longer than this are split at sentence boundaries so a single
// passage stays comfortably typeable in one sitting.
const MAX_PASSAGE_LENGTH = 240;

interface ParseOptions {
  id: string;
  title: string;
  author: string;
  verse?: boolean;
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
    .replace(/…/g, '...') // normalize the ellipsis character to three dots
    .replace(/[—–]/g, '-') // normalize em/en dashes to a plain hyphen
    .replace(/[„”“«»‟]/g, '"') // normalize double quotes to a straight quote
    .replace(/\s+/g, ' ') // collapse intra-paragraph line wraps
    .trim();
}

// A stanza keeps its line breaks: each verse line ends in an Enter typed like any other
// character, the way the poem is read. A stanza is one passage when it fits; a longer one
// breaks between lines, at the last line that ends a sentence, so no passage starts or ends
// mid-sentence when the verse allows it. The limit is looser than prose's because a stanza
// cut in two for being a few characters over reads worse than a slightly long passage.
const MAX_STANZA_LENGTH = 320;
const ENDS_SENTENCE = /[.!?…]["'”’)]*$/;

function splitStanza(stanza: string): string[] {
  const lines = stanza.split('\n').map(normalizeParagraph).filter((l) => l.length > 0);
  const passages: string[] = [];
  let current: string[] = [];
  const length = (ls: string[]) => ls.join('\n').length;
  for (const line of lines) {
    if (current.length > 0 && length([...current, line]) > MAX_STANZA_LENGTH) {
      let cut = current.length;
      for (let i = current.length - 1; i > 0; i--) {
        if (ENDS_SENTENCE.test(current[i - 1])) {
          cut = i;
          break;
        }
      }
      passages.push(current.slice(0, cut).join('\n'));
      current = current.slice(cut);
    }
    current.push(line);
  }
  if (current.length > 0) passages.push(current.join('\n'));
  return passages;
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

  const paragraphs = body.split(/\n\s*\n/); // paragraphs are separated by blank lines
  const passages = options.verse
    ? paragraphs.flatMap(splitStanza)
    : paragraphs
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
