import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Icons } from '../../components/Icons';
import { BulkCheckbox, FilterChip, Status, Tag } from '../../components/primitives';
import { OverflowMenu } from '../../components/OverflowMenu';
import {
  archiveContent,
  listContent,
  pinContent,
  reprocessContent,
  retryContent,
  unpinContent,
} from '../../lib/api';
import { toUiDocument } from '../../lib/view';
import { cls, fmtRel } from '../../lib/util';
import type { ActionDispatch, DocumentType, Project } from '../../types';

interface Props {
  project: Project;
  onAction: ActionDispatch;
}

type DocFilter = 'all' | 'pinned' | 'pending' | 'failed';
type DocTypeFilter = 'all' | DocumentType;

export function DocumentsTab({ project, onAction }: Props) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['content', 'document', project.id],
    queryFn: () => listContent({ type: 'document', project_id: project.id }),
  });

  const docs = useMemo(() => (data ?? []).map(toUiDocument), [data]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<DocFilter>('all');
  const [type, setType] = useState<DocTypeFilter>('all');

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['content'] });
    qc.invalidateQueries({ queryKey: ['project-counts'] });
    qc.invalidateQueries({ queryKey: ['stats'] });
    qc.invalidateQueries({ queryKey: ['activity'] });
  };
  const archiveMut = useMutation({ mutationFn: archiveContent, onSuccess: invalidate });
  const pinMut = useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) => (pinned ? unpinContent(id) : pinContent(id)),
    onSuccess: invalidate,
  });
  const retryMut = useMutation({ mutationFn: retryContent, onSuccess: invalidate });
  const reprocessMut = useMutation({ mutationFn: reprocessContent, onSuccess: invalidate });

  const filtered = docs.filter(d => {
    if (filter === 'pinned' && !d.pinned) return false;
    if (filter === 'pending' && d.processing_status !== 'pending') return false;
    if (filter === 'failed' && d.processing_status !== 'failed') return false;
    if (type !== 'all' && d.type !== type) return false;
    return true;
  });
  const allSelected = filtered.length > 0 && filtered.every(d => selected.has(d.id));
  const toggle = (id: string) =>
    setSelected(s => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(filtered.map(d => d.id)));

  if (error) {
    return <div className="page-subtle" style={{ color: 'var(--danger)' }}>Failed to load documents: {String((error as Error).message)}</div>;
  }
  if (isLoading) {
    return <div className="page-subtle">Loading documents…</div>;
  }

  return (
    <div>
      <div className="filter-bar">
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
          All <span style={{ marginLeft: 4 }}>{docs.length}</span>
        </FilterChip>
        <FilterChip active={filter === 'pinned'} onClick={() => setFilter('pinned')}>
          Pinned <span style={{ marginLeft: 4 }}>{docs.filter(d => d.pinned).length}</span>
        </FilterChip>
        <FilterChip active={filter === 'pending'} onClick={() => setFilter('pending')}>
          Processing <span style={{ marginLeft: 4 }}>{docs.filter(d => d.processing_status === 'pending').length}</span>
        </FilterChip>
        <FilterChip active={filter === 'failed'} onClick={() => setFilter('failed')}>
          Failed <span style={{ marginLeft: 4 }}>{docs.filter(d => d.processing_status === 'failed').length}</span>
        </FilterChip>
        <span style={{ width: 1, height: 18, background: 'var(--hairline)', margin: '0 4px' }} />
        <FilterChip active={type === 'all'} onClick={() => setType('all')}>Any type</FilterChip>
        <FilterChip active={type === 'binary'} onClick={() => setType('binary')}>Files</FilterChip>
        <FilterChip active={type === 'url'} onClick={() => setType('url')}>URLs</FilterChip>
        <FilterChip active={type === 'note-as-doc'} onClick={() => setType('note-as-doc')}>Notes-as-doc</FilterChip>
        <span style={{ marginLeft: 'auto' }} className="row-flex gap-1">
          <button className="btn btn-sm" onClick={() => onAction({ kind: 'upload', payload: project })}>
            <Icons.Plus /> Add document
          </button>
        </span>
      </div>

      {docs.length === 0 ? (
        <div className="page-subtle">No documents in this project yet.</div>
      ) : (
        <>
          <div className="row-flex gap-2 list-bulk-bar">
            <BulkCheckbox checked={allSelected} onClick={toggleAll} />
            <span className="subtle">
              {filtered.length} of {docs.length} {selected.size ? `· ${selected.size} selected` : ''}
            </span>
          </div>

          <div className="doc-list">
            {filtered.map(d => (
              <div key={d.id} className={cls('doc-row', selected.has(d.id) && 'selected')}>
                <BulkCheckbox checked={selected.has(d.id)} onClick={() => toggle(d.id)} />
                <div className="ic-box">
                  {d.type === 'binary' ? <Icons.Doc /> : d.type === 'url' ? <Icons.Globe /> : <Icons.Note />}
                </div>
                <div onClick={() => d.processing_status === 'ready' && onAction({ kind: 'doc-read', payload: d })}>
                  <div className="row-flex gap-2">
                    <span className="nm">{d.title}</span>
                    {d.pinned ? <Icons.Pin size={11} style={{ color: 'var(--fg-subtle)' }} /> : null}
                    {d.tags.slice(0, 2).map(t => (
                      <Tag key={t}>{t}</Tag>
                    ))}
                    {d.project_ids.length > 1 ? <Tag>+{d.project_ids.length - 1} project</Tag> : null}
                  </div>
                  <div className="sub">
                    <Status status={d.processing_status} error={d.processing_error} />
                    <span>{d.size}</span>
                    {d.source_url ? (
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 }}>
                        {d.source_url}
                      </span>
                    ) : null}
                    {d.file_hash ? <span>sha {d.file_hash.slice(0, 7)}</span> : null}
                    {d.processing_status === 'failed' ? (
                      <span style={{ color: 'oklch(0.72 0.14 25)' }}>{d.processing_error}</span>
                    ) : null}
                  </div>
                </div>
                <span className="date">{fmtRel(d.created_at)}</span>
                <OverflowMenu title="Document actions" triggerClassName="btn btn-ghost btn-icon">
                  {(close) => (
                    <>
                      {d.processing_status === 'failed' ? (
                        <button
                          role="menuitem"
                          disabled={retryMut.isPending}
                          onClick={() => { close(); retryMut.mutate(d.id); }}
                        >
                          <Icons.Cog size={13} /> Retry
                        </button>
                      ) : null}
                      <button
                        role="menuitem"
                        disabled={pinMut.isPending}
                        onClick={() => { close(); pinMut.mutate({ id: d.id, pinned: !!d.pinned }); }}
                      >
                        <Icons.Pin size={13} /> {d.pinned ? 'Unpin' : 'Pin'}
                      </button>
                      <button
                        role="menuitem"
                        disabled={reprocessMut.isPending || d.processing_status === 'pending'}
                        onClick={() => { close(); reprocessMut.mutate(d.id); }}
                      >
                        <Icons.Sparkle size={13} /> Reprocess
                      </button>
                      <button
                        role="menuitem"
                        disabled={archiveMut.isPending}
                        onClick={() => { close(); archiveMut.mutate(d.id); }}
                      >
                        <Icons.ArchiveBox size={13} /> Archive
                      </button>
                    </>
                  )}
                </OverflowMenu>
              </div>
            ))}
          </div>
        </>
      )}

      {selected.size > 0 ? (
        <div className="bulk-bar">
          <span className="ct">{selected.size} selected</span>
          <span className="sep" />
          <button className="btn btn-sm">Tag</button>
          <button className="btn btn-sm">Move to project</button>
          <button
            className="btn btn-sm"
            disabled={pinMut.isPending}
            onClick={() => {
              const ids = Array.from(selected);
              setSelected(new Set());
              ids.forEach((id) => {
                const doc = docs.find((x) => x.id === id);
                pinMut.mutate({ id, pinned: !!doc?.pinned });
              });
            }}
          >
            Pin
          </button>
          <button
            className="btn btn-sm"
            disabled={reprocessMut.isPending}
            onClick={() => {
              const ids = Array.from(selected).filter((id) => {
                const doc = docs.find((x) => x.id === id);
                return doc?.processing_status !== 'pending';
              });
              setSelected(new Set());
              ids.forEach((id) => reprocessMut.mutate(id));
            }}
          >
            Reprocess
          </button>
          <span className="sep" />
          <button
            className="btn btn-sm btn-danger"
            disabled={archiveMut.isPending}
            onClick={() => {
              const ids = Array.from(selected);
              setSelected(new Set());
              ids.forEach((id) => archiveMut.mutate(id));
            }}
          >
            Archive
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      ) : null}
    </div>
  );
}
