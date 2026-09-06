/*
 * JSON, split into coloured pieces — as data, never as markup.
 *
 * This exists for the events app's pipeline tab, where the whole point is reading a stored record
 * with your own eyes: a wall of one-colour text is exactly as unreadable as no JSON at all, and
 * the fields worth noticing (a null date, an empty tag list, a haystack that swallowed the page's
 * navigation) are the ones that hide in it.
 *
 * It returns **tokens rather than an HTML string**, and that is the one decision here worth
 * defending. The usual highlighter builds `<span class=…>` markup and the caller hands it to
 * `dangerouslySetInnerHTML` — which in this app would be scraped titles, scraped venue names and a
 * model's free-text sentence, all of them written by somebody else, injected into the page. Tokens
 * go through React's own escaping like any other string, so the shape of the data cannot become
 * the shape of the document.
 *
 * Generic on purpose: nothing here knows what an event is.
 */

export type JsonTokenKind = 'key' | 'string' | 'number' | 'literal' | 'punct';

export interface JsonToken {
  kind: JsonTokenKind;
  text: string;
}

/**
 * Strings, numbers and the three bare words, in that order.
 *
 * The order is what makes this safe without a real parser: a `"` starts an alternative that
 * consumes the whole string including its escapes, so a `null` or a `12` *inside* a title can
 * never be matched as a literal of its own. Everything the scan does not claim — braces, commas,
 * colons, indentation, newlines — is punctuation by subtraction, which is what keeps the
 * concatenation of every token byte-identical to the input.
 */
const SCAN = /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g;

/**
 * `JSON.stringify(value, null, indent)`, tokenised.
 *
 * A string is a `key` exactly when the next non-space character after it is a colon, which is the
 * whole of the distinction and needs no nesting state. `undefined` — which `JSON.stringify`
 * answers with nothing at all rather than with text — comes back as the literal word, because a
 * blank panel where a field should be is the one output a reader cannot tell from a bug.
 */
export function tokenizeJson(value: unknown, indent = 2): JsonToken[] {
  const text = JSON.stringify(value, null, indent) ?? 'undefined';
  const tokens: JsonToken[] = [];
  let at = 0;

  for (const match of text.matchAll(SCAN)) {
    const start = match.index ?? 0;
    if (start > at) tokens.push({ kind: 'punct', text: text.slice(at, start) });

    const raw = match[0];
    tokens.push({ kind: kindOf(raw, text.slice(start + raw.length)), text: raw });
    at = start + raw.length;
  }

  if (at < text.length) tokens.push({ kind: 'punct', text: text.slice(at) });
  return tokens;
}

function kindOf(raw: string, rest: string): JsonTokenKind {
  if (raw.startsWith('"')) return /^\s*:/.test(rest) ? 'key' : 'string';
  if (raw === 'true' || raw === 'false' || raw === 'null') return 'literal';
  return 'number';
}
