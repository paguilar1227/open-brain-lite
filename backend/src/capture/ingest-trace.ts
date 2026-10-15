/**
 * Per-ingest trace scaffold. One trace per save — threaded through url-ingest
 * and content-items so every stage can record a fingerprint {len, hash,
 * sample}. Fingerprints are logged and also persisted onto the row's
 * metadata.ingest_trace for retroactive forensics.
 *
 * Why: length + count logs aren't enough to answer "did the upstream duplicate
 * the content?" or "did Flash echo the input back as extracted_text?" We need
 * fingerprints at each hop.
 */

import { createHash, randomUUID } from 'crypto';

export interface StageFingerprint {
  len: number;
  hash: string;        // sha256[:12] — short enough to eyeball, long enough to match
  sample: string;      // first 120 chars, newlines collapsed
}

export interface IngestTrace {
  trace_id: string;
  url_type?: string;
  source_url?: string;
  stages: Record<string, StageFingerprint | null>;
  started_at: string;
  notes: string[];
}

export function newTrace(attrs: { source_url?: string; url_type?: string } = {}): IngestTrace {
  return {
    trace_id: randomUUID(),
    url_type: attrs.url_type,
    source_url: attrs.source_url,
    stages: {},
    started_at: new Date().toISOString(),
    notes: [],
  };
}

export function fingerprint(content: string | null | undefined): StageFingerprint | null {
  if (content == null || content.length === 0) return null;
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 12);
  const sample = content.slice(0, 120).replace(/\s+/g, ' ').trim();
  return { len: content.length, hash, sample };
}

export function recordStage(trace: IngestTrace, stage: string, content: string | null | undefined): void {
  const fp = fingerprint(content);
  trace.stages[stage] = fp;
  if (fp) {
    console.log(`[trace:${trace.trace_id.slice(0, 8)}] ${stage} len=${fp.len} hash=${fp.hash} sample="${fp.sample.slice(0, 80)}"`);
  } else {
    console.log(`[trace:${trace.trace_id.slice(0, 8)}] ${stage} (null)`);
  }
}

export function addNote(trace: IngestTrace, note: string): void {
  trace.notes.push(note);
  console.log(`[trace:${trace.trace_id.slice(0, 8)}] NOTE ${note}`);
}

/**
 * Check whether a later stage is a duplicate or superset of an earlier stage.
 * Useful to flag "Flash echoed input.content" without guessing.
 */
export function isEchoOf(a: StageFingerprint | null, b: StageFingerprint | null): boolean {
  if (!a || !b) return false;
  return a.hash === b.hash;
}
