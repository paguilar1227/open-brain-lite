import { extractLocalFile } from '../capture/local-file.js';
import { createHash } from 'crypto';
import type { ServiceDeps } from './index.js';
import {
  insertContentItem, listContentItems as dbListContentItems,
  getContentItemById, updateContentItem as dbUpdate,
  archiveContentItem, unarchiveContentItem,
  deleteContentItemHard,
  findByFileHash,
  updateProcessingStatus,
  getContentItemStatus as dbGetStatus,
  bulkArchiveContentItems,
  bulkRestoreContentItems,
  bulkDeleteContentItemsHard,
  bulkAddTagsContentItems,
  bulkRemoveTagsContentItems,
  bulkSetProjectIdsContentItems,
  pinContentItem as dbPinContentItem,
  unpinContentItem as dbUnpinContentItem,
  type ContentItemRow, type ContentItemStatus, type ContentType,
  type ListContentItemsFilters, type ProcessingStatus,
  type BulkContentResult,
} from '../db/content-items.js';
import { insertChunks, deleteChunksByContentItem, type ChunkInsert, type ChunkType } from '../db/chunks.js';
import { extractMetadata } from '../capture/metadata.js';
import { chunkText, approximateTokens } from '../capture/chunker.js';
import { extractPdfText } from '../providers/pdf-extract.js';
import {
  newTrace, recordStage, addNote, isEchoOf,
  type IngestTrace,
} from '../capture/ingest-trace.js';
import { buildGraphEdges } from './entities.js';
import { getChunksByContentItem } from '../db/chunks.js';
import { mapConcurrent } from '../util/concurrency.js';
import { withSpan } from '../observability.js';

const EMBED_CONCURRENCY = 6;

export interface CreateContentInput {
  type: ContentType;
  content?: string;            // text content (notes, or extracted text for documents)
  title?: string;              // optional — auto-generated if missing
  file?: {                     // optional file (for documents or note with embedded media)
    data: Buffer;
    mimeType: string;
    filename: string;
  };
  projectIds?: string[];
  tags?: string[];
  folder?: string | null;      // optional — folder path the note is filed under
  sourceUrl?: string;          // optional — set for URL-ingested content
  trace?: IngestTrace;         // optional — passed in by url-ingest. Otherwise a fresh one is made here.
  /** Skip the file-hash and source-url dedup gate. Used by the replace
   *  workflow where the caller explicitly wants a new row even if bytes
   *  collide with an existing item. */
  skipDedup?: boolean;
  /** Stamped onto the new row's metadata. Used by replace to record which
   *  row this one supersedes, for traceability and version history. */
  replacesId?: string;
}

export interface CreateContentResult {
  id: string;
  title: string;
  chunkCount: number;
  warnings?: string[];
  status: ProcessingStatus;
  error?: string;
}

/**
 * Returned by `createContentItem`. The id and processing status are available
 * synchronously after the cheap prelude (dedup + blob upload + early row
 * insert). The rest of the pipeline (metadata, chunking, embedding, graph)
 * runs on `completion`. REST adapters return `id` immediately and let
 * `completion` finish in the background. MCP adapters await `completion`
 * to preserve their existing sync contract.
 */
export interface StartContentResult {
  id: string;
  status: ProcessingStatus;
  completion: Promise<CreateContentResult>;
}

/**
 * Start ingest for a content item (document or note). Returns immediately
 * after the cheap sync prelude (dedup + blob upload + PDF text extract +
 * early row insert) with a `completion` promise that resolves when the
 * heavy pipeline (metadata, chunking, embedding, graph edges) finishes.
 *
 * Sync prelude steps:
 *   1. File hash dedup (early-out if hit)
 *   2. Upload file to blob storage
 *   3. PDF text extraction (deterministic, fast)
 *   4. Insert content_item with placeholder title and processing_status='pending'
 *
 * Async tail (runIngestTail):
 *   5. Metadata extraction (parallel with chunk embedding when fullText is known)
 *   6. Chunk + embed (bounded Promise.all)
 *   7. Whole-item embedding (parallel where safe)
 *   8. UPDATE content_item with real title/content/embedding/metadata/published_at
 *   9. Insert chunks
 *  10. Build graph edges
 *  11. Flip processing_status to 'ready' (or 'failed' on error)
 */
export async function createContentItem(
  deps: ServiceDeps,
  input: CreateContentInput,
): Promise<StartContentResult> {
  return withSpan(
    'content.create',
    {
      'content.type': input.type,
      'content.has_file': Boolean(input.file),
      'content.has_source_url': Boolean(input.sourceUrl),
      'content.is_replace': Boolean(input.replacesId),
    },
    () => createContentItemImpl(deps, input),
  );
}

async function createContentItemImpl(
  deps: ServiceDeps,
  input: CreateContentInput,
): Promise<StartContentResult> {
  const trace = input.trace ?? newTrace({ source_url: input.sourceUrl });
  recordStage(trace, 'input.content', input.content);

  // Prelude step 1: dedup by file hash. Skipped on replace, where the caller
  // explicitly wants a fresh row even if the bytes collide with an archive.
  let fileHash: string | null = null;
  let blobUrl: string | null = null;
  if (input.file) {
    fileHash = createHash('sha256').update(input.file.data).digest('hex');
    console.log(`[content] File hash: ${fileHash}`);

    if (!input.skipDedup) {
      const existing = await findByFileHash(deps.db, fileHash);
      if (existing) {
        console.log(`[content] Duplicate file detected, returning existing: ${existing.id}`);
        return {
          id: existing.id,
          status: existing.processing_status,
          completion: Promise.resolve({
            id: existing.id,
            title: existing.title,
            chunkCount: 0,
            warnings: ['Duplicate file — returning existing item.'],
            status: existing.processing_status,
          }),
        };
      }
    }
  }

  // Prelude step 2: upload blob
  if (input.file) {
    const blobName = `${Date.now()}-${input.file.filename}`;
    blobUrl = await deps.blobStorage.upload(blobName, input.file.data, input.file.mimeType);
    console.log(`[content] Uploaded to blob: ${blobUrl}`);
  }

  // Prelude step 3: PDF text extraction (local pdf-parse, deterministic & fast).
  // Done in the prelude so the async tail has it ready and can route metadata
  // to the right LLM up front. Flash's multimodal PDF handling is unreliable —
  // pdf-parse handles text-heavy PDFs deterministically.
  let pdfText: string | null = null;
  if (input.file?.mimeType === 'application/pdf') {
    try {
      const pdf = await extractPdfText(input.file.data);
      pdfText = pdf.text;
      console.log(`[content] PDF extraction — ${pdf.pageCount} pages, ${pdfText.length} chars`);
      recordStage(trace, 'pdf_parse.text', pdfText);
    } catch (err) {
      console.warn(`[content] pdf-parse failed, falling back to Flash multimodal:`, err instanceof Error ? err.message : err);
      addNote(trace, `pdf_parse_failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (input.file && deps.config.llmProvider !== 'real' && deps.config.llmProvider !== 'stub') {
    const extracted = await extractLocalFile(input.file);
    if (extracted !== null) pdfText = extracted;
    if (!pdfText?.trim() && !input.content?.trim()) throw new Error('No extractable text found. Add a transcript or text description.');
  }

  // Prelude step 4: early row insert with placeholder title + status='pending'.
  // The id returned to REST callers is the id of this row; the async tail
  // updates the row in place with real metadata when it finishes.
  const placeholderTitle =
    input.title?.trim() ||
    input.file?.filename ||
    (input.sourceUrl ? `Processing… ${input.sourceUrl.slice(0, 80)}` : 'Processing…');
  const titleSource = input.title?.trim() ? 'user' : (input.file ? 'filename' : 'ai_generated');

  const inserted = await insertContentItem(deps.db, {
    type: input.type,
    title: placeholderTitle,
    titleSource: titleSource as 'user' | 'ai_generated' | 'filename',
    content: input.content || pdfText || null,
    blobUrl,
    mimeType: input.file?.mimeType ?? null,
    fileHash,
    projectIds: input.projectIds ?? [],
    tags: input.tags ?? [],
    folder: input.folder ?? null,
    embedding: null,
    metadata: input.replacesId
      ? { ingest_trace: trace, filename: input.file?.filename, replaces: input.replacesId }
      : { ingest_trace: trace, filename: input.file?.filename },
    sourceUrl: input.sourceUrl ?? null,
    publishedAt: null,
    processingStatus: 'pending',
  });

  console.log(`[content] Early-insert ${input.type} ${inserted.id} — placeholder title: "${placeholderTitle}", status=pending`);

  // Async tail. Errors inside the tail mark the row as 'failed' and are
  // re-thrown so MCP callers (which await `completion`) see them. REST
  // callers attach a default .catch so unawaited rejections don't crash
  // the process.
  const completion = runIngestTail(deps, inserted.id, input, pdfText, trace)
    .catch((err) => {
      // Convert to a resolved CreateContentResult for callers that just want
      // the final state. The row in the DB has the canonical truth; this
      // shape is just for MCP/test consumers.
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        id: inserted.id,
        title: placeholderTitle,
        chunkCount: 0,
        warnings: undefined,
        status: 'failed' as ProcessingStatus,
        error: errMsg,
      };
    });

  return {
    id: inserted.id,
    status: 'pending',
    completion,
  };
}

/**
 * The async tail of the ingest pipeline. Runs metadata, chunking, embedding,
 * and graph edges, then UPDATEs the row with the final state and flips
 * processing_status. On any error: marks the row 'failed' with the error
 * message and re-throws.
 *
 * Exported so retryContentIngest() can re-run it on an existing row without
 * duplicating the orchestration logic.
 */
export async function runIngestTail(
  deps: ServiceDeps,
  contentItemId: string,
  input: CreateContentInput,
  pdfText: string | null,
  trace: IngestTrace,
): Promise<CreateContentResult> {
  return withSpan(
    'content.ingest_tail',
    {
      'content.id': contentItemId,
      'content.type': input.type,
      'content.has_pdf_text': Boolean(pdfText),
    },
    () => runIngestTailImpl(deps, contentItemId, input, pdfText, trace),
  );
}

async function runIngestTailImpl(
  deps: ServiceDeps,
  contentItemId: string,
  input: CreateContentInput,
  pdfText: string | null,
  trace: IngestTrace,
): Promise<CreateContentResult> {
  const warnings: string[] = [];

  try {
    // Metadata extraction setup — same routing as before.
    const filesForMeta = pdfText === null && input.file
      ? [{ data: input.file.data, mimeType: input.file.mimeType }]
      : undefined;
    const contentForMeta = pdfText
      ? `${input.content ?? ''}\n\n${pdfText}`.trim().slice(0, 50000)
      : input.content ?? '';
    const needsMediaLLM = filesForMeta?.some(
      (f) => f.mimeType.startsWith('audio/') || f.mimeType.startsWith('video/'),
    );
    const llmForMeta = needsMediaLLM ? deps.mediaMetadataLLM : deps.metadataLLM;
    if (needsMediaLLM) {
      console.log(`[content] Routing metadata to mediaMetadataLLM for ${filesForMeta!.map((f) => f.mimeType).join(', ')}`);
    }

    // Pipeline parallelism (A): kick off chunk + whole-item embeddings in
    // parallel with metadata when fullText is known without metadata.extracted_text.
    const preliminaryParts: string[] = [];
    if (input.content) preliminaryParts.push(input.content);
    if (pdfText && !input.content?.includes(pdfText.slice(0, 200))) {
      preliminaryParts.push(pdfText);
    }
    const preliminaryFullText = preliminaryParts.join('\n\n').trim();
    const fullTextKnownEarly = preliminaryFullText.length > 0 && (!input.file || pdfText !== null);
    const shouldWholeEmbed = input.type === 'document' && Boolean(input.file);

    const metadataPromise = extractMetadata(llmForMeta, contentForMeta, filesForMeta);

    let earlyTextChunks: string[] | null = null;
    let earlyChunkEmbedsPromise: Promise<number[][]> | null = null;
    if (fullTextKnownEarly) {
      earlyTextChunks = chunkText(preliminaryFullText);
      console.log(`[content] Early-pipeline: ${earlyTextChunks.length} chunk(s) embedding in parallel with metadata`);
      earlyChunkEmbedsPromise = mapConcurrent(
        earlyTextChunks,
        EMBED_CONCURRENCY,
        (text) => deps.embeddingProvider.embed(text),
      );
    }

    let earlyWholeEmbedPromise: Promise<number[] | null> | null = null;
    if (fullTextKnownEarly && shouldWholeEmbed && input.file) {
      const fileForEmbed = { data: input.file.data, mimeType: input.file.mimeType };
      earlyWholeEmbedPromise = deps.embeddingProvider
        .embed(preliminaryFullText, [fileForEmbed])
        .catch((err) => {
          console.warn(`[content] Whole-item multimodal embedding failed:`, err);
          warnings.push('Whole-item embedding failed; relying on chunks only.');
          return null;
        });
    }

    const metadata = await metadataPromise;
    recordStage(trace, 'metadata.title', metadata.title);
    recordStage(trace, 'metadata.extracted_text', metadata.extracted_text);
    if (isEchoOf(trace.stages['metadata.extracted_text'] ?? null, trace.stages['input.content'] ?? null)) {
      addNote(trace, 'flash_echoed_input_content_into_extracted_text');
    }

    // Final fullText
    const parts: string[] = [];
    if (input.content) parts.push(input.content);
    if (pdfText && !input.content?.includes(pdfText.slice(0, 200))) {
      parts.push(pdfText);
    }
    if (input.file && !pdfText && metadata.extracted_text && metadata.extracted_text !== input.content) {
      parts.push(metadata.extracted_text);
    }
    const fullText = parts.join('\n\n').trim();
    recordStage(trace, 'fulltext', fullText);
    if (fullText.length > 400) {
      const half = fullText.slice(0, Math.floor(fullText.length / 2));
      if (half.length > 200 && fullText.indexOf(half.slice(0, 200), 200) >= 0) {
        addNote(trace, 'fulltext_contains_repeated_prefix');
      }
    }

    // Title + tags. Tags are user-only — the metadata extractor no
    // longer proposes them. If the caller (UI / MCP) didn't supply
    // tags, this row starts untagged; the user adds them later via
    // the editor.
    const finalTitle = input.title?.trim() || metadata.title || 'Untitled';
    const finalTags = input.tags ?? [];

    // Whole-item embedding
    let wholeItemEmbedding: number[] | null = null;
    if (earlyWholeEmbedPromise) {
      wholeItemEmbedding = await earlyWholeEmbedPromise;
    } else if (shouldWholeEmbed && input.file) {
      try {
        wholeItemEmbedding = await deps.embeddingProvider.embed(
          fullText || metadata.title,
          [{ data: input.file.data, mimeType: input.file.mimeType }],
        );
      } catch (err) {
        console.warn(`[content] Whole-item multimodal embedding failed, skipping:`, err);
        warnings.push('Whole-item embedding failed; relying on chunks only.');
      }
    }

    // UPDATE the early row with everything we now know
    await dbUpdate(deps.db, contentItemId, {
      title: finalTitle,
      content: fullText || null,
      embedding: wholeItemEmbedding,
      tags: finalTags,
      publishedAt: metadata.published_at,
      metadata: {
        topics: metadata.topics,
        filename: input.file?.filename,
        ingest_trace: trace,
        // Preserve the replace cross-link the prelude stamped onto the row.
        // Otherwise this UPDATE would clobber it on the way to 'ready'.
        ...(input.replacesId ? { replaces: input.replacesId } : {}),
      },
    });

    // Chunks
    let chunkCount = 0;
    if (fullText) {
      let textChunks: string[];
      let embeddings: number[][];
      if (earlyChunkEmbedsPromise && earlyTextChunks) {
        textChunks = earlyTextChunks;
        embeddings = await earlyChunkEmbedsPromise;
      } else {
        textChunks = chunkText(fullText);
        console.log(`[content] Split into ${textChunks.length} text chunk(s) — total tokens ~${approximateTokens(fullText)}`);
        embeddings = await mapConcurrent(
          textChunks,
          EMBED_CONCURRENCY,
          (text) => deps.embeddingProvider.embed(text),
        );
      }
      const chunksToInsert: ChunkInsert[] = textChunks.map((text, i) => ({
        contentItemId,
        chunkIndex: i,
        chunkType: 'text' as ChunkType,
        content: text,
        embedding: embeddings[i],
        metadata: { token_estimate: approximateTokens(text) },
      }));
      await insertChunks(deps.db, chunksToInsert);
      chunkCount = chunksToInsert.length;
    } else if (input.file && input.type === 'document' && wholeItemEmbedding) {
      await insertChunks(deps.db, [{
        contentItemId,
        chunkIndex: 0,
        chunkType: 'image' as ChunkType,
        content: null,
        embedding: wholeItemEmbedding,
        metadata: { mime_type: input.file.mimeType },
      }]);
      chunkCount = 1;
    }

    // Graph edges (best-effort)
    if (fullText && chunkCount > 0) {
      try {
        const chunks = await getChunksByContentItem(deps.db, contentItemId);
        const { entityCount, edgeCount } = await buildGraphEdges(deps, fullText, chunks);
        addNote(trace, `graph: ${entityCount} entities, ${edgeCount} edges`);
      } catch (err) {
        console.warn(`[content] Graph edge construction failed (continuing):`, err instanceof Error ? err.message : err);
        addNote(trace, `graph_failed: ${err instanceof Error ? err.message : String(err)}`);
        warnings.push('Entity graph construction failed; item is searchable but not graph-linked.');
      }
      // Persist the updated trace with any notes added during graph construction.
      // Like the earlier UPDATE, preserve the replace cross-link the prelude
      // stamped onto the row — otherwise this second UPDATE clobbers it.
      try {
        await dbUpdate(deps.db, contentItemId, {
          metadata: {
            topics: metadata.topics,
            filename: input.file?.filename,
            ingest_trace: trace,
            ...(input.replacesId ? { replaces: input.replacesId } : {}),
          },
        });
      } catch (err) {
        console.warn(`[content] Trace persist failed (non-fatal):`, err instanceof Error ? err.message : err);
      }
    }

    // Flip status to 'ready'
    await updateProcessingStatus(deps.db, contentItemId, 'ready', null);

    console.log(`[content] Ingest complete ${input.type} ${contentItemId} — title: "${finalTitle}", chunks: ${chunkCount}`);
    return {
      id: contentItemId,
      title: finalTitle,
      chunkCount,
      warnings: warnings.length > 0 ? warnings : undefined,
      status: 'ready',
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[content] Ingest tail failed for ${contentItemId}:`, errMsg);
    addNote(trace, `tail_failed: ${errMsg}`);
    try {
      await updateProcessingStatus(deps.db, contentItemId, 'failed', errMsg.slice(0, 1000));
      await dbUpdate(deps.db, contentItemId, {
        metadata: {
          ingest_trace: trace,
          ...(input.replacesId ? { replaces: input.replacesId } : {}),
        },
      });
    } catch (updateErr) {
      console.error(`[content] Failed to mark row as failed:`, updateErr);
    }
    throw err;
  }
}

export async function listContentItems(
  deps: ServiceDeps,
  filters: ListContentItemsFilters = {},
): Promise<ContentItemRow[]> {
  return dbListContentItems(deps.db, filters);
}

export async function getContentItem(deps: ServiceDeps, id: string): Promise<ContentItemRow | null> {
  return getContentItemById(deps.db, id);
}

/**
 * Slim status read for the polling endpoint. Avoids hauling content body /
 * metadata / embeddings on every poll tick.
 */
export async function getContentItemStatus(
  deps: ServiceDeps,
  id: string,
): Promise<ContentItemStatus | null> {
  return dbGetStatus(deps.db, id);
}

/** Errors retryContentIngest signals to the adapter so REST/MCP can map cleanly. */
export class RetryStateError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'ALREADY_READY' | 'IN_FLIGHT', message: string) {
    super(message);
    this.name = 'RetryStateError';
  }
}

/** Errors reprocessContent signals to the adapter. Reprocess is OK on ready or failed. */
export class ReprocessStateError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'IN_FLIGHT', message: string) {
    super(message);
    this.name = 'ReprocessStateError';
  }
}

/** Errors editContentBody signals. BODY_IMMUTABLE means the row has a blob backing it. */
export class EditBodyError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'BODY_IMMUTABLE' | 'IN_FLIGHT',
    message: string,
  ) {
    super(message);
    this.name = 'EditBodyError';
  }
}

/**
 * Re-run the async tail on an existing row whose previous ingest failed.
 *
 * Intended use: a transient pipeline error (embedding service down, LLM 5xx)
 * left the row in `processing_status='failed'`. Retry resets the row to
 * `pending`, reconstructs the original `CreateContentInput` from the row +
 * blob, and feeds it back through `runIngestTail` — same pipeline, no new
 * id, dedup hash and source_url preserved.
 *
 * State rules:
 *   - 'failed'  → ok, retryable
 *   - 'ready'   → throw ALREADY_READY (caller should not "retry" a healthy row)
 *   - 'pending' → throw IN_FLIGHT (a tail is still running; running a second
 *                 one would race chunk inserts)
 *
 * Side effects on the row before re-running the tail:
 *   - chunks are deleted (chunk_entities cascade-delete via FK)
 *   - processing_status is reset to 'pending', clearing ingest_completed_at
 *
 * Binary content (PDF, audio, video) is re-fetched from blob storage. If
 * the blob download itself fails, retry continues in text-only mode using
 * the row's existing `content` field; if that's also null, the tail will
 * almost certainly fail again, but at least the failure surface is the
 * same as the original ingest's, with a fresh trace.
 */
export async function retryContentIngest(
  deps: ServiceDeps,
  id: string,
): Promise<StartContentResult> {
  const row = await getContentItemById(deps.db, id);
  if (!row) throw new RetryStateError('NOT_FOUND', `Content item ${id} not found`);
  if (row.processing_status === 'ready') {
    throw new RetryStateError('ALREADY_READY', `Content item ${id} is already ready; nothing to retry`);
  }
  if (row.processing_status === 'pending') {
    throw new RetryStateError('IN_FLIGHT', `Content item ${id} is still pending; cannot retry an in-flight ingest`);
  }
  return rerunIngestTail(deps, row, 'retry');
}

/**
 * Re-run the async tail on a healthy row to regenerate chunks + embeddings +
 * metadata + entity graph. Intended for "I want fresh metadata after a model
 * upgrade" or "the chunk size changed" workflows — the row's text/blob
 * content is unchanged but everything derived from it gets rebuilt.
 *
 * Mechanics are identical to retryContentIngest with one difference: the
 * starting state must be 'ready' or 'failed' (NOT 'pending', since the tail
 * is still in flight there).
 */
export async function reprocessContent(
  deps: ServiceDeps,
  id: string,
): Promise<StartContentResult> {
  const row = await getContentItemById(deps.db, id);
  if (!row) throw new ReprocessStateError('NOT_FOUND', `Content item ${id} not found`);
  if (row.processing_status === 'pending') {
    throw new ReprocessStateError('IN_FLIGHT', `Content item ${id} is still pending; cannot reprocess an in-flight ingest`);
  }
  return rerunIngestTail(deps, row, 'reprocess');
}

/**
 * Decide whether a reprocess should pass the row's existing title back into
 * the metadata extractor (preserving it) or pass `undefined` (letting the
 * extractor produce a fresh title).
 *
 * Preserve only when the user explicitly set the title (`title_source =
 * 'user'`). For filename- and AI-derived titles, return undefined so the
 * extractor wins — otherwise a stale auto-title (e.g. "(no text content)"
 * from a failed first ingest) survives every subsequent reprocess. Also
 * always drop the "Processing… <url>" placeholder left by an interrupted
 * ingest, regardless of title_source.
 */
export function pickPreservedTitle(row: Pick<ContentItemRow, 'title' | 'title_source'>): string | undefined {
  if (row.title_source !== 'user') return undefined;
  if (row.title.startsWith('Processing…')) return undefined;
  return row.title;
}

async function rerunIngestTail(
  deps: ServiceDeps,
  row: ContentItemRow,
  mode: 'retry' | 'reprocess',
): Promise<StartContentResult> {
  const id = row.id;

  // Clear tail-produced state so the rerun is clean. chunk_entities cascade
  // off chunks via FK; entities themselves are global by design (shared
  // canonical names across the corpus) so we leave them alone.
  // Reconstruct the input shape runIngestTail expects. Binary inputs need
  // the original bytes; the blob is the canonical store for those.
  let file: { data: Buffer; mimeType: string; filename: string } | undefined;
  let pdfText: string | null = null;
  if (row.blob_url && row.mime_type) {
    try {
      const bytes = await deps.blobStorage.download(row.blob_url);
      const filename = (row.metadata as Record<string, unknown>)?.filename as string | undefined
        ?? `${mode}-${id}`;
      file = { data: bytes, mimeType: row.mime_type, filename };
      if (row.mime_type === 'application/pdf') {
        try {
          const pdf = await extractPdfText(bytes);
          pdfText = pdf.text;
        } catch (err) {
          console.warn(`[${mode}] PDF re-extract failed for ${id}, falling back to text-only:`, err);
        }
      }
    } catch (err) {
      console.warn(`[${mode}] Blob download failed for ${id}, falling back to text-only:`, err);
    }
  }

  if (file && deps.config.llmProvider !== 'real' && deps.config.llmProvider !== 'stub') {
    const extracted = await extractLocalFile(file);
    if (extracted !== null) pdfText = extracted;
    if (!pdfText?.trim() && !row.content?.trim()) throw new Error('No extractable text in the stored document.');
  }

  const userTitle = pickPreservedTitle(row);

  const trace = newTrace({ source_url: row.source_url ?? undefined });
  const input: CreateContentInput = {
    type: row.type,
    content: row.content ?? undefined,
    title: userTitle,
    file,
    projectIds: row.project_ids,
    tags: row.tags,
    folder: row.folder,
    sourceUrl: row.source_url ?? undefined,
    trace,
  };

  // All source preflight succeeded. Only now retire the old index.
  await deleteChunksByContentItem(deps.db, id);

  // Reset to pending. updateProcessingStatus also clears ingest_completed_at
  // via its CASE expression, so the polling endpoint reports a fresh start.
  await updateProcessingStatus(deps.db, id, 'pending', null);

  console.log(`[${mode}] Re-running ingest tail for ${row.type} ${id}`);

  const completion = runIngestTail(deps, id, input, pdfText, trace).catch((err) => {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      id,
      title: userTitle ?? row.title,
      chunkCount: 0,
      warnings: undefined,
      status: 'failed' as ProcessingStatus,
      error: errMsg,
    };
  });

  return { id, status: 'pending', completion };
}

/**
 * Metadata-only update on a content item: title, project_ids, tags.
 *
 * Body edits are deliberately NOT here — they're async (re-chunk + re-embed
 * + entity-graph rebuild) and gated by the body-immutability rule. Use
 * editContentBody() instead.
 */
export async function updateContentItem(
  deps: ServiceDeps,
  id: string,
  patch: {
    title?: string;
    projectIds?: string[];
    tags?: string[];
    folder?: string | null;
  },
): Promise<ContentItemRow | null> {
  return dbUpdate(deps.db, id, {
    title: patch.title,
    projectIds: patch.projectIds,
    tags: patch.tags,
    folder: patch.folder,
  });
}

/**
 * Edit the body of a text-only content item — notes, markdown documents,
 * URL-ingested articles, anything where blob_url IS NULL.
 *
 * Same async contract as ingest: returns 202 + completion. The tail
 * deletes old chunks, re-chunks the new body, re-embeds, rebuilds the
 * entity graph, and flips processing_status to 'ready'.
 *
 * State rules:
 *   - blob_url IS NOT NULL → BODY_IMMUTABLE (body is extracted from a file
 *     in Azure Blob; editing the text would silently desync from the file).
 *     Use the archive-and-reupload workflow to swap the file instead.
 *   - processing_status = 'pending' → IN_FLIGHT (a tail is still running;
 *     concurrent chunk inserts would race).
 *   - missing → NOT_FOUND.
 *
 * Does NOT re-run metadata extraction. The user controls title and tags
 * directly via metadata edits, or via reprocess() if they want auto-regen.
 */
export async function editContentBody(
  deps: ServiceDeps,
  id: string,
  newContent: string,
): Promise<StartContentResult> {
  const row = await getContentItemById(deps.db, id);
  if (!row) throw new EditBodyError('NOT_FOUND', `Content item ${id} not found`);
  if (row.blob_url !== null) {
    throw new EditBodyError(
      'BODY_IMMUTABLE',
      `Content item ${id} has an external file backing (blob_url is set); body is extracted from it. Use the archive-and-reupload workflow to replace the file.`,
    );
  }
  if (row.processing_status === 'pending') {
    throw new EditBodyError(
      'IN_FLIGHT',
      `Content item ${id} is still pending; cannot edit body during ingest`,
    );
  }

  // Persist the new body up front so any caller polling /status sees it.
  // Reset to pending and clear chunks so the tail starts from a clean slate.
  await dbUpdate(deps.db, id, { content: newContent });
  await deleteChunksByContentItem(deps.db, id);
  await updateProcessingStatus(deps.db, id, 'pending', null);

  console.log(`[edit-body] Re-chunking + re-embedding ${row.type} ${id} (${newContent.length} chars)`);

  const completion = runBodyEditTail(deps, id, newContent, row.title).catch((err) => {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      id,
      title: row.title,
      chunkCount: 0,
      warnings: undefined,
      status: 'failed' as ProcessingStatus,
      error: errMsg,
    };
  });

  return { id, status: 'pending', completion };
}

async function runBodyEditTail(
  deps: ServiceDeps,
  id: string,
  newContent: string,
  fallbackTitle: string,
): Promise<CreateContentResult> {
  try {
    const textChunks = chunkText(newContent);
    const chunkInserts: ChunkInsert[] = await mapConcurrent(
      textChunks,
      EMBED_CONCURRENCY,
      async (text, i) => ({
        contentItemId: id,
        chunkIndex: i,
        chunkType: 'text' as ChunkType,
        content: text,
        embedding: await deps.embeddingProvider.embed(text),
        metadata: { token_estimate: approximateTokens(text) },
      }),
    );
    await insertChunks(deps.db, chunkInserts);

    // Rebuild entity graph from the new chunks. Failures here shouldn't
    // fail the whole edit — log and continue, same posture as the main
    // ingest pipeline. The user can rerun reprocess() if the graph is
    // important and missing.
    try {
      const insertedChunks = await getChunksByContentItem(deps.db, id);
      await buildGraphEdges(deps, newContent, insertedChunks);
    } catch (err) {
      console.warn(`[edit-body] Entity graph rebuild failed for ${id}:`, err instanceof Error ? err.message : err);
    }

    await updateProcessingStatus(deps.db, id, 'ready', null);
    const finalRow = await getContentItemById(deps.db, id);
    return {
      id,
      title: finalRow?.title ?? fallbackTitle,
      chunkCount: chunkInserts.length,
      warnings: undefined,
      status: 'ready',
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await updateProcessingStatus(deps.db, id, 'failed', errMsg);
    throw err;
  }
}

export async function archiveContentItemById(deps: ServiceDeps, id: string): Promise<void> {
  await archiveContentItem(deps.db, id);
}

export async function unarchiveContentItemById(deps: ServiceDeps, id: string): Promise<void> {
  await unarchiveContentItem(deps.db, id);
}

/** Hard delete a content item. Chunks cascade via FK. Does NOT remove blob storage files. */
export async function deleteContentItemHardById(deps: ServiceDeps, id: string): Promise<void> {
  await deleteContentItemHard(deps.db, id);
}

export async function pinContentItem(deps: ServiceDeps, id: string): Promise<{ found: boolean }> {
  return dbPinContentItem(deps.db, id);
}

export async function unpinContentItem(deps: ServiceDeps, id: string): Promise<{ found: boolean }> {
  return dbUnpinContentItem(deps.db, id);
}

export type BulkContentAction =
  | 'archive'
  | 'restore'
  | 'delete'
  | 'add_tags'
  | 'remove_tags'
  | 'set_project_ids';

export interface BulkContentRequest {
  ids: string[];
  action: BulkContentAction;
  tags?: string[];
  project_ids?: string[];
}

export class BulkContentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BulkContentValidationError';
  }
}

export async function bulkContent(
  deps: ServiceDeps,
  req: BulkContentRequest,
): Promise<BulkContentResult> {
  switch (req.action) {
    case 'archive':
      return bulkArchiveContentItems(deps.db, req.ids);
    case 'restore':
      return bulkRestoreContentItems(deps.db, req.ids);
    case 'delete':
      return bulkDeleteContentItemsHard(deps.db, req.ids);
    case 'add_tags':
      if (!req.tags || req.tags.length === 0) {
        throw new BulkContentValidationError('action="add_tags" requires non-empty tags array');
      }
      return bulkAddTagsContentItems(deps.db, req.ids, req.tags);
    case 'remove_tags':
      if (!req.tags || req.tags.length === 0) {
        throw new BulkContentValidationError('action="remove_tags" requires non-empty tags array');
      }
      return bulkRemoveTagsContentItems(deps.db, req.ids, req.tags);
    case 'set_project_ids':
      if (!req.project_ids) {
        throw new BulkContentValidationError(
          'action="set_project_ids" requires a project_ids array (use [] to detach from all projects)',
        );
      }
      return bulkSetProjectIdsContentItems(deps.db, req.ids, req.project_ids);
  }
}

/** Errors replaceContent signals to the adapter so REST/MCP can map cleanly. */
export class ReplaceContentError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'IN_FLIGHT' | 'BAD_INPUT',
    message: string,
  ) {
    super(message);
    this.name = 'ReplaceContentError';
  }
}

export interface ReplaceContentInput {
  /** New file payload (PDF v2, audio v2, etc.). */
  file?: { data: Buffer; mimeType: string; filename: string };
  /** New text body — use this for replacing a markdown / plain-text doc. */
  content?: string;
  /** New title. Defaults to old item's title if omitted. */
  title?: string;
}

export interface ReplaceContentResult {
  oldId: string;
  newId: string;
  status: ProcessingStatus;
  completion: Promise<CreateContentResult>;
}

/**
 * Archive-and-reupload: the canonical "v2 of an existing content item" path.
 *
 * Old row gets archived (soft delete) and stamped with metadata.replaced_by.
 * New row is created via the standard ingest pipeline with project_ids and
 * tags carried over, type preserved, and metadata.replaces pointing at the
 * old id. Dedup is bypassed so identical bytes still produce a new row.
 *
 * Use cases:
 *   - PDF v2 / audio v2 / video v2 (blob-backed content where edit-body is
 *     forbidden)
 *   - Refreshing a URL-ingested article (re-fetch with the same source_url)
 *   - Pablo iterating with Claude on a markdown doc and wanting to preserve
 *     v1 in the archive rather than overwriting it via edit-body
 *
 * State rules:
 *   - Old row missing → NOT_FOUND
 *   - Old row pending → IN_FLIGHT (don't replace an in-flight ingest)
 *   - Already archived → ok, replace anyway (the user might want a v3 from
 *     a previously-archived v2)
 *
 * Returns the new id immediately (after the cheap prelude). Caller polls
 * /status until ready.
 */
export async function replaceContent(
  deps: ServiceDeps,
  oldId: string,
  input: ReplaceContentInput,
): Promise<ReplaceContentResult> {
  const oldRow = await getContentItemById(deps.db, oldId);
  if (!oldRow) throw new ReplaceContentError('NOT_FOUND', `Content item ${oldId} not found`);
  if (oldRow.processing_status === 'pending') {
    throw new ReplaceContentError(
      'IN_FLIGHT',
      `Content item ${oldId} is still pending; cannot replace an in-flight ingest`,
    );
  }
  if (!input.file && (input.content === undefined || input.content === '')) {
    throw new ReplaceContentError(
      'BAD_INPUT',
      'replace requires either a file (multipart) or content (text)',
    );
  }

  // Run the standard ingest pipeline with dedup bypassed and the parent
  // stamped on metadata. Type is preserved from the old row — replace
  // doesn't switch a document into a note or vice versa.
  const started = await createContentItem(deps, {
    type: oldRow.type,
    file: input.file,
    content: input.content,
    title: input.title ?? oldRow.title,
    projectIds: oldRow.project_ids,
    tags: oldRow.tags,
    folder: oldRow.folder,
    skipDedup: true,
    replacesId: oldId,
  });

  // Now archive the old row and stamp it with replaced_by. We do this
  // AFTER createContentItem returns its id so the back-link is accurate.
  // Failure here is fine — the new row is already in flight; old just
  // stays unarchived which the user can fix manually.
  try {
    await dbUpdate(deps.db, oldId, {
      metadata: {
        ...(oldRow.metadata as Record<string, unknown>),
        replaced_by: started.id,
      },
    });
    await archiveContentItem(deps.db, oldId);
  } catch (err) {
    console.warn(`[replace] Failed to archive/stamp old row ${oldId}:`, err instanceof Error ? err.message : err);
  }

  return {
    oldId,
    newId: started.id,
    status: started.status,
    completion: started.completion,
  };
}

/** Called once after this single-instance server starts; prior in-memory jobs cannot still be running. */
export async function recoverInterruptedIngests(deps: ServiceDeps): Promise<void> {
  const pending = await deps.db.query("SELECT id FROM content_items WHERE processing_status = 'pending' ORDER BY created_at");
  for (const row of pending.rows) {
    await updateProcessingStatus(deps.db, row.id, 'failed', 'Interrupted by application restart; retrying from stored source');
    try { const retry = await retryContentIngest(deps, row.id); await retry.completion; }
    catch (err) { console.error(`[recovery] Could not re-index ${row.id}:`, err instanceof Error ? err.message : String(err)); }
  }
}
