import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createSession, listSessions } from '../lib/api';
import { useProjects } from '../lib/useProjects';
import { fmtRel } from '../lib/util';
import { Modal } from '../components/primitives';
import type { Route } from '../types';

export function SessionsPage({ projectId, onRoute }: { projectId?: string; onRoute: (route: Route) => void }) {
  const client=useQueryClient();
  const [filter,setFilter]=useState('all');
  const [query,setQuery]=useState('');
  const [creating,setCreating]=useState(false);
  const [name,setName]=useState('');
  const [parent,setParent]=useState(projectId??'');
  const scope=projectId??(filter==='all'?undefined:filter==='standalone'?null:filter);
  const {data:sessions,isPending:sessionsPending,error:sessionsError}=useQuery({queryKey:['sessions',scope],queryFn:()=>listSessions(scope)});
  const {data:projects=[]}=useProjects();
  const create=useMutation({mutationFn:()=>createSession({name:name.trim(),project_id:parent||null}),onSuccess:session=>{
    client.invalidateQueries({queryKey:['sessions']});setCreating(false);onRoute({route:'session',session:session.id});
  }});
  const visible=(sessions??[]).filter(session=>`${session.name} ${session.summary}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <section className={projectId?'session-browser':'page session-browser'} aria-label="Sessions">
    <div className="session-heading"><div><h1>{projectId?'Project sessions':'Sessions'}</h1><p className="page-subtle">A space for each conversation’s notes, todos, artifacts, and history.</p></div>
      <button type="button" className="btn btn-primary" onClick={()=>{setName('');setParent(projectId??'');setCreating(true);}}>New session</button></div>
    <div className="session-toolbar"><input className="input" aria-label="Find sessions" placeholder="Find a session…" value={query} onChange={e=>setQuery(e.target.value)}/>
      {!projectId&&<select className="input" aria-label="Filter sessions" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All sessions</option><option value="standalone">Standalone sessions</option>{projects.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select>}</div>
    {sessionsPending?<p role="status">Loading sessions…</p>:sessionsError?<p role="alert">{sessionsError.message}</p>:visible.length?<div className="session-list">{visible.map(session=><button type="button" key={session.id} className="session-list-row" onClick={()=>onRoute({route:'session',session:session.id})}>
      <span><strong>{session.name}</strong><span className="page-subtle session-parent">{projects.find(p=>p.id===session.project_id)?.name??'Standalone'} · {fmtRel(session.updated_at)}</span>{session.summary&&<span className="session-summary-preview">{session.summary}</span>}</span>
      <span className="session-counts">{session.counts?.notes??0} notes · {session.counts?.documents??0} documents · {session.counts?.todos??0} todos <span aria-hidden="true">›</span></span>
    </button>)}</div>:<p className="session-empty">{query?'No sessions match your search.':'No sessions yet. Create one to keep a conversation’s work together.'}</p>}
    {creating&&<Modal title="New session" onClose={()=>setCreating(false)} footer={<><button type="button" className="btn" disabled={create.isPending} onClick={()=>setCreating(false)}>Cancel</button><button type="button" className="btn btn-primary" disabled={!name.trim()||create.isPending} onClick={()=>create.mutate()}>{create.isPending?'Creating…':'Create session'}</button></>}>
      <label className="session-field">Name<input className="input" autoFocus value={name} onChange={e=>setName(e.target.value)}/></label>
      <label className="session-field">Project<select className="input" value={parent} onChange={e=>setParent(e.target.value)}><option value="">Standalone</option>{projects.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
      <p className="page-subtle">Standalone sessions are available in global search. You can assign a project later.</p>{create.error&&<p role="alert">{create.error.message}</p>}
    </Modal>}
  </section>;
}
