// Generic typeahead popover anchored under an input. The parent owns
// the items list (filtering / sourcing per sigil), the popover handles
// just rendering, mouse hover, click selection, and Escape dismiss.
// Up/Down navigation and Enter selection live on the parent input — we
// expose `activeIndex` + `setActiveIndex` so the parent can sync state.
//
// Why parent-owned items: each sigil shapes its list differently
// (tags = name + count; mentions = title + entity icon; in: = three
// hardcoded options with different icons). A generic items prop keeps
// the popover unaware of those shapes — caller picks the right items
// + renders them as ReactNodes.

import { useEffect, useRef } from 'react';
import { cls } from '../lib/util';

export interface TypeaheadItem {
  /** Unique key for React. */
  key: string;
  /** Inserted/used by the caller on select — opaque to the popover. */
  value: string;
  /** Primary label shown in the row. */
  label: string;
  /** Optional small secondary text (e.g. tag count, doc subtitle). */
  sublabel?: string;
  /** Optional left-side icon ReactNode. */
  icon?: React.ReactNode;
}

interface Props {
  items: TypeaheadItem[];
  activeIndex: number;
  onSelect: (item: TypeaheadItem) => void;
  onHover: (i: number) => void;
  onDismiss: () => void;
  /** Bound to the input. Hides on dismiss; parent re-renders when input/cursor changes. */
  emptyMessage?: string;
  /** ARIA label for the listbox role — describes what kind of items. */
  ariaLabel: string;
  /** DOM id for the listbox, so the controlling input can reference it via
   *  aria-controls (WAI-ARIA autocomplete pattern). */
  id?: string;
}

export function TypeaheadPopover({
  items,
  activeIndex,
  onSelect,
  onHover,
  onDismiss,
  emptyMessage = 'No matches.',
  ariaLabel,
  id,
}: Props) {
  const popRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  // Dismiss on click outside. Escape is handled by the parent input's
  // onKeyDown (we can't intercept here without stealing focus from input).
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node)) return;
      onDismiss();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onDismiss]);

  // Keep the active row visible when the parent moves activeIndex via
  // keyboard. scrollIntoView with 'nearest' so we don't yank the page.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  return (
    <div ref={popRef} id={id} className="typeahead-popover" role="listbox" aria-label={ariaLabel}>
      {items.length === 0 ? (
        <div className="typeahead-empty">{emptyMessage}</div>
      ) : (
        items.map((item, i) => (
          <button
            key={item.key}
            ref={(el) => {
              if (i === activeIndex) activeRef.current = el;
            }}
            type="button"
            role="option"
            aria-selected={i === activeIndex}
            className={cls('typeahead-row', i === activeIndex && 'active')}
            onMouseDown={(e) => {
              // mousedown (not click) so the input doesn't lose focus
              // before we get to process the selection. preventDefault
              // keeps the focus on the input.
              e.preventDefault();
              onSelect(item);
            }}
            onMouseEnter={() => onHover(i)}
          >
            {/* Always render the icon slot so the grid's first column
                isn't filled by the label (which would overflow 18px
                and overlap the sublabel). Empty placeholder when no
                icon — costs 18px but keeps layout consistent across
                rows with and without icons. */}
            <span className="typeahead-icon" aria-hidden>{item.icon ?? null}</span>
            <span className="typeahead-label">{item.label}</span>
            {item.sublabel ? <span className="typeahead-sublabel">{item.sublabel}</span> : null}
          </button>
        ))
      )}
    </div>
  );
}
