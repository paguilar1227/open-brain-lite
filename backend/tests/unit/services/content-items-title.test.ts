// Regression test for the reprocess-title-preserve logic. The bug it pins:
// before the fix, `rerunIngestTail` preserved ANY non-placeholder title on
// the existing row, which meant a stale auto-generated title (e.g. the
// "(no text content)" sentinel produced by a failed stub-mode OCR run) would
// survive every subsequent reprocess. The fix narrows preservation to titles
// the user explicitly set (title_source = 'user'); filename- and AI-derived
// titles return undefined so the metadata extractor's fresh title wins.
import { describe, it, expect } from 'vitest';
import { pickPreservedTitle } from '../../../src/services/content-items.js';

describe('pickPreservedTitle (reprocess title-preserve policy)', () => {
  it('preserves a user-set title verbatim', () => {
    expect(pickPreservedTitle({ title: 'My favorite paper', title_source: 'user' })).toBe('My favorite paper');
  });

  it('drops a filename-derived title so the extractor refreshes it', () => {
    // This is the bug the fix addresses — "(no text content)" was a
    // filename-source title from a failed first ingest that survived reprocess.
    expect(pickPreservedTitle({ title: '(no text content)', title_source: 'filename' })).toBeUndefined();
    expect(pickPreservedTitle({ title: 'sample.pdf', title_source: 'filename' })).toBeUndefined();
  });

  it('drops an AI-generated title so the extractor can refresh it', () => {
    expect(pickPreservedTitle({ title: 'Stale auto title', title_source: 'ai_generated' })).toBeUndefined();
  });

  it('always drops the "Processing…" placeholder, even when title_source is user', () => {
    // A user can set the title BEFORE ingest completes, in which case the
    // placeholder "Processing… <url>" can briefly be the stored title with
    // source 'user'. We treat that as a placeholder regardless of source so
    // reprocess doesn't lock it in.
    expect(pickPreservedTitle({ title: 'Processing… https://example.com', title_source: 'user' })).toBeUndefined();
    expect(pickPreservedTitle({ title: 'Processing…', title_source: 'filename' })).toBeUndefined();
  });
});
