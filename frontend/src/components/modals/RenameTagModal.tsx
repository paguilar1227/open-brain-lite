// Rename (or merge) a tag corpus-wide. The user types the new name
// into a single input — no "type the old name to confirm" gymnastics,
// because rename isn't destructive in the same way delete is. If the
// new name already exists, the backend merges; the modal calls that
// out before the user commits.
//
// Empty / unchanged input keeps Rename disabled. The mutation
// invalidates tag queries on success so /tags and the Home Top tags
// strip refetch with the renamed name in place.

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../primitives';
import { listTags, renameTag } from '../../lib/api';
import { useDirtyCloseGuard } from '../../lib/useDirtyCloseGuard';
import type { TagRow } from '../../types';

interface Props {
  tag: TagRow;
  onClose: () => void;
}

export function RenameTagModal({ tag, onClose }: Props) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(tag.name);
  const [error, setError] = useState<string | null>(null);

  // Look up the full tag set so we can warn about merge collisions.
  // The query is cheap and almost certainly cached by the catalog
  // page that opened this modal.
  const tagsQ = useQuery({ queryKey: ['tags', 'rename-modal'], queryFn: () => listTags({ scope: 'all' }) });
  const allTags = tagsQ.data ?? [];
  const existingNames = useMemo(
    () => new Set(allTags.map((t) => t.name).filter((n) => n !== tag.name)),
    [allTags, tag.name],
  );

  const trimmed = draft.trim().toLowerCase();
  const isUnchanged = trimmed === tag.name;
  const isEmpty = trimmed.length === 0;
  const willMerge = trimmed.length > 0 && existingNames.has(trimmed);
  const mergeTarget = willMerge ? allTags.find((t) => t.name === trimmed) : null;
  const canSubmit = !isEmpty && !isUnchanged;

  const mut = useMutation({
    mutationFn: () => renameTag(tag.name, trimmed),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tags'] });
      qc.invalidateQueries({ queryKey: ['tag-detail'] });
      qc.invalidateQueries({ queryKey: ['content'] });
      qc.invalidateQueries({ queryKey: ['todos'] });
      qc.invalidateQueries({ queryKey: ['activity'] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });

  const submit = () => {
    setError(null);
    if (!canSubmit) return;
    mut.mutate();
  };

  const isDirty = !isUnchanged;
  const tryClose = useDirtyCloseGuard(isDirty, onClose, mut.isPending);

  return (
    <Modal
      title="Rename tag"
      onClose={tryClose}
      footer={
        <>
          <button className="btn" onClick={tryClose} disabled={mut.isPending}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={submit}
            disabled={!canSubmit || mut.isPending}
          >
            {mut.isPending ? 'Renaming…' : willMerge ? 'Merge' : 'Rename'}
          </button>
        </>
      }
    >
      <p className="page-subtle" style={{ marginBottom: 12 }}>
        Renaming <strong>#{tag.name}</strong> will update {tag.total}
        {tag.total === 1 ? ' entity' : ' entities'} that carry it. This can't be undone.
      </p>

      <label className="field-label" htmlFor="rename-tag-input">New name</label>
      <input
        id="rename-tag-input"
        className="input"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && canSubmit && !mut.isPending) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="lowercase-kebab-case"
      />

      {isEmpty ? (
        <div className="page-subtle" style={{ marginTop: 8 }}>Name can't be empty.</div>
      ) : willMerge && mergeTarget ? (
        <div className="page-subtle" style={{ marginTop: 8 }}>
          <strong>#{trimmed}</strong> already exists with {mergeTarget.total}
          {mergeTarget.total === 1 ? ' entity' : ' entities'}. Renaming will merge into it —
          you'll end up with {tag.total + mergeTarget.total} items under <strong>#{trimmed}</strong>.
        </div>
      ) : isUnchanged ? (
        <div className="page-subtle" style={{ marginTop: 8 }}>Nothing to rename yet.</div>
      ) : null}

      {error ? (
        <div className="page-subtle" style={{ color: 'var(--danger)', marginTop: 8 }}>
          {error}
        </div>
      ) : null}
    </Modal>
  );
}
