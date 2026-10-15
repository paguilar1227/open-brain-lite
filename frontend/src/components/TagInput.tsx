// Reusable tag editor: a removable chip list + a "+ Add" affordance that
// opens an input with the SAME autocomplete dropdown the search bar uses
// (TypeaheadPopover). Suggesting already-existing tags as you type avoids
// misspellings and duplicate near-identical tags.
//
// Shared by every surface that edits tags (notes, todos, doc upload) so the
// behavior is identical everywhere. The component owns the in-progress draft;
// committed adds/removes flow out through `onChange`. For form-save flows
// (note editor, upload) the parent can flush an uncommitted draft via the
// imperative `commitDraft()` handle before submitting.
//
// Renders a fragment (chips, then the input/Add button) — NOT a wrapper — so
// each caller keeps its own flex layout (e.g. a trailing status badge).

import {
  forwardRef, useId, useImperativeHandle, useMemo, useRef, useState,
  type KeyboardEvent,
} from 'react';
import { Icons } from './Icons';
import { Tag } from './primitives';
import { TypeaheadPopover, type TypeaheadItem } from './TypeaheadPopover';
import type { TagSuggestion } from './SearchInput';

export interface TagInputHandle {
  /** Commit any typed-but-uncommitted draft into the list and return the
   *  resulting tags. Call from a form's save handler so "I typed it but
   *  forgot to press Enter" doesn't silently drop the tag. No-op (returns
   *  the current value) when there's no pending draft. */
  commitDraft: () => string[];
}

interface Props {
  /** Current tags (lowercase). */
  value: string[];
  /** Fires with the next list on every committed add / remove. */
  onChange: (next: string[]) => void;
  /** Tag inventory for the autocomplete (name + usage count), scoped by the
   *  caller via useTagSuggestions. */
  suggestions: TagSuggestion[];
  placeholder?: string;
  /** Max suggestions rendered in the dropdown. */
  max?: number;
}

export const TagInput = forwardRef<TagInputHandle, Props>(function TagInput(
  { value, onChange, suggestions, placeholder = 'add tag', max = 8 },
  ref,
) {
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Ties the input's aria-controls to the suggestion listbox (WAI-ARIA
  // autocomplete pattern). useId keeps it unique across multiple TagInputs.
  const listId = useId();

  const addTag = (name: string) => {
    const t = name.trim().toLowerCase();
    setDraft('');
    setActiveIndex(0);
    if (!t || value.includes(t)) return;
    onChange([...value, t]);
    // Stay in editing mode so the user can chain-add another tag without
    // re-clicking Add. Blur / Escape / empty-Enter closes the input.
  };

  const removeTag = (t: string) => onChange(value.filter((x) => x !== t));

  useImperativeHandle(
    ref,
    () => ({
      commitDraft: () => {
        const t = draft.trim().toLowerCase();
        setDraft('');
        if (t && !value.includes(t)) {
          const next = [...value, t];
          onChange(next);
          return next;
        }
        return value;
      },
    }),
    [draft, value, onChange],
  );

  // Suggestions: existing tags not already applied, matched against the draft
  // (substring), top N by usage. Drawn from the full scope inventory so a tag
  // first used elsewhere can be reused here.
  const items = useMemo<TypeaheadItem[]>(() => {
    const prefix = draft.trim().toLowerCase();
    const applied = new Set(value.map((t) => t.toLowerCase()));
    return suggestions
      .filter((t) => !applied.has(t.name.toLowerCase()) && (!prefix || t.name.toLowerCase().includes(prefix)))
      .sort((a, b) => b.total - a.total)
      .slice(0, max)
      .map((t) => ({ key: t.name, value: t.name, label: t.name, sublabel: String(t.total) }));
  }, [draft, value, suggestions, max]);

  const popoverOpen = editing && items.length > 0;

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
      if (e.key === 'Tab') {
        e.preventDefault();
        addTag(items[activeIndex].value);
        return;
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      // Empty input → Enter closes the editor. Crucially this is checked
      // BEFORE the suggestion branch: with an open popover, "add the
      // highlighted suggestion" would otherwise silently add the user's
      // top-by-usage tag on a bare Enter they meant as "I'm done".
      if (!draft.trim()) setEditing(false);
      else if (popoverOpen && items[activeIndex]) addTag(items[activeIndex].value);
      else addTag(draft);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setDraft('');
      setEditing(false);
    }
  };

  return (
    <>
      {value.map((t) => (
        <Tag key={t} removable onRemove={() => removeTag(t)}>
          {t}
        </Tag>
      ))}
      {editing ? (
        <span className="input-tag-wrap" style={{ position: 'relative' }}>
          <span className="hash">#</span>
          <input
            ref={inputRef}
            autoFocus
            className="input-tag"
            placeholder={placeholder}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
            // Commit a typed draft on click-away, then close. The popover's
            // onMouseDown preventDefault keeps focus on the input while
            // selecting a suggestion, so this only fires on a genuine blur.
            onBlur={() => {
              if (draft.trim()) addTag(draft);
              setEditing(false);
            }}
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-label="Add a tag"
            aria-autocomplete="list"
            aria-expanded={popoverOpen}
            aria-controls={listId}
          />
          {popoverOpen ? (
            <TypeaheadPopover
              id={listId}
              items={items}
              activeIndex={activeIndex}
              onSelect={(item) => addTag(item.value)}
              onHover={setActiveIndex}
              onDismiss={() => setEditing(false)}
              ariaLabel="Tag suggestions"
            />
          ) : null}
        </span>
      ) : (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
          <Icons.Plus size={11} /> Add
        </button>
      )}
    </>
  );
});
