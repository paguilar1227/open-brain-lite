-- Migration 008: manual ordering for todos.
--
-- Adds an optional `manual_order` column. NULL means "no manual order
-- — sort by the default bias (overdue/pinned/due/priority/created)."
-- When the user drags todos around, the backend stamps every sibling
-- in that group with a non-null integer position so the manual order
-- takes precedence over the bias within the same band.
--
-- One column carries both top-level (parent_id IS NULL) and subtask
-- groupings — the partial indexes split by parent_id so manual-order
-- queries don't scan the whole table.

ALTER TABLE todos ADD COLUMN IF NOT EXISTS manual_order INTEGER;

-- Per-parent + per-top-level indexes. Partial on `manual_order IS NOT
-- NULL` keeps them small (most rows will have no manual order set).
CREATE INDEX IF NOT EXISTS idx_todos_manual_order_top
  ON todos (manual_order)
  WHERE parent_id IS NULL AND manual_order IS NOT NULL AND archived = false;

CREATE INDEX IF NOT EXISTS idx_todos_manual_order_child
  ON todos (parent_id, manual_order)
  WHERE parent_id IS NOT NULL AND manual_order IS NOT NULL AND archived = false;
