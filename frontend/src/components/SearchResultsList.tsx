import { useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Icons } from './Icons';
import { Tag } from './primitives';
import type { SearchHit } from '../types';

interface Props {
  hits: SearchHit[];
  onOpen: (hit: SearchHit) => void;
}

// Card-level open: any click on the row opens the hit, EXCEPT when the
// user is actively selecting text (drag-to-copy). The selection check on
// click preserves "select an excerpt to copy" while making the rest of
// the card a hit target.
function hasActiveSelection() {
  const sel = window.getSelection();
  return !!sel && sel.toString().length > 0;
}

export function SearchResultsList({ hits, onOpen }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Arrow-key nav between hits — ↓ to next, ↑ to previous, Enter to open.
  // Tab still works (each title is a real button), but power users expect
  // arrow-based list traversal in a search-results surface. Roving focus
  // is implicit: we move document.activeElement between title buttons.
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!hits.length) return;
    const buttons = Array.from(
      containerRef.current?.querySelectorAll<HTMLButtonElement>('button.search-hit-title') ?? [],
    );
    if (!buttons.length) return;
    const activeIdx = buttons.findIndex((b) => b === document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = activeIdx < 0 ? 0 : Math.min(buttons.length - 1, activeIdx + 1);
      buttons[next]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = activeIdx <= 0 ? 0 : activeIdx - 1;
      buttons[next]?.focus();
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      onOpen(hits[activeIdx]);
    }
  };

  return (
    <div className="search-hits" ref={containerRef} onKeyDown={onKeyDown}>
      {hits.map(h => (
        <div
          key={h.id}
          className="doc-row search-hit"
          onClick={() => {
            if (hasActiveSelection()) return;
            onOpen(h);
          }}
          role="button"
          tabIndex={-1}
        >
          <div className="ic-box">
            {h.entity_kind === 'document' ? <Icons.Doc /> : h.entity_kind === 'note' ? <Icons.Note /> : <Icons.Check />}
          </div>
          <div>
            <div className="row-flex gap-2 search-hit-head">
              <button
                type="button"
                className="search-hit-title"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen(h);
                }}
              >
                {h.title}
              </button>
              <Tag kind={h.entity_kind === 'document' ? 'doc' : h.entity_kind === 'note' ? 'note' : 'todo'}>
                {h.entity_kind}
              </Tag>
              <span className="search-hit-project subtle">{h.project}</span>
            </div>
            <div
              className="search-hit-excerpt"
              dangerouslySetInnerHTML={{ __html: h.excerpt }}
            />
            <div className="row-flex gap-1 search-hit-paths">
              {h.retrieval_path.map(p => (
                <span key={p} className="tag search-hit-path">{p}</span>
              ))}
              <span className="search-hit-score">score {h.score.toFixed(2)}</span>
            </div>
          </div>
          {/* Visual affordance: chevron on the right shows the card is
              actionable. Fades in on hover or keyboard focus inside. */}
          <span className="search-hit-chevron" aria-hidden>
            <Icons.ChevronRight size={14} />
          </span>
        </div>
      ))}
    </div>
  );
}
