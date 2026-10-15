// Debounced search input used by the personal Notes / Todos drawers
// and the project tabs. Keeps a local draft so each keystroke is
// instant, then fires onChange after `debounceMs` of quiet so the
// query refetch happens once per "thought" instead of once per char.
//
// `value` is the source of truth (drives initial draft + re-syncs if
// the caller resets externally). `onChange` is invoked with the
// trimmed string (never the partial keystroke value).

import { useEffect, useRef, useState } from 'react';
import { Icons } from './Icons';

interface Props {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  debounceMs?: number;
  ariaLabel?: string;
}

export function SearchBox({
  value,
  onChange,
  placeholder = 'Search…',
  debounceMs = 250,
  ariaLabel,
}: Props) {
  const [draft, setDraft] = useState(value);
  const lastEmittedRef = useRef(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-sync draft when the caller resets the value (e.g. on surface
  // change or external clear). Skip if the draft already matches —
  // otherwise the user's mid-type keystrokes would get stomped by an
  // identity-only update.
  useEffect(() => {
    if (value !== lastEmittedRef.current) {
      setDraft(value);
      lastEmittedRef.current = value;
    }
  }, [value]);

  // Debounce the draft → onChange. The trimmed string is what hits
  // the backend; empty string clears the filter.
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const trimmed = draft.trim();
    if (trimmed === lastEmittedRef.current.trim()) return;
    timerRef.current = setTimeout(() => {
      lastEmittedRef.current = trimmed;
      onChange(trimmed);
    }, debounceMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [draft, debounceMs, onChange]);

  const clear = () => {
    setDraft('');
    if (timerRef.current) clearTimeout(timerRef.current);
    lastEmittedRef.current = '';
    onChange('');
  };

  return (
    <div className="search-box">
      <Icons.Search size={13} />
      <input
        type="search"
        className="search-box-input"
        value={draft}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && draft) {
            e.preventDefault();
            clear();
          }
        }}
      />
      {draft ? (
        <button
          type="button"
          className="search-box-clear"
          onClick={clear}
          aria-label="Clear search"
        >
          <Icons.X size={11} />
        </button>
      ) : null}
    </div>
  );
}
