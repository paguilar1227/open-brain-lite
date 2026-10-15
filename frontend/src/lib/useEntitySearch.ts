// Shared hybrid-search hook for scoped search surfaces (list drawers,
// project tabs). Wraps the SAME building blocks the Home search uses —
// `parseSearchSyntax` for the #tag / in: / @ / project: DSL, the
// `search()` endpoint for lexical+vector+graph fusion, and
// `toUiSearchHit` for rendering — so every search bar that adopts it
// behaves identically to Home, just scoped to its surface.
//
// The host owns the query string via the returned setQuery (drives a
// SearchInput); the hook owns debounce → parse → request → hits. Empty
// / signal-less input leaves `searchActive` false so the host can fall
// back to its browse list.

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { search } from './api';
import { useDebounced } from './useDebounced';
import { parseSearchSyntax } from './searchSyntax';
import { toUiSearchHit } from './view';

// Derive the wire types from the functions we call so this hook never
// drifts from the shared schema / view layer.
type SearchRequest = Parameters<typeof search>[0];
type EntityKind = NonNullable<SearchRequest['entity_types']>[number];
export type ProjectsById = Parameters<typeof toUiSearchHit>[1];
type UiHit = ReturnType<typeof toUiSearchHit>;

// Stable default for surfaces (e.g. personal-notes drawer) where every
// hit is project-less → 'Inbox' and no lookup is needed.
const NO_PROJECTS: ProjectsById = new Map();

interface Options {
  /** Fixed scope. `'null'` = personal (no project); a UUID = that project;
   *  omitted = global (all projects + personal). */
  projectId?: 'null' | string;
  /** Restrict results to these entity kinds, e.g. `['note']`. */
  entityTypes?: EntityKind[];
  /** Project lookup for hit → UI mapping (project names / Inbox). Omit
   *  for personal-only surfaces where every hit is project-less. */
  projectsById?: ProjectsById;
  initialQuery?: string;
  debounceMs?: number;
  limit?: number;
}

type RawHits = Awaited<ReturnType<typeof search>>;

export interface EntitySearch {
  query: string;
  setQuery: (next: string) => void;
  parsed: ReturnType<typeof parseSearchSyntax>;
  /** Mode switch: any free text OR predicate flips this on. */
  searchActive: boolean;
  /** UI-mapped hits (title/excerpt/score) for snippet-style rows. */
  hits: UiHit[];
  /** Raw API hits — needed when a surface renders a full entity row
   *  (e.g. todos carry the whole todo in the hit). */
  rawHits: RawHits;
  isFetching: boolean;
  error: unknown;
}

export function useEntitySearch({
  projectId,
  entityTypes,
  projectsById = NO_PROJECTS,
  initialQuery = '',
  debounceMs = 180,
  limit = 30,
}: Options): EntitySearch {
  const [query, setQuery] = useState(initialQuery);
  const debouncedQuery = useDebounced(query, debounceMs);
  const parsed = useMemo(() => parseSearchSyntax(debouncedQuery), [debouncedQuery]);

  const searchActive =
    parsed.text.trim().length > 0 ||
    parsed.tags.length > 0 ||
    parsed.types.length > 0 ||
    parsed.mentions.length > 0 ||
    parsed.projects.length > 0 ||
    parsed.excludedTags.length > 0 ||
    parsed.excludedTypes.length > 0;

  const req = useMemo<SearchRequest | null>(() => {
    if (!searchActive) return null;
    // Predicate-only inputs (e.g. just `#chore`) parse to text === '' —
    // send empty so the backend takes the filter-only path instead of
    // embedding garbage (mirrors HomePage).
    return {
      query: parsed.text,
      ...(projectId !== undefined ? { project_id: projectId } : {}),
      ...(entityTypes && entityTypes.length ? { entity_types: entityTypes } : {}),
      ...(parsed.tags.length ? { tags: parsed.tags } : {}),
      ...(parsed.excludedTags.length ? { excluded_tags: parsed.excludedTags } : {}),
      ...(parsed.excludedTypes.length ? { excluded_entity_types: parsed.excludedTypes } : {}),
      limit,
    };
  }, [searchActive, parsed, projectId, entityTypes, limit]);

  const { data, isFetching, error } = useQuery({
    queryKey: ['entity-search', req ? JSON.stringify(req) : 'idle'],
    queryFn: () => search(req as SearchRequest),
    enabled: req !== null,
  });

  const rawHits = data ?? [];
  const hits = useMemo(
    () => rawHits.map((h) => toUiSearchHit(h, projectsById)),
    [rawHits, projectsById],
  );

  return { query, setQuery, parsed, searchActive, hits, rawHits, isFetching, error };
}
