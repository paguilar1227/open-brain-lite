// @vitest-environment node
// Pure logic — no DOM. Runs in node so it doesn't require jsdom (the repo's
// default vitest env), keeping this test runnable on its own.
//
// Folders are now a FIRST-CLASS field on a note (`folder: string | null`),
// not an overloaded slash-tag. The key consequence — and the regression this
// suite pins — is that a SINGLE-SEGMENT path (e.g. "travel") is a real
// top-level folder, so removing the leaf of "travel/japan" leaves the note
// filed under "travel" instead of vanishing.
import { describe, it, expect } from 'vitest';
import {
  normalizeFolderPath, buildFolderTree, noteInFolder, ancestorsOf,
} from './folders';

describe('ancestorsOf', () => {
  it('returns every inclusive ancestor path', () => {
    expect(ancestorsOf('a/b/c')).toEqual(['a', 'a/b', 'a/b/c']);
    expect(ancestorsOf('media')).toEqual(['media']);
  });
});

describe('normalizeFolderPath', () => {
  it('trims segments and drops blank/edge separators', () => {
    expect(normalizeFolderPath(' cooking / italian / ')).toBe('cooking/italian');
    expect(normalizeFolderPath('//a//b//')).toBe('a/b');
    expect(normalizeFolderPath('   ')).toBe('');
    expect(normalizeFolderPath('travel')).toBe('travel'); // single segment is valid
  });
});

describe('buildFolderTree', () => {
  it('treats a single-segment folder as a real top-level node (the regression)', () => {
    const roots = buildFolderTree([{ folder: 'travel' }]);
    expect(roots.map((r) => r.name)).toEqual(['travel']);
    expect(roots[0]!.path).toBe('travel');
    expect(roots[0]!.noteCount).toBe(1);
    expect(roots[0]!.children).toEqual([]);
  });

  it('lets a top-level folder hold a note AND have subfolders', () => {
    // This is exactly the post-edit shape of the bug: one note moved up to
    // "travel" while its old siblings keep travel/hiking + travel/portugal.
    const roots = buildFolderTree([
      { folder: 'travel' },
      { folder: 'travel/hiking' },
      { folder: 'travel/portugal' },
    ]);
    expect(roots.map((r) => r.name)).toEqual(['travel']);
    const travel = roots[0]!;
    expect(travel.noteCount).toBe(3); // the moved-up note + 2 descendants
    expect(travel.children.map((c) => c.name).sort()).toEqual(['hiking', 'portugal']);
  });

  it('builds a nested tree from folder strings', () => {
    const roots = buildFolderTree([
      { folder: 'cooking/italian/dessert' },
      { folder: 'cooking/coffee' },
      { folder: 'cooking/italian' },
      { folder: null }, // no folder → not in the tree
    ]);
    expect(roots.map((r) => r.name)).toEqual(['cooking']);
    const cooking = roots[0]!;
    expect(cooking.children.map((c) => c.name).sort()).toEqual(['coffee', 'italian']);
    const italian = cooking.children.find((c) => c.name === 'italian')!;
    expect(italian.children.map((c) => c.name)).toEqual(['dessert']);
  });

  it('counts a note at every ancestor exactly once', () => {
    const roots = buildFolderTree([
      { folder: 'cooking/italian/dessert' },
      { folder: 'cooking/coffee' },
      { folder: 'cooking/italian' },
    ]);
    const cooking = roots[0]!;
    expect(cooking.noteCount).toBe(3); // 3 distinct notes touch cooking/*
    const italian = cooking.children.find((c) => c.name === 'italian')!;
    expect(italian.noteCount).toBe(2); // italian + italian/dessert
    expect(cooking.children.find((c) => c.name === 'coffee')!.noteCount).toBe(1);
  });

  it('normalizes folder strings while building (stray separators/whitespace)', () => {
    const roots = buildFolderTree([{ folder: ' travel / japan ' }]);
    expect(roots[0]!.path).toBe('travel');
    expect(roots[0]!.children[0]!.path).toBe('travel/japan');
  });
});

describe('noteInFolder', () => {
  it('matches exact path and descendants, not siblings/prefixes', () => {
    expect(noteInFolder('cooking/italian', 'cooking/italian')).toBe(true);        // exact
    expect(noteInFolder('cooking/italian/dessert', 'cooking/italian')).toBe(true); // descendant
    expect(noteInFolder('cooking/italian', 'cooking')).toBe(true);                // ancestor selects descendant
    expect(noteInFolder('cooking/italian-extra', 'cooking/italian')).toBe(false); // prefix, not a path boundary
    expect(noteInFolder('travel/japan', 'cooking')).toBe(false);                  // unrelated
    expect(noteInFolder(null, 'cooking')).toBe(false);                            // no folder
  });

  it('matches a single-segment folder against itself and its parent selection', () => {
    expect(noteInFolder('travel', 'travel')).toBe(true);       // exact single-segment
    expect(noteInFolder('travel/japan', 'travel')).toBe(true); // descendant of single-segment
  });
});
