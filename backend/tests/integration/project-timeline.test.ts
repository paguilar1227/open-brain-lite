import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listProjectTimeline } from '../../src/db/timeline.js';
import { createApp } from '../../src/app.js';
import type { DbClient } from '../../src/db/client.js';
import type { ServiceDeps } from '../../src/services/index.js';
import { TimelineResponseSchema } from '@open-brain/shared';

let pg: PGlite;
let directory: string;
let legacy: string;
let legacyComments: string;
const db = { query: async (sql: string, params?: unknown[]) => pg.query(sql, params) } as DbClient;
async function project(name = 'Timeline project') {
  return (await pg.query<{id:string}>('INSERT INTO projects(name) VALUES ($1) RETURNING id', [name])).rows[0].id;
}
async function document(projectId: string, title = 'Design upload') {
  return (await pg.query<{id:string}>("INSERT INTO content_items(type,title,content,project_ids) VALUES ('document',$1,'private body',ARRAY[$2]::uuid[]) RETURNING id",[title,projectId])).rows[0].id;
}
const events = (id:string) => listProjectTimeline(db,id,{limit:100});

beforeAll(async () => {
  directory=await mkdtemp(join(tmpdir(),'timeline-test-'));
  pg=new PGlite(join(directory,'database'),{extensions:{vector,uuid_ossp}});
  for(const file of (await readdir('../migrations')).filter(n=>n.endsWith('.sql')&&n<'012').sort()) await pg.exec(await readFile(join('../migrations',file),'utf8'));
  legacy=await project('Existing project');
  await pg.query("INSERT INTO content_items(type,title,project_ids,created_at,updated_at) VALUES ('note','Legacy note',ARRAY[$1]::uuid[],'2025-01-01T00:00:00Z','2025-02-01T00:00:00Z')",[legacy]);
  legacyComments=await project('Existing comments');
  const task=await pg.query<{id:string}>("INSERT INTO todos(content,project_id) VALUES ('Existing task',$1) RETURNING id",[legacyComments]);
  await pg.query("INSERT INTO todo_comments(todo_id,content,created_at,updated_at) VALUES ($1,'Old comment','2025-01-01T00:00:00Z','2025-02-01T00:00:00Z')",[task.rows[0].id]);
  await pg.exec(await readFile('../migrations/012_project_timeline.sql','utf8'));
  await pg.exec(await readFile('../migrations/013_session_workspaces.sql','utf8'));
});
afterAll(async()=>{await pg?.close();if(directory)await rm(directory,{recursive:true,force:true});});

describe('durable project timeline',()=>{
  it('backfills only known creation/latest-update timestamps, marked as reconstructed',async()=>{
    const result=await events(legacy);
    expect(result.events.map(e=>e.action)).toEqual(['edited','created']);
    expect(result.events.every(e=>e.reconstructed)).toBe(true);
    expect(result.events[0].occurred_at).toBe('2025-02-01T00:00:00.000Z');
  });
  it('retains an upload, every meaningful edit, archive/restore and deletion after the source is gone',async()=>{
    const p=await project();const id=await document(p);
    await pg.query('UPDATE content_items SET title=$1 WHERE id=$2',['Revised title',id]);
    await pg.query('UPDATE content_items SET content=$1 WHERE id=$2',['Secret replacement body',id]);
    await pg.query('UPDATE content_items SET archived=true WHERE id=$1',[id]);
    await pg.query('UPDATE content_items SET archived=false WHERE id=$1',[id]);
    await pg.query('DELETE FROM content_items WHERE id=$1',[id]);
    const result=await events(p);
    // Capture order is independent of adjustments to the host's wall clock.
    // Chronological presentation is checked with explicit timestamps below.
    const captured=[...result.events].sort((a,b)=>Number(BigInt(b.id)-BigInt(a.id)));
    expect(captured.map(e=>e.action)).toEqual(['deleted','restored','archived','edited','edited','uploaded']);
    expect(captured.at(-1)?.title).toBe('Design upload');
    expect(captured[0].title).toBe('Revised title');
    expect(JSON.stringify(result)).not.toContain('Secret replacement body');
    expect(result.events.every(e=>!e.reconstructed)).toBe(true);
  });
  it('backfills existing comments without copying their bodies',async()=>{
    const comments=(await events(legacyComments)).events.filter(e=>e.entity_type==='todo_comment');
    expect(comments.map(e=>e.action)).toEqual(['edited','created']);
    expect(comments.every(e=>e.reconstructed&&e.title==='Existing task')).toBe(true);
    expect(JSON.stringify(comments)).not.toContain('Old comment');
  });
  it('records task section changes and exactly one deletion for cascaded comments',async()=>{
    const p=await project();
    const parent=await pg.query<{id:string}>("INSERT INTO todos(content,project_id,section) VALUES ('Parent',$1,'Before') RETURNING id",[p]);
    const child=await pg.query<{id:string}>("INSERT INTO todos(content,project_id,parent_id) VALUES ('Child',$1,$2) RETURNING id",[p,parent.rows[0].id]);
    await pg.query("INSERT INTO todo_comments(todo_id,content) VALUES ($1,'Parent comment'),($2,'Child comment')",[parent.rows[0].id,child.rows[0].id]);
    await pg.query("UPDATE todos SET section='After' WHERE id=$1",[parent.rows[0].id]);
    expect((await events(p)).events.find(e=>e.action==='edited')?.changed_fields).toEqual(['section']);
    await pg.query('DELETE FROM todos WHERE id=$1',[parent.rows[0].id]);
    const result=await events(p);
    expect(result.events.filter(e=>e.action==='deleted'&&e.entity_type==='todo_comment')).toHaveLength(2);
    expect(result.events.filter(e=>e.action==='deleted'&&e.entity_type==='todo')).toHaveLength(2);
    expect((await pg.query('SELECT * FROM todo_comments WHERE todo_id=ANY($1::uuid[])',[[parent.rows[0].id,child.rows[0].id]])).rows).toHaveLength(0);
  });
  it('does not turn indexing/status/timestamp-only writes into user edits',async()=>{
    const p=await project();const id=await document(p);
    await pg.query("UPDATE content_items SET processing_status='ready',metadata='{}',updated_at=now() WHERE id=$1",[id]);
    expect((await events(p)).events.map(e=>e.action)).toEqual(['uploaded']);
  });
  it('captures bulk todo deletion and comment changes',async()=>{
    const p=await project();
    const todos=await pg.query<{id:string}>("INSERT INTO todos(content,project_id) VALUES ('Task A',$1),('Task B',$1) RETURNING id",[p]);
    const comment=await pg.query<{id:string}>("INSERT INTO todo_comments(todo_id,content) VALUES ($1,'Comment') RETURNING id",[todos.rows[0].id]);
    await pg.query("UPDATE todo_comments SET content='Edited comment' WHERE id=$1",[comment.rows[0].id]);
    await pg.query('DELETE FROM todo_comments WHERE id=$1',[comment.rows[0].id]);
    await pg.query('DELETE FROM todos WHERE id=ANY($1::uuid[])',[todos.rows.map(t=>t.id)]);
    const result=await events(p);
    expect(result.events.filter(e=>e.action==='deleted'&&e.entity_type==='todo')).toHaveLength(2);
    expect(result.events.filter(e=>e.entity_type==='todo_comment').map(e=>e.action)).toEqual(['deleted','edited','created']);
  });
  it('keeps project scoping through membership edits and project deletion',async()=>{
    const a=await project('A'),b=await project('B'),other=await project('Unrelated');
    const id=await document(a,'Shared plan');
    await pg.query('UPDATE content_items SET project_ids=ARRAY[$1]::uuid[] WHERE id=$2',[b,id]);
    expect((await events(a)).events.map(e=>e.action)).toEqual(['edited','uploaded']);
    expect((await events(b)).events.map(e=>e.action)).toEqual(['edited']);
    expect((await events(other)).events).toEqual([]);
    await pg.query("INSERT INTO todos(content,project_id) VALUES ('Project task',$1)",[b]);
    await pg.query('DELETE FROM projects WHERE id=$1',[b]);
    expect((await events(b)).events).toEqual([]);
  });
  it('paginates tied timestamps without gaps and searches titles/actions/fields literally',async()=>{
    const p=await project();
    for(const title of ['100%_special','Ordinary','Other'])await document(p,title);
    await pg.query("UPDATE project_timeline_events SET occurred_at='2026-01-01T12:00:00.123Z' WHERE project_id=$1",[p]);
    const first=await listProjectTimeline(db,p,{limit:2});
    const next=await listProjectTimeline(db,p,{limit:2,before_at:first.next_cursor!.at,before_id:first.next_cursor!.id});
    expect(new Set([...first.events,...next.events].map(e=>e.id)).size).toBe(3);
    expect(next.next_cursor).toBeNull();
    expect(first.total).toBe(3);
    expect((await listProjectTimeline(db,p,{limit:100,search:'100%_'})).events).toHaveLength(1);
    expect((await listProjectTimeline(db,p,{limit:100,search:'UPLOADED'})).events).toHaveLength(3);
    expect(TimelineResponseSchema.safeParse(first).success).toBe(true);
  });
  it('orders and paginates distinct timestamps chronologically rather than by insertion order',async()=>{
    const p=await project();
    for(const title of ['Middle','Newest','Oldest']) await document(p,title);
    await pg.query("UPDATE project_timeline_events SET occurred_at=CASE title WHEN 'Newest' THEN '2026-01-03T00:00:00Z'::timestamptz WHEN 'Middle' THEN '2026-01-02T00:00:00Z'::timestamptz ELSE '2026-01-01T00:00:00Z'::timestamptz END WHERE project_id=$1",[p]);
    const first=await listProjectTimeline(db,p,{limit:2});
    const second=await listProjectTimeline(db,p,{limit:2,before_at:first.next_cursor!.at,before_id:first.next_cursor!.id});
    expect([...first.events,...second.events].map(e=>e.title)).toEqual(['Newest','Middle','Oldest']);
  });
  it('filters every event by current artifact tags, defaults to AND, supports OR, and preserves tags after deletion',async()=>{
    const p=await project(),other=await project();
    const design=await document(p,'Design brief'),release=await document(p,'Release notes');
    await pg.query("UPDATE content_items SET tags=ARRAY['design','shared'] WHERE id=$1",[design]);
    await pg.query("UPDATE content_items SET tags=ARRAY['release','shared'] WHERE id=$1",[release]);
    const foreign=await document(other,'Other project');
    await pg.query("UPDATE content_items SET tags=ARRAY['private'] WHERE id=$1",[foreign]);
    const filtered=await listProjectTimeline(db,p,{limit:100,tags:['design']});
    expect(filtered.events.map(e=>e.action).sort()).toEqual(['edited','uploaded']);
    expect(filtered.events.every(e=>e.tags.includes('design'))).toBe(true);
    expect(filtered.available_tags).toEqual(['design','release','shared']);
    expect((await listProjectTimeline(db,p,{limit:100,tags:['design','release']})).total).toBe(0);
    const combined=await listProjectTimeline(db,p,{limit:100,tags:['design','release'],tag_match:'any'});
    expect(combined.total).toBe(4);
    expect((await listProjectTimeline(db,p,{limit:100,tags:[]})).total).toBe(4);
    expect((await listProjectTimeline(db,p,{limit:100,tags:['missing']})).events).toEqual([]);
    await pg.query("UPDATE content_items SET tags=ARRAY['research'] WHERE id=$1",[design]);
    expect((await listProjectTimeline(db,p,{limit:100,tags:['design']})).total).toBe(0);
    await pg.query('DELETE FROM content_items WHERE id=$1',[design]);
    const deleted=await listProjectTimeline(db,p,{limit:100,tags:['research'],search:'uploaded'});
    expect(deleted.events.map(e=>e.action)).toEqual(['uploaded']);
    expect(deleted.events[0].tags).toEqual(['research']);
    expect(deleted.available_tags).toEqual(['release','research','shared']);
  });
  it('retains parent task tags for direct and cascaded comment deletions',async()=>{
    const p=await project();
    const task=await pg.query<{id:string}>("INSERT INTO todos(content,project_id,tags) VALUES ('Tagged task',$1,ARRAY['work']) RETURNING id",[p]);
    const comment=await pg.query<{id:string}>("INSERT INTO todo_comments(todo_id,content) VALUES ($1,'Direct comment'),($1,'Cascaded comment') RETURNING id",[task.rows[0].id]);
    await pg.query('DELETE FROM todo_comments WHERE id=$1',[comment.rows[0].id]);
    await pg.query('DELETE FROM todos WHERE id=$1',[task.rows[0].id]);
    const result=await listProjectTimeline(db,p,{limit:100,tags:['work']});
    expect(result.events).toHaveLength(6);
    expect(result.events.every(e=>e.tags.includes('work'))).toBe(true);
    expect(result.events.filter(e=>e.entity_type==='todo_comment'&&e.action==='deleted')).toHaveLength(2);
  });
  it('keeps final artifact tags in former projects after moving or unassigning and deleting',async()=>{
    const a=await project(),b=await project();
    const id=await document(a,'Moved document');
    await pg.query("UPDATE content_items SET tags=ARRAY['initial'] WHERE id=$1",[id]);
    await pg.query('UPDATE content_items SET project_ids=ARRAY[$1]::uuid[] WHERE id=$2',[b,id]);
    await pg.query("UPDATE content_items SET tags=ARRAY['latest'] WHERE id=$1",[id]);
    await pg.query('DELETE FROM content_items WHERE id=$1',[id]);
    expect((await listProjectTimeline(db,a,{limit:100,tags:['latest']})).total).toBe(3);
    expect((await listProjectTimeline(db,a,{limit:100,tags:['initial']})).total).toBe(0);
    const unassigned=await document(a,'Unassigned document');
    await pg.query("UPDATE content_items SET project_ids='{}',tags=ARRAY['unassigned'] WHERE id=$1",[unassigned]);
    await pg.query("UPDATE content_items SET tags=ARRAY['final'] WHERE id=$1",[unassigned]);
    await pg.query('DELETE FROM content_items WHERE id=$1',[unassigned]);
    expect((await listProjectTimeline(db,a,{limit:100,tags:['final']})).total).toBe(2);
    expect((await listProjectTimeline(db,a,{limit:100,tags:['unassigned']})).total).toBe(0);
  });
  it('freezes final parent tags for comments after moving and deleting the task',async()=>{
    const a=await project(),b=await project();
    const task=await pg.query<{id:string}>("INSERT INTO todos(content,project_id,tags) VALUES ('Moving task',$1,ARRAY['initial']) RETURNING id",[a]);
    await pg.query("INSERT INTO todo_comments(todo_id,content) VALUES ($1,'Comment')",[task.rows[0].id]);
    await pg.query("UPDATE todos SET project_id=$1,tags=ARRAY['latest'] WHERE id=$2",[b,task.rows[0].id]);
    await pg.query('DELETE FROM todos WHERE id=$1',[task.rows[0].id]);
    const result=await listProjectTimeline(db,a,{limit:100,tags:['latest']});
    expect(result.events.find(e=>e.entity_type==='todo_comment')?.tags).toEqual(['latest']);
    expect((await listProjectTimeline(db,a,{limit:100,tags:['initial']})).total).toBe(0);
  });
  it('keeps tag filters across REST pagination and search',async()=>{
    const p=await project();
    const id=await document(p,'Tagged upload');
    await pg.query("UPDATE content_items SET tags=ARRAY['design','tag with spaces'] WHERE id=$1",[id]);
    const app=createApp({db,config:{storageProvider:'local'}} as ServiceDeps);
    const response=await app.request(`/api/v1/projects/${p}/timeline?tag=design&tag=tag%20with%20spaces&limit=1`);
    const first=TimelineResponseSchema.parse(await response.json());
    expect(first.total).toBe(2);
    expect(first.events).toHaveLength(1);
    const next=await app.request(`/api/v1/projects/${p}/timeline?tag=design&limit=1&before_at=${encodeURIComponent(first.next_cursor!.at)}&before_id=${first.next_cursor!.id}`);
    expect(TimelineResponseSchema.parse(await next.json()).events).toHaveLength(1);
    const missing=await app.request(`/api/v1/projects/${p}/timeline?tag=absent&search=upload`);
    expect(TimelineResponseSchema.parse(await missing.json()).total).toBe(0);
  });
  it('rolls back mutation and history together',async()=>{
    const p=await project();const id=await document(p);
    await expect(pg.transaction(async tx=>{await tx.query("UPDATE content_items SET title='Rolled back' WHERE id=$1",[id]);throw new Error('abort');})).rejects.toThrow('abort');
    expect((await events(p)).events).toHaveLength(1);
    expect((await pg.query<{title:string}>('SELECT title FROM content_items WHERE id=$1',[id])).rows[0].title).toBe('Design upload');
  });
  it('rejects invalid cursors, respects project scope through REST, and survives reopen',async()=>{
    const app=createApp({db,config:{storageProvider:'local'}} as ServiceDeps);
    expect((await app.request(`/api/v1/projects/${legacy}/timeline?before_id=1`)).status).toBe(400);
    const response=await app.request(`/api/v1/projects/${legacy}/timeline?search=Legacy`);
    expect(response.status).toBe(200);
    expect((await response.json()).events).toHaveLength(2);
    await pg.close();
    pg=new PGlite(join(directory,'database'),{extensions:{vector,uuid_ossp}});
    expect((await events(legacy)).events).toHaveLength(2);
  });
});
