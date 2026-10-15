-- Migration 002: source_url column for URL-sourced content items
--
-- Content ingested from a URL (YouTube transcript, X thread, HTML article,
-- PDF URL, etc.) preserves the original URL here so retrieval results can
-- surface it as a citation. Also used as the dedup key for URL ingestion.

ALTER TABLE content_items ADD COLUMN IF NOT EXISTS source_url text;

-- Partial index: most items won't have a source_url, so index only the ones
-- that do. Speeds up dedup lookups without paying to index NULLs.
CREATE INDEX IF NOT EXISTS idx_content_items_source_url
  ON content_items(source_url) WHERE source_url IS NOT NULL;
