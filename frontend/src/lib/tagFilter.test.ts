import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER, matchesTagFilter, parseTagFilter, serializeTagFilter, toggleTag } from './tagFilter';

describe('parseTagFilter — high-value edge cases', () => {
  it('mode=and with no tag → EMPTY (mode without tags is meaningless)', () => {
    const f = parseTagFilter(new URLSearchParams('mode=and'));
    expect(f).toEqual(EMPTY_FILTER);
  });

  it('tag= (empty value) → EMPTY (no empty-string tags)', () => {
    const f = parseTagFilter(new URLSearchParams('tag='));
    expect(f).toEqual(EMPTY_FILTER);
  });

  it('tag=foo,,bar (double comma) → drops empty segments', () => {
    const f = parseTagFilter(new URLSearchParams('tag=foo,,bar'));
    expect(f.tags).toEqual(['foo', 'bar']);
  });

  it('mode=garbage&tag=foo → mode falls back to OR', () => {
    const f = parseTagFilter(new URLSearchParams('mode=garbage&tag=foo'));
    expect(f.mode).toBe('or');
    expect(f.tags).toEqual(['foo']);
  });
});

describe('matchesTagFilter — defensive cases', () => {
  it('item.tags undefined → false against any non-empty filter', () => {
    const f = { tags: ['foo'], mode: 'or' as const };
    expect(matchesTagFilter({ tags: undefined }, f)).toBe(false);
  });

  it('item.tags null → false against any non-empty filter', () => {
    const f = { tags: ['foo'], mode: 'or' as const };
    expect(matchesTagFilter({ tags: null }, f)).toBe(false);
  });
});

describe('serializeTagFilter — URL key contract (H1.7 guard)', () => {
  it('uses the key "tag" (singular), not "tags" — guards against typo regression', () => {
    const out = serializeTagFilter({ tags: ['foo'], mode: 'or' });
    expect(out.has('tag')).toBe(true);
    expect(out.has('tags')).toBe(false);
  });
});

describe('toggleTag — AND→OR snap (D3 invariant)', () => {
  it('removing one of two tags while AND → mode snaps to OR', () => {
    const after = toggleTag({ tags: ['a', 'b'], mode: 'and' }, 'b');
    expect(after).toEqual({ tags: ['a'], mode: 'or' });
  });

  it('A → B → AND → -B → +B lands in OR (snap is forgetful)', () => {
    let f = EMPTY_FILTER;
    f = toggleTag(f, 'a');
    f = toggleTag(f, 'b');
    f = { ...f, mode: 'and' };
    f = toggleTag(f, 'b');
    f = toggleTag(f, 'b');
    expect(f.mode).toBe('or');
    expect(f.tags).toEqual(['a', 'b']);
  });
});
