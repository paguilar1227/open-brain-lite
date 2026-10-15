import { extractLocalMedia } from '../capture/local-media.js';
import { scrapeLocal } from '../providers/local-web.js';
import { fetchPublicXPost } from '../providers/local-x.js';
/**
 * URL ingestion orchestrator.
 *
 * Takes a URL → determines its type → uses the right handler to fetch content →
 * routes through the existing content-items pipeline with `source_url` set.
 *
 * Dedup: if we already have a content item for this URL, return it instead of
 * re-ingesting.
 *
 * Supported URL types:
 *   - YouTube → local captions or Whisper (legacy cloud mode uses Supadata)
 *   - X/Twitter → public post text (legacy cloud mode uses xAI threads)
 *   - PDF / image / audio / video direct links → download bytes, reuse the file pipeline
 *   - Generic HTML → local Readability (legacy cloud mode uses Firecrawl)
 */

import type { ServiceDeps } from './index.js';
import { findByUrl, updateContentItem as dbUpdate } from '../db/content-items.js';
import type { ProcessingStatus } from '../db/content-items.js';
import { createContentItem, type CreateContentResult } from './content-items.js';
import { FirecrawlClient } from '../providers/firecrawl.js';
import { XaiClient } from '../providers/xai.js';
import { SupadataClient } from '../providers/supadata.js';
import {
  detectUrlType,
  detectUrlTypeByPattern,
  normalizeUrl,
  type UrlType,
} from '../capture/url-detect.js';
import { newTrace, recordStage, addNote, type IngestTrace } from '../capture/ingest-trace.js';

export interface IngestFromUrlInput {
  projectIds?: string[];
  tags?: string[];
  title?: string;
}

/**
 * Returned by `ingestFromUrl`. Mirrors `StartContentResult` from content-items
 * with URL-specific fields. REST adapters return id+status immediately; MCP
 * adapters await `completion` to preserve the existing sync contract.
 */
export interface IngestFromUrlResult {
  id: string;
  title: string;
  type: 'document' | 'note';
  source_url: string;
  deduped: boolean;
  url_type: UrlType;
  status: ProcessingStatus;
  completion: Promise<CreateContentResult>;
}

const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024; // 100 MB guardrail for binary URLs
const MIN_HTML_CONTENT_CHARS = 300; // reject Firecrawl results shorter than this (placeholder pages)

/** Title patterns that indicate the URL resolved to an error/placeholder page, not real content. */
const ERROR_TITLE_PATTERNS = [
  /^example domain$/i,
  /\b(not found|doesn't exist|page not found|article not found)\b/i,
  /^404\b/i,
  /^error\s+\d/i,
];

/** Title strings that are entirely generic — not a real article. */
const GENERIC_TITLES = new Set([
  'untitled',
  'error',
  'page not found',
  '404',
  '',
]);

/** Body-content patterns that indicate the page is a "no such article" stub (Wikipedia, etc). */
const ERROR_BODY_PATTERNS = [
  /wikipedia does not have an article with this exact name/i,
  /no article exists with this name/i,
  /the page you are looking for doesn['']t exist/i,
  /this article does not yet exist/i,
];

export async function ingestFromUrl(
  deps: ServiceDeps,
  url: string,
  opts: IngestFromUrlInput = {},
): Promise<IngestFromUrlResult> {
  const normalized = normalizeUrl(url);
  const trace = newTrace({ source_url: normalized });
  console.log(`[url-ingest] Starting — url: ${normalized}  trace: ${trace.trace_id}`);

  // Dedup by source_url. On hit: merge incoming project_ids and tags into the
  // existing item (previously we silently dropped them — user thought their
  // save scoped to a project, but the item's project_ids stayed as-is).
  const existing = await findByUrl(deps.db, normalized);
  if (existing) {
    // Cheap URL-type detection for the response (no HEAD, just the pattern match).
    const urlTypeByPattern = detectUrlTypeByPattern(normalized) ?? 'html';

    const incomingProjectIds = opts.projectIds ?? [];
    const incomingTags = opts.tags ?? [];
    const mergedProjectIds = Array.from(new Set([...(existing.project_ids ?? []), ...incomingProjectIds]));
    const mergedTags = Array.from(new Set([...(existing.tags ?? []), ...incomingTags]));

    const projectsChanged = mergedProjectIds.length !== (existing.project_ids?.length ?? 0);
    const tagsChanged = mergedTags.length !== (existing.tags?.length ?? 0);

    if (projectsChanged || tagsChanged) {
      console.log(
        `[url-ingest] Deduped + merging — item: ${existing.id}, ` +
        `+projects: ${projectsChanged ? JSON.stringify(incomingProjectIds) : '(none)'}, ` +
        `+tags: ${tagsChanged ? JSON.stringify(incomingTags) : '(none)'}`,
      );
      await dbUpdate(deps.db, existing.id, {
        projectIds: mergedProjectIds,
        tags: mergedTags,
      });
    } else {
      console.log(`[url-ingest] Deduped — existing item: ${existing.id}, no membership changes`);
    }

    return {
      id: existing.id,
      title: existing.title,
      type: existing.type,
      source_url: normalized,
      deduped: true,
      url_type: urlTypeByPattern,
      status: existing.processing_status,
      completion: Promise.resolve({
        id: existing.id,
        title: existing.title,
        chunkCount: 0,
        status: existing.processing_status,
      }),
    };
  }

  const urlType = await detectUrlType(normalized);
  trace.url_type = urlType;
  console.log(`[url-ingest] Detected type: ${urlType}`);

  if (deps.config.llmProvider !== 'real' && (urlType === 'youtube' || urlType === 'x')) {
    const media = urlType === 'x' ? await fetchPublicXPost(normalized) : await extractLocalMedia('url', normalized);
    recordStage(trace, urlType === 'x' ? 'x.public_post' : 'youtube.local_transcript', media.text);
    const started = await createContentItem(deps, { type: 'document', title: opts.title ?? media.title, content: media.text, sourceUrl: normalized, projectIds: opts.projectIds, tags: opts.tags, trace });
    return { id: started.id, title: opts.title ?? media.title ?? 'Transcript', type: 'document', source_url: normalized, deduped: false, url_type: urlType, status: started.status, completion: started.completion };
  }
  switch (urlType) {
    case 'youtube':
      return await handleYoutube(deps, normalized, opts, trace);
    case 'x':
      return await handleXThread(deps, normalized, opts, trace);
    case 'pdf':
      return await handleBinary(deps, normalized, opts, 'application/pdf', trace);
    case 'image':
    case 'audio':
    case 'video':
      return await handleBinary(deps, normalized, opts, null, trace);
    case 'html':
    default:
      return await handleHtml(deps, normalized, opts, trace);
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleYoutube(
  deps: ServiceDeps,
  url: string,
  opts: IngestFromUrlInput,
  trace: IngestTrace,
): Promise<IngestFromUrlResult> {
  // Single source of truth: Supadata's /v1/youtube/transcript endpoint.
  // No fallback by design — the previous direct-scrape → Firecrawl → xAI ladder
  // chained 60-180s of latency on cold cases (YouTube blocks Azure datacenter
  // IPs, so direct scrape almost always fell through). Supadata is 1-5s and
  // returns a clean transcript. If it fails, we let the failure surface to
  // the caller rather than silently mask it.
  const supadata = new SupadataClient(deps.config.supadataApiKey);
  const res = await supadata.fetchYouTubeTranscript(url, { lang: 'en' });
  const transcript = res.content;

  recordStage(trace, 'youtube.transcript', transcript);
  if (res.lang && res.lang !== 'en') {
    addNote(trace, `requested-lang=en, supadata-served=${res.lang}`);
  }

  const started = await createContentItem(deps, {
    type: 'document',
    content: transcript,
    title: opts.title, // auto-generated via metadata LLM if omitted
    projectIds: opts.projectIds,
    tags: opts.tags,
    sourceUrl: url,
    trace,
  });

  return {
    id: started.id,
    title: opts.title?.trim() || `Processing… ${url.slice(0, 80)}`,
    type: 'document',
    source_url: url,
    deduped: false,
    url_type: 'youtube',
    status: started.status,
    completion: started.completion,
  };
}

async function handleXThread(
  deps: ServiceDeps,
  url: string,
  opts: IngestFromUrlInput,
  trace: IngestTrace,
): Promise<IngestFromUrlResult> {
  // Primary: xAI Agent Tools API with x_search built-in tool (the 2026 replacement
  //   for the deprecated live_search). Grok does the X fetch server-side.
  // Firecrawl is NOT a useful fallback here — they explicitly refuse x.com.
  const xai = new XaiClient(deps.config.xaiApiKey);

  let content: string;
  let fetchedTitle: string;

  try {
    const res = await xai.fetchXThread(url);
    content = res.content;
    fetchedTitle = res.title;
    console.log(`[url-ingest][x] xAI x_search succeeded — length: ${content.length}`);
    recordStage(trace, 'x.grok_response', content);
    // Detect Grok returning the same post text twice in its own response.
    if (content.length > 200) {
      const firstHalf = content.slice(0, Math.floor(content.length / 2));
      if (firstHalf.length > 100 && content.indexOf(firstHalf.slice(0, 100), firstHalf.length) >= 0) {
        addNote(trace, 'grok_response_contains_repeated_prefix');
      }
    }
  } catch (err) {
    // Re-throw without extra wrapping. xai.ts already produces a clear,
    // actionable message (X_SEARCH_MISS: ...); double-wrapping just makes
    // the downstream error harder to match on.
    throw err instanceof Error ? err : new Error(String(err));
  }

  const started = await createContentItem(deps, {
    type: 'document',
    content,
    title: opts.title ?? fetchedTitle,
    projectIds: opts.projectIds,
    tags: opts.tags,
    sourceUrl: url,
    trace,
  });

  return {
    id: started.id,
    title: opts.title?.trim() || fetchedTitle || `Processing… ${url.slice(0, 80)}`,
    type: 'document',
    source_url: url,
    deduped: false,
    url_type: 'x',
    status: started.status,
    completion: started.completion,
  };
}

async function handleHtml(
  deps: ServiceDeps,
  url: string,
  opts: IngestFromUrlInput,
  trace: IngestTrace,
): Promise<IngestFromUrlResult> {
  const firecrawl = new FirecrawlClient(deps.config.firecrawlApiKey);
  const { title, markdown, statusCode } = deps.config.llmProvider === 'real' ? await firecrawl.scrape(url) : await scrapeLocal(url);
  console.log(`[url-ingest][html] scraped — title: "${title}", length: ${markdown.length}, status: ${statusCode ?? 'n/a'}`);
  recordStage(trace, 'html.markdown', markdown);

  // Guard against saving placeholder pages and error pages. Three layers:
  //   1. Firecrawl reports HTTP status — reject 4xx/5xx outright
  //   2. Length guard — catches example.com and similar tiny-body pages
  //   3. Title + body pattern guards — catches sites like Wikipedia whose
  //      "article not found" pages have real chrome/nav but are still stubs.
  if (statusCode !== undefined && statusCode >= 400) {
    throw new Error(
      `Upstream HTTP ${statusCode} at ${url}. Not saving ${title ? `("${title}")` : ''}`,
    );
  }
  if (markdown.length < MIN_HTML_CONTENT_CHARS) {
    throw new Error(
      `Scraped content from ${url} is suspiciously short (${markdown.length} chars, threshold ${MIN_HTML_CONTENT_CHARS}). ` +
      `Likely a placeholder or error page — not saving. Title was: "${title}"`,
    );
  }
  if (ERROR_TITLE_PATTERNS.some((p) => p.test(title)) || GENERIC_TITLES.has(title.toLowerCase().trim())) {
    throw new Error(
      `Page title "${title}" indicates a 404/error/placeholder page at ${url}. Not saving.`,
    );
  }
  if (ERROR_BODY_PATTERNS.some((p) => p.test(markdown))) {
    throw new Error(
      `Page content at ${url} matches a known "no such article" stub pattern. Not saving. Title was: "${title}"`,
    );
  }

  const started = await createContentItem(deps, {
    type: 'document',
    content: markdown,
    title: opts.title ?? title,
    projectIds: opts.projectIds,
    tags: opts.tags,
    sourceUrl: url,
    trace,
  });

  return {
    id: started.id,
    title: opts.title?.trim() || title || `Processing… ${url.slice(0, 80)}`,
    type: 'document',
    source_url: url,
    deduped: false,
    url_type: 'html',
    status: started.status,
    completion: started.completion,
  };
}

async function handleBinary(
  deps: ServiceDeps,
  url: string,
  opts: IngestFromUrlInput,
  forcedMimeType: string | null,
  trace: IngestTrace,
): Promise<IngestFromUrlResult> {
  const res = await fetch(url, { redirect: 'follow' });
  // fetch.ok is true for any 2xx. Treat 3xx (follow should have handled),
  // 4xx and 5xx as failures with a clear message.
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${res.status} ${res.statusText || ''}`.trim());
  }

  // Enforce size cap up front via Content-Length when available
  const lenHeader = res.headers.get('content-length');
  if (lenHeader) {
    const len = parseInt(lenHeader, 10);
    if (len > MAX_DOWNLOAD_BYTES) {
      throw new Error(`File too large (${(len / 1024 / 1024).toFixed(1)} MB, max ${MAX_DOWNLOAD_BYTES / 1024 / 1024} MB)`);
    }
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_DOWNLOAD_BYTES) {
    throw new Error(`File too large (${(buf.length / 1024 / 1024).toFixed(1)} MB, max ${MAX_DOWNLOAD_BYTES / 1024 / 1024} MB)`);
  }

  const mimeType =
    forcedMimeType ??
    res.headers.get('content-type')?.split(';')[0]?.trim() ??
    'application/octet-stream';
  const filename = (() => {
    try {
      const path = new URL(url).pathname;
      return path.split('/').filter(Boolean).pop() ?? 'download';
    } catch {
      return 'download';
    }
  })();

  console.log(`[url-ingest][binary] downloaded ${(buf.length / 1024).toFixed(1)} KB, mime: ${mimeType}`);

  const started = await createContentItem(deps, {
    type: 'document',
    title: opts.title,
    projectIds: opts.projectIds,
    tags: opts.tags,
    sourceUrl: url,
    file: { data: buf, mimeType, filename },
    trace,
  });

  return {
    id: started.id,
    title: opts.title?.trim() || filename || `Processing… ${url.slice(0, 80)}`,
    type: 'document',
    source_url: url,
    deduped: false,
    url_type: inferUrlTypeFromMime(mimeType),
    status: started.status,
    completion: started.completion,
  };
}

function inferUrlTypeFromMime(mime: string): UrlType {
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'html';
}
