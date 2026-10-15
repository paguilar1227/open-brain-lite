// Per-surface persistent todo sort mode. Each surface (Home column,
// Inbox drawer, Project X todos panel) keeps its own choice — Pablo's
// "Home option is distinct from Project X option" requirement.
//
// Surface keys are caller-supplied so they can include scoping like
// `project:<id>`. localStorage stores them under
// `obv2.todoSort.<surfaceKey>`. Unknown / corrupt entries fall back to
// the default mode without throwing.

import { useCallback, useEffect, useState } from 'react';
import { TODO_SORT_MODES, type TodoSortMode } from './todoSort';

const STORAGE_PREFIX = 'obv2.todoSort.';
const DEFAULT_MODE: TodoSortMode = 'smart';

function readInitial(surfaceKey: string): TodoSortMode {
  if (typeof window === 'undefined') return DEFAULT_MODE;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + surfaceKey);
    if (raw && (TODO_SORT_MODES as string[]).includes(raw)) return raw as TodoSortMode;
    return DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

export function useTodoSortMode(surfaceKey: string): {
  mode: TodoSortMode;
  setMode: (m: TodoSortMode) => void;
} {
  const [mode, setModeState] = useState<TodoSortMode>(() => readInitial(surfaceKey));

  // Re-read when the surface key changes (e.g. user navigates from
  // Project A to Project B). Without this the dropdown would stick on
  // Project A's last choice when re-mounting against Project B's key.
  useEffect(() => {
    setModeState(readInitial(surfaceKey));
  }, [surfaceKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_PREFIX + surfaceKey, mode);
    } catch {
      // Quota / private mode — fall through; in-memory state still works.
    }
  }, [surfaceKey, mode]);

  const setMode = useCallback((m: TodoSortMode) => setModeState(m), []);
  return { mode, setMode };
}
