import { useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SearchHit } from '@open-brain/shared';
import { createTodo, deleteSession, getContent, getSession, getTodo, listContent, listTodos, search, updateSession, updateTodo } from '../lib/api';
import { toUiDocument, toUiNote, toUiProject, toUiTodo } from '../lib/view';
import { useProjects } from '../lib/useProjects';
import { Modal, Tabs } from '../components/primitives';
import { ConfirmModal } from '../components/modals/ConfirmModal';
import { TimelineTab } from './project/TimelineTab';
import { MarkdownPreview } from '../components/MarkdownPreview';
import type { ActionDispatch, Route } from '../types';

type Tab='timeline'|'notes'|'documents'|'todos';
export function SessionPage({ sessionId, onRoute, onAction }: { sessionId: string; onRoute: (route:Route)=>void; onAction:ActionDispatch }) {
  const client=useQueryClient();
  const [tab,setTab]=useState<Tab>('timeline');
  const [settings,setSettings]=useState(false),[confirmDelete,setConfirmDelete]=useState(false);
  const [name,setName]=useState(''),[parent,setParent]=useState('');
  const [todoText,setTodoText]=useState('');
  const [query,setQuery]=useState(''),[submitted,setSubmitted]=useState(''),[scope,setScope]=useState('session');
  const [openError,setOpenError]=useState('');
  const {data:sessionData,isPending:sessionPending,error:sessionError}=useQuery({queryKey:['sessions',sessionId],queryFn:()=>getSession(sessionId)});
  const {data:projects=[]}=useProjects();
  const [notes,documents,todos]=useQueries({queries:[
    {queryKey:['content','session',sessionId,'notes'],queryFn:()=>listContent({type:'note',session_id:sessionId}),refetchInterval:(q:any)=>q.state.data?.some((x:any)=>x.processing_status==='pending')?1000:false},
    {queryKey:['content','session',sessionId,'documents'],queryFn:()=>listContent({type:'document',session_id:sessionId}),refetchInterval:(q:any)=>q.state.data?.some((x:any)=>x.processing_status==='pending')?1000:false},
    {queryKey:['todos','session',sessionId],queryFn:()=>listTodos({session_id:sessionId})},
  ]});
  const invalidate=()=>{for(const key of ['sessions','content','todos','session-timeline','project-timeline','project-counts','stats'])client.invalidateQueries({queryKey:[key]});};
  const save=useMutation({mutationFn:()=>updateSession(sessionId,{name:name.trim(),project_id:parent||null}),onSuccess:()=>{invalidate();setSettings(false);}});
  const remove=useMutation({mutationFn:()=>deleteSession(sessionId),onSuccess:result=>{
    invalidate();setConfirmDelete(false);
    if(result.pending_files){setOpenError('Session records were deleted. Some uploaded files could not be removed; retry cleanup below.');return;}
    onRoute({route:'sessions'});
  }});
  const addTodo=useMutation({mutationFn:()=>createTodo({content:todoText.trim(),session_id:sessionId}),onSuccess:()=>{setTodoText('');invalidate();}});
  const toggle=useMutation({mutationFn:({id,status}:{id:string;status:'done'|'not_started'})=>updateTodo(id,{status}),onSuccess:invalidate});
  const searchScope=scope==='project'&&!sessionData?.project_id?'session':scope;
  const {data:searchResults,isFetching:searching,error:searchError}=useQuery({queryKey:['session-search',sessionId,submitted,searchScope,sessionData?.project_id],queryFn:()=>search({query:submitted,...(searchScope==='session'?{session_id:sessionId}:searchScope==='project'?{project_id:sessionData!.project_id!}:{})}),enabled:!!submitted&&!!sessionData});
  async function openHit(hit:SearchHit){
    setOpenError('');try{
      if(hit.type==='todo')onAction({kind:'todo-detail',payload:toUiTodo(await getTodo(hit.todo.id))});
      else {const item=await getContent(hit.chunk.content_item_id);onAction(item.type==='note'?{kind:'note-edit',payload:toUiNote(item)}:{kind:'doc-read',payload:toUiDocument(item)});}
    }catch(error){setOpenError(error instanceof Error?error.message:String(error));}
  }
  if(sessionPending)return <div className="page" role="status">Loading session…</div>;
  if(sessionError)return <div className="page"><p role="alert">{sessionError.message}</p><button type="button" className="btn" onClick={()=>onRoute({route:'sessions'})}>Back to sessions</button>{openError&&<><p role="alert">{openError}</p><button type="button" className="btn" onClick={()=>remove.mutate()}>Retry file cleanup</button></>}</div>;
  const s=sessionData,project=projects.find(p=>p.id===s.project_id);
  const activeQuery=tab==='notes'?notes:tab==='documents'?documents:todos;
  return <div className="page session-page">
    <button type="button" className="btn btn-ghost" onClick={()=>onRoute({route:'sessions'})}>‹ All sessions</button>
    <div className="session-heading"><div><p className="page-subtle">{project?<button type="button" className="session-parent-link" onClick={()=>onRoute({route:'project',project:project.id})}>{project.name}</button>:'Standalone session'}</p><h1>{s.name}</h1><p className="page-subtle">{notes.data?.length??0} notes · {documents.data?.length??0} documents · {todos.data?.length??0} todos</p></div>
      <button type="button" className="btn" onClick={()=>{setName(s.name);setParent(s.project_id??'');setSettings(true);}}>Manage session</button></div>
    {s.summary&&<details className="session-handoff"><summary>Session handoff</summary><MarkdownPreview src={s.summary}/>{s.decisions.length>0&&<><h3>Decisions</h3><ul>{s.decisions.map((text,index)=><li key={index}>{text}</li>)}</ul></>}{s.next_steps.length>0&&<><h3>Next steps</h3><ul>{s.next_steps.map((text,index)=><li key={index}>{text}</li>)}</ul></>}</details>}
    <form className="session-toolbar" onSubmit={e=>{e.preventDefault();setSubmitted(query.trim());}}><input className="input" aria-label="Search workspace" placeholder="Search notes, todos, and artifacts…" value={query} onChange={e=>{setQuery(e.target.value);if(!e.target.value.trim())setSubmitted('');}}/>
      <select className="input" aria-label="Search scope" value={searchScope} onChange={e=>setScope(e.target.value)}><option value="session">This session</option>{s.project_id&&<option value="project">This project</option>}<option value="all">Everything</option></select><button type="submit" className="btn">Search</button>{submitted&&<button type="button" className="btn" onClick={()=>{setQuery('');setSubmitted('');}}>Clear</button>}</form>
    {openError&&<p role="alert">{openError}</p>}
    {submitted?<section aria-label="Search results"><h2>Search results</h2>{searching?<p role="status">Searching…</p>:searchError?<p role="alert">{searchError.message}</p>:searchResults?.length?<div className="session-list">{searchResults.map(hit=><button type="button" key={hit.type==='todo'?hit.todo.id:hit.chunk.id} className="session-list-row" onClick={()=>void openHit(hit)}><span><strong>{hit.type==='todo'?hit.todo.content:hit.chunk.parent_title}</strong><span className="session-summary-preview">{hit.type==='todo'?'Todo':hit.chunk.content}</span></span></button>)}</div>:<p>No results in this scope.</p>}</section>:<>
    <div className="tabs-row"><Tabs value={tab} onChange={id=>setTab(id as Tab)} items={[{id:'timeline',label:'Timeline'},{id:'notes',label:'Notes',count:notes.data?.length??0},{id:'documents',label:'Documents',count:documents.data?.length??0},{id:'todos',label:'Todos',count:todos.data?.length??0}]}/></div>
    {tab==='timeline'?<TimelineTab sessionId={sessionId}/>:<section aria-label={`Session ${tab}`}>
      <div className="session-heading"><h2>{tab==='notes'?'Notes':tab==='documents'?'Documents':'Todos'}</h2>{tab==='notes'?<button type="button" className="btn btn-primary" onClick={()=>onAction({kind:'note-edit',payload:null,sessionId,projectId:s.project_id??undefined})}>New note</button>:tab==='documents'?<button type="button" className="btn btn-primary" onClick={()=>onAction({kind:'upload',payload:project?toUiProject(project):null,sessionId})}>Upload artifact</button>:null}</div>
      {tab==='todos'&&<form className="session-toolbar" onSubmit={e=>{e.preventDefault();if(todoText.trim())addTodo.mutate();}}><input className="input" aria-label="New session todo" placeholder="Add a todo…" value={todoText} onChange={e=>setTodoText(e.target.value)}/><button type="submit" className="btn btn-primary" disabled={!todoText.trim()||addTodo.isPending}>Add todo</button></form>}
      {(addTodo.error||toggle.error)&&<p role="alert">{(addTodo.error??toggle.error)?.message}</p>}
      {activeQuery.isPending?<p role="status">Loading {tab}…</p>:activeQuery.error?<p role="alert">{activeQuery.error.message}</p>:tab==='todos'?todos.data?.length?<div className="session-list">{todos.data.map(todo=><div className="session-list-row" key={todo.id}><input type="checkbox" aria-label={`Complete ${todo.content}`} checked={todo.status==='done'} disabled={toggle.isPending} onChange={e=>toggle.mutate({id:todo.id,status:e.target.checked?'done':'not_started'})}/><button type="button" className="session-text-button" onClick={()=>onAction({kind:'todo-detail',payload:toUiTodo(todo)})}>{todo.parent_id?'↳ ':''}{todo.content}</button><span className="page-subtle">{todo.status.replace(/_/g,' ')}</span></div>)}</div>:<p className="session-empty">No todos yet. Add the next step for this session.</p>:(tab==='notes'?notes.data:documents.data)?.length?<div className="session-list">{(tab==='notes'?notes.data:documents.data)?.map(item=><button type="button" className="session-list-row" key={item.id} onClick={()=>onAction(item.type==='note'?{kind:'note-edit',payload:toUiNote(item)}:{kind:'doc-read',payload:toUiDocument(item)})}><span><strong>{item.title}</strong><span className="session-summary-preview">{item.tags.map(tag=>`#${tag}`).join(' ')}</span></span><span className="page-subtle">{item.processing_status}</span></button>)}</div>:<p className="session-empty">No {tab} yet. Add the work you want to keep in this session.</p>}
    </section>}
    </>}
    {settings&&<Modal title="Manage session" onClose={()=>setSettings(false)} footer={<><button type="button" className="btn btn-danger" disabled={save.isPending} onClick={()=>{setSettings(false);setConfirmDelete(true);}}>Delete session</button><button type="button" className="btn btn-primary" disabled={!name.trim()||save.isPending} onClick={()=>save.mutate()}>{save.isPending?'Saving…':'Save changes'}</button></>}>
      <label className="session-field">Name<input className="input" value={name} onChange={e=>setName(e.target.value)}/></label><label className="session-field">Project<select className="input" value={parent} onChange={e=>setParent(e.target.value)}><option value="">Standalone</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><p className="page-subtle">Moving this session moves all its notes, todos, artifacts, and timeline to the selected scope.</p>{save.error&&<p role="alert">{save.error.message}</p>}
    </Modal>}
    {confirmDelete&&<ConfirmModal title={`Delete “${s.name}”?`} message={`This permanently deletes the session, its ${s.counts?.notes??0} notes, ${s.counts?.documents??0} documents, ${s.counts?.todos??0} todos, uploaded files, and timeline. This cannot be undone.`} requireType={s.name} confirmLabel={remove.isPending?'Deleting…':'Delete session forever'} onClose={()=>setConfirmDelete(false)} onConfirm={()=>{if(!remove.isPending)remove.mutate();}}/>}
    {remove.error&&<p role="alert">{remove.error.message}</p>}
  </div>;
}
