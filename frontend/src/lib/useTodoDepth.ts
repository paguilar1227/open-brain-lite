// Walk the parent chain via React Query–cached getTodo calls and
// return the depth of `todo` (root = 0). Used by TodoDetailDrawer to
// gate the "Add subtask" affordance: at MAX_TODO_DEPTH the input is
// hidden and the user gets a clear notice instead of a backend
// rejection.
//
// The chain is bounded — we stop at MAX_TODO_DEPTH + 2 hops which
// is enough to know whether the cap is reached. Each ancestor lookup
// uses the same ['todo', id] key the drawer's parentQ uses, so most
// hits land in cache.

import { useQuery } from '@tanstack/react-query';
import { MAX_TODO_DEPTH } from '@open-brain/shared';
import { getTodo } from './api';
import type { Todo } from '../types';

const PROBE_LIMIT = MAX_TODO_DEPTH + 2;

export function useTodoDepth(todo: Todo): { depth: number; isLoading: boolean } {
  const q = useQuery({
    queryKey: ['todo-depth', todo.id, todo.parent_id],
    queryFn: async () => {
      let d = 0;
      let parentId = todo.parent_id;
      while (parentId && d < PROBE_LIMIT) {
        d++;
        const parent = await getTodo(parentId);
        parentId = parent?.parent_id ?? null;
      }
      return d;
    },
    staleTime: 30_000,
  });
  return { depth: q.data ?? 0, isLoading: q.isLoading };
}
