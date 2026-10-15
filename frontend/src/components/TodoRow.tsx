// Single source of truth for a compact todo row, used by the Home
// personal-todos column and the personal todos drawer. Anything that
// should look or behave the same across both surfaces lives here.
//
// Visual states the row carries:
//   - depth ≥ 1 → indented under its parent (CSS uses --depth)
//   - status=done → title struck through, row dimmed
//   - comment_count > 0 → tiny chat-bubble badge with the count
//   - due in the past + status != done → red due meta line
//   - childCount > 0 + onToggleExpand → chevron toggles subtree
//   - hiddenDescendants > 0 (no toggle) → "+N deeper" italic hint
//
// Distinguish hint vs chevron: chevron means "you can show/hide these
// from here." Hint means "deeper rows live in the drawer; this surface
// caps depth." Both can be expressed by the same hidden count, so the
// caller picks via whether they pass `onToggleExpand`.

import { Icons } from './Icons';
import { Checkbox, Priority } from './primitives';
import { RowTags } from './RowTags';
import { cls, fmtDue, fmtRel, isOverdue } from '../lib/util';
import type { Todo } from '../types';

interface Props {
  todo: Todo;
  depth?: number;
  childCount?: number;
  expanded?: boolean;
  hiddenDescendants?: number;
  /**
   * Drag-handle props from `useSortable` ({...attributes, ...listeners}).
   * When provided, a grip cell renders to the left of the chevron column
   * and is the only surface that initiates a drag — the row body still
   * routes clicks to onClick. Omit to render a non-draggable row.
   */
  dragHandleProps?: Record<string, unknown>;
  onClick?: () => void;
  onToggleDone?: () => void;
  onToggleExpand?: () => void;
}

export function TodoRow({
  todo,
  depth = 0,
  childCount = 0,
  expanded = false,
  hiddenDescendants = 0,
  dragHandleProps,
  onClick,
  onToggleDone,
  onToggleExpand,
}: Props) {
  const t = todo;
  const done = t.status === 'done';
  const expandable = childCount > 0 && !!onToggleExpand;
  // "+N deeper" hint is for surfaces that cap depth without offering a
  // toggle. If the row IS expandable, the chevron is the hint.
  const showDeeperHint = !expandable && hiddenDescendants > 0;
  return (
    <div
      className={cls('prow', 'prow-todo', done && 'prow-done', dragHandleProps && 'prow-draggable')}
      data-depth={depth}
      style={{ '--depth': depth } as React.CSSProperties}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      } : undefined}
    >
      {dragHandleProps ? (
        <span
          className="prow-grip"
          role="button"
          aria-label="Reorder this todo"
          {...dragHandleProps}
          onClick={(e) => e.stopPropagation()}
        >
          <Icons.Grip size={14} />
        </span>
      ) : (
        <span className="prow-grip-spacer" aria-hidden="true" />
      )}
      {expandable ? (
        <button
          type="button"
          className={cls('prow-chev', expanded && 'open')}
          aria-label={expanded ? 'Collapse subtasks' : 'Expand subtasks'}
          aria-expanded={expanded}
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand!();
          }}
        >
          <Icons.ChevronRight size={11} />
        </button>
      ) : (
        <span className="prow-chev-spacer" aria-hidden="true" />
      )}
      <Checkbox
        checked={done}
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation();
          onToggleDone?.();
        }}
      />
      <div className="prow-main">
        <div className="ti" title={t.title}>
          {t.title}
          {expandable && !expanded ? (
            <span className="ti-childcount" title={`${childCount} subtask${childCount === 1 ? '' : 's'}`}>
              ({childCount})
            </span>
          ) : null}
        </div>
        {t.due_at ? (
          <div className={cls('ti-sub', !done && isOverdue(t.due_at) && 'due-overdue')}>
            due {fmtDue(t.due_at)}
          </div>
        ) : null}
        {showDeeperHint ? (
          <div
            className="ti-deeper"
            title={`${hiddenDescendants} item${hiddenDescendants === 1 ? '' : 's'} deeper — open the drawer to see all`}
          >
            +{hiddenDescendants} deeper
          </div>
        ) : null}
        {/* Meta chips: an active-status pill (in_progress / paused) then the
            tags. `done` is already conveyed by the checkbox + strikethrough,
            and `not_started` is the implicit default, so only the two
            in-between states get a pill. Tags stay root-only and cap inline
            via RowTags so a heavily-tagged todo can't blow out the row. */}
        <RowTags
          leading={
            t.status === 'in_progress' || t.status === 'paused' ? (
              <span className={cls('prow-status', `status-${t.status}`)}>
                {t.status === 'in_progress' ? 'In progress' : 'Paused'}
              </span>
            ) : null
          }
          tags={!t.parent_id ? t.tags : []}
        />
      </div>
      {/* Comments is always rendered as a fixed-width slot so the
          priority pill sits at a consistent X across rows; when there
          are no comments the slot is invisible but still occupies its
          width. */}
      <span className="prow-comments-slot" aria-hidden={t.comments === 0 ? 'true' : undefined}>
        {t.comments > 0 ? (
          <span className="prow-comments" title={`${t.comments} comment${t.comments === 1 ? '' : 's'}`}>
            <Icons.Chat size={11} />
            <span>{t.comments}</span>
          </span>
        ) : null}
      </span>
      <Priority p={t.priority} />
      <span className="ats">{fmtRel(t.created_at)}</span>
    </div>
  );
}
