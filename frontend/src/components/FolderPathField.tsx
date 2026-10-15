import { useEffect, useState } from 'react';
import { Icons } from './Icons';
import { normalizeFolderPath } from '../lib/folders';
import { cls } from '../lib/util';

interface Props {
  /** Current folder path, or null when unfiled. */
  value: string | null;
  /** Commit a new normalized path, or null to unfile. The parent decides what
   *  this does — persist immediately (Notes view) or stage until a Save
   *  (note editor modal). */
  onChange: (path: string | null) => void;
  /** Show a "saving…" hint — for callers that persist on every change. */
  pending?: boolean;
  /** Drop the inline edit state when this changes (e.g. switching notes). */
  resetKey?: string | null;
  placeholder?: string;
  className?: string;
}

/**
 * Click-to-edit folder-path field. A note belongs to exactly ONE folder, so
 * this shows that single path as a chip you click to edit (Enter / click-away
 * commits, Escape cancels) or a "+ Folder" button when unfiled. Controlled:
 * the parent owns `value` and `onChange`. Reused by the Notes view (bottom
 * bar, commits immediately) and the note editor modal (staged until Save).
 */
export function FolderPathField({
  value, onChange, pending, resetKey, placeholder = 'area/topic/sub', className,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  // Reset edit state when the underlying record changes out from under us.
  useEffect(() => { setEditing(false); setDraft(''); }, [resetKey]);

  const startEdit = () => { setDraft(value ?? ''); setEditing(true); };
  const commit = () => {
    setEditing(false);
    const next = normalizeFolderPath(draft) || null;
    if (next !== value) onChange(next);
  };

  return (
    <div className={cls('folder-field', className)} aria-label="Folder for this note">
      <span className="folder-field-ic"><Icons.Layers size={12} /></span>
      {editing ? (
        <input
          className="folder-field-input"
          autoFocus
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { setEditing(false); setDraft(''); }
          }}
          onBlur={commit}
        />
      ) : value ? (
        <button className="folder-field-chip" onClick={startEdit} title="Click to edit folder">
          {value}
        </button>
      ) : (
        <button className="btn btn-ghost btn-sm folder-field-add" disabled={pending} onClick={startEdit}>
          <Icons.Plus size={11} /> Folder
        </button>
      )}
      {pending ? <span className="page-subtle">saving…</span> : null}
    </div>
  );
}
