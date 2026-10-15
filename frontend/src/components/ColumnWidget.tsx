import type { ReactNode } from 'react';
import { Icons } from './Icons';
import { PersonalColumnHeader } from './PersonalColumnHeader';
import { ErrorBoundary, PanelErrorFallback } from './ErrorBoundary';

// Hard cap on rows shown in a Home dashboard column preview. Every widget
// shows up to MAX_ROWS items; the remainder is one tap away via the
// "View N more" footer / drawer.
//
// A flat cap — rather than measuring how many rows fit the viewport — keeps
// every column consistent no matter where it sits. The Documents widget in
// the shorter lower row shows the same 6 as the Todos / Notes columns in the
// taller top row.
const MAX_ROWS = 6;

// Single source of truth for the Home dashboard's column widgets.
//
// Each Personal / All-projects column (Todos / Notes / Documents) is
// the same shell — outer card, header, optional quick-add input, a
// rows region capped at MAX_ROWS, and a "View N more" footer when the
// dataset is larger than the cap. Differences live only in slot content
// (title, row-renderer, empty state, sort dropdown). Before this lived
// inline in HomePage 3× — see PR notes on the dashboard widget refactor
// for context.
//
// Slot contract:
//   sort      — dropdown rendered on the right of the header
//   quickAdd  — optional input row above the rows region (todos/notes)
//   empty     — what to render when isEmpty is true
//   renderRows — function taking the row cap, returns the row markup.
//                Caller slice(0, cap) to respect it.
interface Props {
  /** data-pcol value — also identifies the column in DOM queries / e2e. */
  id: string;
  title: string;
  /** Count chip in the header — usually the total filtered length. */
  count: number;
  sort: ReactNode;
  quickAdd?: ReactNode;
  isEmpty: boolean;
  empty: ReactNode;
  /** Receives the row cap so the caller can slice its data source to
   *  render at most that many rows. */
  renderRows: (cap: number) => ReactNode;
  /** Total dataset length — drives the "View N more" math (remainder
   *  beyond the shown rows). The footer renders whenever totalRows > 0. */
  totalRows: number;
  onMore: () => void;
}

export function ColumnWidget({
  id,
  title,
  count,
  sort,
  quickAdd,
  isEmpty,
  empty,
  renderRows,
  totalRows,
  onMore,
}: Props) {
  const shown = Math.min(totalRows, MAX_ROWS);
  return (
    <div className="pcol" data-pcol={id}>
      <PersonalColumnHeader title={title} count={count} sort={sort} />
      {quickAdd ? <div className="pcol-add">{quickAdd}</div> : null}
      <div className="pcol-rows">
        <ErrorBoundary
          label={`widget:${id}`}
          fallback={(error, reset) => (
            <PanelErrorFallback error={error} reset={reset} title={`Couldn’t load ${title.toLowerCase()}`} />
          )}
        >
          {isEmpty ? empty : renderRows(shown)}
        </ErrorBoundary>
      </div>
      {totalRows > 0 ? (
        // Always offer the drawer entry when the column has content — the
        // drawer is the only way to reach search + the full paginated list.
        // A permanent footer can't detach mid-click, so the entry is stable
        // (gating it on totalRows > shown made it a load-phase transient and
        // was the cause of flaky footer-driven drawer e2es).
        <button className="pcol-more" onClick={onMore}>
          {totalRows > shown ? `View ${totalRows - shown} more` : 'View all'}
          <Icons.ChevronRight size={11} />
        </button>
      ) : null}
    </div>
  );
}
