/**
 * PDF text extraction via pdf-parse v2 (class-based API built on pdfjs-dist).
 */

import { PDFParse } from 'pdf-parse';

/**
 * Strip ASCII control bytes that pdf-parse can leak through (form-feed,
 * vertical-tab, null, etc). Keeps \t \n \r — those are valid whitespace
 * the chunker expects. Without this, downstream JSON serialization (API
 * responses) contains unescaped control chars that break strict parsers
 * like jq, and the bytes are useless for retrieval anyway.
 *
 * Constructed via RegExp() rather than a regex literal so the source file
 * stays free of invisible control bytes.
 */
const CONTROL_CHAR_RE = new RegExp(
  '[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]',
  'g',
);

function sanitizeControlChars(text: string): string {
  return text.replace(CONTROL_CHAR_RE, ' ');
}

/** Extract text content from a PDF buffer. Returns the concatenated text and page count. */
export async function extractPdfText(data: Buffer): Promise<{ text: string; pageCount: number }> {
  const parser = new PDFParse({ data: new Uint8Array(data) });
  try {
    const result = await parser.getText();
    return {
      text: sanitizeControlChars(result.text).trim(),
      pageCount: result.total,
    };
  } finally {
    await parser.destroy();
  }
}
