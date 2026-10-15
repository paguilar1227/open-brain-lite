-- 010_subtask_tags_cleanup.sql
-- Tags are a root-only concept: only top-level todos (parent_id IS NULL) carry
-- them; subtasks inherit their grouping from the parent. Older data (and the
-- pre-guard seed) left tags on some subtasks, which then rendered as stray
-- chips that a parent's tag-removal couldn't clear. Strip them.
--
-- Idempotent: the runMigrations probe only runs this while such rows exist.
-- Creating/updating/bulk-tagging a subtask is already guarded server-side, so
-- this is a one-time backfill for legacy rows.

UPDATE todos
   SET tags = '{}', updated_at = now()
 WHERE parent_id IS NOT NULL
   AND cardinality(tags) > 0;
