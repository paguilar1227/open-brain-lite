BEGIN;
-- Keep writes and event capture atomic while installing the new history log.
LOCK TABLE content_items, todos, todo_comments IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE IF NOT EXISTS project_timeline_events (
  id bigserial PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('document','note','todo','todo_comment')),
  action text NOT NULL CHECK (action IN ('uploaded','created','edited','archived','restored','deleted')),
  title text NOT NULL,
  changed_fields text[] NOT NULL DEFAULT '{}',
  tags text[] NOT NULL DEFAULT '{}',
  -- JS dates round-trip milliseconds; id breaks ties without skipping entries.
  occurred_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  reconstructed boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS project_timeline_order ON project_timeline_events(project_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS project_timeline_artifact ON project_timeline_events(entity_type, entity_id);

-- Existing records reveal creation and the latest update only. Never invent
-- missing intermediate edits, archive times, or already-deleted records.
INSERT INTO project_timeline_events(project_id,entity_id,entity_type,action,title,tags,occurred_at,reconstructed)
SELECT p.id,c.id,c.type,CASE WHEN c.type='document' THEN 'uploaded' ELSE 'created' END,c.title,c.tags,c.created_at,true
FROM content_items c CROSS JOIN LATERAL unnest(c.project_ids) AS membership(id) JOIN projects p ON p.id=membership.id
WHERE NOT EXISTS (SELECT 1 FROM project_timeline_events e WHERE e.project_id=p.id AND e.entity_id=c.id AND e.reconstructed);
INSERT INTO project_timeline_events(project_id,entity_id,entity_type,action,title,tags,occurred_at,reconstructed)
SELECT p.id,t.id,'todo','created',t.content,t.tags,t.created_at,true FROM todos t JOIN projects p ON p.id=t.project_id
WHERE NOT EXISTS (SELECT 1 FROM project_timeline_events e WHERE e.project_id=p.id AND e.entity_id=t.id AND e.reconstructed);
INSERT INTO project_timeline_events(project_id,entity_id,entity_type,action,title,tags,occurred_at,reconstructed)
SELECT p.id,c.id,'todo_comment','created',t.content,t.tags,c.created_at,true
FROM todo_comments c JOIN todos t ON t.id=c.todo_id JOIN projects p ON p.id=t.project_id
WHERE NOT EXISTS (SELECT 1 FROM project_timeline_events e WHERE e.project_id=p.id AND e.entity_id=c.id AND e.reconstructed);
INSERT INTO project_timeline_events(project_id,entity_id,entity_type,action,title,tags,occurred_at,reconstructed)
SELECT p.id,c.id,c.type,'edited',c.title,c.tags,c.updated_at,true
FROM content_items c CROSS JOIN LATERAL unnest(c.project_ids) AS membership(id) JOIN projects p ON p.id=membership.id
WHERE c.updated_at>c.created_at AND NOT EXISTS (SELECT 1 FROM project_timeline_events e WHERE e.project_id=p.id AND e.entity_id=c.id AND e.reconstructed AND e.action='edited');
INSERT INTO project_timeline_events(project_id,entity_id,entity_type,action,title,tags,occurred_at,reconstructed)
SELECT p.id,t.id,'todo','edited',t.content,t.tags,t.updated_at,true FROM todos t JOIN projects p ON p.id=t.project_id
WHERE t.updated_at>t.created_at AND NOT EXISTS (SELECT 1 FROM project_timeline_events e WHERE e.project_id=p.id AND e.entity_id=t.id AND e.reconstructed AND e.action='edited');
INSERT INTO project_timeline_events(project_id,entity_id,entity_type,action,title,tags,occurred_at,reconstructed)
SELECT p.id,c.id,'todo_comment','edited',t.content,t.tags,c.updated_at,true
FROM todo_comments c JOIN todos t ON t.id=c.todo_id JOIN projects p ON p.id=t.project_id
WHERE c.updated_at>c.created_at AND NOT EXISTS (SELECT 1 FROM project_timeline_events e WHERE e.project_id=p.id AND e.entity_id=c.id AND e.reconstructed AND e.action='edited');

CREATE OR REPLACE FUNCTION capture_project_timeline() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous jsonb := CASE WHEN TG_OP='INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
  current_row jsonb := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  memberships uuid[] := '{}';
  record_type text;
  record_title text;
  event_action text;
  fields text[] := '{}';
  record_tags text[] := '{}';
  field_name text;
  relevant_fields text[];
  parent_project uuid;
BEGIN
  SELECT coalesce(array_agg(value),'{}') INTO record_tags
    FROM jsonb_array_elements_text(coalesce(current_row->'tags','[]'));
  IF TG_TABLE_NAME='content_items' THEN
    record_type := current_row->>'type';
    record_title := current_row->>'title';
    SELECT coalesce(array_agg(DISTINCT value::uuid),'{}') INTO memberships
      FROM jsonb_array_elements_text(coalesce(previous->'project_ids','[]') || coalesce(current_row->'project_ids','[]'));
    relevant_fields := ARRAY['title','content','project_ids','tags','folder','source_url','blob_url','pinned_at'];
  ELSIF TG_TABLE_NAME='todos' THEN
    record_type := 'todo'; record_title := current_row->>'content';
    SELECT coalesce(array_agg(DISTINCT id),'{}') INTO memberships FROM
      (VALUES ((previous->>'project_id')::uuid),((current_row->>'project_id')::uuid)) AS ids(id) WHERE id IS NOT NULL;
    relevant_fields := ARRAY['content','project_id','section','status','priority','due_date','tags','parent_id','pinned_at'];
  ELSE
    record_type := 'todo_comment';
    SELECT project_id,content,tags INTO parent_project,record_title,record_tags FROM todos WHERE id=(current_row->>'todo_id')::uuid;
    memberships := CASE WHEN parent_project IS NULL THEN '{}'::uuid[] ELSE ARRAY[parent_project] END;
    relevant_fields := ARRAY['content'];
  END IF;
  IF TG_OP='INSERT' THEN
    event_action := CASE WHEN record_type='document' THEN 'uploaded' ELSE 'created' END;
  ELSIF TG_OP='DELETE' THEN
    event_action := 'deleted';
  ELSE
    FOREACH field_name IN ARRAY relevant_fields LOOP
      IF previous->field_name IS DISTINCT FROM current_row->field_name THEN fields := array_append(fields,field_name); END IF;
    END LOOP;
    IF previous->'archived' IS DISTINCT FROM current_row->'archived' THEN
      event_action := CASE WHEN (current_row->>'archived')::boolean THEN 'archived' ELSE 'restored' END;
      fields := array_append(fields,'archived');
    ELSIF cardinality(fields)>0 THEN event_action := 'edited';
    ELSE RETURN NULL;
    END IF;
  END IF;
  -- Freeze the final tags on all former project memberships as well. This
  -- also preserves them when an unassigned artifact is deleted with no new event.
  IF TG_OP='DELETE' AND record_tags IS NOT NULL THEN
    UPDATE project_timeline_events SET tags=record_tags
      WHERE entity_id=(current_row->>'id')::uuid AND entity_type=record_type;
  END IF;
  -- Only titles and field names are retained: no copies of deleted bodies/files.
  -- Joining projects also avoids orphan capture during project-delete cascades.
  INSERT INTO project_timeline_events(project_id,entity_id,entity_type,action,title,changed_fields,tags)
    SELECT p.id,(current_row->>'id')::uuid,record_type,event_action,coalesce(record_title,'Untitled'),fields,coalesce(record_tags,'{}')
    FROM unnest(memberships) AS m(id) JOIN projects p ON p.id=m.id;
  RETURN NULL;
END;
$$;
-- A comment's parent is no longer queryable when its cascading DELETE runs.
-- Capture those deletions before removing the task, while its project is known.
CREATE OR REPLACE FUNCTION capture_project_comment_cascade() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE project_timeline_events SET tags=OLD.tags
    WHERE entity_type='todo_comment' AND entity_id IN (SELECT id FROM todo_comments WHERE todo_id=OLD.id);
  INSERT INTO project_timeline_events(project_id,entity_id,entity_type,action,title,tags)
    SELECT p.id,c.id,'todo_comment','deleted',OLD.content,OLD.tags
    FROM todo_comments c JOIN projects p ON p.id=OLD.project_id WHERE c.todo_id=OLD.id;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS todo_comment_cascade_timeline ON todos;
CREATE TRIGGER todo_comment_cascade_timeline BEFORE DELETE ON todos FOR EACH ROW EXECUTE FUNCTION capture_project_comment_cascade();
DROP TRIGGER IF EXISTS content_project_timeline ON content_items;
CREATE TRIGGER content_project_timeline AFTER INSERT OR UPDATE OR DELETE ON content_items FOR EACH ROW EXECUTE FUNCTION capture_project_timeline();
DROP TRIGGER IF EXISTS todo_project_timeline ON todos;
CREATE TRIGGER todo_project_timeline AFTER INSERT OR UPDATE OR DELETE ON todos FOR EACH ROW EXECUTE FUNCTION capture_project_timeline();
DROP TRIGGER IF EXISTS comment_project_timeline ON todo_comments;
CREATE TRIGGER comment_project_timeline AFTER INSERT OR UPDATE OR DELETE ON todo_comments FOR EACH ROW EXECUTE FUNCTION capture_project_timeline();
COMMIT;
