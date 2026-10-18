import { onHostEvent } from '../lib/host';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { cls } from '../lib/util';
import { Icons } from './Icons';
import { toggleTag, type TagFilter } from '../lib/tagFilter';

interface TagOption {
  name: string;
  total: number;
}

interface Props {
  /** Full personal-scope tag list, NOT pre-sliced — the component
   *  decides how many to show inline. When `visibleCap` is omitted
   *  (default), the cap is computed dynamically to fit the current
   *  row width; when provided, it's treated as a hard cap (useful
   *  for tests / demos). */
  options: TagOption[];
  filter: TagFilter;
  onChange: (next: TagFilter) => void;
  visibleCap?: number;
}

// Inline chip row + AND/OR toggle + Clear. By default, the inline
// chip count is computed dynamically from the available row width via
// a hidden measure layer + ResizeObserver — whatever doesn't fit
// spills into the typeahead popover behind "+N more". The pattern
// keeps the row to one line at any viewport width or tag count.
//
// Roving-tabindex over the inline chip set (per WAI-ARIA toolbar pattern).
export function HomeTagFilter({ options, filter, onChange, visibleCap }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  // Start cap large so first paint shows everything; the measure pass
  // immediately clamps it to what actually fits. Choosing `options.length`
  // (not Infinity) keeps `inlineChips.slice` cheap and bounded.
  const [autoCap, setAutoCap] = useState(options.length);
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const moreBtnRef = useRef<HTMLButtonElement | null>(null);
  const chipsContainerRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);

  // Manual override (tests, demos) takes precedence over the measured cap.
  const effectiveCap = visibleCap ?? autoCap;

  // Inline chips = top N by usage (where N = effectiveCap), with any
  // SELECTED-but-not-top-N tags prepended as "orphans" so an active filter
  // is always visible without opening the popover. Long tail = popover-only.
  const { inlineChips, popoverOptions } = useMemo(() => {
    const top = options.slice(0, effectiveCap);
    const topNames = new Set(top.map((o) => o.name));
    const orphans = filter.tags
      .filter((t) => !topNames.has(t))
      .map((name) => {
        const found = options.find((o) => o.name === name);
        return { name, total: found?.total ?? 0, known: !!found };
      });
    const inline = [
      ...orphans,
      ...top.map((o) => ({ name: o.name, total: o.total, known: true })),
    ];
    const inlineNames = new Set(inline.map((c) => c.name));
    const tail = options.filter((o) => !inlineNames.has(o.name));
    return { inlineChips: inline, popoverOptions: tail };
  }, [options, effectiveCap, filter.tags]);

  // The full set the measure layer renders, in the order they'd appear
  // inline if everything fit: orphans first (always-visible), then top
  // tags in usage order. We measure THIS array's widths and pick the
  // prefix that fits the container.
  const measureSet = useMemo(() => {
    const knownOptionsByName = new Map(options.map((o) => [o.name, o] as const));
    const orphans = filter.tags
      .filter((t) => !knownOptionsByName.has(t))
      .map((name) => ({ name, total: 0, known: false }));
    const orphanNames = new Set(orphans.map((o) => o.name));
    // Pre-selected known tags also pin (they're effectively orphans for
    // measurement purposes — they must show inline). The rest of the top
    // tags follow in usage order.
    const pinned = options
      .filter((o) => filter.tags.includes(o.name) && !orphanNames.has(o.name))
      .map((o) => ({ name: o.name, total: o.total, known: true }));
    const pinnedNames = new Set([...orphans, ...pinned].map((o) => o.name));
    const rest = options
      .filter((o) => !pinnedNames.has(o.name))
      .map((o) => ({ name: o.name, total: o.total, known: true }));
    return { allInOrder: [...orphans, ...pinned, ...rest], pinnedCount: orphans.length + pinned.length };
  }, [options, filter.tags]);

  // Auto-fit pass: measure the chip widths in the hidden layer, then set
  // autoCap to the count of TOP TAGS (not chips) that fit alongside the
  // pinned set. ResizeObserver re-runs on container width changes (sidebar
  // toggle, viewport resize, mobile rotation).
  useLayoutEffect(() => {
    if (visibleCap !== undefined) return; // explicit cap — skip measurement
    const container = chipsContainerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const recompute = () => {
      const chipNodes = Array.from(measure.querySelectorAll<HTMLElement>('[data-measure-chip]'));
      const moreNode = measure.querySelector<HTMLElement>('[data-measure-more]');
      if (chipNodes.length === 0) {
        setAutoCap(0);
        return;
      }
      const gap = 6; // matches CSS gap on .home-tag-filter-chips
      const containerWidth = container.clientWidth;
      const totalWidth = chipNodes.reduce(
        (sum, el, i) => sum + el.offsetWidth + (i > 0 ? gap : 0),
        0,
      );

      // Everything fits in one row → no overflow, no +N more reserve needed.
      if (totalWidth <= containerWidth) {
        const knownCount = options.length;
        setAutoCap(knownCount);
        return;
      }

      // Doesn't fit → reserve space for the +N more chip and greedy-pack.
      const moreReserve = (moreNode?.offsetWidth ?? 80) + gap;
      const available = Math.max(0, containerWidth - moreReserve);
      let used = 0;
      let fit = 0;
      for (let i = 0; i < chipNodes.length; i++) {
        const inc = chipNodes[i]!.offsetWidth + (i > 0 ? gap : 0);
        if (used + inc > available) break;
        used += inc;
        fit++;
      }
      // Subtract the pinned (orphan + already-selected) prefix — those
      // aren't part of the "top tags to show" count. Floor at 0 in the
      // degenerate "even orphans don't fit" case.
      const topShown = Math.max(0, fit - measureSet.pinnedCount);
      setAutoCap(topShown);
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(container);
    return () => ro.disconnect();
  }, [visibleCap, measureSet, options]);

  const overflowCount = popoverOptions.length;
  const showMoreChip = overflowCount > 0;
  const totalFocusable = inlineChips.length + (showMoreChip ? 1 : 0);

  // Clamp activeIndex when the chip set shrinks (e.g. user clears tags
  // while focus was on an orphan that disappears). Without this, tabIndex=0
  // ends up on no chip, breaking Tab entry to the toolbar.
  useEffect(() => {
    if (totalFocusable === 0) {
      setActiveIndex(0);
      return;
    }
    setActiveIndex((i) => Math.max(0, Math.min(i, totalFocusable - 1)));
  }, [totalFocusable]);

  const focusAt = (i: number) => {
    const clamped = Math.max(0, Math.min(i, totalFocusable - 1));
    setActiveIndex(clamped);
    buttonsRef.current[clamped]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        focusAt(activeIndex + 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        focusAt(activeIndex - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusAt(0);
        break;
      case 'End':
        e.preventDefault();
        focusAt(totalFocusable - 1);
        break;
    }
  };

  const onClickChip = (name: string) => onChange(toggleTag(filter, name));
  const onClear = () => onChange({ tags: [], mode: 'or' });
  const setMode = (mode: 'or' | 'and') => {
    if (filter.mode !== mode) onChange({ ...filter, mode });
  };

  const isSelected = (name: string) => filter.tags.includes(name);
  const hasActiveFilter = filter.tags.length > 0;
  const showModeToggle = filter.tags.length >= 2;

  return (
    <div className="home-tag-filter" data-tag-filter>
      {/* Hidden measure layer — renders every candidate chip plus a
          worst-case "+N more" so the layout effect can read offsetWidth
          and pick the prefix that fits. aria-hidden + pointer-events:none
          so it's invisible to AT and mouse. */}
      <div ref={measureRef} className="home-tag-filter-measure" aria-hidden="true">
        {measureSet.allInOrder.map((chip) => (
          <span key={`m-${chip.name}`} className="home-filter-chip" data-measure-chip>
            #{chip.name}
            {chip.known && chip.total > 0 ? (
              <span className="home-filter-chip-count">{chip.total}</span>
            ) : null}
          </span>
        ))}
        <span className="home-filter-chip home-filter-chip-more" data-measure-more>
          +{Math.max(99, options.length)} more
        </span>
      </div>
      <div
        ref={chipsContainerRef}
        className="home-tag-filter-chips"
        role="toolbar"
        aria-label="Filter by tags"
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
      >
        {inlineChips.map((chip, i) => (
          <button
            key={chip.name}
            ref={(el) => {
              buttonsRef.current[i] = el;
            }}
            type="button"
            className={cls('home-filter-chip', isSelected(chip.name) && 'active', !chip.known && 'orphan')}
            aria-pressed={isSelected(chip.name)}
            tabIndex={i === activeIndex ? 0 : -1}
            onClick={() => onClickChip(chip.name)}
            onFocus={() => setActiveIndex(i)}
          >
            #{chip.name}
            {chip.known && chip.total > 0 ? (
              <span className="home-filter-chip-count">{chip.total}</span>
            ) : null}
          </button>
        ))}
        {showMoreChip ? (
          <button
            key="__more"
            ref={(el) => {
              buttonsRef.current[inlineChips.length] = el;
              moreBtnRef.current = el;
            }}
            type="button"
            className="home-filter-chip home-filter-chip-more"
            tabIndex={inlineChips.length === activeIndex ? 0 : -1}
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
            aria-label={`Show ${overflowCount} more tags`}
            onClick={() => setPickerOpen((v) => !v)}
            onFocus={() => setActiveIndex(inlineChips.length)}
          >
            +{overflowCount} more
          </button>
        ) : null}
      </div>

      {showModeToggle ? (
        <div className="home-tag-filter-mode" role="radiogroup" aria-label="Filter mode">
          <button
            type="button"
            role="radio"
            className={cls('home-tag-filter-mode-btn', filter.mode === 'or' && 'active')}
            aria-checked={filter.mode === 'or'}
            onClick={() => setMode('or')}
          >
            OR
          </button>
          <button
            type="button"
            role="radio"
            className={cls('home-tag-filter-mode-btn', filter.mode === 'and' && 'active')}
            aria-checked={filter.mode === 'and'}
            onClick={() => setMode('and')}
          >
            AND
          </button>
        </div>
      ) : null}

      {hasActiveFilter ? (
        <button
          type="button"
          className="home-tag-filter-clear"
          onClick={onClear}
          aria-label="Clear tag filter"
        >
          <Icons.X size={11} aria-hidden /> Clear
        </button>
      ) : null}

      {pickerOpen ? (
        <TagPickerPopover
          options={popoverOptions}
          selected={filter.tags}
          onToggle={(name) => onChange(toggleTag(filter, name))}
          onClose={() => {
            setPickerOpen(false);
            // Return focus to the trigger so keyboard users don't lose context.
            requestAnimationFrame(() => moreBtnRef.current?.focus());
          }}
        />
      ) : null}
    </div>
  );
}

interface PopoverProps {
  options: TagOption[];
  selected: string[];
  onToggle: (name: string) => void;
  onClose: () => void;
}

// Anchored popover with typeahead. Renders a search input + filterable
// scrollable list of tag rows (checkbox-style toggles). Click-outside
// and Escape both close; closing returns focus to the trigger.
function TagPickerPopover({ options, selected, onToggle, onClose }: PopoverProps) {
  const popRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, query]);

  // Reset active row when the filter changes (the row at the old index
  // may not exist anymore, and even if it does it's the wrong row).
  useEffect(() => {
    setActive(0);
  }, [query]);

  // Outside-click + Escape. Pattern mirrors DateTimePicker.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (e.composedPath().includes(popRef.current!)) return;
      onClose();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    const stopDown = onHostEvent('mousedown', onDown);
    const stopKey = onHostEvent('keydown', onKey);
    return () => {
      stopDown();
      stopKey();
    };
  }, [onClose]);

  // Autofocus the search input on open — typeahead is the whole point.
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const onInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = filtered[active];
      if (row) onToggle(row.name);
    }
  };

  return (
    <div
      ref={popRef}
      className="tag-picker-popover"
      role="dialog"
      aria-label="Pick a tag"
    >
      <div className="tag-picker-search">
        <Icons.Search size={12} aria-hidden />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKey}
          placeholder={`Search ${options.length} tags…`}
          aria-label="Search tags"
        />
      </div>
      <div className="tag-picker-list" role="listbox" aria-label="Tags">
        {filtered.length === 0 ? (
          <div className="tag-picker-empty">No tags match "{query}".</div>
        ) : (
          filtered.map((opt, i) => {
            const isOn = selected.includes(opt.name);
            return (
              <button
                key={opt.name}
                type="button"
                role="option"
                aria-selected={isOn}
                className={cls('tag-picker-row', isOn && 'on', i === active && 'active')}
                onClick={() => onToggle(opt.name)}
                onMouseEnter={() => setActive(i)}
              >
                <span className="tag-picker-check" aria-hidden>
                  {isOn ? '✓' : ''}
                </span>
                <span className="tag-picker-name">#{opt.name}</span>
                <span className="tag-picker-count">{opt.total}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

interface FilterEmptyProps {
  entity: 'todos' | 'notes' | 'documents';
  filter: TagFilter;
}

export function FilterEmpty({ entity, filter }: FilterEmptyProps) {
  const tags = filter.tags.map((t) => `#${t}`).join(filter.mode === 'and' ? ' AND ' : ' or ');
  return (
    <div className="pcol-empty">
      No {entity} with {filter.tags.length === 1 ? 'tag' : 'tags'} {tags}.
    </div>
  );
}
