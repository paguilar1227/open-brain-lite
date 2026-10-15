import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icons } from './Icons';

interface Props {
  /** Accessible label / tooltip for the ⋯ trigger button. */
  title?: string;
  /** className for the trigger button — defaults to a plain `btn`. */
  triggerClassName?: string;
  /**
   * Menu items, rendered inside `role="menu"`. Receives `close` so an item can
   * dismiss the menu after firing its action. Use `<button role="menuitem">`
   * for items and `<div className="overflow-menu-sep" />` for separators;
   * add `className="danger"` to a destructive item.
   */
  children: (close: () => void) => ReactNode;
}

/**
 * Shared ⋯ overflow menu: a trigger button that toggles an anchored dropdown,
 * closing on outside-click or Escape. Used by the project header and document
 * cards so there's a single menu implementation, not one per surface.
 */
export function OverflowMenu({ title = 'More actions', triggerClassName = 'btn', children }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="overflow-menu-wrap" ref={ref}>
      <button
        className={triggerClassName}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icons.More />
      </button>
      {open ? (
        <div className="overflow-menu" role="menu">
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}
