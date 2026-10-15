import { useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal, Status } from '../primitives';
import { MarkdownEditor } from '../MarkdownEditor';
import { FolderPathField } from '../FolderPathField';
import { TagInput, type TagInputHandle } from '../TagInput';
import { createNote, editContentBody, updateContent } from '../../lib/api';
import { useTagSuggestions } from '../../lib/useTagSuggestions';
import { useDirtyCloseGuard } from '../../lib/useDirtyCloseGuard';
import { fmtRel } from '../../lib/util';
import type { Note } from '../../types';

const NEW_NOTE_BODY_PLACEHOLDER = '# New note\n\nStart writing…';
const NEW_NOTE_TITLE_PLACEHOLDER = 'Untitled note';

interface Props {
  note: Note | null;
  projectId?: string;
  /** Folder to file a NEW note into (the Notes view passes its selected
   *  folder so the new note lands where the user is browsing). Edit ignores it. */
  initialFolder?: string | null;
  onClose: () => void;
}

// Resolve the tag-suggestion scope for the note being edited. Single
// project membership → scope to that project. Empty membership →
// personal. Multi-project → fall back to global (no filter) since
// neither single-project nor personal applies.
function tagsScopeFor(note: Note | null, defaultProjectId?: string): { project_id: string } | { scope: 'personal' | 'all' } {
  const ids = note?.project_ids ?? (defaultProjectId ? [defaultProjectId] : []);
  if (ids.length === 1) return { project_id: ids[0] };
  if (ids.length === 0) return { scope: 'personal' };
  return { scope: 'all' };
}

export function NoteEditorModal({ note, projectId, initialFolder, onClose }: Props) {
  const isNew = !note;
  const [body, setBody] = useState(note?.body ?? NEW_NOTE_BODY_PLACEHOLDER);
  const [title, setTitle] = useState(note?.title ?? NEW_NOTE_TITLE_PLACEHOLDER);
  const [tags, setTags] = useState<string[]>(note?.tags ?? []);
  // Folder the note is filed under. New notes default to the folder the caller
  // is browsing (initialFolder); edits start from the note's current folder.
  const [folder, setFolder] = useState<string | null>(note?.folder ?? initialFolder ?? null);
  const [error, setError] = useState<string | null>(null);
  const tagInputRef = useRef<TagInputHandle | null>(null);
  const qc = useQueryClient();

  // Scope-aware tag suggestions for the autocomplete. Same source-of-truth
  // listTags inventory the home page uses, scoped to wherever the note lives
  // so the user sees relevant tags first.
  const tagsScope = useMemo(() => tagsScopeFor(note, projectId), [note, projectId]);
  const tagSuggestions = useTagSuggestions(tagsScope);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['content'] });
    qc.invalidateQueries({ queryKey: ['project-counts'] });
    qc.invalidateQueries({ queryKey: ['stats'] });
    qc.invalidateQueries({ queryKey: ['activity'] });
    qc.invalidateQueries({ queryKey: ['tags'] });
  };

  // Both mutations take the final tag list as an arg (not from closure)
  // so a draft committed in save() is reflected even though setTags is
  // async and the mutationFn captures the previous render's state.
  const createMut = useMutation({
    mutationFn: (finalTags: string[]) =>
      createNote({
        type: 'note',
        title: title.trim() || 'Untitled note',
        content: body,
        project_ids: projectId ? [projectId] : [],
        tags: finalTags,
        folder,
      }),
    onSuccess: () => { invalidateAll(); onClose(); },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });

  // Edit splits into two backend calls: metadata (PUT) for title/tags
  // and edit-body (async, 202 ack) when the body actually changed. We
  // gate each call on a real diff so we don't pay the re-chunk cost on
  // a tag-only tweak.
  const editMut = useMutation({
    mutationFn: async (finalTags: string[]) => {
      if (!note) return;
      const cleanTitle = title.trim() || 'Untitled note';
      const titleChanged = cleanTitle !== note.title;
      const tagsChanged = JSON.stringify(finalTags) !== JSON.stringify(note.tags ?? []);
      const folderChanged = (folder ?? null) !== (note.folder ?? null);
      const bodyChanged = body !== note.body;

      if (titleChanged || tagsChanged || folderChanged) {
        await updateContent(note.id, {
          ...(titleChanged ? { title: cleanTitle } : {}),
          ...(tagsChanged ? { tags: finalTags } : {}),
          ...(folderChanged ? { folder } : {}),
        });
      }
      if (bodyChanged) {
        await editContentBody(note.id, body);
      }
    },
    onSuccess: () => { invalidateAll(); onClose(); },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });

  const pending = createMut.isPending || editMut.isPending;

  // Dirty = user has actually edited something compared to the initial
  // state. For a new note that means stepping away from the placeholder
  // defaults; for an existing note it means any field differs from the
  // server's copy. An uncommitted tag draft is committed on blur (before
  // any close click lands), so it surfaces here through the tags diff.
  const cleanTitle = title.trim() || NEW_NOTE_TITLE_PLACEHOLDER;
  const isDirty = isNew
    ? (
        body !== NEW_NOTE_BODY_PLACEHOLDER ||
        cleanTitle !== NEW_NOTE_TITLE_PLACEHOLDER ||
        tags.length > 0 ||
        (folder ?? null) !== (initialFolder ?? null)
      )
    : (
        body !== note!.body ||
        cleanTitle !== note!.title ||
        JSON.stringify(tags) !== JSON.stringify(note!.tags ?? []) ||
        (folder ?? null) !== (note!.folder ?? null)
      );

  const tryClose = useDirtyCloseGuard(isDirty, onClose, pending);

  const save = () => {
    setError(null);
    if (!body.trim()) {
      setError('Body is required.');
      return;
    }
    // Commit any pending draft into the tag list before mutating —
    // saves users from "I typed it but forgot to press Enter" data loss.
    const finalTags = tagInputRef.current?.commitDraft() ?? tags;
    if (isNew) createMut.mutate(finalTags);
    else editMut.mutate(finalTags);
  };

  return (
    <Modal
      title={isNew ? 'New note' : 'Edit note'}
      size="lg"
      onClose={tryClose}
      footer={
        <>
          <span className="subtle modal-foot-meta">
            {isNew ? 'draft' : `last edit ${fmtRel(note!.updated_at)}`} · {body.split(/\s+/).length} words
          </span>
          <button className="btn" onClick={tryClose} disabled={pending}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <input
        className="input note-title-input"
        value={title}
        onChange={e => setTitle(e.target.value)}
      />
      <div className="row-flex gap-1" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
        <TagInput
          ref={tagInputRef}
          value={tags}
          onChange={setTags}
          suggestions={tagSuggestions}
        />
        <span style={{ marginLeft: 'auto' }}>
          <Status status={note?.processing_status || 'ready'} />
        </span>
      </div>
      <div className="note-editor-folder" style={{ marginBottom: 12 }}>
        <FolderPathField
          value={folder}
          onChange={setFolder}
          resetKey={note?.id ?? 'new'}
        />
      </div>
      <div
        className="note-editor-pane"
        style={{
          minHeight: 360,
          padding: '6px 4px',
          background: 'var(--glass-bg-soft)',
          border: '0.5px solid var(--hairline)',
          borderRadius: 9,
          overflow: 'hidden',
        }}
      >
        <MarkdownEditor value={body} onChange={setBody} autoFocus />
      </div>
      {error ? (
        <div className="page-subtle" style={{ color: 'var(--danger)', marginTop: 8 }}>
          {error}
        </div>
      ) : null}
    </Modal>
  );
}
