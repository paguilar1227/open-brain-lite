import { describe, it, expect } from 'vitest';

// Verify the control-char sanitizer at the source level, not behind pdf-parse.
// pdf-parse itself is too heavy + non-deterministic for unit tests; we just
// need to know the sanitizer drops the right bytes.

const CONTROL_CHAR_RE = new RegExp(
  '[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]',
  'g',
);

function sanitizeControlChars(text: string): string {
  return text.replace(CONTROL_CHAR_RE, ' ');
}

// Build inputs with literal control bytes via fromCharCode so the test source
// stays free of invisible chars.
const FF = String.fromCharCode(0x0c);   // form-feed — pdf-parse leaves these between pages
const VT = String.fromCharCode(0x0b);   // vertical tab
const NUL = String.fromCharCode(0x00);
const SOH = String.fromCharCode(0x01);
const DEL = String.fromCharCode(0x7f);

describe('sanitizeControlChars (pdf-extract)', () => {
  it('strips form-feed, vertical-tab, null, DEL', () => {
    const dirty = `page1${FF}page2${VT}col1${NUL}end${DEL}done`;
    expect(sanitizeControlChars(dirty)).toBe('page1 page2 col1 end done');
  });

  it('keeps \\t \\n \\r intact', () => {
    const text = 'line1\nline2\rcol1\tcol2';
    expect(sanitizeControlChars(text)).toBe(text);
  });

  it('strips other low control chars (0x01..0x08, 0x0e..0x1f)', () => {
    const allLow = Array.from({ length: 0x1f - 0x0e + 1 }, (_, i) =>
      String.fromCharCode(0x0e + i),
    ).join('');
    const dirty = `a${SOH}b${allLow}c`;
    expect(sanitizeControlChars(dirty)).toMatch(/^a +b +c$/);
  });

  it('leaves unicode and ascii printable text untouched', () => {
    const text = 'pgvector + HNSW — café résumé 你好';
    expect(sanitizeControlChars(text)).toBe(text);
  });

  it('result is JSON-serializable without raw control bytes', () => {
    const dirty = `doc${FF}content${NUL}`;
    const cleaned = sanitizeControlChars(dirty);
    const json = JSON.stringify({ text: cleaned });
    expect(JSON.parse(json).text).toBe(cleaned);
    // No \u000X escape for the original control bytes — they're gone
    expect(json).not.toMatch(/\\u000[0-8bcef]/);
    expect(json).not.toMatch(/\\u001[0-9a-f]/);
  });
});
