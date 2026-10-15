// Tag inventory shaped for SearchInput's `#` typeahead. Shared by every
// search surface (home, drawers, project tabs) so the suggestion source
// is identical everywhere.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listTags } from './api';
import type { TagSuggestion } from '../components/SearchInput';

type TagType = 'note' | 'document' | 'todo';

export function useTagSuggestions(
  opts: { project_id?: string; scope?: 'personal' | 'all'; type?: TagType } = {},
): TagSuggestion[] {
  const { project_id, scope, type } = opts;
  const { data } = useQuery({
    queryKey: ['tags', project_id ?? null, scope ?? null],
    queryFn: () => listTags({ project_id, scope }),
  });
  // Scope the suggestion AND its count to the surface. A personal-notes drawer
  // wants tags that actually live on personal NOTES (by_type.note within the
  // personal scope), not the global total — otherwise the typeahead promises
  // matches the scoped search can't deliver (e.g. #rag shows 10 but personal
  // notes have 0). listTags' by_type is scope-aware (filtered by project_id /
  // scope server-side), so by_type[type] is the exact count the search returns.
  return useMemo(
    () =>
      (data ?? [])
        .map((t) => ({ name: t.name, total: type ? t.by_type[type] : t.total }))
        .filter((t) => t.total > 0),
    [data, type],
  );
}
