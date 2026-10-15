-- Migration 004: processing_status / processing_error
--
-- Decouples "row exists" from "ingest finished". REST callers get the row id
-- back as soon as the cheap sync prelude (dedup + blob upload + early insert)
-- completes; the heavy pipeline (metadata, chunking, embedding, graph edges)
-- runs in the background and flips processing_status from 'pending' to 'ready'
-- (or 'failed' with an error string) when it lands.
--
-- Existing rows default to 'ready' so retrieval/search semantics don't change.

BEGIN;

ALTER TABLE content_items
  ADD COLUMN IF NOT EXISTS processing_status text NOT NULL DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS processing_error text;

ALTER TABLE content_items
  DROP CONSTRAINT IF EXISTS content_items_processing_status_check;

ALTER TABLE content_items
  ADD CONSTRAINT content_items_processing_status_check
    CHECK (processing_status IN ('pending', 'ready', 'failed'));

-- Belt-and-suspenders: if a row somehow ended up NULL (rerun edge case before
-- the NOT NULL was applied), force it to 'ready'.
UPDATE content_items SET processing_status = 'ready' WHERE processing_status IS NULL;

-- Partial index: most rows are 'ready'; we only ever query for the others
-- (admin views, retry, search filtering), so a partial index keeps it small.
CREATE INDEX IF NOT EXISTS content_items_processing_status_idx
  ON content_items (processing_status)
  WHERE processing_status <> 'ready';

COMMIT;
