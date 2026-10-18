BEGIN;
LOCK TABLE project_sessions, content_items, todos, todo_comments IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE project_sessions ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE project_sessions ALTER COLUMN summary SET DEFAULT '';
ALTER TABLE project_sessions ADD COLUMN name text NOT NULL DEFAULT 'Session';
ALTER TABLE project_sessions ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
UPDATE project_sessions SET name='Session ' || session_key, updated_at=created_at;
CREATE TABLE session_file_cleanup (session_id uuid NOT NULL, blob_url text NOT NULL, PRIMARY KEY(session_id,blob_url));
CREATE UNIQUE INDEX standalone_session_key ON project_sessions(session_key) WHERE project_id IS NULL;
ALTER TABLE content_items ADD COLUMN session_id uuid REFERENCES project_sessions(id) ON DELETE CASCADE;
ALTER TABLE todos ADD COLUMN session_id uuid REFERENCES project_sessions(id) ON DELETE CASCADE;
CREATE INDEX content_session ON content_items(session_id);
CREATE INDEX todo_session ON todos(session_id);
ALTER TABLE project_timeline_events ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE project_timeline_events ADD COLUMN session_id uuid REFERENCES project_sessions(id) ON DELETE CASCADE;
CREATE INDEX session_timeline_order ON project_timeline_events(session_id, occurred_at DESC, id DESC);
-- Existing handoffs keep their IDs, facts and linked note. Other legacy content stays directly under its project.
UPDATE content_items c SET session_id=s.id FROM project_sessions s WHERE c.id=s.note_id;
UPDATE project_timeline_events e SET session_id=c.session_id FROM content_items c WHERE e.entity_id=c.id AND e.entity_type IN ('document','note');

-- The owning session is authoritative for project membership, including null.
-- Lock it for the duration of a write to serialize against moves and deletion.
CREATE FUNCTION enforce_session_ownership() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_project uuid; parent_session uuid;
BEGIN
  IF TG_TABLE_NAME='todos' THEN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT session_id INTO parent_session FROM todos WHERE id=NEW.parent_id;
    IF NEW.session_id IS NOT NULL AND NEW.session_id IS DISTINCT FROM parent_session THEN
      RAISE EXCEPTION 'A subtask must belong to the same session as its parent' USING ERRCODE='23514';
    END IF;
    NEW.session_id := parent_session;
  END IF;
  END IF;
  IF NEW.session_id IS NOT NULL THEN
    SELECT project_id INTO parent_project FROM project_sessions WHERE id=NEW.session_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Session not found' USING ERRCODE='23503'; END IF;
    IF TG_TABLE_NAME='content_items' THEN
      NEW.project_ids := CASE WHEN parent_project IS NULL THEN '{}'::uuid[] ELSE ARRAY[parent_project] END;
    ELSE NEW.project_id := parent_project;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER content_session_owner BEFORE INSERT OR UPDATE OF session_id,project_ids ON content_items FOR EACH ROW EXECUTE FUNCTION enforce_session_ownership();
CREATE TRIGGER todo_session_owner BEFORE INSERT OR UPDATE OF session_id,project_id,parent_id ON todos FOR EACH ROW EXECUTE FUNCTION enforce_session_ownership();
CREATE FUNCTION move_session_contents() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.project_id IS DISTINCT FROM NEW.project_id THEN
    UPDATE content_items SET project_ids=CASE WHEN NEW.project_id IS NULL THEN '{}'::uuid[] ELSE ARRAY[NEW.project_id] END WHERE session_id=NEW.id;
    UPDATE todos SET project_id=NEW.project_id WHERE session_id=NEW.id;
    UPDATE project_timeline_events SET project_id=NEW.project_id WHERE session_id=NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER move_session_contents AFTER UPDATE OF project_id ON project_sessions FOR EACH ROW EXECUTE FUNCTION move_session_contents();
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
  owning_session uuid := (current_row->>'session_id')::uuid;
BEGIN
  SELECT coalesce(array_agg(value),'{}') INTO record_tags
    FROM jsonb_array_elements_text(coalesce(current_row->'tags','[]'));
  IF TG_TABLE_NAME='content_items' THEN
    record_type := current_row->>'type';
    record_title := current_row->>'title';
    SELECT coalesce(array_agg(DISTINCT value::uuid),'{}') INTO memberships
      FROM jsonb_array_elements_text(coalesce(previous->'project_ids','[]') || coalesce(current_row->'project_ids','[]'));
    relevant_fields := ARRAY['title','content','project_ids','tags','folder','source_url','blob_url','pinned_at','session_id'];
  ELSIF TG_TABLE_NAME='todos' THEN
    record_type := 'todo'; record_title := current_row->>'content';
    SELECT coalesce(array_agg(DISTINCT id),'{}') INTO memberships FROM
      (VALUES ((previous->>'project_id')::uuid),((current_row->>'project_id')::uuid)) AS ids(id) WHERE id IS NOT NULL;
    relevant_fields := ARRAY['content','project_id','section','status','priority','due_date','tags','parent_id','pinned_at','session_id'];
  ELSE
    record_type := 'todo_comment';
    SELECT project_id,content,tags,session_id INTO parent_project,record_title,record_tags,owning_session FROM todos WHERE id=(current_row->>'todo_id')::uuid;
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
  IF owning_session IS NOT NULL AND NOT EXISTS (SELECT 1 FROM project_sessions WHERE id=owning_session) THEN RETURN NULL; END IF;
  -- A session-owned event has exactly one scope. On an artifact transfer,
  -- the receiving session supplies its project (or NULL for standalone).
  -- Keep the old/new membership union only for direct project artifacts.
  IF owning_session IS NOT NULL THEN
    SELECT project_id INTO parent_project FROM project_sessions WHERE id=owning_session;
    memberships := CASE WHEN parent_project IS NULL THEN '{}'::uuid[] ELSE ARRAY[parent_project] END;
  END IF;
  -- Freeze the final tags on all former project memberships as well. This
  -- also preserves them when an unassigned artifact is deleted with no new event.
  IF TG_OP='DELETE' AND record_tags IS NOT NULL THEN
    UPDATE project_timeline_events SET tags=record_tags
      WHERE entity_id=(current_row->>'id')::uuid AND entity_type=record_type;
  END IF;
  -- Only titles and field names are retained: no copies of deleted bodies/files.
  -- Joining projects also avoids orphan capture during project-delete cascades.
  INSERT INTO project_timeline_events(project_id,session_id,entity_id,entity_type,action,title,changed_fields,tags)
    SELECT p.id,owning_session,(current_row->>'id')::uuid,record_type,event_action,coalesce(record_title,'Untitled'),fields,coalesce(record_tags,'{}')
    FROM unnest(memberships) AS m(id) JOIN projects p ON p.id=m.id;
  IF cardinality(memberships)=0 AND owning_session IS NOT NULL AND EXISTS (SELECT 1 FROM project_sessions WHERE id=owning_session) THEN
    INSERT INTO project_timeline_events(project_id,session_id,entity_id,entity_type,action,title,changed_fields,tags)
      VALUES (NULL,owning_session,(current_row->>'id')::uuid,record_type,event_action,coalesce(record_title,'Untitled'),fields,coalesce(record_tags,'{}'));
  END IF;
  RETURN NULL;
END;
$$;
-- A comment's parent is no longer queryable when its cascading DELETE runs.
-- Capture those deletions before removing the task, while its project is known.
CREATE OR REPLACE FUNCTION capture_project_comment_cascade() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.session_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM project_sessions WHERE id=OLD.session_id) THEN RETURN OLD; END IF;
  UPDATE project_timeline_events SET tags=OLD.tags
    WHERE entity_type='todo_comment' AND entity_id IN (SELECT id FROM todo_comments WHERE todo_id=OLD.id);
  INSERT INTO project_timeline_events(project_id,session_id,entity_id,entity_type,action,title,tags)
    SELECT p.id,OLD.session_id,c.id,'todo_comment','deleted',OLD.content,OLD.tags
    FROM todo_comments c JOIN projects p ON p.id=OLD.project_id WHERE c.todo_id=OLD.id;
  IF OLD.project_id IS NULL AND OLD.session_id IS NOT NULL THEN
    INSERT INTO project_timeline_events(project_id,session_id,entity_id,entity_type,action,title,tags)
      SELECT NULL,OLD.session_id,id,'todo_comment','deleted',OLD.content,OLD.tags FROM todo_comments WHERE todo_id=OLD.id;
  END IF;
  RETURN OLD;
END;
$$;

CREATE FUNCTION inherit_task_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.session_id IS DISTINCT FROM NEW.session_id THEN
    UPDATE todos SET session_id=NEW.session_id,project_id=NEW.project_id WHERE parent_id=NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER inherit_task_session AFTER UPDATE OF session_id ON todos FOR EACH ROW EXECUTE FUNCTION inherit_task_session();
COMMIT;
