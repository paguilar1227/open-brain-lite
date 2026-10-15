export type TagFilterMode = 'or' | 'and';

export interface TagFilter {
  tags: string[];
  mode: TagFilterMode;
}

export const EMPTY_FILTER: TagFilter = { tags: [], mode: 'or' };

export function parseTagFilter(search: URLSearchParams): TagFilter {
  const raw = search.get('tag') ?? '';
  const tags = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (tags.length === 0) return EMPTY_FILTER;

  const rawMode = search.get('mode');
  const mode: TagFilterMode = rawMode === 'and' ? 'and' : 'or';
  return { tags, mode };
}

export function serializeTagFilter(f: TagFilter): URLSearchParams {
  const out = new URLSearchParams();
  if (f.tags.length === 0) return out;
  out.set('tag', f.tags.join(','));
  if (f.mode === 'and') out.set('mode', 'and');
  return out;
}

export function matchesTagFilter(
  item: { tags?: string[] | null | undefined },
  f: TagFilter,
): boolean {
  if (f.tags.length === 0) return true;
  const itemTags = item.tags;
  if (!itemTags || itemTags.length === 0) return false;
  const set = new Set(itemTags);
  return f.mode === 'and'
    ? f.tags.every((t) => set.has(t))
    : f.tags.some((t) => set.has(t));
}

export function toggleTag(f: TagFilter, name: string): TagFilter {
  const present = f.tags.includes(name);
  const next = present ? f.tags.filter((t) => t !== name) : [...f.tags, name];
  // AND→OR snap when count drops below 2: AND on a single tag is meaningless.
  // The snap is forgetful — re-adding a 2nd tag does not restore AND.
  const mode: TagFilterMode = f.mode === 'and' && next.length < 2 ? 'or' : f.mode;
  return { tags: next, mode };
}
