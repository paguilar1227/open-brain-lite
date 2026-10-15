// Universal search-bar DSL — parses scope predicates + free text into a
// structured payload the search API can consume, and reverses the parse
// for round-trip syncing with the home tag chip row.
//
// Grammar (whitespace-separated tokens, case-insensitive predicate keys):
//
//   #<tag>               → .tags (lowercased)
//   in:<type>            → .types (todo|note|document)
//     aliases: todo|todos|note|notes|doc|docs|document|documents
//   @<bare-word>         → .mentions (case preserved)
//   @"multi word name"   → .mentions (whitespace inside quotes)
//   project:<bare-word>  → .projects (case preserved)
//   project:"quoted"     → .projects
//   -<sigil>...          → moves the predicate to the .excluded* counterpart
//                          (e.g. -#tag → .excludedTags, -in:type → .excludedTypes)
//   anything else        → free-text .text (semantic query)
//
// Unrecognized predicates fall through to .text verbatim — the user
// might be mid-typing, and dropping their input on the floor would be
// hostile. Same applies to `@`/`project:`/`-` with no payload — kept
// as text so typeahead can still surface them.
//
// Order is preserved during parse so stringify(parse(s)) is stable up
// to whitespace normalization (single spaces, no leading/trailing).

import type { EntityKind } from '@open-brain/shared';

export interface ParsedQuery {
  /** Free-text portion — the actual semantic query passed to the API. */
  text: string;
  /** `#tag` predicates (lowercased + deduped, insertion order). */
  tags: string[];
  /** `in:<type>` predicates (deduped, insertion order). */
  types: EntityKind[];
  /** `@<name>` predicates (case-preserved, deduped case-insensitively). */
  mentions: string[];
  /** `project:<name>` predicates (case-preserved, deduped case-insensitively). */
  projects: string[];
  /** Exclusion counterparts — same payload semantics, NEGATED at query time. */
  excludedTags: string[];
  excludedTypes: EntityKind[];
  excludedMentions: string[];
  excludedProjects: string[];
}

const EMPTY: ParsedQuery = {
  text: '',
  tags: [],
  types: [],
  mentions: [],
  projects: [],
  excludedTags: [],
  excludedTypes: [],
  excludedMentions: [],
  excludedProjects: [],
};

/** Map a user-typed `in:<value>` to a canonical EntityKind. Returns null
 *  if the value isn't a recognized alias — caller falls back to free text. */
function resolveTypeAlias(value: string): EntityKind | null {
  switch (value.toLowerCase()) {
    case 'todo':
    case 'todos':
      return 'todo';
    case 'note':
    case 'notes':
      return 'note';
    case 'doc':
    case 'docs':
    case 'document':
    case 'documents':
      return 'document';
    default:
      return null;
  }
}

const TAG_TOKEN = /^#([a-z0-9][a-z0-9-]*)$/i;
const IN_TOKEN = /^in:([a-z]+)$/i;
const MENTION_BARE = /^@([^\s"]+)$/;
const MENTION_QUOTED = /^@"([^"]*)"$/;
const MENTION_UNTERMINATED = /^@"([^"]+)$/;
const PROJECT_BARE = /^project:([^\s"]+)$/i;
const PROJECT_QUOTED = /^project:"([^"]*)"$/i;
const PROJECT_UNTERMINATED = /^project:"([^"]+)$/i;

/** Token kinds the parser can produce from a single positive token.
 *  Negation is a single-character `-` prefix on the WHOLE token; we
 *  strip it, parse the rest as positive, and route the result to the
 *  matching `excluded*` bucket. */
type PositiveMatch =
  | { kind: 'tag'; value: string }
  | { kind: 'type'; value: EntityKind }
  | { kind: 'mention'; value: string }
  | { kind: 'project'; value: string }
  | null;

/** Match a single token against the positive predicate grammar. Returns
 *  null when no predicate matches (caller pushes the raw token to text). */
function matchPositive(tok: string): PositiveMatch {
  const tag = tok.match(TAG_TOKEN);
  if (tag) return { kind: 'tag', value: tag[1]!.toLowerCase() };
  const inMatch = tok.match(IN_TOKEN);
  if (inMatch) {
    const kind = resolveTypeAlias(inMatch[1]!);
    if (kind) return { kind: 'type', value: kind };
    // Unknown in:<value> — let the caller push to text.
    return null;
  }
  const quoted = tok.match(MENTION_QUOTED);
  if (quoted && quoted[1]!.trim().length > 0) {
    return { kind: 'mention', value: quoted[1]!.trim() };
  }
  const bare = tok.match(MENTION_BARE);
  if (bare) return { kind: 'mention', value: bare[1]! };
  const unterm = tok.match(MENTION_UNTERMINATED);
  if (unterm) return { kind: 'mention', value: unterm[1]! };
  const projQuoted = tok.match(PROJECT_QUOTED);
  if (projQuoted && projQuoted[1]!.trim().length > 0) {
    return { kind: 'project', value: projQuoted[1]!.trim() };
  }
  const projBare = tok.match(PROJECT_BARE);
  if (projBare) return { kind: 'project', value: projBare[1]! };
  const projUnterm = tok.match(PROJECT_UNTERMINATED);
  if (projUnterm) return { kind: 'project', value: projUnterm[1]! };
  return null;
}

/**
 * Whitespace-aware tokenizer that keeps `@"multi word"` and
 * `project:"multi word"` as single tokens. Quote tracking engages only
 * when the current accumulator ends with `@"` or `project:"` — so plain
 * unrelated quotes elsewhere don't trigger quote mode.
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (inQuote) {
      cur += ch;
      if (ch === '"') inQuote = false;
      continue;
    }
    if (ch === '"' && (cur === '@' || cur === '-@' || cur === 'project:' || cur === '-project:')) {
      cur += ch;
      inQuote = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) tokens.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur) tokens.push(cur);
  return tokens;
}

export function parseSearchSyntax(input: string): ParsedQuery {
  const trimmed = input.trim();
  if (!trimmed) return EMPTY;
  const tokens = tokenize(trimmed);
  const out: ParsedQuery = {
    text: '',
    tags: [],
    types: [],
    mentions: [],
    projects: [],
    excludedTags: [],
    excludedTypes: [],
    excludedMentions: [],
    excludedProjects: [],
  };
  const textParts: string[] = [];
  const seen = {
    mentions: new Set<string>(),
    projects: new Set<string>(),
    exMentions: new Set<string>(),
    exProjects: new Set<string>(),
  };

  for (const tok of tokens) {
    const isNegated = tok.startsWith('-') && tok.length > 1;
    const positive = matchPositive(isNegated ? tok.slice(1) : tok);
    if (!positive) {
      textParts.push(tok);
      continue;
    }
    if (positive.kind === 'tag') {
      const bucket = isNegated ? out.excludedTags : out.tags;
      if (!bucket.includes(positive.value)) bucket.push(positive.value);
      continue;
    }
    if (positive.kind === 'type') {
      const bucket = isNegated ? out.excludedTypes : out.types;
      if (!bucket.includes(positive.value)) bucket.push(positive.value);
      continue;
    }
    if (positive.kind === 'mention') {
      const seenSet = isNegated ? seen.exMentions : seen.mentions;
      const bucket = isNegated ? out.excludedMentions : out.mentions;
      const key = positive.value.toLowerCase();
      if (!seenSet.has(key)) {
        seenSet.add(key);
        bucket.push(positive.value);
      }
      continue;
    }
    // project
    const seenSet = isNegated ? seen.exProjects : seen.projects;
    const bucket = isNegated ? out.excludedProjects : out.projects;
    const key = positive.value.toLowerCase();
    if (!seenSet.has(key)) {
      seenSet.add(key);
      bucket.push(positive.value);
    }
  }
  out.text = textParts.join(' ');
  return out;
}

/** Quote a mention/project name if it needs it (whitespace or quotes). */
function quoteIfNeeded(name: string): string {
  return /\s|"/.test(name) ? `"${name.replace(/"/g, '\\"')}"` : name;
}

function formatMention(name: string): string {
  return `@${quoteIfNeeded(name)}`;
}
function formatProject(name: string): string {
  return `project:${quoteIfNeeded(name)}`;
}

/** Inverse of parseSearchSyntax. Predicates come first (positives,
 *  then negatives), free text last. Stable order so chip-row sync
 *  produces a predictable input string. */
export function stringifySearchSyntax(parsed: ParsedQuery): string {
  const positives = [
    ...parsed.tags.map((t) => `#${t}`),
    ...parsed.types.map((t) => `in:${t}`),
    ...parsed.mentions.map(formatMention),
    ...parsed.projects.map(formatProject),
  ];
  const negatives = [
    ...parsed.excludedTags.map((t) => `-#${t}`),
    ...parsed.excludedTypes.map((t) => `-in:${t}`),
    ...parsed.excludedMentions.map((n) => `-${formatMention(n)}`),
    ...parsed.excludedProjects.map((n) => `-${formatProject(n)}`),
  ];
  const allParts = [...positives, ...negatives];
  if (parsed.text) allParts.push(parsed.text);
  return allParts.join(' ');
}

/** Toggle a tag in the parsed query (add if absent, remove if present).
 *  Used when a chip is clicked — preserves the rest of the parse. */
export function toggleTagInQuery(input: string, tag: string): string {
  const parsed = parseSearchSyntax(input);
  const lower = tag.toLowerCase();
  const next: ParsedQuery = {
    ...parsed,
    tags: parsed.tags.includes(lower)
      ? parsed.tags.filter((t) => t !== lower)
      : [...parsed.tags, lower],
  };
  return stringifySearchSyntax(next);
}

/** Remove a single tag from the parsed query (idempotent — no-op if absent). */
export function removeTagFromQuery(input: string, tag: string): string {
  const parsed = parseSearchSyntax(input);
  const lower = tag.toLowerCase();
  return stringifySearchSyntax({ ...parsed, tags: parsed.tags.filter((t) => t !== lower) });
}

/** Remove a single entity type from the parsed query. */
export function removeTypeFromQuery(input: string, type: EntityKind): string {
  const parsed = parseSearchSyntax(input);
  return stringifySearchSyntax({ ...parsed, types: parsed.types.filter((t) => t !== type) });
}

/** Remove a mention (case-insensitive) from the parsed query. */
export function removeMentionFromQuery(input: string, name: string): string {
  const parsed = parseSearchSyntax(input);
  const lower = name.toLowerCase();
  return stringifySearchSyntax({
    ...parsed,
    mentions: parsed.mentions.filter((m) => m.toLowerCase() !== lower),
  });
}

/** Remove a project (case-insensitive) from the parsed query. */
export function removeProjectFromQuery(input: string, name: string): string {
  const parsed = parseSearchSyntax(input);
  const lower = name.toLowerCase();
  return stringifySearchSyntax({
    ...parsed,
    projects: parsed.projects.filter((p) => p.toLowerCase() !== lower),
  });
}

/** Remove an excluded predicate (works against any of the negative buckets). */
export function removeExcludedFromQuery(
  input: string,
  kind: 'tag' | 'type' | 'mention' | 'project',
  value: string,
): string {
  const parsed = parseSearchSyntax(input);
  const lower = value.toLowerCase();
  const next = { ...parsed };
  if (kind === 'tag') next.excludedTags = parsed.excludedTags.filter((t) => t !== lower);
  if (kind === 'type') next.excludedTypes = parsed.excludedTypes.filter((t) => t !== value);
  if (kind === 'mention') next.excludedMentions = parsed.excludedMentions.filter((m) => m.toLowerCase() !== lower);
  if (kind === 'project') next.excludedProjects = parsed.excludedProjects.filter((p) => p.toLowerCase() !== lower);
  return stringifySearchSyntax(next);
}

/** Cursor-aware token-at-position detection — figures out which token (if
 *  any) the user is currently typing into. Quote-aware: `@"foo bar`
 *  and `project:"foo bar` (mid-typing) are each treated as one token
 *  even though they contain whitespace.
 *
 *  Uses the same tokenizer logic as parseSearchSyntax and returns the
 *  prefix of the token that ends at or contains the cursor. */
export function tokenAtCursor(input: string, cursor: number): string {
  if (cursor <= 0) return '';
  let cur = '';
  let tokenStart = 0;
  let inQuote = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (i === cursor) {
      return cur;
    }
    if (inQuote) {
      cur += ch;
      if (ch === '"') inQuote = false;
      continue;
    }
    if (ch === '"' && (cur === '@' || cur === '-@' || cur === 'project:' || cur === '-project:')) {
      cur += ch;
      inQuote = true;
      continue;
    }
    if (/\s/.test(ch)) {
      cur = '';
      tokenStart = i + 1;
      continue;
    }
    cur += ch;
  }
  if (cursor >= tokenStart) return cur;
  return '';
}

/** Replace the token at cursor with a new value, preserving everything
 *  else. Returns the new input + the new cursor position. */
export function replaceTokenAtCursor(
  input: string,
  cursor: number,
  replacement: string,
): { value: string; cursor: number } {
  const token = tokenAtCursor(input, cursor);
  const tokenStart = cursor - token.length;
  const before = input.slice(0, tokenStart);
  const after = input.slice(cursor);
  // Skip trailing space when the existing tail ALREADY starts with whitespace
  // (avoids double-space mid-input). At end-of-input we DO add a space so
  // the user can keep typing more tokens without manually inserting one.
  const trailing = /^\s/.test(after) ? '' : ' ';
  const value = `${before}${replacement}${trailing}${after}`;
  return { value, cursor: tokenStart + replacement.length + trailing.length };
}
