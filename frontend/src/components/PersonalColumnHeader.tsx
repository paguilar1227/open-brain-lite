// Shared header strip for the Home "Personal" columns (Todos / Notes).
// Renders the title, a count chip, and an optional sort dropdown slot.
// Kept as a thin layout component — the columns differ in too many
// ways below the header (add-input shape, row component, drag-and-
// drop) to justify a bigger abstraction.

import type { ReactNode } from 'react';

interface Props {
  title: string;
  count: number;
  /** Optional sort dropdown — pass `<TodoSortDropdown/>` or
   *  `<NoteSortDropdown/>` to render it on the right. */
  sort?: ReactNode;
}

export function PersonalColumnHeader({ title, count, sort }: Props) {
  return (
    <div className="pcol-h">
      <h3>{title}</h3>
      <span className="ct">{count}</span>
      {sort}
    </div>
  );
}
