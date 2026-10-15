// Universal search input — wraps a search box with cursor-aware
// typeahead. Four sigil contexts trigger their own suggestion lists:
//
//   #                 → tags (filtered by prefix after #)
//   in:               → todo / note / document
//   @                 → mentions: docs + notes by title
//   project:          → projects by name
//
// Any sigil can be NEGATED by prefixing with `-`: typing `-#archive`,
// `-in:doc`, `-@drafts`, `-project:foo` opens the same typeahead but
// selection inserts the negated form. The parser routes negatives to
// the .excluded* buckets — see searchSyntax.ts.
//
// Sigil detection uses tokenAtCursor (searchSyntax.ts). On selection,
// tags/types/projects REPLACE the current partial via
// replaceTokenAtCursor. Mentions ALSO fire `onMentionSelect` so the
// host can navigate to the entity.
//
// Keyboard: ↑/↓ navigate, Enter selects (or submits if no popover),
// Esc dismisses the popover, Tab also selects.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Icons } from './Icons';
import { TypeaheadPopover, type TypeaheadItem } from './TypeaheadPopover';
import {
  replaceTokenAtCursor,
  tokenAtCursor,
} from '../lib/searchSyntax';

export interface MentionTarget {
  /** Display title — shown in the popover and inserted as `@"title"` */
  title: string;
  /** Underlying entity kind so the host can route correctly. */
  kind: 'document' | 'note';
  /** Entity UUID. */
  id: string;
}

export interface TagSuggestion {
  name: string;
  total: number;
}

export interface ProjectSuggestion {
  /** Display name — inserted as `project:name` or `project:"name"`. */
  name: string;
  /** Project UUID — exposed so host can resolve on submit. */
  id: string;
}

interface Props {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  /** Tag suggestions for `#` typeahead — full list, component prefix-filters. */
  tags: TagSuggestion[];
  /** Mention targets for `@` typeahead — docs + notes by title. */
  mentions: MentionTarget[];
  /** Project suggestions for `project:` typeahead. */
  projects?: ProjectSuggestion[];
  /** Called when user picks a mention from typeahead — host navigates. */
  onMentionSelect?: (target: MentionTarget) => void;
  /** Called when the user presses ArrowDown while the typeahead popover is
   *  NOT open. Host uses this to descend focus into a results list (so the
   *  flow is: type → ↓ → ↓ → Enter without ever touching Tab). */
  onArrowDownExit?: () => void;
  /** Which sigil typeaheads are active. Defaults to all four. Scope it
   *  to the surface — e.g. `['tag']` inside a notes drawer, where
   *  `@docname` / `in:type` / `project:` don't apply. Pass a stable
   *  (module-scope or memoized) array to avoid re-renders. */
  sigils?: readonly SigilKind[];
  placeholder?: string;
}

export type SigilKind = 'tag' | 'type' | 'mention' | 'project';
const ALL_SIGILS: readonly SigilKind[] = ['tag', 'type', 'mention', 'project'];

type SigilContext =
  | { kind: 'tag'; prefix: string; negated: boolean }
  | { kind: 'type'; prefix: string; negated: boolean }
  | { kind: 'mention'; prefix: string; negated: boolean }
  | { kind: 'project'; prefix: string; negated: boolean }
  | null;

const TYPE_OPTIONS = [
  { value: 'todo', label: 'todo', sub: 'todos only' },
  { value: 'note', label: 'note', sub: 'notes only' },
  { value: 'document', label: 'document', sub: 'documents only' },
];

/** Inspect the token at the cursor and decide which sigil context applies.
 *  Returns the negated flag separately so the caller renders the same
 *  popover but formats the selection with the `-` prefix. */
function detectSigilContext(input: string, cursor: number): SigilContext {
  const tokRaw = tokenAtCursor(input, cursor);
  const negated = tokRaw.startsWith('-') && tokRaw.length > 1;
  const tok = negated ? tokRaw.slice(1) : tokRaw;
  if (tok.startsWith('#')) {
    return { kind: 'tag', prefix: tok.slice(1).toLowerCase(), negated };
  }
  if (tok.startsWith('in:')) {
    return { kind: 'type', prefix: tok.slice(3).toLowerCase(), negated };
  }
  if (tok.startsWith('project:"')) {
    return { kind: 'project', prefix: tok.slice('project:"'.length).toLowerCase(), negated };
  }
  if (tok.startsWith('project:')) {
    return { kind: 'project', prefix: tok.slice('project:'.length).toLowerCase(), negated };
  }
  if (tok.startsWith('@"')) {
    return { kind: 'mention', prefix: tok.slice(2).toLowerCase(), negated };
  }
  if (tok.startsWith('@')) {
    return { kind: 'mention', prefix: tok.slice(1).toLowerCase(), negated };
  }
  return null;
}

/** Quote name if needed (whitespace/quotes). Mirrors searchSyntax.ts. */
function maybeQuote(name: string): string {
  return /\s|"/.test(name) ? `"${name.replace(/"/g, '\\"')}"` : name;
}

export function SearchInput({
  value,
  onChange,
  onSubmit,
  tags,
  mentions,
  projects = [],
  onMentionSelect,
  onArrowDownExit,
  sigils = ALL_SIGILS,
  placeholder,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [cursor, setCursor] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedToken, setDismissedToken] = useState<string | null>(null);

  const currentToken = useMemo(() => tokenAtCursor(value, cursor), [value, cursor]);
  const sigil = useMemo(() => {
    if (dismissedToken === currentToken) return null;
    const detected = detectSigilContext(value, cursor);
    // Only honor sigils the host enabled for this surface.
    return detected && sigils.includes(detected.kind) ? detected : null;
  }, [value, cursor, dismissedToken, currentToken, sigils]);

  const items = useMemo<TypeaheadItem[]>(() => {
    if (!sigil) return [];
    const prefix = `${sigil.negated ? '-' : ''}`;
    if (sigil.kind === 'tag') {
      return tags
        .filter((t) => t.name.toLowerCase().startsWith(sigil.prefix))
        .slice(0, 8)
        .map((t) => ({
          key: `tag-${t.name}`,
          value: `${prefix}#${t.name}`,
          label: `${prefix}#${t.name}`,
          sublabel: t.total.toString(),
          icon: <Icons.Tag size={12} aria-hidden />,
        }));
    }
    if (sigil.kind === 'type') {
      return TYPE_OPTIONS.filter((o) => o.value.startsWith(sigil.prefix)).map((o) => ({
        key: `type-${o.value}`,
        value: `${prefix}in:${o.value}`,
        label: `${prefix}in:${o.value}`,
        sublabel: o.sub,
        icon: typeIcon(o.value),
      }));
    }
    if (sigil.kind === 'project') {
      return projects
        .filter((p) => p.name.toLowerCase().includes(sigil.prefix))
        .slice(0, 8)
        .map((p) => ({
          key: `project-${p.id}`,
          value: `${prefix}project:${maybeQuote(p.name)}`,
          label: p.name,
          sublabel: 'project',
          icon: <Icons.Folders size={12} aria-hidden />,
        }));
    }
    // mention
    return mentions
      .filter((m) => m.title.toLowerCase().includes(sigil.prefix))
      .slice(0, 8)
      .map((m) => ({
        key: `mention-${m.id}`,
        value: `${prefix}@${maybeQuote(m.title)}`,
        label: m.title,
        sublabel: m.kind,
        icon: m.kind === 'document' ? <Icons.Doc size={12} aria-hidden /> : <Icons.Note size={12} aria-hidden />,
      }));
  }, [sigil, tags, mentions, projects]);

  useEffect(() => {
    setActiveIndex(0);
  }, [items]);

  useEffect(() => {
    if (dismissedToken !== null && dismissedToken !== currentToken) {
      setDismissedToken(null);
    }
  }, [currentToken, dismissedToken]);

  const popoverOpen = sigil !== null && items.length > 0;

  const applyItem = (item: TypeaheadItem) => {
    if (!sigil) return;
    if (sigil.kind === 'mention' && !sigil.negated && onMentionSelect) {
      const target = mentions.find((m) => `mention-${m.id}` === item.key);
      if (target) onMentionSelect(target);
    }
    const next = replaceTokenAtCursor(value, cursor, item.value);
    onChange(next.value);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.cursor, next.cursor);
      setCursor(next.cursor);
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (popoverOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(items.length - 1, i + 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const item = items[activeIndex];
        if (item) applyItem(item);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissedToken(currentToken);
        return;
      }
    }
    if (e.key === 'Enter') {
      onSubmit();
      return;
    }
    // No popover open + ArrowDown → hand focus off to the results list
    // (host wires this to focus the first search hit). Lets users go from
    // typing straight into list navigation without Tabbing.
    if (e.key === 'ArrowDown' && onArrowDownExit) {
      e.preventDefault();
      onArrowDownExit();
    }
  };

  const syncCursor = () => {
    const el = inputRef.current;
    if (el) setCursor(el.selectionStart ?? el.value.length);
  };

  return (
    <div className="search-input-wrapper">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          requestAnimationFrame(syncCursor);
        }}
        onSelect={syncCursor}
        onKeyUp={syncCursor}
        onClick={syncCursor}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-autocomplete="list"
        aria-expanded={popoverOpen}
        aria-controls={popoverOpen ? 'search-typeahead' : undefined}
      />
      {popoverOpen ? (
        <TypeaheadPopover
          items={items}
          activeIndex={activeIndex}
          onSelect={applyItem}
          onHover={setActiveIndex}
          onDismiss={() => setDismissedToken(currentToken)}
          ariaLabel={ariaLabelFor(sigil!.kind, sigil!.negated)}
        />
      ) : null}
    </div>
  );
}

function ariaLabelFor(kind: 'tag' | 'type' | 'mention' | 'project', negated: boolean): string {
  const prefix = negated ? 'Exclude ' : '';
  if (kind === 'tag') return `${prefix}tag suggestions`;
  if (kind === 'type') return `${prefix}type suggestions`;
  if (kind === 'mention') return `${prefix}mention suggestions`;
  return `${prefix}project suggestions`;
}

function typeIcon(value: string): ReactNode {
  if (value === 'todo') return <Icons.Check size={12} aria-hidden />;
  if (value === 'note') return <Icons.Note size={12} aria-hidden />;
  return <Icons.Doc size={12} aria-hidden />;
}
