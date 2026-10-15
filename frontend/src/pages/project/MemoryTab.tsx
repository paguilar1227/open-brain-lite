import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { liteRequest } from '../../lib/api';
import { MarkdownPreview } from '../../components/MarkdownPreview';
import { useEffect } from 'react';
interface Context { memory: { id: string; summary: string; created_at: string } | null; sessions: Array<{ id: string; summary: string; decisions: string[]; next_steps: string[]; created_at: string }>; open_todos: Array<{ id: string; content: string }>; consolidation: { id: string; status: 'running' | 'completed' | 'failed'; error?: string } | null }
export function MemoryTab({ projectId }: { projectId: string }) {
  const client = useQueryClient();
  const context = useQuery({ queryKey: ['project-context', projectId], queryFn: () => liteRequest<Context>(`/projects/${projectId}/context`),
    refetchInterval: query => query.state.data?.consolidation?.status === 'running' ? 1000 : false });
  const consolidate = useMutation({ mutationFn: () => liteRequest(`/projects/${projectId}/consolidate`, { method: 'POST' }), onSuccess: () => { client.invalidateQueries({ queryKey: ['project-context', projectId] }); client.invalidateQueries({ queryKey: ['content'] }); } });
  useEffect(() => {
    if (context.data?.consolidation?.status === 'completed') client.invalidateQueries({ queryKey: ['content'] });
  }, [client, context.data?.consolidation?.id, context.data?.consolidation?.status]);
  if (context.isPending) return <p>Loading project memory…</p>;
  if (context.error) return <p role="alert">{context.error.message}</p>;
  const running = consolidate.isPending || context.data.consolidation?.status === 'running';
  return <section className="memory-panel">
    <div className="row-flex gap-2"><h2>Project memory</h2><button type="button" className="btn btn-primary" disabled={running} onClick={() => consolidate.mutate()}>{running ? 'Consolidating…' : 'Consolidate memory'}</button></div>
    <p className="page-subtle">A durable handoff for the next AI session. Source notes, documents, and previous handoffs stay available.</p>
    {consolidate.error && <p role="alert">{consolidate.error.message}</p>}
    {context.data.consolidation?.status === 'failed' && <p role="alert">Consolidation failed: {context.data.consolidation.error}</p>}
    {context.data.memory ? <section aria-label="Consolidated project memory" data-memory-id={context.data.memory.id}><MarkdownPreview src={context.data.memory.summary} /></section> : <p>No consolidated memory yet. Save a session with the plugin, or consolidate your project’s existing notes and todos.</p>}
    <h3>Session handoffs</h3>
    {context.data.sessions.map(session => <article key={session.id} className="settings-card"><p>{session.summary}</p>
      {session.decisions.length > 0 && <><h4>Decisions</h4><ul>{session.decisions.map((text, i) => <li key={i}>{text}</li>)}</ul></>}
      {session.next_steps.length > 0 && <><h4>Next steps</h4><ul>{session.next_steps.map((text, i) => <li key={i}>{text}</li>)}</ul></>}
    </article>)}
  </section>;
}
