-- Migration 005: backfill control-char sanitization on content_items.content
--
-- Pre-fix-#32 ingests of PDFs left raw C0 control bytes (form-feed, vertical
-- tab, etc.) inside content_items.content. New ingests are sanitized at the
-- pdf-parse layer (src/providers/pdf-extract.ts), but existing rows still
-- carry the bytes. Strict JSON parsers (jq, browser JSON.parse) reject the
-- resulting unescaped chars in /api/v1/content list responses, which would
-- bite the UI when it lists those rows.
--
-- Mirrors the in-process sanitizer's character class:
--   x01-x08, x0b, x0c, x0e-x1f, x7f
-- (Keeps tab/newline/CR as valid whitespace. NUL is impossible in PG TEXT.)
--
-- Idempotent: only updates rows that still contain a matching byte. Running
-- twice on a clean corpus is a no-op.

BEGIN;

UPDATE content_items
   SET content    = regexp_replace(
                      content,
                      E'[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]',
                      ' ',
                      'g'
                    ),
       updated_at = now()
 WHERE content IS NOT NULL
   AND content ~ E'[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]';

COMMIT;
