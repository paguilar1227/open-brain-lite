import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MAX_TODO_DEPTH, type TodoComment } from '@open-brain/shared';
import { DateTimePicker } from '../DateTimePicker';
import { Icons } from '../Icons';
import { Drawer, Checkbox, EntityLink, Priority, Tag } from '../primitives';
import { TagInput } from '../TagInput';
import { ReaderBackButton } from '../ReaderBackButton';
import { useConfirm } from '../ConfirmDialog';
import {
  createComment, createTodo as apiCreateTodo, deleteComment, getTodo,
  listTodoComments, listTodos, updateComment, updateTodo,
} from '../../lib/api';
import { toUiTodo } from '../../lib/view';
import { useTagSuggestions } from '../../lib/useTagSuggestions';
import { cls, fmtRel } from '../../lib/util';
import { useDirtyCloseGuard } from '../../lib/useDirtyCloseGuard';
import { useTodoDepth } from '../../lib/useTodoDepth';
import type { ActionDispatch, Todo } from '../../types';

type PriorityVal = 'p1' | 'p2' | 'p3';

// UI priority is lowercase p1/p2/p3; the wire schema is uppercase P1/P2/P3
// (see toUiTodo's PRIORITY_MAP). Convert here so callers stay in UI shape.
const toWirePriority = (p: PriorityVal): 'P1' | 'P2' | 'P3' =>
  p.toUpperCase() as 'P1' | 'P2' | 'P3';

// Editable status chips, in lifecycle order.
const STATUS_OPTIONS: { value: Todo['status']; label: string }[] = [
  { value: 'not_started', label: 'Not started' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'paused', label: 'Paused' },
  { value: 'done', label: 'Done' },
];

interface Props {
  todo: Todo;
  onClose: () => void;
  /**
   * Required to navigate when a subtask row is clicked. The drawer
   * dispatches `todo-detail` with the subtask, then closes itself —
   * the App reopens the new drawer one frame later, giving a
   * navigation feel without nesting drawers.
   */
  onAction?: ActionDispatch;
  /**
   * If set, render a "Back to list" button at the top of the body.
   * Used when this drawer is embedded inline by TodoListDrawer's
   * detail mode — clicking back returns to the list view while
   * preserving its scroll / search / sort state.
   */
  onBack?: () => void;
}

export function TodoDetailDrawer({ todo, onClose, onAction, onBack }: Props) {
  const qc = useQueryClient();
  const [commentDraft, setCommentDraft] = useState('');
  const [subtaskDraft, setSubtaskDraft] = useState('');
  const [priority, setPriority] = useState<PriorityVal>(todo.priority);
  const [status, setStatus] = useState<Todo['status']>(todo.status);
  // Local mirror so the trigger reflects the user's edit immediately
  // — the drawer receives `todo` as a prop snapshot (parent doesn't
  // refetch it on update) so we can't rely on todo.due_at after a
  // mutation. Same pattern priority uses.
  const [dueIso, setDueIso] = useState<string | null>(todo.due_at);
  // Title is also locally mirrored so the inline-edit affordance can
  // show the user's saved value immediately without a parent refetch.
  const [title, setTitle] = useState(todo.title);
  // Tags mirror the todo's saved list. Add / remove fire updateTodo
  // immediately (same pattern priority/due use); the local state keeps
  // the chip cluster current between the optimistic edit and the next
  // refetch from the parent.
  const [tags, setTags] = useState<string[]>(todo.tags);
  // Tags are a root-only concept (the user's decision): only top-level todos
  // carry them; subtasks inherit their grouping from the parent.
  const isRoot = !todo.parent_id;
  // Autocomplete inventory for the tag editor — scoped to the todo's project
  // (or personal). Shows existing tags so the user reuses rather than retypes.
  const tagSuggestions = useTagSuggestions(
    todo.project_id ? { project_id: todo.project_id } : { scope: 'personal' },
  );

  const commentsQ = useQuery({
    queryKey: ['todo-comments', todo.id],
    queryFn: () => listTodoComments(todo.id),
  });

  // Direct subtasks of this todo. Cached by parent id so opening the
  // drawer again is instant; invalidated whenever a subtask is added,
  // toggled, or its parent's any status changes.
  const subtasksQ = useQuery({
    queryKey: ['todos', 'children', todo.id],
    queryFn: () => listTodos({ parent_id: todo.id }),
  });

  // Parent todo title — resolved on demand. The list/detail payload only
  // carries parent_id so we have to fetch it. Cached by id so jumping
  // around sibling subtasks doesn't refetch the same parent.
  const parentQ = useQuery({
    queryKey: ['todo', todo.parent_id],
    queryFn: () => getTodo(todo.parent_id!),
    enabled: !!todo.parent_id,
  });

  const addCommentMut = useMutation({
    mutationFn: (content: string) => createComment(todo.id, { content }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['todo-comments', todo.id] });
      qc.invalidateQueries({ queryKey: ['activity'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      setCommentDraft('');
    },
  });

  const updateMut = useMutation({
    mutationFn: (patch: { priority?: PriorityVal; due_date?: string | null; tags?: string[]; status?: Todo['status'] }) =>
      updateTodo(todo.id, {
        ...(patch.priority ? { priority: toWirePriority(patch.priority) } : {}),
        ...('due_date' in patch ? { due_date: patch.due_date } : {}),
        ...(patch.tags ? { tags: patch.tags } : {}),
        ...(patch.status ? { status: patch.status } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['todos'] });
      qc.invalidateQueries({ queryKey: ['activity'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
    },
  });

  const renameMut = useMutation({
    mutationFn: (content: string) => updateTodo(todo.id, { content }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['todos'] });
      qc.invalidateQueries({ queryKey: ['todo-comments', todo.id] });
      qc.invalidateQueries({ queryKey: ['activity'] });
    },
  });

  const addSubtaskMut = useMutation({
    mutationFn: (content: string) =>
      apiCreateTodo({ content, parent_id: todo.id, project_id: todo.project_id ?? null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['todos'] });
      qc.invalidateQueries({ queryKey: ['todos', 'children', todo.id] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['activity'] });
      setSubtaskDraft('');
    },
  });

  const toggleSubtaskMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Todo['status'] }) =>
      updateTodo(id, { status }),
    onSuccess: () => {
      // Invalidate broadly: the toggle can cascade (parent → done → all
      // descendants), and we want every consumer (drawer subtasks,
      // column, activity feed, stats) to refresh.
      qc.invalidateQueries({ queryKey: ['todos'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['activity'] });
    },
  });

  const submitComment = () => {
    const c = commentDraft.trim();
    if (!c || addCommentMut.isPending) return;
    addCommentMut.mutate(c);
  };

  const submitSubtask = () => {
    const c = subtaskDraft.trim();
    if (!c || addSubtaskMut.isPending) return;
    addSubtaskMut.mutate(c);
  };

  const setPriorityNow = (p: PriorityVal) => {
    if (p === priority) return;
    setPriority(p);
    updateMut.mutate({ priority: p });
  };

  const setStatusNow = (s: Todo['status']) => {
    if (s === status) return;
    setStatus(s);
    updateMut.mutate({ status: s });
  };

  // Tag editing — same auto-save pattern as priority / due. TagInput emits
  // the full next list on every add/remove; we persist it immediately (no
  // merge endpoint exists — the wire contract replaces the whole list).
  const onTagsChange = (next: string[]) => {
    setTags(next);
    updateMut.mutate({ tags: next });
  };

  // Save closes the drawer after pending edits. Priority + due fire
  // optimistically on chip / picker-Done click; this button is the
  // user's "I'm done here" gesture.
  // The drawer-level drafts (new comment, new subtask) are the only
  // pieces of unsaved input that closing would discard — priority and
  // due-date save on every chip / picker change, so they're never
  // mid-flight. If either draft has text, prompt before dismissing.
  const hasUnsavedInput =
    commentDraft.trim().length > 0 || subtaskDraft.trim().length > 0;
  const closePending = updateMut.isPending || addCommentMut.isPending || addSubtaskMut.isPending;
  const tryClose = useDirtyCloseGuard(hasUnsavedInput, onClose, closePending);

  const comments = commentsQ.data ?? [];
  const subtasks = subtasksQ.data ?? [];
  const { depth: ownDepth } = useTodoDepth(todo);
  // We can only add a subtask if doing so wouldn't push the new child
  // past MAX_TODO_DEPTH. New child sits at ownDepth + 1.
  const canAddSubtask = ownDepth + 1 <= MAX_TODO_DEPTH;

  return (
    <Drawer
      title={
        <EditableTitle
          value={title}
          pending={renameMut.isPending}
          onSave={(next) => {
            setTitle(next);
            renameMut.mutate(next);
          }}
        />
      }
      // No footer: every field auto-saves on change (priority/status/due/
      // tags/title) and subtasks/comments commit on their own controls, so
      // there's nothing to "save". The X (tryClose) handles dismissal and
      // guards unsaved comment/subtask drafts — matching the Note/Doc readers.
      onClose={tryClose}
    >
      {onBack ? <ReaderBackButton onClick={onBack} /> : null}
      <div className="row-flex gap-2" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        <Priority p={priority} />
        <span className="todo-status-pill">{status.replace('_', ' ')}</span>
        {/* Tags are a root-only concept — subtasks never show them. */}
        {isRoot && tags.map(t => (
          <Tag key={t}>{t}</Tag>
        ))}
      </div>
      <div className="meta-grid">
        <span className="subtle">priority</span>
        <div className="row-flex gap-1">
          {(['p1', 'p2', 'p3'] as const).map((p) => (
            <button
              key={p}
              className={cls('filter-chip', priority === p && 'active')}
              onClick={() => setPriorityNow(p)}
              disabled={updateMut.isPending}
            >
              {p.toUpperCase()}
            </button>
          ))}
        </div>
        <span className="subtle">status</span>
        <div className="row-flex gap-1" style={{ flexWrap: 'wrap' }}>
          {STATUS_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              className={cls('filter-chip', status === value && 'active')}
              onClick={() => setStatusNow(value)}
              disabled={updateMut.isPending}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="subtle">due</span>
        <DateTimePicker
          value={dueIso}
          onChange={(iso) => {
            setDueIso(iso);
            updateMut.mutate({ due_date: iso });
          }}
          disabled={updateMut.isPending}
        />
        {/* Tags are root-only: a subtask inherits its grouping from the
            parent, so the editor is hidden entirely for subtasks. */}
        {isRoot ? (
          <>
            <span className="subtle">tags</span>
            <div className="row-flex gap-1" style={{ flexWrap: 'wrap' }}>
              <TagInput value={tags} onChange={onTagsChange} suggestions={tagSuggestions} />
            </div>
          </>
        ) : null}
        <span className="subtle">created</span>
        <span>{fmtRel(todo.created_at)}</span>
        <span className="subtle">project</span>
        <span>{todo.project_id ?? 'Inbox'}</span>
        <span className="subtle">parent</span>
        <span>
          {todo.parent_id ? (
            <EntityLink
              kind="todo"
              // Navigate up: close this drawer, then dispatch detail
              // for the parent. App reopens the drawer one frame
              // later — same pattern as the subtask click below.
              onClick={onAction && parentQ.data ? () => {
                onClose();
                onAction({ kind: 'todo-detail', payload: toUiTodo(parentQ.data!) });
              } : undefined}
            >
              {parentQ.data?.content ?? (parentQ.isLoading ? '…' : todo.parent_id)}
            </EntityLink>
          ) : '—'}
        </span>
      </div>
      {updateMut.error ? (
        <div className="page-subtle" style={{ color: 'var(--danger)', marginBottom: 12 }}>
          {updateMut.error instanceof Error ? updateMut.error.message : String(updateMut.error)}
        </div>
      ) : null}

      <div className="divider" />
      <label className="field-label">
        Subtasks · {subtasksQ.isLoading ? '…' : subtasks.length}
        {addSubtaskMut.error ? (
          <span style={{ color: 'var(--danger)', marginLeft: 8 }}>
            {addSubtaskMut.error instanceof Error ? addSubtaskMut.error.message : String(addSubtaskMut.error)}
          </span>
        ) : null}
      </label>
      {subtasksQ.isLoading ? (
        <div className="page-subtle">Loading subtasks…</div>
      ) : subtasks.length === 0 ? (
        <div className="page-subtle">No subtasks yet.</div>
      ) : (
        // Reuse TodoRow so subtasks render with the same conventions as
        // everywhere else (strikethrough on done, comment badges, etc.).
        // No drag handles here — this is just the subtask list, not the
        // hierarchy view.
        <div className="todo-subtask-list">
          {subtasks.map((s) => {
            const ui = toUiTodo(s);
            // Lightweight inline row: a checkbox + title (clickable to
            // navigate), no chevron / depth indent / DnD. The parent
            // drawer is the context, so we don't need TodoRow's full
            // chrome — keep it visually tight.
            const done = s.status === 'done';
            return (
              <div
                key={s.id}
                className={cls('todo-subtask-row', done && 'done')}
                role={onAction ? 'button' : undefined}
                tabIndex={onAction ? 0 : undefined}
                onClick={() => {
                  if (!onAction) return;
                  onClose();
                  onAction({ kind: 'todo-detail', payload: ui });
                }}
                onKeyDown={onAction ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onClose();
                    onAction({ kind: 'todo-detail', payload: ui });
                  }
                } : undefined}
              >
                <Checkbox
                  checked={done}
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    toggleSubtaskMut.mutate({
                      id: s.id,
                      status: done ? 'not_started' : 'done',
                    });
                  }}
                />
                <span className="todo-subtask-title">
                  {s.content}
                  {s.subtask_count && s.subtask_count > 0 ? (
                    <span
                      className="todo-subtask-childcount"
                      title={`${s.subtask_count} subtask${s.subtask_count === 1 ? '' : 's'}`}
                    >
                      ({s.subtask_count})
                    </span>
                  ) : null}
                </span>
                {s.priority ? <Priority p={ui.priority} /> : null}
              </div>
            );
          })}
        </div>
      )}
      {canAddSubtask ? (
        <div className="todo-input-row" style={{ marginTop: 8 }}>
          <div className="field">
            <Icons.Plus size={13} />
            <input
              placeholder="Add a subtask…"
              value={subtaskDraft}
              onChange={(e) => setSubtaskDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitSubtask()}
              disabled={addSubtaskMut.isPending}
            />
          </div>
          <button
            className="btn btn-primary btn-icon"
            onClick={submitSubtask}
            disabled={!subtaskDraft.trim() || addSubtaskMut.isPending}
            aria-label="Add subtask"
          >
            <Icons.Plus />
          </button>
        </div>
      ) : (
        <div className="todo-subtask-cap-notice" style={{ marginTop: 8 }}>
          {`Max nesting reached (${MAX_TODO_DEPTH + 1} levels). Split this task or add a sibling instead of going deeper.`}
        </div>
      )}

      <div className="divider" />
      <label className="field-label">
        Comments · {commentsQ.isLoading ? '…' : comments.length}
        {addCommentMut.error ? (
          <span style={{ color: 'var(--danger)', marginLeft: 8 }}>
            {addCommentMut.error instanceof Error ? addCommentMut.error.message : String(addCommentMut.error)}
          </span>
        ) : null}
      </label>
      {commentsQ.isLoading ? (
        <div className="page-subtle">Loading comments…</div>
      ) : comments.length === 0 ? (
        <div className="page-subtle">No comments yet.</div>
      ) : (
        comments.map(c => (
          <CommentRow key={c.id} todoId={todo.id} comment={c} />
        ))
      )}
      <div className="todo-input-row" style={{ marginTop: 8 }}>
        <div className="field">
          <Icons.Chat size={13} />
          <input
            placeholder="Add a comment…"
            value={commentDraft}
            onChange={(e) => setCommentDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitComment()}
            disabled={addCommentMut.isPending}
          />
        </div>
        <button
          className="btn btn-primary btn-icon"
          onClick={submitComment}
          disabled={!commentDraft.trim() || addCommentMut.isPending}
          aria-label="Send comment"
        >
          <Icons.Send />
        </button>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// EditableTitle — click-to-edit affordance for the drawer's title slot.
// View mode shows the title styled like the existing drawer header
// label, with a subtle hover state hinting it's interactive. Click (or
// Enter / Space when focused) switches to an input; Enter or blur saves
// the trimmed value, Escape reverts. Empty saves are rejected so the
// user can't accidentally blank the title.
// ---------------------------------------------------------------------------

interface EditableTitleProps {
  value: string;
  pending: boolean;
  onSave: (next: string) => void;
}

function EditableTitle({ value, pending, onSave }: EditableTitleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const begin = () => {
    setDraft(value);
    setEditing(true);
  };
  const commit = () => {
    const next = draft.trim();
    if (!next || next === value) {
      setEditing(false);
      return;
    }
    onSave(next);
    setEditing(false);
  };
  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        className="todo-title-edit-input"
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            // Drawer attaches its own document-level Escape listener
            // to close itself. Stop propagation so cancelling the title
            // edit doesn't dismiss the whole drawer.
            e.preventDefault();
            e.stopPropagation();
            cancel();
          }
        }}
        disabled={pending}
      />
    );
  }
  return (
    <span
      className="todo-title-edit-view"
      role="button"
      tabIndex={0}
      title="Click to rename"
      onClick={begin}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          begin();
        }
      }}
    >
      {value}
    </span>
  );
}

// ---------------------------------------------------------------------------
// CommentRow — single comment with view/edit/delete affordances. Keeps
// its own per-row state (mode + draft) so editing one doesn't blow
// away another's draft. Mutations invalidate the parent query so the
// `updated_at` timestamp on the row refreshes after a save.
// ---------------------------------------------------------------------------

interface CommentRowProps {
  todoId: string;
  comment: TodoComment;
}

function CommentRow({ todoId, comment }: CommentRowProps) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [draft, setDraft] = useState(comment.content);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['todo-comments', todoId] });
    qc.invalidateQueries({ queryKey: ['activity'] });
  };

  const updateMut = useMutation({
    mutationFn: (content: string) => updateComment(todoId, comment.id, content),
    onSuccess: () => {
      invalidate();
      setMode('view');
    },
  });
  const deleteMut = useMutation({
    mutationFn: () => deleteComment(todoId, comment.id),
    onSuccess: invalidate,
  });

  const startEdit = () => {
    setDraft(comment.content);
    setMode('edit');
  };
  const cancelEdit = () => {
    setDraft(comment.content);
    setMode('view');
  };
  const saveEdit = () => {
    const c = draft.trim();
    if (!c || c === comment.content || updateMut.isPending) return;
    updateMut.mutate(c);
  };
  const onDelete = async () => {
    if (deleteMut.isPending) return;
    const ok = await confirm({
      title: 'Delete this comment?',
      body: 'This can’t be undone.',
      destructive: true,
      confirmLabel: 'Delete',
    });
    if (ok) deleteMut.mutate();
  };

  // Hide the "Updated …" line when create == update (within a second's
  // tolerance — Postgres stamps both columns to now() on insert and the
  // values can disagree by microseconds, which would surface a useless
  // "Updated 0s ago" line on every freshly-created row).
  const wasEdited =
    Math.abs(new Date(comment.updated_at).getTime() - new Date(comment.created_at).getTime()) > 1000;

  return (
    <div className={cls('todo-comment', mode === 'edit' && 'editing')}>
      <div className="meta">
        <b>pablo</b> · {fmtRel(comment.created_at)}
        {wasEdited ? (
          <span className="todo-comment-updated" title={new Date(comment.updated_at).toLocaleString()}>
            · Updated {fmtRel(comment.updated_at)}
          </span>
        ) : null}
        {mode === 'view' ? (
          <span className="todo-comment-actions">
            <button
              type="button"
              className="todo-comment-action"
              onClick={startEdit}
              aria-label="Edit comment"
              title="Edit"
            >
              <Icons.Pencil size={12} />
            </button>
            <button
              type="button"
              className="todo-comment-action todo-comment-action-danger"
              onClick={onDelete}
              disabled={deleteMut.isPending}
              aria-label="Delete comment"
              title="Delete"
            >
              <Icons.Trash size={12} />
            </button>
          </span>
        ) : null}
      </div>
      {mode === 'view' ? (
        <div className="todo-comment-body">{comment.content}</div>
      ) : (
        <div className="todo-comment-edit">
          <textarea
            className="todo-comment-edit-input"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Cmd/Ctrl+Enter saves; plain Enter inserts newline so
              // multi-line edits don't fight the keyboard.
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                saveEdit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelEdit();
              }
            }}
          />
          <div className="todo-comment-edit-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={cancelEdit}
              disabled={updateMut.isPending}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={saveEdit}
              disabled={!draft.trim() || draft.trim() === comment.content || updateMut.isPending}
            >
              Save
            </button>
          </div>
          {updateMut.error ? (
            <div className="page-subtle" style={{ color: 'var(--danger)', marginTop: 4 }}>
              {updateMut.error instanceof Error ? updateMut.error.message : String(updateMut.error)}
            </div>
          ) : null}
        </div>
      )}
      {deleteMut.error ? (
        <div className="page-subtle" style={{ color: 'var(--danger)' }}>
          Failed to delete: {deleteMut.error instanceof Error ? deleteMut.error.message : String(deleteMut.error)}
        </div>
      ) : null}
    </div>
  );
}

