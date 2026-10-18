import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Icons } from '../Icons';
import { Modal } from '../primitives';
import { TagInput, type TagInputHandle } from '../TagInput';
import { saveFromUrl, uploadFile } from '../../lib/api';
import { useTagSuggestions } from '../../lib/useTagSuggestions';
import { useDirtyCloseGuard } from '../../lib/useDirtyCloseGuard';
import { uid } from '../../lib/uid';
import type { Project } from '../../types';

type Queued =
  | { kind: 'file'; id: string; file: File; status: 'queued' | 'uploading' | 'ready' | 'failed'; error?: string }
  | { kind: 'url'; id: string; url: string; status: 'queued' | 'uploading' | 'ready' | 'failed'; error?: string };

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadModal({ project, sessionId, onClose }: { sessionId?: string; project: Project | null; onClose: () => void }) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [queue, setQueue] = useState<Queued[]>([]);
  const [urlDraft, setUrlDraft] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const tagInputRef = useRef<TagInputHandle | null>(null);

  const projectIds = project ? [project.id] : undefined;
  // Autocomplete inventory — scoped to the upload target (a project or the
  // personal Inbox) so existing tags are offered instead of re-typed.
  const tagSuggestions = useTagSuggestions(
    project ? { project_id: project.id } : { scope: 'personal' },
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['content'] });
    qc.invalidateQueries({ queryKey: ['sessions'] });
    qc.invalidateQueries({ queryKey: ['session-timeline'] });
    qc.invalidateQueries({ queryKey: ['project-counts'] });
    qc.invalidateQueries({ queryKey: ['stats'] });
    qc.invalidateQueries({ queryKey: ['activity'] });
  };

  const fileMut = useMutation({
    mutationFn: ({ item, tags }: { item: Extract<Queued, { kind: 'file' }>; tags: string[] }) =>
      uploadFile({ file: item.file, projectIds, sessionId, tags: tags.length ? tags : undefined }),
  });
  const urlMut = useMutation({
    mutationFn: ({ item, tags }: { item: Extract<Queued, { kind: 'url' }>; tags: string[] }) =>
      saveFromUrl({ url: item.url, projectIds, sessionId, tags: tags.length ? tags : undefined }),
  });

  const setStatus = (id: string, patch: Partial<Queued>) => {
    setQueue((q) => q.map((x) => (x.id === id ? ({ ...x, ...patch } as Queued) : x)));
  };

  const onFiles = (files: FileList | null) => {
    if (!files) return;
    const items: Queued[] = Array.from(files).map((f) => ({
      kind: 'file',
      id: uid(),
      file: f,
      status: 'queued',
    }));
    setQueue((q) => [...q, ...items]);
  };

  const queueUrl = () => {
    const u = urlDraft.trim();
    if (!u) return;
    setQueue((q) => [...q, { kind: 'url', id: uid(), url: u, status: 'queued' }]);
    setUrlDraft('');
  };

  const processAll = async () => {
    // Flush any typed-but-uncommitted tag so it isn't silently dropped.
    const finalTags = tagInputRef.current?.commitDraft() ?? tags;
    const pending = queue.filter((x) => x.status === 'queued');
    for (const item of pending) {
      setStatus(item.id, { status: 'uploading' });
      try {
        if (item.kind === 'file') await fileMut.mutateAsync({ item, tags: finalTags });
        else await urlMut.mutateAsync({ item, tags: finalTags });
        setStatus(item.id, { status: 'ready' });
      } catch (err) {
        setStatus(item.id, {
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    invalidate();
  };

  const removeItem = (id: string) => setQueue((q) => q.filter((x) => x.id !== id));
  const queuedCount = queue.filter((x) => x.status === 'queued').length;
  const busy = queue.some((x) => x.status === 'uploading');

  // Dirty when anything is staged to upload but hasn't run yet, or the
  // URL / tags drafts are non-empty (the user typed something they'd
  // lose on close). Items already in `ready` / `failed` states have
  // either succeeded or surfaced their error — no recovery to protect.
  const isDirty =
    queuedCount > 0 ||
    urlDraft.trim().length > 0 ||
    tags.length > 0;
  const tryClose = useDirtyCloseGuard(isDirty, onClose, busy, {
    body: 'You have queued items or unsaved input. Closing will lose them.',
  });

  return (
    <Modal
      title={`Add to ${project?.name || 'Inbox'}`}
      onClose={tryClose}
      size="lg"
      footer={
        <>
          <button className="btn" onClick={tryClose} disabled={busy}>
            Close
          </button>
          <button
            className="btn btn-primary"
            onClick={processAll}
            disabled={busy || queuedCount === 0}
          >
            {busy ? 'Uploading…' : `Process ${queuedCount || ''}`.trim()}
          </button>
        </>
      }
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <div
        className="dropzone"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          onFiles(e.dataTransfer.files);
        }}
        style={{ cursor: 'pointer' }}
      >
        <div className="ic-big">
          <Icons.Upload />
        </div>
        <div className="t">Drop files here, or click to browse</div>
        <div className="d">PDF · MD · TXT · DOCX · audio · images · max 25 MB</div>
      </div>
      <div className="divider" />
      <label className="field-label">Or save a URL</label>
      <div className="row-flex gap-2">
        <input
          className="input"
          placeholder="https://example.com/article"
          value={urlDraft}
          onChange={(e) => setUrlDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              queueUrl();
            }
          }}
        />
        <button className="btn" onClick={queueUrl} disabled={!urlDraft.trim()}>
          Queue
        </button>
      </div>
      <div className="divider" />
      {/* Not a <label>: TagInput has no single associated control (chips +
          an on-demand input), so this is a plain section heading. */}
      <div className="field-label">Default tags</div>
      <div className="row-flex gap-1" style={{ flexWrap: 'wrap', marginTop: 6 }}>
        <TagInput
          ref={tagInputRef}
          value={tags}
          onChange={setTags}
          suggestions={tagSuggestions}
        />
      </div>
      <div className="divider" />
      <label className="field-label">Queue ({queue.length})</label>
      {queue.length === 0 ? (
        <div className="page-subtle">No items queued.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {queue.map((item) => (
            <div key={item.id} className="doc-row" style={{ gridTemplateColumns: '32px 1fr auto auto' }}>
              <div className="ic-box">
                {item.kind === 'file' ? <Icons.Doc /> : <Icons.Globe />}
              </div>
              <div>
                <div className="nm">{item.kind === 'file' ? item.file.name : item.url}</div>
                <div className="sub">
                  {item.kind === 'file' ? <span>{fmtBytes(item.file.size)}</span> : null}
                  <span>{item.status}</span>
                  {item.error ? (
                    <span style={{ color: 'var(--danger)' }}>{item.error}</span>
                  ) : null}
                </div>
              </div>
              <span className="subtle upload-status-pill">{item.status}</span>
              <button
                className="btn btn-ghost btn-icon"
                onClick={() => removeItem(item.id)}
                disabled={item.status === 'uploading'}
                title="Remove"
              >
                <Icons.X />
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
