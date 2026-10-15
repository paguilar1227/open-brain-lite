// Compact sort-mode picker for list surfaces. Native <select> styled
// to match the rest of the chrome — keyboard + screen reader support
// comes free. Generic over the mode union so todos and notes can share
// the same component with their own mode vocabularies.
//
// Pre-configured variants live alongside this primitive: TodoSortDropdown
// reads from useTodoSortMode, NoteSortDropdown reads from
// useNoteSortMode. Surfaces compose those instead of touching the
// underlying primitive directly.

import { TODO_SORT_LABELS, TODO_SORT_MODES, type TodoSortMode } from '../lib/todoSort';
import { NOTE_SORT_LABELS, NOTE_SORT_MODES, type NoteSortMode } from '../lib/useNoteSortMode';

interface Props<M extends string> {
  mode: M;
  modes: readonly M[];
  labels: Record<M, string>;
  onChange: (m: M) => void;
  /** Optional id used to pair the select with its label for screen
   *  readers; only matters when more than one dropdown might exist on
   *  the page. */
  id?: string;
  /** Visible label before the select. Defaults to "Sort"; pass
   *  "Filter" or similar when reusing the primitive for non-sort
   *  pickers (e.g. activity kind filter). */
  label?: string;
}

export function SortDropdown<M extends string>({ mode, modes, labels, onChange, id, label = 'Sort' }: Props<M>) {
  return (
    <label className="todo-sort-dropdown" htmlFor={id}>
      <span className="todo-sort-dropdown-label">{label}</span>
      <select
        id={id}
        className="todo-sort-dropdown-select"
        value={mode}
        onChange={(e) => onChange(e.target.value as M)}
      >
        {modes.map((m) => (
          <option key={m} value={m}>{labels[m]}</option>
        ))}
      </select>
    </label>
  );
}

/** Pre-bound to the todo sort vocabulary. Use this in callers that
 *  pair with useTodoSortMode. */
export function TodoSortDropdown({
  mode, onChange, id,
}: { mode: TodoSortMode; onChange: (m: TodoSortMode) => void; id?: string }) {
  return (
    <SortDropdown<TodoSortMode>
      mode={mode}
      modes={TODO_SORT_MODES}
      labels={TODO_SORT_LABELS}
      onChange={onChange}
      id={id}
    />
  );
}

/** Pre-bound to the note sort vocabulary. */
export function NoteSortDropdown({
  mode, onChange, id,
}: { mode: NoteSortMode; onChange: (m: NoteSortMode) => void; id?: string }) {
  return (
    <SortDropdown<NoteSortMode>
      mode={mode}
      modes={NOTE_SORT_MODES}
      labels={NOTE_SORT_LABELS}
      onChange={onChange}
      id={id}
    />
  );
}
