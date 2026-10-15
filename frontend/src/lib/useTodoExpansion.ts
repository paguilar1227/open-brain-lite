// Tracks which subtask trees the user has expanded. Default is
// collapsed for every parent — first paint of the personal-todos
// widget stays compact, the user opts in per-parent. State sticks
// across reloads via localStorage.

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'obv2.todos.expanded';

function readInitial(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? new Set(arr.filter((x): x is string => typeof x === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

export function useTodoExpansion(): {
  isExpanded: (id: string) => boolean;
  toggle: (id: string) => void;
} {
  const [expanded, setExpanded] = useState<Set<string>>(readInitial);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...expanded]));
    } catch {
      // Quota / private mode — fall through; in-memory state still works.
    }
  }, [expanded]);

  const isExpanded = useCallback((id: string) => expanded.has(id), [expanded]);
  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return { isExpanded, toggle };
}
