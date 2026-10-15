// @vitest-environment node
// Parser is pure — no DOM needed. Overriding to skip jsdom (not currently
// installed; the global vitest.config defaults to jsdom for component tests).

import { describe, expect, it } from 'vitest';
import {
  parseSearchSyntax,
  stringifySearchSyntax,
  toggleTagInQuery,
  removeTagFromQuery,
  removeTypeFromQuery,
  removeMentionFromQuery,
  removeProjectFromQuery,
  removeExcludedFromQuery,
  tokenAtCursor,
  replaceTokenAtCursor,
} from './searchSyntax';
import type { ParsedQuery } from './searchSyntax';

// Test helper: build a ParsedQuery from partial overrides so assertions
// don't have to spell out every field every time. The default value
// for each field matches the parser's EMPTY constant.
function parsed(overrides: Partial<ParsedQuery>): ParsedQuery {
  return {
    text: '',
    tags: [],
    types: [],
    mentions: [],
    projects: [],
    excludedTags: [],
    excludedTypes: [],
    excludedMentions: [],
    excludedProjects: [],
    ...overrides,
  };
}

describe('parseSearchSyntax — basics', () => {
  it('empty / whitespace → EMPTY', () => {
    expect(parseSearchSyntax('')).toEqual(parsed({}));
    expect(parseSearchSyntax('   ')).toEqual(parsed({}));
  });

  it('plain text is preserved as .text', () => {
    expect(parseSearchSyntax('quarterly report')).toEqual(parsed({ text: 'quarterly report' }));
  });

  it('tag tokens move to .tags (lowercased)', () => {
    const p = parseSearchSyntax('#Home #READING');
    expect(p.tags).toEqual(['home', 'reading']);
    expect(p.text).toBe('');
  });

  it('duplicate tags are deduped, insertion order kept', () => {
    expect(parseSearchSyntax('#a #b #a #c').tags).toEqual(['a', 'b', 'c']);
  });

  it('in:<alias> resolves to canonical EntityKind', () => {
    expect(parseSearchSyntax('in:todo').types).toEqual(['todo']);
    expect(parseSearchSyntax('in:notes').types).toEqual(['note']);
    expect(parseSearchSyntax('in:doc in:document in:docs').types).toEqual(['document']);
  });

  it('mixed tokens — tags + types + text preserve as expected', () => {
    const p = parseSearchSyntax('quarterly #home in:doc report #q1');
    expect(p.tags).toEqual(['home', 'q1']);
    expect(p.types).toEqual(['document']);
    expect(p.text).toBe('quarterly report');
  });

  it('unknown in:<value> falls through to free text (user might be mid-typing)', () => {
    const p = parseSearchSyntax('in:wibble find me');
    expect(p.types).toEqual([]);
    expect(p.text).toBe('in:wibble find me');
  });

  it('whitespace is normalized — multiple spaces between tokens collapse', () => {
    expect(parseSearchSyntax('foo   #x    bar')).toEqual(
      parsed({ text: 'foo bar', tags: ['x'] }),
    );
  });

  it('tag with hyphen is valid; trailing punctuation invalidates it', () => {
    expect(parseSearchSyntax('#open-brain').tags).toEqual(['open-brain']);
    expect(parseSearchSyntax('#nope,').text).toBe('#nope,');
  });
});

describe('parseSearchSyntax — mentions (@name)', () => {
  it('bare @name moves to .mentions, case preserved', () => {
    const p = parseSearchSyntax('@Books');
    expect(p.mentions).toEqual(['Books']);
    expect(p.text).toBe('');
  });

  it('quoted @"multi word" allows whitespace in the name', () => {
    const p = parseSearchSyntax('@"Gift ideas — dad birthday"');
    expect(p.mentions).toEqual(['Gift ideas — dad birthday']);
    expect(p.text).toBe('');
  });

  it('mentions dedupe case-insensitively but preserve first-seen casing', () => {
    expect(parseSearchSyntax('@Books @books @BOOKS').mentions).toEqual(['Books']);
  });

  it('unterminated quoted mention (mid-typing) is captured, not dropped', () => {
    const p = parseSearchSyntax('@"q1 rep');
    expect(p.mentions).toEqual(['q1 rep']);
    expect(p.text).toBe('');
  });

  it('@ alone or @"" falls through to text', () => {
    expect(parseSearchSyntax('@').text).toBe('@');
    expect(parseSearchSyntax('@""').text).toBe('@""');
  });

  it('email-style `foo@bar` is NOT a mention (the @ is mid-token)', () => {
    const p = parseSearchSyntax('email@gmail.com');
    expect(p.mentions).toEqual([]);
    expect(p.text).toBe('email@gmail.com');
  });
});

describe('parseSearchSyntax — projects (project:name)', () => {
  it('bare project:name moves to .projects, case preserved', () => {
    const p = parseSearchSyntax('project:openbrain');
    expect(p.projects).toEqual(['openbrain']);
    expect(p.text).toBe('');
  });

  it('quoted project:"multi word" allows whitespace', () => {
    const p = parseSearchSyntax('project:"Open Brain v2"');
    expect(p.projects).toEqual(['Open Brain v2']);
    expect(p.text).toBe('');
  });

  it('mid-typing unterminated project:"foo is captured for typeahead', () => {
    expect(parseSearchSyntax('project:"Open Bra').projects).toEqual(['Open Bra']);
  });

  it('dedupes case-insensitively', () => {
    expect(parseSearchSyntax('project:foo project:FOO').projects).toEqual(['foo']);
  });
});

describe('parseSearchSyntax — exclusion (-prefix on any sigil)', () => {
  it('-#tag routes to excludedTags', () => {
    const p = parseSearchSyntax('-#archive');
    expect(p.excludedTags).toEqual(['archive']);
    expect(p.tags).toEqual([]);
  });

  it('-in:type routes to excludedTypes', () => {
    expect(parseSearchSyntax('-in:doc').excludedTypes).toEqual(['document']);
  });

  it('-@name routes to excludedMentions', () => {
    const p = parseSearchSyntax('-@Drafts');
    expect(p.excludedMentions).toEqual(['Drafts']);
  });

  it('-project:name routes to excludedProjects', () => {
    expect(parseSearchSyntax('-project:openbrain').excludedProjects).toEqual(['openbrain']);
  });

  it('-@"multi word" exclusion handles quotes', () => {
    expect(parseSearchSyntax('-@"old notes"').excludedMentions).toEqual(['old notes']);
  });

  it('mixed positive + negative predicates parse independently', () => {
    const p = parseSearchSyntax('#home -#archive in:todo -in:note @Books -@Drafts');
    expect(p.tags).toEqual(['home']);
    expect(p.excludedTags).toEqual(['archive']);
    expect(p.types).toEqual(['todo']);
    expect(p.excludedTypes).toEqual(['note']);
    expect(p.mentions).toEqual(['Books']);
    expect(p.excludedMentions).toEqual(['Drafts']);
  });

  it('lone "-" is text, not a negation', () => {
    expect(parseSearchSyntax('-').text).toBe('-');
  });
});

describe('stringifySearchSyntax — round-trip + ordering', () => {
  it('positives first, negatives next, free text last', () => {
    const s = stringifySearchSyntax(parsed({
      text: 'find me',
      tags: ['x'],
      excludedTags: ['archive'],
      types: ['todo'],
    }));
    expect(s).toBe('#x in:todo -#archive find me');
  });

  it('quoting applied when name has whitespace', () => {
    expect(
      stringifySearchSyntax(parsed({ mentions: ['Q1 report'] })),
    ).toBe('@"Q1 report"');
    expect(
      stringifySearchSyntax(parsed({ projects: ['Open Brain v2'] })),
    ).toBe('project:"Open Brain v2"');
  });

  it('round-trip stable for the full predicate set', () => {
    const input = '#home in:todo @"Q1 report" project:openbrain -#archive -in:document -@Drafts -project:"old proj" find me';
    const reparsed = parseSearchSyntax(stringifySearchSyntax(parseSearchSyntax(input)));
    expect(reparsed).toEqual(parseSearchSyntax(input));
  });
});

describe('toggle / remove helpers', () => {
  it('toggleTagInQuery adds, then removes', () => {
    expect(toggleTagInQuery('find me', 'home')).toBe('#home find me');
    expect(toggleTagInQuery('#home #reading find me', 'home')).toBe('#reading find me');
  });

  it('removeTagFromQuery / removeTypeFromQuery work and preserve the rest', () => {
    expect(removeTagFromQuery('#a #b q', 'a')).toBe('#b q');
    expect(removeTypeFromQuery('#a in:todo q', 'todo')).toBe('#a q');
  });

  it('removeMentionFromQuery is case-insensitive', () => {
    expect(removeMentionFromQuery('@Books q', 'BOOKS')).toBe('q');
  });

  it('removeProjectFromQuery is case-insensitive', () => {
    expect(removeProjectFromQuery('project:openbrain q', 'OPENBRAIN')).toBe('q');
  });

  it('removeExcludedFromQuery drops the right negative bucket entry', () => {
    expect(removeExcludedFromQuery('-#archive q', 'tag', 'archive')).toBe('q');
    expect(removeExcludedFromQuery('-in:note q', 'type', 'note')).toBe('q');
    expect(removeExcludedFromQuery('-@Drafts q', 'mention', 'drafts')).toBe('q');
    expect(removeExcludedFromQuery('-project:foo q', 'project', 'FOO')).toBe('q');
  });
});

describe('tokenAtCursor — cursor-aware sigil detection', () => {
  it('empty when cursor at position 0', () => {
    expect(tokenAtCursor('foo', 0)).toBe('');
  });

  it('returns the partial token between last whitespace and cursor', () => {
    expect(tokenAtCursor('hello #ho', 9)).toBe('#ho');
    expect(tokenAtCursor('in:to', 5)).toBe('in:to');
  });

  it('captures the full @"partial inside a quoted mention', () => {
    expect(tokenAtCursor('foo @"Q1 re', 11)).toBe('@"Q1 re');
  });

  it('captures the full project:"partial inside a quoted project', () => {
    expect(tokenAtCursor('foo project:"Open Bra', 21)).toBe('project:"Open Bra');
  });

  it('captures negated quoted partials too', () => {
    expect(tokenAtCursor('-@"old', 6)).toBe('-@"old');
    expect(tokenAtCursor('-project:"old', 13)).toBe('-project:"old');
  });

  it('returns empty when cursor sits right after a whitespace', () => {
    expect(tokenAtCursor('hello ', 6)).toBe('');
  });
});

describe('replaceTokenAtCursor', () => {
  it('replaces current partial + trailing space at end of input', () => {
    const r = replaceTokenAtCursor('hello #ho', 9, '#home');
    expect(r.value).toBe('hello #home ');
    expect(r.cursor).toBe(12);
  });

  it('skips trailing space when the tail already starts with one', () => {
    const r = replaceTokenAtCursor('foo @Bo bar', 7, '@"Books — wishlist"');
    expect(r.value).toBe('foo @"Books — wishlist" bar');
    expect(r.cursor).toBe(4 + '@"Books — wishlist"'.length);
  });
});
