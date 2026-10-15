/**
 * Text chunking with sliding window and overlap.
 *
 * Default: 500 tokens per chunk with 100-token overlap.
 * Approximates tokens as ~4 chars (English average). Good enough for
 * chunk sizing; we don't need exact token counts — we need reasonable
 * chunk boundaries.
 */

export interface ChunkingOptions {
  chunkSize?: number;    // tokens per chunk
  overlap?: number;       // tokens of overlap between adjacent chunks
}

const DEFAULTS = { chunkSize: 500, overlap: 100 };
const CHARS_PER_TOKEN = 4;

export function approximateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Split text into overlapping chunks. Respects sentence boundaries when possible. */
export function chunkText(text: string, opts: ChunkingOptions = {}): string[] {
  const chunkSize = opts.chunkSize ?? DEFAULTS.chunkSize;
  const overlap = opts.overlap ?? DEFAULTS.overlap;

  const chunkChars = chunkSize * CHARS_PER_TOKEN;
  const overlapChars = overlap * CHARS_PER_TOKEN;
  const strideChars = chunkChars - overlapChars;

  if (text.length <= chunkChars) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + chunkChars, text.length);

    // Try to end at a sentence boundary if we're not at the end of the text
    if (end < text.length) {
      const sentenceEnd = findSentenceBoundary(text, end, Math.max(start + strideChars, end - 200));
      if (sentenceEnd > start) end = sentenceEnd;
    }

    chunks.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = Math.max(0, end - overlapChars);
  }

  return chunks.filter((c) => c.length > 0);
}

/** Find the nearest sentence-ending punctuation before a hard cutoff, above a floor. */
function findSentenceBoundary(text: string, idealEnd: number, floor: number): number {
  for (let i = idealEnd; i > floor; i--) {
    const ch = text[i];
    if (ch === '.' || ch === '!' || ch === '?' || ch === '\n') {
      return i + 1;
    }
  }
  return idealEnd;
}
