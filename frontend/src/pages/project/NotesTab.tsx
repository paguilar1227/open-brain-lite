import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Icons } from '../../components/Icons';
import { FilterChip, Status, Tag } from '../../components/primitives';
import { SearchInput, type SigilKind } from '../../components/SearchInput';
import { NoteRow } from '../../components/NoteRow';
import { NoteSortDropdown } from '../../components/SortDropdown';
import { listContent } from '../../lib/api';
import { toUiNote } from '../../lib/view';
import { useEntitySearch } from '../../lib/useEntitySearch';
import { useTagSuggestions } from '../../lib/useTagSuggestions';
import { openEntity } from '../../lib/openEntity';
import { useNoteSortMode, compareNotesForMode } from '../../lib/useNoteSortMode';
import { fmtRel } from '../../lib/util';
import type { ActionDispatch, Project } from '../../types';

interface Props {
  project: Project;
  onAction: ActionDispatch;
}

const NOTE_SIGILS: readonly SigilKind[] = ['tag'];
const NO_MENTIONS: never[] = [];

export function NotesTab({ project, onAction }: Props) {
  const { mode: sortMode, setMode: setSortMode } = useNoteSortMode(`project:${project.id}`);

  // Hybrid search scoped to this project's notes — same component + path as
  // Home / the drawers. Typing flips the tab from the card grid to a flat
  // ranked result list; clearing returns to browse.
  const { query, setQuery, searchActive, hits, isFetching: searchFetching, error: searchError } =
    useEntitySearch({ projectId: project.id, entityTypes: ['note'] });
  const tagSuggestions = useTagSuggestions({ project_id: project.id, type: 'note' });

  const noteHits = useMemo(() => {
    const seen = new Set<string>();
    const out: typeof hits = [];
    for (const h of hits) {
      if (h.entity_kind !== 'note' || seen.has(h.entity_id)) continue;
      seen.add(h.entity_id);
      out.push(h);
    }
    return out;
  }, [hits]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['content', 'note', project.id],
    queryFn: () => listContent({ type: 'note', project_id: project.id }),
  });

  const notes = useMemo(() => {
    const sorted = (data ?? []).slice().sort(compareNotesForMode(sortMode));
    return sorted.map(toUiNote);
  }, [data, sortMode]);
  const pinnedCount = notes.filter(n => n.pinned).length;
  const pendingCount = notes.filter(n => n.processing_status === 'pending').length;

  if (error) {
    return <div className="page-subtle" style={{ color: 'var(--danger)' }}>Failed to load notes: {String((error as Error).message)}</div>;
  }
  if (isLoading) {
    return <div className="page-subtle">Loading notes…</div>;
  }

  return (
    <div>
      <div className="filter-bar">
        {searchActive ? null : (
          <>
            <FilterChip active>
              All <span style={{ marginLeft: 4 }}>{notes.length}</span>
            </FilterChip>
            <FilterChip>
              Pinned <span style={{ marginLeft: 4 }}>{pinnedCount}</span>
            </FilterChip>
            <FilterChip>
              Processing <span style={{ marginLeft: 4 }}>{pendingCount}</span>
            </FilterChip>
          </>
        )}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <div className="search-box">
            <Icons.Search size={13} />
            <SearchInput
              value={query}
              onChange={setQuery}
              onSubmit={() => { /* live search — no submit */ }}
              tags={tagSuggestions}
              mentions={NO_MENTIONS}
              sigils={NOTE_SIGILS}
              placeholder={`Search ${project.name} notes… try #tag`}
            />
          </div>
          {searchActive ? null : (
            <NoteSortDropdown id={`project-${project.id}-notes-sort`} mode={sortMode} onChange={setSortMode} />
          )}
          <button className="btn btn-sm" onClick={() => onAction({ kind: 'note-edit', payload: null, projectId: project.id })}>
            <Icons.Plus /> New note
          </button>
        </span>
      </div>

      {searchActive ? (
        searchError ? (
          <div className="page-subtle" style={{ color: 'var(--danger)' }}>
            Search failed: {searchError instanceof Error ? searchError.message : String(searchError)}
          </div>
        ) : searchFetching && noteHits.length === 0 ? (
          <div className="page-subtle">Searching…</div>
        ) : noteHits.length === 0 ? (
          <div className="page-subtle">No notes match.</div>
        ) : (
          <div className="todo-list-drawer-rows">
            {noteHits.map((h) => (
              <NoteRow
                key={h.entity_id}
                note={{ title: h.title }}
                sub={h.excerpt}
                onClick={() => openEntity(h, onAction)}
              />
            ))}
          </div>
        )
      ) : notes.length === 0 ? (
        <div className="page-subtle">No notes in this project yet.</div>
      ) : (
        <div className="note-grid">
          {notes.map(n => (
            <div key={n.id} className="note-card" onClick={() => onAction({ kind: 'note-edit', payload: n })}>
              <div className="row-flex gap-2">
                <span className="nm">{n.title}</span>
                {n.pinned ? (
                  <Icons.Pin size={12} style={{ color: 'var(--fg-subtle)', marginLeft: 'auto' }} />
                ) : null}
              </div>
              <div className="body">{n.body.replace(/^#+\s.*\n?/gm, '').replace(/\*/g, '').trim()}</div>
              <div className="ft">
                <div className="tags">
                  {n.tags.slice(0, 3).map(t => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                </div>
                <div className="row-flex gap-2">
                  <Status status={n.processing_status} />
                  <span>{fmtRel(n.updated_at)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
