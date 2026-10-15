// Per-surface note sort mode. Mirrors useTodoSortMode but with
// note-appropriate modes — notes have a title, todos don't, so the
// vocabulary differs.
//
// Surface keys are caller-supplied so they can scope per-project
// ('notes:project:<id>') vs personal ('notes:inbox'). localStorage
// stores them under `obv2.noteSort.<surfaceKey>`.

import { useCallback, useEffect, useState } from 'react';
import type { ContentItem } from '@open-brain/shared';

export type NoteSortMode = 'recent' | 'oldest' | 'title_az' | 'title_za';

export const NOTE_SORT_MODES: NoteSortMode[] = ['recent', 'oldest', 'title_az', 'title_za'];

export const NOTE_SORT_LABELS: Record<NoteSortMode, string> = {
  recent: 'Recent',
  oldest: 'Oldest',
  title_az: 'Title A–Z',
  title_za: 'Title Z–A',
};

const STORAGE_PREFIX = 'obv2.noteSort.';
const DEFAULT_MODE: NoteSortMode = 'recent';

function readInitial(surfaceKey: string): NoteSortMode {
  if (typeof window === 'undefined') return DEFAULT_MODE;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + surfaceKey);
    if (raw && (NOTE_SORT_MODES as string[]).includes(raw)) return raw as NoteSortMode;
    return DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

export function useNoteSortMode(surfaceKey: string): {
  mode: NoteSortMode;
  setMode: (m: NoteSortMode) => void;
} {
  const [mode, setModeState] = useState<NoteSortMode>(() => readInitial(surfaceKey));

  useEffect(() => {
    setModeState(readInitial(surfaceKey));
  }, [surfaceKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_PREFIX + surfaceKey, mode);
    } catch {
      // Quota / private mode — in-memory state still works.
    }
  }, [surfaceKey, mode]);

  const setMode = useCallback((m: NoteSortMode) => setModeState(m), []);
  return { mode, setMode };
}

/** Comparator for the chosen note sort mode. Backend always returns
 *  rows ordered by `created_at DESC` (= 'recent'); the other modes are
 *  client-side because the dataset that lands per page is small enough
 *  that re-sorting in JS is cheap and avoids a roundtrip per mode. */
export function compareNotesForMode(mode: NoteSortMode): (a: ContentItem, b: ContentItem) => number {
  switch (mode) {
    case 'recent':
      return (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    case 'oldest':
      return (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    case 'title_az':
      return (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    case 'title_za':
      return (a, b) => b.title.localeCompare(a.title, undefined, { sensitivity: 'base' });
  }
}
