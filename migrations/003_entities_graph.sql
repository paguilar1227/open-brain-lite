-- ============================================================================
-- Graph foundation: entities + chunk → entity edges.
-- Also adds published_at on content_items for content-time (vs ingest-time)
-- aware retrieval (e.g. "papers published after 2023" irrespective of when
-- they were saved to Open Brain).
-- ============================================================================

-- Canonical entity registry. Entity resolution (Gemini Embedding 2 vs
-- "gemini-embedding-2-preview") collapses surface forms onto one row via
-- aliases + embedding similarity at ingest time.
CREATE TABLE entities (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  canonical_name  text NOT NULL,
  type            text NOT NULL
                  CHECK (type IN ('person', 'org', 'concept', 'tool', 'paper')),
  aliases         text[] NOT NULL DEFAULT '{}',
  embedding       vector(768) NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (canonical_name, type)
);

CREATE INDEX idx_entities_type    ON entities(type);
CREATE INDEX idx_entities_aliases ON entities USING GIN (aliases);

-- Chunk → entity mention edge. One row per (chunk, entity).
-- confidence comes from the Haiku extraction; mention_text preserves the
-- verbatim span that triggered the link (useful for explainability).
CREATE TABLE chunk_entities (
  chunk_id     uuid NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  entity_id   uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  confidence   real NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  mention_text text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chunk_id, entity_id)
);

CREATE INDEX idx_chunk_entities_entity ON chunk_entities(entity_id);

-- Content-time awareness. NULL for content with no explicit publication date
-- (the user's own notes, most HTML without bylines). Set from the metadata
-- extractor when detectable (arXiv papers, blog posts with visible dates,
-- YouTube upload dates).
ALTER TABLE content_items ADD COLUMN published_at timestamptz;

CREATE INDEX idx_content_items_published ON content_items(published_at)
  WHERE published_at IS NOT NULL;
