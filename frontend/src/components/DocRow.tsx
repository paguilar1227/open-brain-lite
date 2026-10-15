// Compact document row, mirrors NoteRow / TodoRow: shared between the Home
// personal-documents column and the personal documents drawer.
//
// Type icon matches the project DocumentsTab so users see the same glyph
// for the same kind of doc whether browsing personal or project-scoped.

import { Icons } from './Icons';
import { fmtRel } from '../lib/util';
import type { DocumentItem } from '../types';

interface Props {
  // Structural minimum — a full DocumentItem satisfies it, and a search
  // hit (title only, no type/mime/timestamp) can populate title + sub.
  doc: Pick<DocumentItem, 'title'> & Partial<Pick<DocumentItem, 'type' | 'mime' | 'size' | 'created_at'>>;
  onClick?: () => void;
  /** Override the sub-line (e.g. a search-match snippet). When set, the
   *  right-side timestamp is omitted since hits carry no created time. */
  sub?: string;
}

function TypeIcon({ type }: { type?: DocumentItem['type'] }) {
  if (type === 'url') return <Icons.Globe />;
  if (type && type !== 'binary') return <Icons.Note />;
  return <Icons.Doc />;
}

export function DocRow({ doc, onClick, sub }: Props) {
  return (
    <div
      className="prow prow-doc"
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      } : undefined}
    >
      <span className="prow-doc-icon"><TypeIcon type={doc.type} /></span>
      <div>
        <div className="ti" title={doc.title}>{doc.title}</div>
        <div className="ti-sub">
          {sub ?? `${doc.mime || doc.type || ''}${doc.size ? ` · ${doc.size}` : ''}`}
        </div>
      </div>
      {sub == null && doc.created_at ? <span className="ats">{fmtRel(doc.created_at)}</span> : null}
    </div>
  );
}
