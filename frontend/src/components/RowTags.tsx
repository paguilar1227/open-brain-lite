// Display-only tag strip for compact list rows (TodoRow / NoteRow, and via
// them every surface that reuses those rows: Home widgets, the Notes/Todos
// views, project tabs, drawers, tag detail).
//
// A heavily-tagged item used to wrap its chips onto many lines and blow out
// the row height. This keeps the chips to a SINGLE line at any width: a hidden
// measure layer reports each chip's intrinsic width, then the layout effect
// greedily packs as many tags as fit (reserving room for the "+N more" pill)
// and re-fits on container resize. Same dynamic technique as the Home tag
// filter, but read-only — the chips don't filter (the row itself opens the
// item). Clicking "+N more" expands the full set inline; clicking again
// collapses.
//
// The measure layer renders sizing-only *ghosts* (`.prow-tags-measure-chip`)
// that replicate the chip box-model but are NOT real `.tag` / `.prow-folder`
// elements — so DOM queries for the visible chips (`.prow-tags .tag`,
// `.prow-folder`) never double-count the hidden copies. The always-visible
// leading block is measured from its real node, not a ghost.

import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Tag } from './primitives';
import { fitInlineCount } from '../lib/fitInlineTags';

interface Props {
  tags: string[];
  /** Always-visible chips rendered before the tags (e.g. a status pill or
   *  folder chip). They never collapse and are accounted for when fitting. */
  leading?: ReactNode;
}

// Gap between chips — must match the `.prow-tags` CSS `gap`.
const GAP = 4;

export function RowTags({ tags, leading }: Props) {
  const [expanded, setExpanded] = useState(false);
  // How many tags fit inline. Start optimistic (all) — useLayoutEffect runs
  // before paint and clamps it, so there's no visible flash of overflow.
  const [fit, setFit] = useState(tags.length);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const leadingRef = useRef<HTMLSpanElement | null>(null);

  const hasLeading = leading != null && leading !== false;

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const recompute = () => {
      const cw = container.clientWidth;
      if (cw === 0) return; // not laid out yet (hidden tab, etc.)
      const chipEls = Array.from(measure.querySelectorAll<HTMLElement>('[data-m-chip]'));
      const moreEl = measure.querySelector<HTMLElement>('[data-m-more]');
      setFit(
        fitInlineCount({
          containerWidth: cw,
          // The leading block is always visible — measure its real node.
          leadWidth: leadingRef.current ? leadingRef.current.offsetWidth : 0,
          chipWidths: chipEls.map((el) => el.offsetWidth),
          moreWidth: moreEl ? moreEl.offsetWidth : 0,
          gap: GAP,
        }),
      );
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(container);
    return () => ro.disconnect();
  }, [tags, hasLeading]);

  if (tags.length === 0 && !hasLeading) return null;

  const overflow = Math.max(0, tags.length - fit);
  const shown = expanded ? tags : tags.slice(0, fit);
  const hidden = tags.slice(fit);

  return (
    <div className="prow-tags" ref={containerRef}>
      {/* Hidden measure layer — sizing-only ghosts that mirror the chip box
          model (see `.prow-tags-measure-chip`). Out of flow, so it never
          affects the real row, and it deliberately does NOT use the `.tag` /
          `.prow-folder` classes so queries for the visible chips don't match
          these hidden copies. */}
      <div ref={measureRef} className="prow-tags-measure" aria-hidden="true">
        {tags.map((t) => (
          <span key={`m-${t}`} data-m-chip className="prow-tags-measure-chip">
            <span>#</span>
            {t}
          </span>
        ))}
        <span data-m-more className="prow-tags-measure-chip">
          +{tags.length} more
        </span>
      </div>

      {hasLeading ? (
        <span ref={leadingRef} className="prow-tags-lead">
          {leading}
        </span>
      ) : null}
      {shown.map((t) => (
        <Tag key={t}>{t}</Tag>
      ))}
      {overflow > 0 ? (
        <button
          type="button"
          className="prow-tags-more"
          aria-expanded={expanded}
          title={expanded ? undefined : hidden.map((t) => `#${t}`).join(', ')}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
        >
          {expanded ? 'Show less' : `+${overflow} more`}
        </button>
      ) : null}
    </div>
  );
}
