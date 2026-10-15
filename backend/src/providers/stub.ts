// src/providers/stub.ts
//
// Deterministic stub providers for local UI iteration and CI integration tests.
// Activated when LLM_PROVIDER=stub. Returns shape-correct, hash-derived fakes
// so the full ingest → search → RAG pipeline runs end-to-end without paid APIs.
//
// What's faked vs real (in stub mode):
//   - Embeddings: 3072-dim deterministic vector from text hash. Same text →
//     same vector. Similar text → vectors with overlapping high-magnitude axes,
//     so cosine ranking is plausible (not accurate).
//   - LLM completions: dispatched by system-prompt heuristics. Returns the
//     shape each call site expects (entity arrays, metadata records, depth
//     classifier verdicts, RAG answers). Quality is fake, structure is real.
//
// What's still real even in stub mode:
//   - Postgres + pgvector
//   - Azure Blob (against Azurite locally)
//   - PDF text extraction (pdf-parse, all local)
//   - URL fetchers (Firecrawl/xAI/Supadata) — currently NOT stubbed; if you
//     ingest a URL in stub mode it still calls those services. To exercise
//     URL ingest offline, swap to `LLM_PROVIDER=stub` AND avoid /from-url.
//
// Quality validation: flip back to LLM_PROVIDER=real (default) for a small
// curated suite before merging anything that touches prompts.

import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type {
  EmbeddingProvider,
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMResponse,
} from './types.js';

// Stub-OCR fixtures: when the metadata extractor runs against an image/audio
// attachment in stub mode, we look up a hand-written response keyed by the
// sha256 of the file bytes (backend/tests/fixtures/stub-ocr/<hash>.json).
// This gives the local seed + drawer a realistic "extracted text" surface
// without burning a real Gemini multimodal call. Falls through to the
// generic placeholder if no fixture is present for the hash.
const __dirname = dirname(fileURLToPath(import.meta.url));
const STUB_OCR_DIR = join(__dirname, '..', '..', 'tests', 'fixtures', 'stub-ocr');

const EMBED_DIMS = 768;

// ---------------------------------------------------------------------------
// Embedding stub
// ---------------------------------------------------------------------------

export class StubEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = EMBED_DIMS;

  async embed(content: string, files?: Array<{ data: Buffer; mimeType: string }>): Promise<number[]> {
    // Use char-trigrams as the embedding unit so morphological variants
    // ("cookie" / "cookies", "auth" / "authn") share most of their components.
    // Single-token hashing is too brittle — two texts that mean the same thing
    // would not register at all on the production search threshold (0.65).
    // Each trigram maps to one axis (mod EMBED_DIMS); contributions accumulate.
    const tokens = tokenize(content);
    const fileSig = (files ?? []).map((f) => `${f.mimeType}:${f.data.length}`).join('|');

    const vec = new Array<number>(EMBED_DIMS).fill(0);
    for (const tok of tokens) {
      const padded = `_${tok}_`; // boundaries help short tokens
      for (let i = 0; i + 3 <= padded.length; i++) {
        const trigram = padded.slice(i, i + 3);
        const h = hashToInt(trigram);
        const axis = h % EMBED_DIMS;
        vec[axis] += 1;
      }
    }
    if (fileSig) {
      const h = hashToInt(fileSig);
      vec[h % EMBED_DIMS] += 1;
    }

    return l2normalize(vec);
  }
}

// ---------------------------------------------------------------------------
// LLM stub — dispatches by system-prompt content
// ---------------------------------------------------------------------------

type Attachment = { mimeType: string; data: Buffer };
type Dispatcher = (system: string, user: string, opts: LLMOptions, attachments: Attachment[]) => string;

export class StubLLMProvider implements LLMProvider {
  async complete(messages: LLMMessage[], options: LLMOptions = {}): Promise<LLMResponse> {
    const system = options.systemPrompt ?? '';
    const user = flattenUserContent(messages);
    const attachments = extractAttachments(messages);
    const dispatcher = pickDispatcher(system, options);
    const content = dispatcher(system, user, options, attachments);
    return {
      content,
      tokensUsed: { input: estimateTokens(system + user), output: estimateTokens(content), total: 0 },
    };
  }
}

function pickDispatcher(system: string, options: LLMOptions): Dispatcher {
  const sys = system.toLowerCase();

  // Order matters — most specific first.
  if (sys.includes('classify') && sys.includes('depth')) return depthClassifierStub;
  if (sys.includes('extract') && sys.includes('entit')) return entityExtractionStub;
  // Metadata-extraction prompts ask for title + topics + extracted_text.
  // Tags used to be in this list but are now user-only.
  if (sys.includes('title') && sys.includes('topics')) return metadataExtractionStub;

  // Fallbacks by responseFormat
  if (options.responseFormat === 'json') return emptyJsonStub;
  return ragSynthesisStub;
}

// ---------------------------------------------------------------------------
// Specific dispatchers
// ---------------------------------------------------------------------------

const depthClassifierStub: Dispatcher = (_sys, user) => {
  const text = user.trim();
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const isThorough =
    wordCount >= 9 ||
    /\b(why|how|explain|compare|contrast|difference|tradeoff|relate)\b/i.test(text);
  const entities = extractCapitalizedPhrases(text).slice(0, 5).map((name) => ({
    name,
    type: 'concept',
  }));
  return JSON.stringify({
    depth: isThorough ? 'thorough' : 'fast',
    reason: isThorough ? 'multi-hop or analytical' : 'simple lookup',
    entities,
  });
};

const entityExtractionStub: Dispatcher = (_sys, user) => {
  const phrases = extractCapitalizedPhrases(user).slice(0, 12);
  const entities = phrases.map((name) => {
    // First mention: a 10-200 char span containing the entity name, copied
    // verbatim from the user text (so the chunk-mention mapping works).
    const span = findSpan(user, name) ?? name;
    return {
      canonical_name: name,
      type: 'concept' as const,
      aliases: [],
      confidence: 0.9,
      mentions: [span],
    };
  });
  return JSON.stringify(entities);
};

function findSpan(text: string, needle: string): string | null {
  const idx = text.indexOf(needle);
  if (idx < 0) return null;
  // Take a window of ~80 chars centered on the match, clipped to sentence-ish edges.
  const start = Math.max(0, idx - 20);
  const end = Math.min(text.length, idx + needle.length + 60);
  return text.slice(start, end).trim();
}

const metadataExtractionStub: Dispatcher = (_sys, user, _opts, attachments) => {
  // Binary attachment present (image, audio, video, PDF that bypassed
  // pdf-parse, etc.) → try the stub-OCR fixture before falling back to
  // text-only heuristics. Without this, every image in dev shows up as
  // "(no text content)" because the stub has no real OCR/transcription.
  const fixture = attachments.length > 0 ? lookupStubOcr(attachments[0].data) : null;
  if (fixture) return JSON.stringify(fixture);

  const text = user.trim();
  const firstSentence = (text.match(/^.{1,200}?(?:[.!?](?:\s|$)|\n|$)/) ?? [text.slice(0, 80)])[0]
    .trim()
    .replace(/[.!?\s]+$/, '');
  const title = (firstSentence || 'Untitled').slice(0, 80);

  const wordFreq = new Map<string, number>();
  for (const w of text.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? []) {
    if (STOPWORDS.has(w)) continue;
    wordFreq.set(w, (wordFreq.get(w) ?? 0) + 1);
  }
  const topWords = [...wordFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([w]) => w);

  return JSON.stringify({
    title,
    topics: topWords.slice(0, 4),
    // Tags are user-authored only; the metadata extractor doesn't
    // propose them. Stub mirrors the production prompt schema.
    extracted_text: text.slice(0, 4000),
    published_at: null,
  });
};

function lookupStubOcr(data: Buffer): Record<string, unknown> | null {
  const hash = createHash('sha256').update(data).digest('hex');
  const path = join(STUB_OCR_DIR, `${hash}.json`);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    // Strip the documentation-only `_fixture_source` field before returning —
    // the production schema doesn't have it, and we want stub responses to
    // round-trip through the same validator as real ones.
    const { _fixture_source: _ignored, ...rest } = raw;
    return rest;
  } catch (err) {
    console.warn(`[stub-ocr] failed to read fixture ${hash}.json:`, err instanceof Error ? err.message : err);
    return null;
  }
}

const ragSynthesisStub: Dispatcher = (_sys, user) => {
  // The user message in RAG calls is the assembled prompt with retrieved
  // chunks inlined. We don't try to be smart — just acknowledge the question
  // and quote the first chunk if we can find one.
  const question = (user.match(/(?:question|query)[:\s]+(.{1,200})/i)?.[1] ?? user.slice(0, 200)).trim();
  const chunkMatch = user.match(/(?:chunk|passage|excerpt|context)[\s\S]{0,500}?\n([^\n]{20,300})/i);
  const quoted = chunkMatch ? chunkMatch[1].trim() : null;

  let answer = `[stub] Based on the retrieved context, here is a placeholder answer for: "${question}".`;
  if (quoted) answer += ` One relevant excerpt: "${quoted}"`;
  answer += ' Switch LLM_PROVIDER=real for a real synthesis.';
  return answer;
};

const emptyJsonStub: Dispatcher = () => '{}';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flattenUserContent(messages: LLMMessage[]): string {
  return messages
    .filter((m) => m.role === 'user')
    .flatMap((m) => {
      if (typeof m.content === 'string') return [m.content];
      return m.content.map((p) => p.text ?? '').filter(Boolean);
    })
    .join('\n');
}

function extractAttachments(messages: LLMMessage[]): Attachment[] {
  const out: Attachment[] = [];
  for (const m of messages) {
    if (typeof m.content === 'string') continue;
    for (const part of m.content) {
      // Image and audio/video parts both come through as { type: 'image' | ...,
      // data: Buffer | string, mimeType: string }. Production-side providers
      // also send base64-encoded strings; coerce both into Buffers so the
      // sha256 lookup is stable regardless of how the caller framed it.
      const raw = (part as { data?: unknown }).data;
      const mime = (part as { mimeType?: string }).mimeType;
      if (raw == null || !mime) continue;
      const buf = Buffer.isBuffer(raw)
        ? raw
        : typeof raw === 'string'
          ? Buffer.from(raw, 'base64')
          : null;
      if (buf) out.push({ mimeType: mime, data: buf });
    }
  }
  return out;
}

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/\b[a-z0-9]{2,}\b/g) ?? []).slice(0, 2000);
}

function hashToInt(s: string): number {
  // 32-bit unsigned int from sha256.
  const hex = createHash('sha256').update(s).digest('hex');
  return parseInt(hex.slice(0, 8), 16) >>> 0;
}

function l2normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum) || 1;
  return v.map((x) => x / norm);
}

function extractCapitalizedPhrases(text: string): string[] {
  const matches = text.match(/\b[A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+){0,3}\b/g) ?? [];
  return [...new Set(matches.filter((m) => m.length >= 3 && !STOPWORDS.has(m.toLowerCase())))];
}

function estimateTokens(s: string): number {
  return Math.max(1, Math.ceil(s.length / 4));
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her', 'was', 'one', 'our', 'out', 'day',
  'get', 'has', 'him', 'his', 'how', 'man', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy', 'did',
  'its', 'let', 'put', 'say', 'she', 'too', 'use', 'with', 'this', 'that', 'have', 'from', 'they', 'will',
  'been', 'were', 'each', 'which', 'their', 'time', 'into', 'them', 'than', 'these', 'about',
]);
