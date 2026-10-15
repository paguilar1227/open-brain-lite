// All personal (project-less) notes in a drawer. Mirrors DocListDrawer:
// clicking a row swaps the drawer body to NoteReaderBody with a "Back to
// list" affordance — the list state (sort, scroll, infinite cursor)
// survives the round trip because we don't unmount it, just hide it
// visually while the reader is up.
//
// Two modes share the toolbar's SearchInput:
//   • empty input  → browse: paginated personal notes (created_at DESC),
//     client-sorted, infinite-scroll sentinel.
//   • typing       → hybrid search via useEntitySearch (the SAME
//     lexical+vector+graph path + #tag typeahead as Home), scoped to
//     personal notes. Results render as NoteRows with the match snippet.
//
// Pagination: PAGE_SIZE rows per request ordered by created_at DESC.
// Next-page cursor is the oldest visible row's `created_at`.

import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Drawer } from '../primitives';
import { Icons } from '../Icons';
import { NoteRow } from '../NoteRow';
import { SearchInput, type SigilKind } from '../SearchInput';
import { NoteSortDropdown } from '../SortDropdown';
import { NoteReaderBody } from './NoteReaderDrawer';
import { listContent, getContent } from '../../lib/api';
import { useEntitySearch } from '../../lib/useEntitySearch';
import { useTagSuggestions } from '../../lib/useTagSuggestions';
import { toUiNote } from '../../lib/view';
import { useInView } from '../../lib/useInView';
import { useNoteSortMode, compareNotesForMode } from '../../lib/useNoteSortMode';
import { matchesTagFilter, type TagFilter } from '../../lib/tagFilter';
import type { ActionDispatch, Note, Route } from '../../types';

interface Props {
  onClose: () => void;
  onAction: ActionDispatch;
  onRoute?: (r: Route) => void;
  /** When set, only notes matching this tag filter are shown (browse). */
  initialTagFilter?: TagFilter;
}

const PAGE_SIZE = 20;
// Inside a notes drawer only `#tag` makes sense — `@docname` / `in:type`
// / `project:` don't (we're already scoped to personal notes).
const NOTE_SIGILS: readonly SigilKind[] = ['tag'];
const NO_MENTIONS: never[] = [];

export function NoteListDrawer({ onClose, onAction, onRoute, initialTagFilter }: Props) {
  const { mode: sortMode, setMode: setSortMode } = useNoteSortMode('inbox');
  const [selected, setSelected] = useState<Note | null>(null);

  // Hybrid search — same building blocks as Home, scoped to personal notes.
  const { query, setQuery, searchActive, hits, isFetching: searchFetching, error: searchError } =
    useEntitySearch({ projectId: 'null', entityTypes: ['note'] });

  // Tag inventory powers the `#` typeahead — scoped to personal notes so
  // suggestions + counts match what this drawer's search actually returns.
  const tagSuggestions = useTagSuggestions({ scope: 'personal', type: 'note' });

  // Browse pages — independent of the search query (search has its own path).
  const pages = useInfiniteQuery({
    queryKey: ['content', 'notes', 'personal', 'infinite'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listContent({
        type: 'note',
        project_id: 'null',
        limit: PAGE_SIZE,
        ...(pageParam ? { before: pageParam } : {}),
      }),
    getNextPageParam: (lastPage) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      return lastPage[lastPage.length - 1].created_at;
    },
  });

  const notes = useMemo(() => {
    const flat = (pages.data?.pages ?? []).flat();
    const filtered =
      initialTagFilter && initialTagFilter.tags.length > 0
        ? flat.filter((n) => matchesTagFilter(n, initialTagFilter))
        : flat;
    return [...filtered].sort(compareNotesForMode(sortMode));
  }, [pages.data, sortMode, initialTagFilter]);

  // Dedupe chunk-level hits to one row per note, preserving rank order.
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

  // Open a hit in the SAME in-drawer reader as a browse row (hits carry
  // no full record, so fetch it — same getContent + toUiNote as elsewhere).
  const openHit = async (entityId: string) => {
    try {
      const c = await getContent(entityId);
      if (c.type === 'note') setSelected(toUiNote(c));
    } catch (err) {
      console.error('Failed to open note hit', entityId, err);
    }
  };

  const { ref: sentinelRef, inView } = useInView<HTMLDivElement>();
  useEffect(() => {
    if (inView && pages.hasNextPage && !pages.isFetchingNextPage) {
      pages.fetchNextPage();
    }
  }, [inView, pages.hasNextPage, pages.isFetchingNextPage, pages.fetchNextPage]);

  // Detail view: drawer title swaps to the note title, NoteReaderBody
  // renders with onBack = return-to-list. The list state stays mounted
  // so scroll position + sort survive.
  if (selected) {
    return (
      <Drawer title={selected.title} onClose={onClose}>
        <NoteReaderBody
          note={selected}
          onClose={onClose}
          onBack={() => setSelected(null)}
          onRoute={onRoute}
        />
      </Drawer>
    );
  }

  const title = searchActive
    ? `Notes · ${noteHits.length} found`
    : `Personal notes · ${notes.length}${pages.hasNextPage ? '+' : ''}`;

  return (
    <Drawer title={title} onClose={onClose}>
      <div className="todo-list-drawer-toolbar">
        <div className="search-box">
          <Icons.Search size={13} />
          <SearchInput
            value={query}
            onChange={setQuery}
            onSubmit={() => { /* live search — no submit */ }}
            tags={tagSuggestions}
            mentions={NO_MENTIONS}
            sigils={NOTE_SIGILS}
            placeholder="Search notes… try #tag"
          />
        </div>
        <NoteSortDropdown id="inbox-notes-sort" mode={sortMode} onChange={setSortMode} />
      </div>

      {searchActive ? (
        searchError ? (
          <div className="page-subtle search-drawer-error">
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
                tags={h.tags}
                onClick={() => openHit(h.entity_id)}
              />
            ))}
          </div>
        )
      ) : pages.error ? (
        <div className="page-subtle search-drawer-error">
          Failed to load: {pages.error instanceof Error ? pages.error.message : String(pages.error)}
        </div>
      ) : pages.isLoading ? (
        <div className="page-subtle">Loading…</div>
      ) : notes.length === 0 && !pages.hasNextPage ? (
        <div className="page-subtle">
          {initialTagFilter && initialTagFilter.tags.length > 0
            ? `No personal notes with ${initialTagFilter.tags.length === 1 ? 'tag' : 'tags'} ${initialTagFilter.tags.map((t) => `#${t}`).join(initialTagFilter.mode === 'and' ? ' AND ' : ' or ')}.`
            : 'No personal notes yet.'}
        </div>
      ) : (
        <div className="todo-list-drawer-rows">
          {notes.length === 0 && initialTagFilter && initialTagFilter.tags.length > 0 ? (
            <div className="page-subtle">Searching older entries for matches…</div>
          ) : (
            notes.map((n) => {
              const ui = toUiNote(n);
              return (
                <NoteRow
                  key={ui.id}
                  note={ui}
                  folder={ui.folder}
                  tags={ui.tags}
                  onClick={() => setSelected(ui)}
                />
              );
            })
          )}
          {pages.hasNextPage ? (
            <div ref={sentinelRef} className="todo-list-drawer-sentinel" aria-hidden="true">
              {pages.isFetchingNextPage ? <span className="page-subtle">Loading more…</span> : null}
            </div>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}
