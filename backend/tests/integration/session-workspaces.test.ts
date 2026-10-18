import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {TimelineResponseSchema} from '@open-brain/shared';
import {PGlite} from '@electric-sql/pglite';
import {vector} from '@electric-sql/pglite-pgvector';
import {uuid_ossp} from '@electric-sql/pglite/contrib/uuid_ossp';
import {readFile,readdir} from 'node:fs/promises';
import {createApp} from '../../src/app.js';
import {createMcpServer} from '../../src/mcp/server.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import * as sessions from '../../src/services/sessions.js';
import {createContentItem,replaceContent} from '../../src/services/content-items.js';
import {createTodo} from '../../src/services/todos.js';
import {search} from '../../src/services/search.js';
import {listProjectTimeline,listSessionTimeline} from '../../src/db/timeline.js';
import {StubEmbeddingProvider,StubLLMProvider} from '../../src/providers/stub.js';
import {mockBlobStorage} from '../helpers/mocks.js';
import type {ServiceDeps} from '../../src/services/index.js';
import type {DbClient} from '../../src/db/client.js';

let pg:PGlite,deps:ServiceDeps,app:ReturnType<typeof createApp>,legacySession:string,legacyNote:string;
const project=async(name:string)=>(await pg.query<{id:string}>('INSERT INTO projects(name) VALUES($1) RETURNING id',[name])).rows[0].id;
const note=async(sessionId:string,title:string)=>{const started=await createContentItem(deps,{type:'note',sessionId,title,content:`${title} shared keyword`});await started.completion;return started.id;};
const request=async(path:string,method='GET',body?:unknown)=>app.request(path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
beforeAll(async()=>{
 pg=new PGlite({extensions:{vector,uuid_ossp}});
 const query=async(sql:string,params?:unknown[])=>{const r=await pg.query(sql,params);return {...r,rowCount:r.affectedRows??r.rows.length};};
 const db={query,pool:{query},transaction:(fn:any)=>pg.transaction(tx=>fn({query:async(sql:string,params?:unknown[])=>{const r=await tx.query(sql,params);return {...r,rowCount:r.affectedRows??r.rows.length};}}))} as unknown as DbClient;
 for(const file of (await readdir('../migrations')).filter(n=>n.endsWith('.sql')&&n<'013').sort())await pg.exec(await readFile(`../migrations/${file}`,'utf8'));
 const p=await project('Legacy');legacyNote=(await pg.query<{id:string}>("INSERT INTO content_items(type,title,content,project_ids) VALUES('note','Legacy handoff','keep this',ARRAY[$1]::uuid[]) RETURNING id",[p])).rows[0].id;
 legacySession=(await pg.query<{id:string}>("INSERT INTO project_sessions(project_id,session_key,summary,note_id) VALUES($1,'legacy','keep facts',$2) RETURNING id",[p,legacyNote])).rows[0].id;
 await pg.exec(await readFile('../migrations/013_session_workspaces.sql','utf8'));
 deps={db,config:{apiKey:'',llmProvider:'stub',storageProvider:'local'},embeddingProvider:new StubEmbeddingProvider(),metadataLLM:new StubLLMProvider(),ragFastLLM:new StubLLMProvider(),blobStorage:{...mockBlobStorage(),delete:vi.fn().mockResolvedValue(undefined)}} as unknown as ServiceDeps;
 app=createApp(deps);
});
afterAll(async()=>{await pg?.close();});
describe('session workspaces',()=>{
 it('migrates handoffs without losing IDs, facts or the owned source note',async()=>{
  const s=await sessions.getSession(deps,legacySession);expect(s?.summary).toBe('keep facts');expect(s?.note_id).toBe(legacyNote);
  expect((await pg.query('SELECT session_id FROM content_items WHERE id=$1',[legacyNote])).rows[0].session_id).toBe(legacySession);
 });
 it('creates/resumes separate sessions under a project and standalone, through REST',async()=>{
  const p=await project('Workspace project');
  const response=await request('/api/v1/sessions','POST',{name:'First session',project_id:p,session_key:'one'});expect(response.status).toBe(201);
  const s=(await response.json()).session;
  const repeat=await sessions.createSession(deps,{name:'Retry',project_id:p,session_key:'one'});expect(repeat.id).toBe(s.id);expect(repeat.name).toBe('First session');
  const solo=await sessions.createSession(deps,{name:'Standalone',session_key:'standalone'});expect(solo.project_id).toBeNull();
  expect((await sessions.listSessions(deps,p)).map(x=>x.id)).toEqual([s.id]);
  expect((await sessions.listSessions(deps,null)).map(x=>x.id)).toContain(solo.id);
 });
 it('isolates session search while project search includes every child and global includes standalone',async()=>{
  const p=await project('Search project'),other=await project('Other project');
  const a=await sessions.createSession(deps,{name:'A',project_id:p}),b=await sessions.createSession(deps,{name:'B',project_id:p}),c=await sessions.createSession(deps,{name:'C',project_id:other}),solo=await sessions.createSession(deps,{name:'Solo'});
  const ids=await Promise.all([note(a.id,'alpha'),note(b.id,'bravo'),note(c.id,'charlie'),note(solo.id,'delta')]);
  const todo=await createTodo(deps,{content:'shared keyword task',sessionId:a.id});
  const entityIds=(hits:Awaited<ReturnType<typeof search>>)=>new Set(hits.map(h=>h.type==='todo'?h.todo!.id:h.chunk!.content_item_id));
  expect(entityIds(await search(deps,'shared keyword',{sessionId:a.id,threshold:0}))).toEqual(new Set([ids[0],todo.id]));
  expect(entityIds(await search(deps,'shared keyword',{projectId:p,threshold:0}))).toEqual(new Set([ids[0],ids[1],todo.id]));
  expect(entityIds(await search(deps,'shared keyword',{threshold:0}))).toEqual(new Set([...ids,todo.id]));
  expect(entityIds(await search(deps,'',{sessionId:solo.id}))).toEqual(new Set([ids[3]]));
  expect(todo.project_id).toBe(p);
  const response=await request('/api/v1/search','POST',{query:'shared keyword',session_id:a.id});expect(response.status).toBe(200);expect(entityIds((await response.json()).hits)).toEqual(new Set([ids[0],todo.id]));
  const listed=await request(`/api/v1/content?session_id=${b.id}`);expect((await listed.json()).items.map((x:any)=>x.id)).toEqual([ids[1]]);
 });
 it('captures session timelines, tags and deletions for standalone and project sessions',async()=>{
  for(const project_id of [await project('Timeline'),null]){
   const s=await sessions.createSession(deps,{name:'Timeline session',project_id});const id=await note(s.id,'Timeline note');
   await pg.query("UPDATE content_items SET title='Changed title',tags=ARRAY['design'] WHERE id=$1",[id]);
   await pg.query('DELETE FROM content_items WHERE id=$1',[id]);
   const history=await listSessionTimeline(deps.db,s.id,{limit:100,tags:['design']});expect(history.events.map(e=>e.action)).toEqual(['deleted','edited','created']);
   expect(history.events.every(e=>e.session_id===s.id)).toBe(true);
   if(project_id)expect((await listProjectTimeline(deps.db,project_id,{limit:100})).total).toBe(3);
   const response=await request(`/api/v1/sessions/${s.id}/timeline?search=Changed`);expect(response.status).toBe(200);const payload=TimelineResponseSchema.parse(await response.json());expect(payload.total).toBe(2);expect(payload.events.every(e=>e.session_id===s.id)).toBe(true);
  }
 });
 it('consolidates project and child-session timelines with one shared-name tag filter and a complete tag union',async()=>{
  const p=await project('Consolidated history'),outside=await project('Unrelated history');
  const a=await sessions.createSession(deps,{name:'Design review',project_id:p});
  const b=await sessions.createSession(deps,{name:'Implementation',project_id:p});
  const foreign=await sessions.createSession(deps,{name:'Unrelated session',project_id:outside});
  const standalone=await sessions.createSession(deps,{name:'Standalone history'});
  async function artifact(title:string,owner:string|null,tags:string[],parent:string|null=null){
   return (await pg.query<{id:string}>("INSERT INTO content_items(type,title,content,project_ids,session_id,tags) VALUES('document',$1,'source',$2,$3,$4) RETURNING id",[title,parent?[parent]:[],owner,tags])).rows[0].id;
  }
  const direct=await artifact('Project spec',null,['front-end','project-only'],p);
  const first=await artifact('Design spec',a.id,['front-end','session-one']);
  const second=await artifact('Implementation spec',b.id,['front-end','session-two']);
  const backend=await artifact('Server spec',b.id,['back-end']);
  await artifact('Outside spec',foreign.id,['front-end','private']);
  await artifact('Standalone spec',standalone.id,['front-end','standalone']);
  // Explicit interleaving proves one chronology rather than concatenated session lists.
  for(const [index,id] of [direct,second,first,backend].entries())await pg.query('UPDATE project_timeline_events SET occurred_at=$2 WHERE entity_id=$1',[id,`2026-01-0${index+1}T12:00:00Z`]);
  const response=await request(`/api/v1/projects/${p}/timeline?limit=2&tag=front-end`);
  expect(response.status).toBe(200);
  const page=TimelineResponseSchema.parse(await response.json());
  const tagUnion=['back-end','front-end','project-only','session-one','session-two'];
  expect(page.available_tags).toEqual(tagUnion);
  expect(page.available_tags.filter(t=>t==='front-end')).toHaveLength(1);
  expect(page.total).toBe(3);
  const next=await listProjectTimeline(deps.db,p,{limit:2,tags:['front-end'],before_at:page.next_cursor!.at,before_id:page.next_cursor!.id});
  const events=[...page.events,...next.events];
  expect(events.map(e=>e.entity_id)).toEqual([first,second,direct]);
  expect(events.map(e=>e.session_name)).toEqual(['Design review','Implementation',null]);
  expect(next.available_tags).toEqual(tagUnion);
  expect((await listProjectTimeline(deps.db,p,{limit:100,tags:['front-end','back-end']})).total).toBe(0);
  expect((await listProjectTimeline(deps.db,p,{limit:100,tags:['front-end','back-end'],tag_match:'any'})).total).toBe(4);
  const matched=await listProjectTimeline(deps.db,p,{limit:100,search:'Design review',tags:['front-end']});
  expect(matched.events.map(e=>e.entity_id)).toEqual([first]);
  expect(matched.available_tags).toEqual(tagUnion);
  const sessionOnly=await listSessionTimeline(deps.db,a.id,{limit:100});
  expect(sessionOnly.events.map(e=>e.entity_id)).toEqual([first]);
  expect(sessionOnly.available_tags).toEqual(['front-end','session-one']);
 });
 it('keeps the consolidated tag union correct through session moves, artifact deletion and session deletion',async()=>{
  const p=await project('Tag lifecycle'),q=await project('Destination');
  const a=await sessions.createSession(deps,{name:'Moving session',project_id:p});
  const b=await sessions.createSession(deps,{name:'Deleting session',project_id:p});
  const first=await note(a.id,'Move tagged artifact'),second=await note(b.id,'Delete tagged artifact');
  await pg.query("UPDATE content_items SET tags=ARRAY['front-end','moving'] WHERE id=$1",[first]);
  await pg.query("UPDATE content_items SET tags=ARRAY['front-end','retained-history'] WHERE id=$1",[second]);
  await sessions.updateSession(deps,a.id,{project_id:q});
  expect((await listProjectTimeline(deps.db,p,{limit:100})).available_tags).toEqual(['front-end','retained-history']);
  expect((await listProjectTimeline(deps.db,q,{limit:100})).available_tags).toEqual(['front-end','moving']);
  await pg.query('DELETE FROM content_items WHERE id=$1',[second]);
  const retained=await listProjectTimeline(deps.db,p,{limit:100,tags:['front-end']});
  expect(retained.events.some(e=>e.action==='deleted')).toBe(true);
  expect(retained.events.every(e=>e.session_name==='Deleting session')).toBe(true);
  expect(retained.available_tags).toEqual(['front-end','retained-history']);
  await sessions.deleteSession(deps,b.id);
  expect((await listProjectTimeline(deps.db,p,{limit:100})).available_tags).toEqual([]);
  expect((await listProjectTimeline(deps.db,q,{limit:100})).available_tags).toEqual(['front-end','moving']);
 });
 it('shares AND/OR tag matching across REST, MCP, project and session timelines',async()=>{
  const p=await project('Tag combinations'),a=await sessions.createSession(deps,{name:'Tagged session A',project_id:p}),b=await sessions.createSession(deps,{name:'Tagged session B',project_id:p});
  async function tagged(title:string,owner:string|null,tags:string[]){
   return (await pg.query<{id:string}>("INSERT INTO content_items(type,title,content,project_ids,session_id,tags) VALUES('note',$1,'source',ARRAY[$2]::uuid[],$3,$4) RETURNING id",[title,p,owner,tags])).rows[0].id;
  }
  const first=await tagged('Design only',a.id,['design']);
  const both=await tagged('Both tags',a.id,['design','release']);
  const second=await tagged('Release only',b.id,['release']);
  const direct=await tagged('Direct project tags',null,['design','release']);
  const unrelated=await tagged('Unrelated tags',b.id,['unrelated']);
  const ids=(page:any)=>page.events.map((e:any)=>e.entity_id).sort();
  const tags='tag=design&tag=release';
  const defaultPage=await (await request(`/api/v1/projects/${p}/timeline?${tags}`)).json();
  expect(ids(defaultPage)).toEqual([both,direct].sort());
  expect(defaultPage.available_tags).toEqual(['design','release','unrelated']);
  const anyPage=await (await request(`/api/v1/projects/${p}/timeline?${tags}&tag_match=any&limit=1`)).json();
  expect(anyPage.total).toBe(4);
  const next=await (await request(`/api/v1/projects/${p}/timeline?${tags}&tag_match=any&before_at=${encodeURIComponent(anyPage.next_cursor.at)}&before_id=${anyPage.next_cursor.id}`)).json();
  expect([...ids(anyPage),...ids(next)].sort()).toEqual([first,both,second,direct].sort());
  expect(next.available_tags).toEqual(defaultPage.available_tags);
  expect((await request(`/api/v1/projects/${p}/timeline?${tags}&tag_match=xor`)).status).toBe(400);
  const server=createMcpServer(deps),client=new Client({name:'tag-match-test',version:'1'});
  const [x,y]=InMemoryTransport.createLinkedPair();await Promise.all([server.connect(x),client.connect(y)]);
  try{
   const call=async(name:string,args:any)=>{const r=await client.callTool({name,arguments:args});expect(r.isError).not.toBe(true);return JSON.parse((r.content as any)[0].text);};
   expect(ids(await call('project_timeline',{project_id:p,tags:['design','release']}))).toEqual([both,direct].sort());
   expect(ids(await call('project_timeline',{project_id:p,tags:['design','release'],tag_match:'any'}))).toEqual([first,both,second,direct].sort());
   expect(ids(await call('session_timeline',{session_id:a.id,tags:['design','release']}))).toEqual([both]);
   expect(ids(await call('session_timeline',{session_id:a.id,tags:['design','release'],tag_match:'any'}))).toEqual([first,both].sort());
   for(const mode of ['all','any']){
    expect(ids(await call('project_timeline',{project_id:p,tags:[],tag_match:mode}))).toEqual([first,both,second,direct,unrelated].sort());
    const response=await (await request(`/api/v1/sessions/${a.id}/timeline?${tags}&tag_match=${mode}`)).json();
    expect(ids(response)).toEqual(mode==='all'?[both]:[first,both].sort());
   }
   const missing=await client.callTool({name:'project_timeline',arguments:{project_id:p,tags:['design','missing'],tag_match:'all'}});
   expect(JSON.parse((missing.content as any)[0].text).total).toBe(0);
  }finally{await client.close();await server.close();}
 });
 it('records artifact transfers only in the receiving session scope without duplicating or leaking the transfer event',async()=>{
  const p=await project('Original owner'),q=await project('New owner');
  const a=await sessions.createSession(deps,{name:'Original session',project_id:p});
  const b=await sessions.createSession(deps,{name:'Receiving session',project_id:q});
  const standalone=await sessions.createSession(deps,{name:'Standalone receiver'});
  for(const receiver of [b,standalone]){
   const id=await note(a.id,`Transferred to ${receiver.name}`);
   const response=await request(`/api/v1/content/${id}`,'PUT',{session_id:receiver.id,tags:['front-end']});
   expect(response.status).toBe(200);
   const old=await listProjectTimeline(deps.db,p,{limit:100});
   expect(old.events.filter(e=>e.session_id===receiver.id)).toEqual([]);
   const received=await listSessionTimeline(deps.db,receiver.id,{limit:100,tags:['front-end']});
   expect(received.events.filter(e=>e.entity_id===id)).toHaveLength(1);
   expect(received.events.find(e=>e.entity_id===id)?.project_id).toBe(receiver.project_id);
   if(receiver.project_id){
    const current=await listProjectTimeline(deps.db,receiver.project_id,{limit:100,tags:['front-end']});
    expect(current.events.filter(e=>e.entity_id===id)).toHaveLength(1);
   }
  }
 });
 it('moves a session and all its content/timeline between projects and standalone',async()=>{
  const p=await project('Move from'),q=await project('Move to'),s=await sessions.createSession(deps,{name:'Movable',project_id:p});const id=await note(s.id,'move keyword');const todo=await createTodo(deps,{content:'move keyword task',sessionId:s.id});
  await sessions.updateSession(deps,s.id,{project_id:q});
  expect((await pg.query('SELECT project_ids FROM content_items WHERE id=$1',[id])).rows[0].project_ids).toEqual([q]);
  expect((await pg.query('SELECT project_id FROM todos WHERE id=$1',[todo.id])).rows[0].project_id).toBe(q);
  expect((await listProjectTimeline(deps.db,p,{limit:100})).total).toBe(0);
  await sessions.updateSession(deps,s.id,{project_id:null});
  expect((await pg.query('SELECT project_ids FROM content_items WHERE id=$1',[id])).rows[0].project_ids).toEqual([]);
  expect((await listSessionTimeline(deps.db,s.id,{limit:100})).total).toBeGreaterThan(0);
 });
 it('inherits a parent task session and rejects a cross-session child',async()=>{
  const a=await sessions.createSession(deps,{name:'Tree A'}),b=await sessions.createSession(deps,{name:'Tree B'});
  const parent=await createTodo(deps,{content:'Parent',sessionId:a.id});const child=await createTodo(deps,{content:'Child',parentId:parent.id});expect(child.session_id).toBe(a.id);
  await expect(createTodo(deps,{content:'Invalid',parentId:parent.id,sessionId:b.id})).rejects.toThrow('same session');
 });
 it('deletes owned notes, documents, chunks, todos, subtasks, comments, timeline and uploaded files, preserving other sessions',async()=>{
  const a=await sessions.createSession(deps,{name:'Delete me'}),b=await sessions.createSession(deps,{name:'Keep me'});
  const keep=await note(b.id,'Keep note'),removed=await note(a.id,'Remove note');
  const file=await createContentItem(deps,{type:'document',sessionId:a.id,title:'Owned file',file:{data:Buffer.from('delete owned artifact'),filename:'artifact.txt',mimeType:'text/plain'}});await file.completion;
  const parent=await createTodo(deps,{content:'Parent',sessionId:a.id}),child=await createTodo(deps,{content:'Child',parentId:parent.id});
  await pg.query("INSERT INTO todo_comments(todo_id,content) VALUES($1,'Comment')",[child.id]);
  const response=await request(`/api/v1/sessions/${a.id}`,'DELETE');expect(response.status).toBe(200);expect((await response.json()).pending_files).toBe(0);
  for(const table of ['content_items','todos','project_timeline_events'])expect((await pg.query(`SELECT id FROM ${table} WHERE session_id=$1`,[a.id])).rows).toHaveLength(0);
  expect((await pg.query('SELECT id FROM chunks WHERE content_item_id=ANY($1::uuid[])',[[removed,file.id]])).rows).toHaveLength(0);
  expect((await pg.query('SELECT id FROM todo_comments WHERE todo_id=$1',[child.id])).rows).toHaveLength(0);
  expect((await pg.query('SELECT id FROM content_items WHERE id=$1',[keep])).rows).toHaveLength(1);expect(deps.blobStorage.delete).toHaveBeenCalled();
 });
 it('never deduplicates a file into another session and replacement retains its owner',async()=>{
  const a=await sessions.createSession(deps,{name:'Files A'}),b=await sessions.createSession(deps,{name:'Files B'});
  const file={data:Buffer.from('same file bytes'),filename:'shared.txt',mimeType:'text/plain'};
  const one=await createContentItem(deps,{type:'document',sessionId:a.id,file});await one.completion;
  const two=await createContentItem(deps,{type:'document',sessionId:b.id,file});await two.completion;
  expect(one.id).not.toBe(two.id);
  const duplicate=await createContentItem(deps,{type:'document',sessionId:a.id,file});expect(duplicate.id).toBe(one.id);
 });
 it('makes identical handoff retries safe while indexing and rejects changed pending saves without partial updates',async()=>{
  const session=await sessions.createSession(deps,{name:'Retry handoff'});
  const input={summary:'Captured facts',decisions:['Keep source'],next_steps:['Continue']};
  const saved=await sessions.saveSessionHandoff(deps,session.id,input);
  // Wait for this test's stub indexing before installing a deterministic pending state.
  while((await pg.query('SELECT processing_status FROM content_items WHERE id=$1',[saved.note_id])).rows[0].processing_status==='pending') await new Promise(resolve=>setTimeout(resolve,0));
  await pg.query("UPDATE content_items SET processing_status='pending' WHERE id=$1",[saved.note_id]);
  expect((await sessions.saveSessionHandoff(deps,session.id,input)).note_id).toBe(saved.note_id);
  await expect(sessions.saveSessionHandoff(deps,session.id,{...input,summary:'New facts'})).rejects.toThrow('still indexing');
  expect((await sessions.getSession(deps,session.id))?.summary).toBe(input.summary);
  expect((await pg.query('SELECT content FROM content_items WHERE id=$1',[saved.note_id])).rows[0].content).toContain(input.summary);
 });
 it('exposes session workspace tools and scopes MCP writes and reads',async()=>{
  const server=createMcpServer(deps),client=new Client({name:'session-test',version:'1'});
  const [a,b]=InMemoryTransport.createLinkedPair();await Promise.all([server.connect(a),client.connect(b)]);
  try{
   const names=(await client.listTools()).tools.map(t=>t.name);expect(names).toEqual(expect.arrayContaining(['create_session','list_sessions','get_session_context','session_timeline','update_session']));
   const call=async(name:string,args:any)=>{const r=await client.callTool({name,arguments:args});expect(r.isError).not.toBe(true);return JSON.parse((r.content as any)[0].text);};
   const s=await call('create_session',{name:'MCP session',session_key:'mcp-session'});
   const todo=await call('create',{type:'todo',content:'MCP owned todo',session_id:s.id});
   const context=await call('get_session_context',{session_id:s.id});expect(context.todos[0].id).toBe(todo.id);
   const listed=await call('list',{entity_type:'todo',session_id:s.id});expect(listed.map((x:any)=>x.id)).toEqual([todo.id]);
  }finally{await client.close();await server.close();}
 });
});
