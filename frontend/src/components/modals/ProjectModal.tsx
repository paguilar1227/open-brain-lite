import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../primitives';
import { createProject, updateProject } from '../../lib/api';
import { useDirtyCloseGuard } from '../../lib/useDirtyCloseGuard';

// Minimal shape the form needs to pre-fill an edit (the UI Project satisfies it).
interface EditTarget {
  id: string;
  name: string;
  desc: string;
}

// Create OR edit a project — same form. Pass `project` to edit (pre-filled,
// PUT); omit it to create (POST).
export function ProjectModal({ project, onClose }: { project?: EditTarget | null; onClose: () => void }) {
  const editing = !!project;
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.desc ?? '');
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const mut = useMutation({
    mutationFn: () =>
      editing
        ? updateProject(project!.id, { name: name.trim(), description: description.trim() })
        : createProject({ name: name.trim(), description: description.trim() || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['project-counts'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      if (editing) qc.invalidateQueries({ queryKey: ['project', project!.id] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });

  const submit = () => {
    setError(null);
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    mut.mutate();
  };

  // Dirty = changed from the initial values, so an untouched edit closes freely.
  const isDirty =
    name.trim() !== (project?.name ?? '').trim() ||
    description.trim() !== (project?.desc ?? '').trim();
  const tryClose = useDirtyCloseGuard(isDirty, onClose, mut.isPending);

  return (
    <Modal
      title={editing ? 'Edit project' : 'New project'}
      onClose={tryClose}
      footer={
        <>
          <button className="btn" onClick={tryClose} disabled={mut.isPending}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={mut.isPending || !name.trim()}>
            {mut.isPending ? (editing ? 'Saving…' : 'Creating…') : editing ? 'Save' : 'Create'}
          </button>
        </>
      }
    >
      <label className="field-label">Name</label>
      <input
        className="input"
        placeholder="e.g. Mobile Companion"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <div style={{ height: 12 }} />
      <label className="field-label">Description</label>
      <textarea
        className="input"
        rows={3}
        placeholder="One line about what this project is for…"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      {error ? (
        <div className="page-subtle" style={{ color: 'var(--danger)', marginTop: 8 }}>
          {error}
        </div>
      ) : null}
    </Modal>
  );
}
