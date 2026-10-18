import { runIngestTail } from './content-items.js';
import { insertContentItem } from '../db/content-items.js';
import { newTrace } from '../capture/ingest-trace.js';
import { randomUUID } from 'node:crypto';
import type { ServiceDeps } from './index.js';
import type { Session, SessionCreateSchema, SessionUpdateSchema } from '@open-brain/shared';
import type { z } from 'zod';

const selection = `SELECT s.*,
  json_build_object('documents',(SELECT count(*)::int FROM content_items WHERE session_id=s.id AND type='document'),
  'notes',(SELECT count(*)::int FROM content_items WHERE session_id=s.id AND type='note'),
  'todos',(SELECT count(*)::int FROM todos WHERE session_id=s.id)) AS counts FROM project_sessions s`;

export async function listSessions(deps: ServiceDeps, projectId?: string | null): Promise<Session[]> {
  const where = projectId === undefined ? '' : projectId === null ? 'WHERE s.project_id IS NULL' : 'WHERE s.project_id=$1';
  return (await deps.db.query(`${selection} ${where} ORDER BY s.updated_at DESC,s.id`, typeof projectId === 'string' ? [projectId] : [])).rows;
}
export async function getSession(deps: ServiceDeps, id: string): Promise<Session | null> {
  return (await deps.db.query(`${selection} WHERE s.id=$1`, [id])).rows[0] ?? null;
}
export async function createSession(deps: ServiceDeps, input: z.infer<typeof SessionCreateSchema>): Promise<Session> {
  const projectId = input.project_id ?? null, key = input.session_key ?? randomUUID();
  return deps.db.transaction(async tx => {
    await tx.query(`INSERT INTO project_sessions(name,project_id,session_key) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [input.name,projectId,key]);
    return (await tx.query('SELECT * FROM project_sessions WHERE project_id IS NOT DISTINCT FROM $1::uuid AND session_key=$2', [projectId,key])).rows[0];
  });
}
export async function updateSession(deps: ServiceDeps, id: string, input: z.infer<typeof SessionUpdateSchema>): Promise<Session | null> {
  const fields = Object.entries(input).filter(([,v]) => v !== undefined);
  if (!fields.length) return getSession(deps,id);
  const values = fields.map(([,v]) => v);
  const set = fields.map(([key],i) => `${key}=$${i+1}`).join(',');
  return (await deps.db.query(`UPDATE project_sessions SET ${set},updated_at=now() WHERE id=$${values.length+1} RETURNING *`, [...values,id])).rows[0] ?? null;
}
export async function getSessionContext(deps: ServiceDeps, id: string) {
  const session = await getSession(deps,id);
  if (!session) return null;
  const [content, todos] = await Promise.all([
    deps.db.query('SELECT id,type,title,processing_status FROM content_items WHERE session_id=$1 AND archived=false ORDER BY created_at DESC',[id]),
    deps.db.query("SELECT id,content,status,priority,parent_id FROM todos WHERE session_id=$1 AND archived=false ORDER BY created_at",[id]),
  ]);
  return {session, artifacts:content.rows, todos:todos.rows};
}
export async function deleteSession(deps: ServiceDeps, id: string) {
  // Persist cleanup work with the deletion. A storage error can be retried by
  // repeating DELETE, even though the session itself is already gone.
  await deps.db.transaction(async tx => {
    await tx.query('SELECT id FROM project_sessions WHERE id=$1 FOR UPDATE',[id]);
    await tx.query(`INSERT INTO session_file_cleanup(session_id,blob_url)
      SELECT $1,blob_url FROM content_items WHERE session_id=$1 AND blob_url IS NOT NULL ON CONFLICT DO NOTHING`,[id]);
    await tx.query('DELETE FROM project_sessions WHERE id=$1',[id]);
  });
  const queued=await deps.db.query('SELECT blob_url FROM session_file_cleanup WHERE session_id=$1',[id]);
  for (const {blob_url} of queued.rows) {
    try {
      const references=await deps.db.query('SELECT id FROM content_items WHERE blob_url=$1 LIMIT 1',[blob_url]);
      if (!references.rows.length) {
        if (!deps.blobStorage.delete) continue;
        await deps.blobStorage.delete(blob_url);
      }
      await deps.db.query('DELETE FROM session_file_cleanup WHERE session_id=$1 AND blob_url=$2',[id,blob_url]);
    } catch (error) { console.error('[sessions] File cleanup pending',id,error); }
  }
  const pending=await deps.db.query('SELECT count(*)::int AS count FROM session_file_cleanup WHERE session_id=$1',[id]);
  return {ok:true, pending_files:pending.rows[0].count as number};
}

export async function saveSessionHandoff(deps: ServiceDeps, id: string, input: {summary: string; decisions: string[]; next_steps: string[]}) {
  const body=[input.summary,'## Decisions',...input.decisions.map(x=>`- ${x}`),'## Next steps',...input.next_steps.map(x=>`- ${x}`)].join('\n\n');
  const trace=newTrace();
  const staged=await deps.db.transaction(async tx=>{
    const session=(await tx.query('SELECT * FROM project_sessions WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!session) throw new Error('Session not found');
    const note=session.note_id ? (await tx.query('SELECT * FROM content_items WHERE id=$1 FOR UPDATE',[session.note_id])).rows[0] : null;
    // A retried capture is already durable, even while its indexing is pending.
    if(note?.content===body && session.summary===input.summary && JSON.stringify(session.decisions)===JSON.stringify(input.decisions) && JSON.stringify(session.next_steps)===JSON.stringify(input.next_steps)) return {session,note:null};
    if(note?.processing_status==='pending') throw new Error('Session handoff is still indexing; retry the changed handoff when it is ready.');
    const contentInput={type:'note' as const,title:note?.title??`Session ${session.session_key}`,content:body,sessionId:id,projectIds:session.project_id?[session.project_id]:[],folder:'system/sessions'};
    let noteId=note?.id;
    if(note){
      await tx.query('DELETE FROM chunks WHERE content_item_id=$1',[noteId]);
      await tx.query("UPDATE content_items SET content=$2,processing_status='pending',processing_error=NULL,embedding=NULL,metadata=$3,updated_at=now() WHERE id=$1",[noteId,body,JSON.stringify({ingest_trace:trace})]);
    }else{
      noteId=(await insertContentItem(tx,{...contentInput,titleSource:'user',tags:[],blobUrl:null,mimeType:null,fileHash:null,embedding:null,metadata:{ingest_trace:trace},sourceUrl:null,publishedAt:null,processingStatus:'pending'})).id;
    }
    const saved=(await tx.query('UPDATE project_sessions SET summary=$2,decisions=$3,next_steps=$4,note_id=$5,updated_at=now() WHERE id=$1 RETURNING *',[id,input.summary,input.decisions,input.next_steps,noteId])).rows[0];
    return {session:saved,note:{id:noteId,input:contentInput}};
  });
  if(staged.note) void runIngestTail(deps,staged.note.id,staged.note.input,null,trace).catch(error=>console.error('[sessions] Handoff indexing failed',id,error));
  return staged.session;
}
