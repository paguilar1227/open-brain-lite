-- Migration 007: pinned_at column on content_items, todos, projects
--
-- Adds a nullable timestamp column representing when the user starred/pinned
-- the row. NULL = not pinned. The timestamp form (vs a boolean) gives the UI
-- two affordances at once:
--   - filter by pinned (WHERE pinned_at IS NOT NULL)
--   - order pins by most-recently-pinned first (ORDER BY pinned_at DESC)
--
-- Project membership is irrelevant here — pins are a per-user UI preference.
-- Single-user deployment so we don't need a separate user_id key.
--
-- Indexes are partial (WHERE pinned_at IS NOT NULL) so they cost almost
-- nothing on the unpinned majority but make "show me my pins" O(pinned-count).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.

BEGIN;

ALTER TABLE content_items ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;
ALTER TABLE todos         ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;
ALTER TABLE projects      ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_content_items_pinned ON content_items(pinned_at DESC) WHERE pinned_at IS NOT NULL AND archived = false;
CREATE INDEX IF NOT EXISTS idx_todos_pinned         ON todos(pinned_at DESC)         WHERE pinned_at IS NOT NULL AND archived = false;
CREATE INDEX IF NOT EXISTS idx_projects_pinned      ON projects(pinned_at DESC)      WHERE pinned_at IS NOT NULL;

COMMIT;
