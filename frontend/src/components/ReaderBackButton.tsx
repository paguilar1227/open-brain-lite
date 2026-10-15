import { Icons } from './Icons';

// Shared "Back to list" affordance for reader/detail surfaces embedded
// inside a list drawer. Used by DocReaderBody, NoteReaderBody, and the
// todo detail surface. Single source so spacing, icon, and copy don't
// drift across the three.
export function ReaderBackButton({ onClick, label = 'Back to list' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className="btn btn-ghost btn-sm reader-back" onClick={onClick}>
      <Icons.ChevronLeft size={12} /> {label}
    </button>
  );
}
