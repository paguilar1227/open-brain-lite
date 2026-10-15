// All personal (project-less) documents in a drawer. Mirrors NoteListDrawer:
// empty input → paginated browse; typing → hybrid search (same SearchInput +
// useEntitySearch as Home / the notes drawer) scoped to personal documents,
// rendered as DocRows with the match snippet. Clicking a row (browse OR
// search hit) opens DocReaderBody inside this drawer with a "Back to list"
// affordance, so list state survives the round trip.

import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Drawer } from '../primitives';
import { Icons } from '../Icons';
import { DocRow } from '../DocRow';
import { SearchInput, type SigilKind } from '../SearchInput';
import { NoteSortDropdown } from '../SortDropdown';
import { DocReaderBody } from './DocReaderDrawer';
import { listContent, getContent } from '../../lib/api';
import { toUiDocument } from '../../lib/view';
import { useEntitySearch } from '../../lib/useEntitySearch';
import { useTagSuggestions } from '../../lib/useTagSuggestions';
import { useInView } from '../../lib/useInView';
import { useNoteSortMode, compareNotesForMode } from '../../lib/useNoteSortMode';
import { matchesTagFilter, type TagFilter } from '../../lib/tagFilter';
import type { ActionDispatch, DocumentItem, Route } from '../../types';

interface Props {
  onClose: () => void;
  onAction: ActionDispatch;
  onRoute?: (r: Route) => void;
  /** When set, only documents matching this tag filter are shown (browse). */
  initialTagFilter?: TagFilter;
}

const PAGE_SIZE = 20;
const DOC_SIGILS: readonly SigilKind[] = ['tag'];
const NO_MENTIONS: never[] = [];

export function DocListDrawer({ onClose, onAction: _onAction, onRoute, initialTagFilter }: Props) {
  const { mode: sortMode, setMode: setSortMode } = useNoteSortMode('docs:inbox');
  const [selected, setSelected] = useState<DocumentItem | null>(null);

  const { query, setQuery, searchActive, hits, isFetching: searchFetching, error: searchError } =
    useEntitySearch({ projectId: 'null', entityTypes: ['document'] });
  const tagSuggestions = useTagSuggestions({ scope: 'personal', type: 'document' });

  // Dedupe chunk-level hits to one row per document, preserving rank.
  const docHits = useMemo(() => {
    const seen = new Set<string>();
    const out: typeof hits = [];
    for (const h of hits) {
      if (h.entity_kind !== 'document' || seen.has(h.entity_id)) continue;
      seen.add(h.entity_id);
      out.push(h);
    }
    return out;
  }, [hits]);

  // Open a hit in the same in-drawer reader as a browse row (fetch the
  // full record — hits carry only the chunk).
  const openHit = async (entityId: string) => {
    try {
      const c = await getContent(entityId);
      if (c.type === 'document') setSelected(toUiDocument(c));
    } catch (err) {
      console.error('Failed to open document hit', entityId, err);
    }
  };

  const pages = useInfiniteQuery({
    queryKey: ['content', 'documents', 'personal', 'infinite'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listContent({
        type: 'document',
        project_id: 'null',
        limit: PAGE_SIZE,
        ...(pageParam ? { before: pageParam } : {}),
      }),
    getNextPageParam: (lastPage) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      return lastPage[lastPage.length - 1].created_at;
    },
  });

  const docs = useMemo(() => {
    const flat = (pages.data?.pages ?? []).flat();
    const filtered =
      initialTagFilter && initialTagFilter.tags.length > 0
        ? flat.filter((d) => matchesTagFilter(d, initialTagFilter))
        : flat;
    return filtered.slice().sort(compareNotesForMode(sortMode)).map(toUiDocument);
  }, [pages.data, sortMode, initialTagFilter]);

  const { ref: sentinelRef, inView } = useInView<HTMLDivElement>();
  useEffect(() => {
    if (inView && pages.hasNextPage && !pages.isFetchingNextPage) {
      pages.fetchNextPage();
    }
  }, [inView, pages.hasNextPage, pages.isFetchingNextPage, pages.fetchNextPage]);

  // Detail view: drawer title swaps to the doc title, DocReaderBody renders
  // with onBack = return-to-list. The list state stays mounted so scroll
  // position + sort survive.
  if (selected) {
    return (
      <Drawer title={selected.title} onClose={onClose}>
        <DocReaderBody
          doc={selected}
          onClose={onClose}
          onBack={() => setSelected(null)}
          onRoute={onRoute}
        />
      </Drawer>
    );
  }

  const title = searchActive
    ? `Documents · ${docHits.length} found`
    : `Personal documents · ${docs.length}${pages.hasNextPage ? '+' : ''}`;

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
            sigils={DOC_SIGILS}
            placeholder="Search documents… try #tag"
          />
        </div>
        <NoteSortDropdown id="inbox-docs-sort" mode={sortMode} onChange={setSortMode} />
      </div>

      {searchActive ? (
        searchError ? (
          <div className="page-subtle search-drawer-error">
            Search failed: {searchError instanceof Error ? searchError.message : String(searchError)}
          </div>
        ) : searchFetching && docHits.length === 0 ? (
          <div className="page-subtle">Searching…</div>
        ) : docHits.length === 0 ? (
          <div className="page-subtle">No documents match.</div>
        ) : (
          <div className="todo-list-drawer-rows">
            {docHits.map((h) => (
              <DocRow
                key={h.entity_id}
                doc={{ title: h.title }}
                sub={h.excerpt}
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
      ) : docs.length === 0 && !pages.hasNextPage ? (
        <div className="page-subtle">
          {initialTagFilter && initialTagFilter.tags.length > 0
            ? `No personal documents with ${initialTagFilter.tags.length === 1 ? 'tag' : 'tags'} ${initialTagFilter.tags.map((t) => `#${t}`).join(initialTagFilter.mode === 'and' ? ' AND ' : ' or ')}.`
            : 'No personal documents yet.'}
        </div>
      ) : (
        <div className="todo-list-drawer-rows">
          {docs.length === 0 && initialTagFilter && initialTagFilter.tags.length > 0 ? (
            <div className="page-subtle">Searching older entries for matches…</div>
          ) : (
            docs.map((d) => (
              <DocRow
                key={d.id}
                doc={d}
                onClick={() => setSelected(d)}
              />
            ))
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
