import { useQuery } from '@tanstack/react-query';
import { listProjects } from './api';

// Single source of truth for the projects list. Every surface that needs
// to render a project name (sidebar, command palette, mobile tabbar, the
// reader drawers' project chips, etc.) used to re-write the same useQuery
// call — same key, same fn, but hand-rolled in 8 places. One hook keeps
// the cache key stable AND collapses the boilerplate.
//
// Type is inferred from listProjects() — the API/wire shape from
// @open-brain/shared, NOT the UI-shape `Project` in ../types. Callers
// that need the UI shape pipe the result through toUiProjects(...).
export function useProjects() {
  // Cache key matches the historical App.tsx / CommandPalette key so the
  // shared cache hits the same entry. NewProjectModal invalidates the
  // ['projects'] prefix which still cascades to this key (React Query
  // matches by key prefix on invalidation).
  return useQuery({
    queryKey: ['projects', 'all'],
    queryFn: () => listProjects(),
    staleTime: 60_000,
  });
}
