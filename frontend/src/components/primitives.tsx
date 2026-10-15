import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Icons } from './Icons';
import { cls } from '../lib/util';
import type { ProcessingStatus, TodoPriority } from '../types';

export function Tag({
  children,
  kind,
  removable,
  onRemove,
  style,
}: {
  children: ReactNode;
  kind?: 'doc' | 'note' | 'todo';
  removable?: boolean;
  onRemove?: () => void;
  style?: CSSProperties;
}) {
  return (
    <span className={cls('tag', kind && `kind-${kind}`, removable && 'removable')} style={style}>
      {kind ? null : <span style={{ opacity: 0.6 }}>#</span>}
      {children}
      {removable ? (
        <span className="x" onClick={onRemove}>
          <Icons.X size={9} />
        </span>
      ) : null}
    </span>
  );
}

export function EntityLink({
  kind,
  children,
  onClick,
}: {
  kind: string;
  children: ReactNode;
  /** When provided, the link renders as a button and acts as a real
   *  navigation affordance (Enter / Space + click). Without onClick
   *  it's a plain styled span — used as a non-interactive label. */
  onClick?: () => void;
}) {
  if (onClick) {
    return (
      <button type="button" className="entity-link entity-link-button" onClick={onClick}>
        {kind}: {children}
      </button>
    );
  }
  return (
    <span className="entity-link">
      {kind}: {children}
    </span>
  );
}

export function Status({ status, error }: { status: ProcessingStatus; error?: string }) {
  const label = ({ pending: 'processing', ready: 'indexed', failed: 'failed' } as const)[status];
  return (
    <span className={cls('status', status)} title={error || undefined}>
      <span className="dot" />
      {label}
    </span>
  );
}

export function Priority({ p }: { p?: TodoPriority }) {
  if (!p) return null;
  return <span className={cls('priority', p)}>{p.toUpperCase()}</span>;
}

export function Checkbox({
  checked,
  partial,
  onClick,
}: {
  checked?: boolean;
  partial?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <span className={cls('checkbox', checked && 'checked', partial && !checked && 'partial')} onClick={onClick}>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
        {partial && !checked ? <path d="M4 8h8" /> : <path d="m3 8 3.5 3.5L13 5" />}
      </svg>
    </span>
  );
}

export function BulkCheckbox({
  checked,
  onClick,
}: {
  checked?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <span className={cls('bulk-checkbox', checked && 'checked')} onClick={onClick}>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="m3 8 3.5 3.5L13 5" />
      </svg>
    </span>
  );
}

export interface TabItem {
  id: string;
  label: string;
  icon?: ReactNode;
  count?: number;
}

export function Tabs({
  value,
  onChange,
  items,
}: {
  value: string;
  onChange: (id: string) => void;
  items: TabItem[];
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map(it => (
        <span
          key={it.id}
          className={cls('tab', value === it.id && 'active')}
          onClick={() => onChange(it.id)}
          role="tab"
        >
          {it.icon ? <span className="ic">{it.icon}</span> : null}
          {it.label}
          {it.count != null ? <span className="ct">{it.count}</span> : null}
        </span>
      ))}
    </div>
  );
}

export function FilterChip({
  active,
  children,
  onClick,
  count,
}: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
  count?: number;
}) {
  return (
    <span className={cls('filter-chip', active && 'active')} onClick={onClick}>
      {children}
      {count != null ? (
        <span className="filter-chip-count">{count}</span>
      ) : null}
    </span>
  );
}

export function Modal({
  title,
  children,
  onClose,
  footer,
  size,
}: {
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  size?: 'lg';
}) {
  // Capture phase + stopImmediatePropagation so that when a modal is
  // open over a Drawer (e.g. opening NoteEditorModal from inside a
  // NoteReaderBody embedded in NoteListDrawer), pressing Escape closes
  // ONLY the modal and not the surrounding drawer. Without this, both
  // listeners fire — drawer-first by registration order — and the whole
  // surface collapses out from under the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const downOnBackdropRef = useRef(false);
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        downOnBackdropRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (downOnBackdropRef.current && e.target === e.currentTarget) onClose();
        downOnBackdropRef.current = false;
      }}
    >
      <div className={cls('modal', size === 'lg' && 'lg')} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <Icons.X />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Drawer({
  title,
  children,
  onClose,
  footer,
}: {
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
}) {
  // The drawer ships in two desktop layouts: the default right-rail
  // (compact, lives next to the page) and an expanded center-stage
  // variant for when the user wants more room. Mobile ignores this —
  // the drawer is always full-screen there. State is local because
  // expansion is a per-instance UI affordance, not session-wide.
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  // Same mousedown/click-target check as Modal: only dismiss when both
  // ends of the press landed on the backdrop, so a text-selection drag
  // that releases outside the panel doesn't close the drawer.
  const downOnBackdropRef = useRef(false);
  return (
    <div
      className="drawer-overlay"
      onMouseDown={(e) => {
        downOnBackdropRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (downOnBackdropRef.current && e.target === e.currentTarget) onClose();
        downOnBackdropRef.current = false;
      }}
    >
      <div className={cls('drawer', expanded && 'drawer-expanded')} role="dialog" aria-modal="true">
        <div className="drawer-head">
          <span className="ti">{title}</span>
          <button
            className="btn btn-ghost btn-icon drawer-expand"
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? 'Collapse' : 'Expand'}
            aria-label={expanded ? 'Collapse drawer' : 'Expand drawer'}
          >
            {expanded ? <Icons.Compact /> : <Icons.Expand />}
          </button>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <Icons.X />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Empty({
  icon,
  title,
  sub,
  action,
}: {
  icon?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="ic-empty">{icon}</div>
      <div className="ti">{title}</div>
      {sub ? <div className="sb">{sub}</div> : null}
      {action ? <div style={{ marginTop: 14 }}>{action}</div> : null}
    </div>
  );
}

export function Spark({ data, w = 60, h = 18 }: { data: number[]; w?: number; h?: number }) {
  const max = Math.max(...data, 1);
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => `${i * step},${h - (v / max) * (h - 2) - 1}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Re-export Fragment for callers that need it
export { Fragment };
