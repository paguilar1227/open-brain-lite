// Compact note row, mirrors TodoRow's role: shared between the Home
// personal-notes column and the personal notes drawer.

import { fmtRel } from '../lib/util';
import { Icons } from './Icons';
import { RowTags } from './RowTags';

interface Props {
  // Structural minimum the row renders — a full Note satisfies it, and a
  // search hit (which carries no timestamps) can populate title + sub.
  note: { title: string; created_at?: string; updated_at?: string };
  onClick?: () => void;
  /** Override the sub-line (e.g. a search-match snippet). When set, the
   *  right-side timestamp is omitted since hits carry no edited time. */
  sub?: string;
  /** The note's folder path. Rendered as a chip distinct from tags (folder
   *  icon + mono path) so the two concepts read apart at a glance. */
  folder?: string | null;
  /** Tags to render as chips under the sub-line. Lets the drawer show
   *  provenance so a #tag filter's completeness is obvious. */
  tags?: string[];
  /** When true, a pin glyph is shown in the row's meta cell so pinned
   *  notes are recognizable at a glance in the list. */
  pinned?: boolean;
}

export function NoteRow({ note, onClick, sub, folder, tags, pinned }: Props) {
  const at = note.updated_at ?? note.created_at;
  return (
    <div
      className="prow prow-note"
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
      <div>
        <div className="ti" title={note.title}>{note.title}</div>
        <div className="ti-sub">{sub ?? (at ? `edited ${fmtRel(at)}` : '')}</div>
        <RowTags
          leading={
            folder ? (
              <span className="prow-folder" title={`Folder: ${folder}`}>
                <Icons.Layers size={10} />
                {folder}
              </span>
            ) : null
          }
          tags={tags ?? []}
        />
      </div>
      {sub == null && (at || pinned) ? (
        <div className="prow-note-meta">
          {pinned ? (
            <span className="prow-pin" title="Pinned" aria-label="Pinned">
              <Icons.Pin size={11} />
            </span>
          ) : null}
          {at ? <span className="ats">{fmtRel(at)}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
