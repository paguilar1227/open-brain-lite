-- Migration 006: ingest_completed_at column
--
-- Companion to migration 004 (processing_status). Lets the polling endpoint
-- (GET /api/v1/content/:id/status) report when the async pipeline finished
-- without conflating it with row-level updated_at, which gets bumped on
-- every edit (retag, retitle) — making it useless as an "ingest finished"
-- signal once the user starts editing the row post-ingest.
--
-- Started timestamp is intentionally NOT a new column: the row is inserted
-- in the sync prelude of createContentItem, so created_at is already the
-- ingest start. The polling endpoint exposes created_at as
-- ingest_started_at without storing it twice.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, and the backfill only touches rows
-- where ingest_completed_at is still NULL.

BEGIN;

ALTER TABLE content_items
  ADD COLUMN IF NOT EXISTS ingest_completed_at TIMESTAMPTZ;

-- Backfill: existing 'ready' rows finished long ago. Use updated_at as the
-- best proxy. 'failed' rows (none expected today, but defensive) get the
-- same treatment. 'pending' rows stay NULL — that's the intended semantics.
UPDATE content_items
   SET ingest_completed_at = updated_at
 WHERE processing_status IN ('ready', 'failed')
   AND ingest_completed_at IS NULL;

COMMIT;
