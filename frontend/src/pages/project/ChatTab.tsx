import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Icons } from '../../components/Icons';
import { rag } from '../../lib/api';
import { cls } from '../../lib/util';
import type { ChatCitation, ChatMessageT, Project } from '../../types';

interface Props {
  project: Project;
}

type DepthChoice = 'shallow' | 'balanced' | 'deep';

const DEPTH_TO_RAG: Record<DepthChoice, 'fast' | 'auto' | 'thorough'> = {
  shallow: 'fast',
  balanced: 'auto',
  deep: 'thorough',
};

// One-line explainer for the selected depth — shown under the pill so the
// Shallow/Balanced/Deep choice isn't opaque (no hover tooltips on mobile).
const DEPTH_DESC: Record<DepthChoice, string> = {
  shallow: 'Fastest — a quick pass over the closest matches.',
  balanced: 'Default — auto-tunes effort to the question.',
  deep: 'Most thorough — wider retrieval, deeper synthesis. Slower.',
};

export function ChatTab({ project }: Props) {
  const [messages, setMessages] = useState<ChatMessageT[]>([]);
  const [draft, setDraft] = useState('');
  const [depth, setDepth] = useState<DepthChoice>('balanced');
  const scrollRef = useRef<HTMLDivElement>(null);

  const askMut = useMutation({
    mutationFn: (input: { question: string; depth: 'fast' | 'auto' | 'thorough' }) =>
      rag({
        question: input.question,
        project_id: project.id,
        depth: input.depth,
      }),
    onSuccess: (resp) => {
      const citations: ChatCitation[] = resp.citations.map((c, i) => ({
        id: c.id,
        num: i + 1,
        title: c.title,
        path: c.source_url ?? `chunk · ${c.id.slice(0, 8)}`,
        chunk: c.excerpt,
        score: 0,
      }));
      setMessages((m) => [
        ...m,
        {
          id: `a${Date.now()}`,
          role: 'assistant',
          text: resp.answer,
          citations,
          timing: {
            retrieval_ms: resp.meta.timings_ms?.search ?? 0,
            generation_ms: resp.meta.timings_ms?.synthesis ?? 0,
            chunks: resp.used_chunks,
          },
        },
      ]);
    },
    onError: (err) => {
      setMessages((m) => [
        ...m,
        {
          id: `e${Date.now()}`,
          role: 'assistant',
          text: `Error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
    },
  });

  const send = () => {
    const q = draft.trim();
    if (!q || askMut.isPending) return;
    setMessages((m) => [...m, { id: `u${Date.now()}`, role: 'user', text: q }]);
    setDraft('');
    askMut.mutate({ question: q, depth: DEPTH_TO_RAG[depth] });
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, askMut.isPending]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '60vh' }}>
      <div ref={scrollRef} style={{ flex: 1 }}>
        <div className="chat">
          {messages.length === 0 && !askMut.isPending && (
            <div className="chat-empty">
              <div className="ic-circle">
                <Icons.Sparkle size={20} />
              </div>
              <h3>Ask about {project.name}</h3>
              <p>Chat is grounded only in this project's documents, notes, and todos. Citations expand inline so you can verify every claim.</p>
              <div className="chat-suggest">
                <div className="s" onClick={() => setDraft('How am I authenticating to Claude?')}>
                  <div className="lb">Auth</div>How am I authenticating to Claude?
                </div>
                <div className="s" onClick={() => setDraft('Walk me through the multi-session model.')}>
                  <div className="lb">Architecture</div>Walk me through the multi-session model.
                </div>
                <div className="s" onClick={() => setDraft("What's blocking the SSE work?")}>
                  <div className="lb">Open todos</div>What's blocking the SSE work?
                </div>
                <div className="s" onClick={() => setDraft('What gotchas have I logged?')}>
                  <div className="lb">Failure modes</div>What gotchas have I logged?
                </div>
              </div>
            </div>
          )}
          {messages.map(m => (
            <ChatMessage key={m.id} m={m} />
          ))}
          {askMut.isPending && (
            <div className="msg">
              <div className="msg-avatar">
                <Icons.Sparkle size={13} />
              </div>
              <div className="msg-bubble">
                <div className="dots">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="composer-wrap">
        <div className="composer-controls">
          <div className="depth-pill">
            <button className={depth === 'shallow' ? 'active' : ''} onClick={() => setDepth('shallow')}>Shallow</button>
            <button className={depth === 'balanced' ? 'active' : ''} onClick={() => setDepth('balanced')}>Balanced</button>
            <button className={depth === 'deep' ? 'active' : ''} onClick={() => setDepth('deep')}>Deep</button>
          </div>
        </div>
        <p className="composer-depth-desc">{DEPTH_DESC[depth]}</p>
        <div className="composer">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder={`Ask ${project.name}…`}
            rows={1}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button className="btn btn-primary btn-icon" onClick={send} disabled={!draft.trim() || askMut.isPending}>
            <Icons.Send />
          </button>
        </div>
        <div className="chat-foot">
          <span>↵ to send · ⇧↵ for newline</span>
        </div>
      </div>
    </div>
  );
}

function ChatMessage({ m }: { m: ChatMessageT }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set([0]));
  const togg = (i: number) =>
    setExpanded(s => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  return (
    <div className={cls('msg', m.role)}>
      <div className="msg-avatar">{m.role === 'user' ? 'P' : <Icons.Sparkle size={13} />}</div>
      <div style={{ minWidth: 0, flex: 1, maxWidth: 680 }}>
        <div className="msg-bubble" style={{ whiteSpace: 'pre-wrap' }}>
          {m.text}
        </div>
        {m.citations && m.citations.length > 0 ? (
          <div className="citations">
            {m.citations.map((c, i) => (
              <div key={c.id} className="cite-row">
                <div className="cite-head" onClick={() => togg(i)}>
                  <span className="cite-num">{c.num}</span>
                  <span className="nm">{c.title}</span>
                  <span className="pth">{c.path}</span>
                  <span style={{ color: 'var(--fg-subtle)', marginLeft: 4 }}>
                    {expanded.has(i) ? <Icons.ChevronDown size={12} /> : <Icons.ChevronRight size={12} />}
                  </span>
                </div>
                {expanded.has(i) ? (
                  <div className="cite-chunk" dangerouslySetInnerHTML={{ __html: c.chunk }} />
                ) : null}
                {expanded.has(i) ? (
                  <div className="cite-foot">
                    <span style={{ marginLeft: 'auto' }} className="row-flex gap-1">
                      <button className="btn btn-ghost btn-sm">Open source</button>
                    </span>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        {m.timing ? (
          <div className="timing-foot">
            <span>retrieval {m.timing.retrieval_ms}ms</span>
            <span>· generation {m.timing.generation_ms}ms</span>
            <span>· {m.timing.chunks} chunks</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
