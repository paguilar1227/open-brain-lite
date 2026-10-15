import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Icons } from '../Icons';
import { Drawer, Status, Tag } from '../primitives';
import { MarkdownPreview } from '../MarkdownPreview';
import { ProjectChips } from '../ProjectChips';
import { ReaderBackButton } from '../ReaderBackButton';
import { getContent, pinContent, unpinContent } from '../../lib/api';
import { cls, fmtRel } from '../../lib/util';
import { useMarkdownBlobUrl, markdownFilename } from '../../lib/useMarkdownBlobUrl';
import type { DocumentItem, Route } from '../../types';

// Pick a preview surface from the mime type. The text-only branch covers
// markdown-as-doc rows where the body IS the document — no separate source
// media — so the existing MarkdownPreview render below is the whole story.
type PreviewMode = 'pdf' | 'image' | 'audio' | 'video' | 'text' | 'other';

function previewModeFor(mime: string, hasBlob: boolean): PreviewMode {
  if (!hasBlob) return 'text';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'other';
}

function DocPreview({
  doc,
  previewUrl,
  onExpandPdf,
}: {
  doc: DocumentItem;
  previewUrl: string | null;
  onExpandPdf: () => void;
}) {
  const mode = previewModeFor(doc.mime, !!previewUrl);
  const [imageOpen, setImageOpen] = useState(false);

  // Esc closes the image lightbox. The PDF lightbox lives on the drawer so
  // it can stay open across re-renders of this child — its Esc handler is
  // colocated there.
  //
  // The Drawer primitive also listens for Esc on `document` to close itself.
  // We attach in the capture phase and stopImmediatePropagation so the
  // drawer's handler never sees this keydown — otherwise pressing Esc to
  // dismiss the lightbox would also collapse the drawer underneath.
  useEffect(() => {
    if (!imageOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      setImageOpen(false);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [imageOpen]);

  if (mode === 'text' || !previewUrl) return null;

  if (mode === 'pdf') {
    // <object> + <embed> together so browsers that refuse one fall back to
    // the other; the fallback children show when neither renders.
    return (
      <div className="doc-preview doc-preview-pdf">
        <object data={previewUrl} type="application/pdf" aria-label={doc.title}>
          <embed src={previewUrl} type="application/pdf" />
          <div className="doc-preview-fallback">
            <span className="subtle">Inline PDF preview is not supported in this browser.</span>
            <a className="btn btn-sm btn-primary" href={previewUrl} target="_blank" rel="noreferrer">
              <Icons.ExternalLink size={12} /> Open PDF
            </a>
          </div>
        </object>
        <button
          type="button"
          className="btn btn-sm doc-preview-expand"
          onClick={onExpandPdf}
          aria-label="Expand PDF preview"
        >
          <Icons.Expand size={12} /> Expand
        </button>
      </div>
    );
  }

  if (mode === 'image') {
    return (
      <>
        <button
          type="button"
          className="doc-preview doc-preview-image"
          onClick={() => setImageOpen(true)}
          aria-label="Open full-size image"
        >
          <img src={previewUrl} alt={doc.title} />
          <span className="doc-preview-zoom"><Icons.Expand size={11} /> Click to enlarge</span>
        </button>
        {imageOpen && (
          <div
            className="doc-preview-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label={doc.title}
            onClick={() => setImageOpen(false)}
          >
            <img src={previewUrl} alt={doc.title} />
            <button
              type="button"
              className="btn btn-ghost btn-icon doc-preview-lightbox-close"
              onClick={() => setImageOpen(false)}
              aria-label="Close preview"
            >
              <Icons.X />
            </button>
          </div>
        )}
      </>
    );
  }

  if (mode === 'audio') {
    return (
      <div className="doc-preview doc-preview-audio">
        <audio controls preload="metadata" src={previewUrl}>
          <a href={previewUrl} target="_blank" rel="noreferrer">Open audio</a>
        </audio>
      </div>
    );
  }

  if (mode === 'video') {
    return (
      <div className="doc-preview doc-preview-video">
        <video controls preload="metadata" src={previewUrl}>
          <a href={previewUrl} target="_blank" rel="noreferrer">Open video</a>
        </video>
      </div>
    );
  }

  // mode === 'other'
  return (
    <div className="doc-preview doc-preview-other">
      <span className="subtle">{doc.mime || 'Unknown type'}</span>
      <a className="btn btn-sm btn-primary" href={previewUrl} target="_blank" rel="noreferrer">
        <Icons.ExternalLink size={12} /> Open
      </a>
    </div>
  );
}

/**
 * The "body" of the doc reader — everything inside the Drawer chrome.
 * Pulled out so other surfaces (DocListDrawer) can render the same reader
 * inline with a back button, without opening a second modal that would
 * lose the surrounding list state.
 *
 * Contract:
 *   - `onClose`  — close the *containing* drawer (used by project chip
 *                  navigation, which is "leave this surface entirely").
 *   - `onBack`   — if provided, render a back arrow at the top that calls
 *                  this. Used by DocListDrawer to return to its list view.
 *                  Omit when used standalone via DocReaderDrawer.
 *   - `onRoute`  — project navigation. Pass through from the host.
 */
export function DocReaderBody({
  doc,
  onClose,
  onBack,
  onRoute,
}: {
  doc: DocumentItem;
  onClose: () => void;
  onBack?: () => void;
  onRoute?: (r: Route) => void;
}) {
  const qc = useQueryClient();
  const fullQ = useQuery({
    queryKey: ['content', doc.id, 'full'],
    queryFn: () => getContent(doc.id),
  });
  const pinMut = useMutation({
    mutationFn: () => (doc.pinned ? unpinContent(doc.id) : pinContent(doc.id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['content'] });
    },
  });

  const item = fullQ.data;
  const body = item?.content ?? '';
  // Two SAS-signed URLs come back from the server for binary docs:
  //  - blob_url        → read-only, suitable for inline <object>/<img>/<audio>
  //  - download_url    → same blob, but with Content-Disposition: attachment
  //                       baked in via the `rscd` SAS param, so browsers save
  //                       instead of navigating (cross-origin makes the HTML
  //                       `download` attribute a no-op).
  // Both fall back to doc.blob_url if the full record hasn't loaded yet —
  // download won't trigger an actual download until we have download_url.
  const previewUrl = item?.blob_url ?? doc.blob_url;
  const downloadUrl = item?.download_url ?? null;
  const mode = previewModeFor(doc.mime, !!previewUrl);
  const hasBody = body.trim().length > 0;

  // Text-only docs (note-as-doc) have no Azure blob. Synthesize a
  // same-origin blob: URL from the markdown body so Download / Open
  // chips still work. Shared with NoteReaderBody via useMarkdownBlobUrl.
  const synthesizedTextUrl = useMarkdownBlobUrl(mode === 'text' ? body : null);

  // Effective URLs: server-signed for binaries, synthesized blob for text.
  // `downloadIsSynthesized` flips whether the <a> needs the `download` attr —
  // server URLs rely on Content-Disposition (cross-origin), synthesized ones
  // use the attribute (same-origin).
  const effectiveDownloadUrl = downloadUrl ?? synthesizedTextUrl;
  const effectiveOpenUrl = previewUrl ?? synthesizedTextUrl;
  const downloadIsSynthesized = !downloadUrl && !!synthesizedTextUrl;
  const synthesizedFilename = markdownFilename(doc.title);

  const [pdfOpen, setPdfOpen] = useState(false);
  // Same propagation guard as the image lightbox above — keep Esc from
  // bubbling into the Drawer's own document-level Esc handler.
  useEffect(() => {
    if (!pdfOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      setPdfOpen(false);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [pdfOpen]);

  return (
    <>
      {onBack ? <ReaderBackButton onClick={onBack} /> : null}
      <div className="row-flex gap-2 chip-row">
        <Status status={doc.processing_status} error={doc.processing_error} />
        {/* Entity-type chip (not a user tag) — `kind` drops the `#` and tints
            it as a type chip so it reads distinctly from the tags below. */}
        <Tag kind="doc">{doc.type}</Tag>
        {doc.mime ? <span className="subtle doc-mime">{doc.mime}</span> : null}
        <span className="subtle">{doc.size}</span>
        {doc.tags.map(t => (
          <Tag key={t}>{t}</Tag>
        ))}
      </div>
      <div className="meta-grid">
        <span className="subtle">created</span>
        <span>{fmtRel(doc.created_at)}</span>
        {doc.published_at ? (
          <>
            <span className="subtle">published</span>
            <span>{fmtRel(doc.published_at)}</span>
          </>
        ) : null}
        {doc.file_hash ? (
          <>
            <span className="subtle">sha256</span>
            <span className="meta-hash">{doc.file_hash}</span>
          </>
        ) : null}
        {doc.source_url ? (
          <>
            <span className="subtle">source</span>
            <span className="meta-url">{doc.source_url}</span>
          </>
        ) : null}
        {doc.project_ids.length > 0 ? (
          <>
            <span className="subtle">projects</span>
            <ProjectChips ids={doc.project_ids} onRoute={onRoute} onClose={onClose} />
          </>
        ) : null}
      </div>

      <div className="row-flex gap-2 chip-row">
        {doc.source_url ? (
          <a className="btn btn-sm btn-primary" href={doc.source_url} target="_blank" rel="noreferrer">
            <Icons.ExternalLink size={12} /> Open original
          </a>
        ) : null}
        {effectiveDownloadUrl ? (
          <a
            className="btn btn-sm"
            href={effectiveDownloadUrl}
            {...(downloadIsSynthesized ? { download: synthesizedFilename } : {})}
          >
            <Icons.Download size={12} /> Download
          </a>
        ) : null}
        {effectiveOpenUrl ? (
          <a className="btn btn-sm" href={effectiveOpenUrl} target="_blank" rel="noopener noreferrer">
            <Icons.ExternalLink size={12} /> Open
          </a>
        ) : null}
        <button
          className="btn btn-sm"
          onClick={() => pinMut.mutate()}
          disabled={pinMut.isPending}
        >
          <Icons.Pin size={12} /> {doc.pinned ? 'Unpin' : 'Pin'}
        </button>
        <span className="subtle doc-size-trail">{doc.size}</span>
      </div>

      {/* Scroll region — preview + extracted text + markdown body all live
          here. The wrapper takes remaining drawer height (flex: 1 in the
          drawer-body column) and scrolls internally, keeping the chrome
          above (chips, metadata, action buttons) pinned and always reachable
          without scrolling back up. */}
      <div className="reader-content">
        <DocPreview doc={doc} previewUrl={previewUrl} onExpandPdf={() => setPdfOpen(true)} />

        {/* For binary docs the extracted text is supplementary — useful for
            search/RAG and as a body when the preview is awkward (mobile PDF
            embeds especially). We label it so a glance distinguishes the
            model's extraction from the document itself. For text-only docs
            this block IS the document, so no label. */}
        {hasBody || mode === 'text' ? (
          <>
            {mode !== 'text' && hasBody ? (
              <div className={cls('subtle', 'doc-extracted-label')}>Extracted text</div>
            ) : null}
            <div className="md-preview md-preview-card">
              {fullQ.isLoading ? (
                <div className="page-subtle">Loading content…</div>
              ) : fullQ.error ? (
                <div className="page-subtle" style={{ color: 'var(--danger)' }}>
                  Failed to load content: {fullQ.error instanceof Error ? fullQ.error.message : String(fullQ.error)}
                </div>
              ) : !hasBody ? (
                <div className="page-subtle">No extracted text available.</div>
              ) : (
                <MarkdownPreview src={body} />
              )}
            </div>
          </>
        ) : null}
      </div>

      {/* PDF lightbox lives outside the scroll wrapper so position: fixed
          escapes any ancestor stacking context cleanly. */}
      {pdfOpen && previewUrl && mode === 'pdf' && (
        <div
          className="doc-preview-lightbox doc-preview-lightbox-pdf"
          role="dialog"
          aria-modal="true"
          aria-label={doc.title}
          onClick={e => {
            if (e.target === e.currentTarget) setPdfOpen(false);
          }}
        >
          <object data={previewUrl} type="application/pdf" aria-label={doc.title}>
            <embed src={previewUrl} type="application/pdf" />
          </object>
          <button
            type="button"
            className="btn btn-ghost btn-icon doc-preview-lightbox-close"
            onClick={() => setPdfOpen(false)}
            aria-label="Close preview"
          >
            <Icons.X />
          </button>
        </div>
      )}
    </>
  );
}

/** Standalone doc reader — wraps DocReaderBody in a Drawer. The drawer's
 *  close maps directly to onClose on the body. No back button (this surface
 *  doesn't have a list to return to). */
export function DocReaderDrawer({
  doc,
  onClose,
  onRoute,
}: {
  doc: DocumentItem;
  onClose: () => void;
  onRoute?: (r: Route) => void;
}) {
  return (
    <Drawer title={doc.title} onClose={onClose}>
      <DocReaderBody doc={doc} onClose={onClose} onRoute={onRoute} />
    </Drawer>
  );
}
