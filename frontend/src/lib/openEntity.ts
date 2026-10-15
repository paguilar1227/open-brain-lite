// Resolve an entity reference into the right modal: doc reader for
// documents, editor for notes, detail drawer for todos. Callers
// (activity rows, search hits) only carry entity_kind + entity_id —
// modals need the full entity, so we fetch it on click.

import { getContent, getTodo } from './api';
import { toUiDocument, toUiNote, toUiTodo } from './view';
import type { ActionDispatch, ActivityEntityKind } from '../types';

export interface EntityRef {
  entity_kind: ActivityEntityKind;
  entity_id: string;
}

export async function openEntity(ref: EntityRef, onAction: ActionDispatch): Promise<void> {
  try {
    if (ref.entity_kind === 'todo') {
      const t = await getTodo(ref.entity_id);
      onAction({ kind: 'todo-detail', payload: toUiTodo(t) });
      return;
    }
    const c = await getContent(ref.entity_id);
    if (ref.entity_kind === 'document') {
      onAction({ kind: 'doc-read', payload: toUiDocument(c) });
    } else {
      onAction({ kind: 'note-edit', payload: toUiNote(c), projectId: c.project_ids[0] });
    }
  } catch (err) {
    // Soft-deleted or genuinely missing — log and let the click be a
    // no-op rather than crashing the page. UX could grow into a toast
    // later, but silence is fine for now.
    console.error('Failed to open entity target', ref, err);
  }
}
