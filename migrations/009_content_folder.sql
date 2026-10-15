-- 009_content_folder.sql
-- First-class `folder` field on content_items: a single hierarchical path
-- (e.g. "cooking/italian") the note is filed under, or NULL when unfiled.
--
-- Folders used to be overloaded onto the `tags` array as slash-containing
-- tags, which made a single-segment top-level folder (e.g. "travel")
-- indistinguishable from a flat tag — so removing the leaf of "travel/japan"
-- dropped the note out of the folder tree entirely. A dedicated column removes
-- that ambiguity: any depth, including one segment, is a valid folder.
--
-- Backfill moves the FIRST slash-containing tag (in array order) into `folder`
-- and strips all slash-tags from `tags`, preserving flat tags. Idempotent —
-- the runMigrations probe only runs this when the column is absent.

ALTER TABLE content_items ADD COLUMN IF NOT EXISTS folder TEXT;

UPDATE content_items ci
SET folder = sub.first_folder,
    tags   = sub.flat_tags
FROM (
  SELECT id,
    (SELECT t FROM unnest(tags) WITH ORDINALITY u(t, ord)
      WHERE t LIKE '%/%' ORDER BY ord LIMIT 1) AS first_folder,
    ARRAY(SELECT t FROM unnest(tags) WITH ORDINALITY u(t, ord)
      WHERE t NOT LIKE '%/%' ORDER BY ord) AS flat_tags
  FROM content_items
  WHERE folder IS NULL
    AND EXISTS (SELECT 1 FROM unnest(tags) t WHERE t LIKE '%/%')
) sub
WHERE ci.id = sub.id;
