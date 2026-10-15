// "Folders" — a hierarchical organization layer over notes. A note belongs to
// exactly ONE folder, stored in its own first-class `folder` field (a path like
// "cooking/italian/dessert", or null for an unfiled note). Folders are a
// SEPARATE concept from tags: flat tags stay flat and never appear in the tree.
//
// Because the path is its own field (not an overloaded slash-tag), a
// single-segment path like "travel" is a perfectly valid top-level folder — a
// note can live directly in "travel" while "travel/japan" exists as a subfolder.
// The tree is derived client-side from whatever notes are in scope (single-user
// corpus, so no backend aggregation needed).

export const FOLDER_SEP = '/';

export interface FolderNode {
  /** Full path, e.g. "cooking/italian". */
  path: string;
  /** Last segment, e.g. "italian". */
  name: string;
  children: FolderNode[];
  /** Notes filed at this exact path OR any descendant (deduped). */
  noteCount: number;
}

/** Normalize a path: trim, collapse repeated/edge separators, drop blanks. */
export function normalizeFolderPath(raw: string): string {
  return raw
    .split(FOLDER_SEP)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(FOLDER_SEP);
}

/** All ancestor paths of a folder path, inclusive:
 *  "a/b/c" → ["a", "a/b", "a/b/c"]. */
export function ancestorsOf(path: string): string[] {
  const segs = path.split(FOLDER_SEP).filter(Boolean);
  return segs.map((_, i) => segs.slice(0, i + 1).join(FOLDER_SEP));
}

/** Build the folder tree from a set of notes. Each note's `folder` contributes
 *  all of its ancestor paths as nodes; a node's count includes notes filed at
 *  it or below. Notes with no folder are skipped. */
export function buildFolderTree(notes: { folder: string | null }[]): FolderNode[] {
  const nodes = new Map<string, FolderNode>();
  const counted = new Map<string, Set<number>>();

  const ensure = (path: string): FolderNode => {
    let n = nodes.get(path);
    if (!n) {
      const segs = path.split(FOLDER_SEP);
      n = { path, name: segs[segs.length - 1]!, children: [], noteCount: 0 };
      nodes.set(path, n);
      if (segs.length > 1) {
        ensure(segs.slice(0, -1).join(FOLDER_SEP)).children.push(n);
      }
    }
    return n;
  };

  notes.forEach((note, i) => {
    const path = note.folder ? normalizeFolderPath(note.folder) : '';
    if (!path) return;
    for (const ancestor of ancestorsOf(path)) {
      ensure(ancestor);
      let set = counted.get(ancestor);
      if (!set) { set = new Set(); counted.set(ancestor, set); }
      set.add(i);
    }
  });

  for (const [path, set] of counted) {
    const n = nodes.get(path);
    if (n) n.noteCount = set.size;
  }

  const sortRec = (arr: FolderNode[]) => {
    arr.sort((a, b) => a.name.localeCompare(b.name));
    arr.forEach((c) => sortRec(c.children));
  };
  const roots = [...nodes.values()].filter((n) => !n.path.includes(FOLDER_SEP));
  sortRec(roots);
  return roots;
}

/** Does a note (with folder `folder`) belong under `path` — exact match or any
 *  descendant? A null folder belongs to no folder. */
export function noteInFolder(folder: string | null, path: string): boolean {
  if (!folder) return false;
  return folder === path || folder.startsWith(path + FOLDER_SEP);
}
