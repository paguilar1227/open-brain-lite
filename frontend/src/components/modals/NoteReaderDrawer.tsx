// Read-only note surface. Renders inside a drawer (either standalone via
// NoteReaderDrawer or embedded via NoteListDrawer's inline-detail mode).
// The "Edit" button opens the full NoteEditorModal — kept separate so the
// editor's dirty-guard and markdown editor stay contained in their own
// surface.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Icons } from '../Icons';
import { Drawer, Status, Tag } from '../primitives';
import { MarkdownPreview } from '../MarkdownPreview';
import { ProjectChips } from '../ProjectChips';
import { ReaderBackButton } from '../ReaderBackButton';
import { NoteEditorModal } from './NoteEditorModal';
import { getContent, pinContent, unpinContent } from '../../lib/api';
import { fmtRel } from '../../lib/util';
import { toUiNote } from '../../lib/view';
import { useMarkdownBlobUrl, markdownFilename } from '../../lib/useMarkdownBlobUrl';
import type { Note, Route } from '../../types';

interface BodyProps {
  note: Note;
  onClose: () => void;
  onBack?: () => void;
  onRoute?: (r: Route) => void;
}

export function NoteReaderBody({ note, onClose, onBack, onRoute }: BodyProps) {
  const qc = useQueryClient();
  // Refetch full content so any edits from the modal are reflected here.
  // The list view ships a body too, but it's the snapshot from initial
  // list load; this is the authoritative copy.
  const fullQ = useQuery({
    queryKey: ['content', note.id, 'full'],
    queryFn: () => getContent(note.id),
  });
  const pinMut = useMutation({
    mutationFn: () => (note.pinned ? unpinContent(note.id) : pinContent(note.id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['content'] });
    },
  });

  const item = fullQ.data;
  // Prefer the freshly-fetched body. Fall back to whatever the list row
  // had so the reader renders something while the fetch is in flight.
  const body = item?.content ?? note.body ?? '';
  const hasBody = body.trim().length > 0;
  const blobUrl = useMarkdownBlobUrl(body);
  const downloadFilename = markdownFilename(note.title);

  // Editor is local state — opening it doesn't unmount the reader, so
  // the reader's scroll position survives a save. Modal close just flips
  // this back to false; React Query invalidation in NoteEditorModal
  // triggers our fullQ to refetch.
  const [editing, setEditing] = useState(false);
  // toUiNote needs a full ApiContent. fullQ has it; until it loads we
  // can't pop the editor, so the button is disabled while loading.
  const editorNote = item ? toUiNote(item) : null;

  return (
    <>
      {onBack ? <ReaderBackButton onClick={onBack} /> : null}
      <div className="row-flex gap-2 chip-row">
        <Status status={note.processing_status} />
        {/* Entity-type chip (not a user tag). `kind` drops the `#` prefix and
            applies the type-chip colour so it doesn't masquerade as a tag. */}
        <Tag kind="note">note</Tag>
        {note.tags.map((t) => (
          <Tag key={t}>{t}</Tag>
        ))}
      </div>
      <div className="meta-grid">
        <span className="subtle">created</span>
        <span>{fmtRel(note.created_at)}</span>
        <span className="subtle">updated</span>
        <span>{fmtRel(note.updated_at)}</span>
        {note.project_ids.length > 0 ? (
          <>
            <span className="subtle">projects</span>
            <ProjectChips ids={note.project_ids} onRoute={onRoute} onClose={onClose} />
          </>
        ) : null}
      </div>

      <div className="row-flex gap-2 chip-row">
        <button
          className="btn btn-sm btn-primary"
          onClick={() => setEditing(true)}
          disabled={!editorNote}
        >
          <Icons.Pencil size={12} /> Edit
        </button>
        {blobUrl ? (
          <a className="btn btn-sm" href={blobUrl} download={downloadFilename}>
            <Icons.Download size={12} /> Download
          </a>
        ) : null}
        {/* "Open" launches the raw uploaded file (Azure blob) in a new tab —
            distinct from Download's synthesized .md export. A text note has
            no blob (item.blob_url is null), so there's nothing to open: keep
            the affordance for layout consistency but disable it. */}
        {item?.blob_url ? (
          <a className="btn btn-sm" href={item.blob_url} target="_blank" rel="noopener noreferrer">
            <Icons.ExternalLink size={12} /> Open
          </a>
        ) : (
          <button className="btn btn-sm" disabled title="No file to open — this note has no uploaded file">
            <Icons.ExternalLink size={12} /> Open
          </button>
        )}
        <button
          className="btn btn-sm"
          onClick={() => pinMut.mutate()}
          disabled={pinMut.isPending}
        >
          <Icons.Pin size={12} /> {note.pinned ? 'Unpin' : 'Pin'}
        </button>
      </div>

      <div className="reader-content">
        <div className="md-preview md-preview-card">
          {fullQ.isLoading && !hasBody ? (
            <div className="page-subtle">Loading content…</div>
          ) : fullQ.error ? (
            <div className="page-subtle" style={{ color: 'var(--danger)' }}>
              Failed to load content: {fullQ.error instanceof Error ? fullQ.error.message : String(fullQ.error)}
            </div>
          ) : !hasBody ? (
            <div className="page-subtle">No content yet.</div>
          ) : (
            <MarkdownPreview src={body} />
          )}
        </div>
      </div>

      {editing && editorNote ? (
        <NoteEditorModal note={editorNote} onClose={() => setEditing(false)} />
      ) : null}
    </>
  );
}

export function NoteReaderDrawer({
  note,
  onClose,
  onRoute,
}: {
  note: Note;
  onClose: () => void;
  onRoute?: (r: Route) => void;
}) {
  return (
    <Drawer title={note.title} onClose={onClose}>
      <NoteReaderBody note={note} onClose={onClose} onRoute={onRoute} />
    </Drawer>
  );
}
