import type { TimelineQuery, TimelineResponse, TimelineEvent } from '@open-brain/shared';
import type { DbClient } from './client.js';

export async function listProjectTimeline(db: DbClient, projectId: string, query: TimelineQuery): Promise<TimelineResponse> {
  return listTimeline(db, {projectId}, query);
}

export async function listSessionTimeline(db: DbClient, sessionId: string, query: TimelineQuery): Promise<TimelineResponse> {
  return listTimeline(db, {sessionId}, query);
}
async function listTimeline(db: DbClient, scope: {projectId?: string; sessionId?: string}, query: TimelineQuery): Promise<TimelineResponse> {
  const search = (query.search ?? '').trim();
  // Existing artifacts use their current tags, including for earlier uploads.
  // Deletion freezes the last known tags onto every historical event.
  const source = `WITH timeline AS (
    SELECT e.id,e.project_id,e.session_id,s.name AS session_name,e.entity_id,e.entity_type,e.action,e.title,e.changed_fields,e.occurred_at,e.reconstructed,
      coalesce(c.tags,t.tags,parent.tags,e.tags) AS tags
    FROM project_timeline_events e
    LEFT JOIN project_sessions s ON s.id=e.session_id
    LEFT JOIN content_items c ON e.entity_type IN ('document','note') AND c.id=e.entity_id
    LEFT JOIN todos t ON e.entity_type='todo' AND t.id=e.entity_id
    LEFT JOIN todo_comments comment ON e.entity_type='todo_comment' AND comment.id=e.entity_id
    LEFT JOIN todos parent ON parent.id=comment.todo_id
    WHERE ${scope.sessionId ? 'e.session_id' : 'e.project_id'}=$1
  )`;
  const filter = `($2='' OR strpos(lower(concat_ws(' ',title,action,entity_type,session_name,CASE WHEN session_id IS NULL THEN 'project-level' ELSE 'session' END,array_to_string(tags,' '),array_to_string(changed_fields,' '),replace(replace(array_to_string(changed_fields,' '),'content','text'),'_',' '),CASE WHEN reconstructed THEN 'existing history last known update' ELSE '' END)),lower($2))>0)
    AND (cardinality($3::text[])=0 OR tags ${query.tag_match === 'any' ? '&&' : '@>'} $3::text[])`;
  const params = [scope.sessionId ?? scope.projectId, search, query.tags ?? []];
  const [count, result, available] = await Promise.all([
    db.query(`${source} SELECT count(*)::int AS total FROM timeline WHERE ${filter}`, params),
    db.query(`${source} SELECT id::text,project_id,session_id,session_name,entity_id,entity_type,action,title,changed_fields,tags,occurred_at,reconstructed
      FROM timeline WHERE ${filter}
      AND ($4::timestamptz IS NULL OR (occurred_at,id)<($4::timestamptz,$5::bigint))
      ORDER BY occurred_at DESC,id DESC LIMIT $6`, [...params, query.before_at ?? null, query.before_id ?? null, query.limit + 1]),
    db.query(`${source} SELECT DISTINCT unnest(tags) AS tag FROM timeline ORDER BY tag`, [scope.sessionId ?? scope.projectId]),
  ]);
  const events: TimelineEvent[] = result.rows.slice(0, query.limit).map(row => ({ ...row,
    occurred_at: new Date(row.occurred_at).toISOString(),
  }));
  const last = events.at(-1);
  return { events, total: Number(count.rows[0].total), available_tags: available.rows.map(row => row.tag), next_cursor: result.rows.length > query.limit && last
    ? { at: last.occurred_at, id: last.id } : null };
}
