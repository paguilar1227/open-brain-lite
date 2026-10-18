// Telemetry must be the first import: the Azure Monitor distro patches
// http/https/fetch/pg at require-time. Importing it after any of those
// modules would silently disable auto-instrumentation.
// Local runtime uses console/OpenTelemetry no-op instrumentation; no cloud telemetry export.

import { recoverInterruptedIngests } from './services/content-items.js';
import { serve } from '@hono/node-server';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createDbClient } from './db/client.js';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { SubscriptionLLMProvider, trySelectCopilotDefault } from './providers/subscription.js';
import { LocalFileStorage } from './storage/local.js';
import { OllamaEmbeddingProvider, OllamaLLMProvider } from './providers/ollama.js';
import { createBlobStorage } from './storage/blob.js';
import { GeminiEmbeddingProvider } from './providers/gemini-embedding.js';
import { GeminiLLMProvider } from './providers/gemini-llm.js';
import { AnthropicLLMProvider } from './providers/anthropic-llm.js';
import { AzureFoundryLLMProvider } from './providers/azure-foundry-llm.js';
import { AzureFoundryResponsesProvider } from './providers/azure-foundry-responses.js';
import { StubEmbeddingProvider, StubLLMProvider } from './providers/stub.js';
import type { EmbeddingProvider, LLMProvider } from './providers/types.js';
import type { ServiceDeps } from './services/index.js';

const config = loadConfig();
const db = createDbClient(config.databaseUrl);

// Model roles:
//   embeddingProvider: Gemini Embedding 2 (3072-dim, unified multimodal)
//   metadataLLM:       Claude Haiku 4.5 — lowest hallucination (~3%) on
//                      entity/topic extraction. Used for text, image OCR,
//                      and pdf-extracted text. Anthropic doesn't yet
//                      support audio/video input though.
//   mediaMetadataLLM:  Gemini 3 Flash Preview — fallback for audio/video
//                      where Haiku has no support. Used only when Haiku
//                      can't handle the media; everything else stays on
//                      Haiku for consistency + entity-extraction quality.
//   queryDepthLLM:     Haiku 4.5 again — classifies RAG questions as
//                      fast vs thorough. Tiny prompt, ~$0.0001/call.
//   ragFastLLM:        Azure gpt-5-4 (chat completions) — default RAG
//                      synthesis, 2-5s response, used on simple questions.
//   ragDeepLLM:        Azure gpt-5-4-pro (Responses API) — reasoning tier,
//                      used on multi-hop / comparison / inference questions.
//                      15-60s response.
//
// LLM_PROVIDER=stub swaps every LLM + embedding upstream for deterministic
// in-memory fakes (providers/stub.ts). Used by local dev + CI integration tests.
let embeddingProvider: EmbeddingProvider;
let metadataLLM: LLMProvider;
let mediaMetadataLLM: LLMProvider;
let queryDepthLLM: LLMProvider;
let ragFastLLM: LLMProvider;
let ragDeepLLM: LLMProvider;

if (config.llmProvider === 'stub') {
  console.log('[providers] LLM_PROVIDER=stub — using deterministic stub providers');
  const stubLLM = new StubLLMProvider();
  embeddingProvider = new StubEmbeddingProvider();
  metadataLLM = stubLLM;
  mediaMetadataLLM = stubLLM;
  queryDepthLLM = stubLLM;
  ragFastLLM = stubLLM;
  ragDeepLLM = stubLLM;
} else if (config.llmProvider !== 'real') {
  const local = new SubscriptionLLMProvider(config);
  embeddingProvider = new OllamaEmbeddingProvider(config.ollamaUrl, config.embeddingModel);
  metadataLLM = mediaMetadataLLM = queryDepthLLM = ragFastLLM = ragDeepLLM = local;
} else {
  const haiku = new AnthropicLLMProvider(config.anthropicApiKey, 'claude-haiku-4-5-20251001');
  const geminiMedia = new GeminiLLMProvider(config.geminiApiKey, 'gemini-3-flash-preview');
  embeddingProvider = new GeminiEmbeddingProvider(config.geminiApiKey);
  metadataLLM = haiku;
  mediaMetadataLLM = geminiMedia;
  queryDepthLLM = haiku;
  ragFastLLM = new AzureFoundryLLMProvider({
    endpoint: config.azureOpenAIEndpoint,
    apiKey: config.azureOpenAIKey,
    deployment: config.azureRagDeployment,
  });
  ragDeepLLM = new AzureFoundryResponsesProvider({
    endpoint: config.azureOpenAIEndpoint,
    apiKey: config.azureOpenAIKey,
    deployment: config.azureDeepRagDeployment,
  });
}

const deps: ServiceDeps = {
  db,
  embeddingProvider,
  metadataLLM,
  mediaMetadataLLM,
  queryDepthLLM,
  ragFastLLM,
  ragDeepLLM,
  blobStorage: config.storageProvider === 'local' ? new LocalFileStorage(config.filesDir, config.apiKey) : createBlobStorage(config.azureStorageConnectionString, config.azureStorageContainer),
  config,
};

async function runMigrations(): Promise<void> {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    // The Dockerfile copies migrations to backend/migrations/, so prod
    // resolves via __dirname/.. — which is what existing readFileSync
    // calls below assume. In local dev we run `tsx watch src/server.ts`
    // and the migrations live at the project root, one level up. Fall
    // back to that when the prod path doesn't exist.
    const migrationsRoot = existsSync(join(__dirname, '..', 'migrations'))
      ? join(__dirname, '..', 'migrations')
      : join(__dirname, '..', '..', 'migrations');
    const migration = (name: string) => join(migrationsRoot, name);

    // Migration 001: initial schema
    const existsResult = await deps.db.pool.query(
      "SELECT count(*) as count FROM pg_tables WHERE schemaname = 'public' AND tablename = 'projects'",
    );
    if (parseInt(existsResult.rows[0].count) === 0) {
      console.log('Running migration 001...');
      const sql = readFileSync(migration('001_schema.sql'), 'utf-8');
      await deps.db.pool.query(sql);
      console.log('Migration 001 complete.');
    } else {
      console.log('Schema 001 already present.');
    }

    // Migration 002: source_url column for URL-ingested content
    const m002Check = await deps.db.pool.query(
      `SELECT count(*) as count FROM information_schema.columns
       WHERE table_name = 'content_items' AND column_name = 'source_url'`,
    );
    if (parseInt(m002Check.rows[0].count) === 0) {
      console.log('Running migration 002...');
      const sql = readFileSync(migration('002_source_url.sql'), 'utf-8');
      await deps.db.pool.query(sql);
      console.log('Migration 002 complete.');
    }

    // Migration 003: entities + chunk_entities graph tables, published_at column
    const m003Check = await deps.db.pool.query(
      "SELECT count(*) as count FROM pg_tables WHERE schemaname = 'public' AND tablename = 'entities'",
    );
    if (parseInt(m003Check.rows[0].count) === 0) {
      console.log('Running migration 003...');
      const sql = readFileSync(migration('003_entities_graph.sql'), 'utf-8');
      await deps.db.pool.query(sql);
      console.log('Migration 003 complete.');
    }

    // Migration 004: processing_status + processing_error columns on content_items
    const m004Check = await deps.db.pool.query(
      `SELECT count(*) as count FROM information_schema.columns
       WHERE table_name = 'content_items' AND column_name = 'processing_status'`,
    );
    if (parseInt(m004Check.rows[0].count) === 0) {
      console.log('Running migration 004...');
      const sql = readFileSync(migration('004_processing_status.sql'), 'utf-8');
      await deps.db.pool.query(sql);
      console.log('Migration 004 complete.');
    }

    // Migration 005: backfill control-char sanitization on existing content rows.
    // Idempotent — only runs when there are still rows containing C0/DEL bytes.
    const m005Check = await deps.db.pool.query(
      `SELECT count(*) AS count FROM content_items
        WHERE content IS NOT NULL
          AND content ~ E'[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]'`,
    );
    const m005Count = parseInt(m005Check.rows[0].count);
    if (m005Count > 0) {
      console.log(`Running migration 005 — control-char backfill (${m005Count} affected rows)...`);
      const sql = readFileSync(migration('005_backfill_control_chars.sql'), 'utf-8');
      await deps.db.pool.query(sql);
      console.log('Migration 005 complete.');
    }

    // Migration 006: ingest_completed_at column for the polling endpoint
    const m006Check = await deps.db.pool.query(
      `SELECT count(*) as count FROM information_schema.columns
       WHERE table_name = 'content_items' AND column_name = 'ingest_completed_at'`,
    );
    if (parseInt(m006Check.rows[0].count) === 0) {
      console.log('Running migration 006...');
      const sql = readFileSync(migration('006_ingest_completed_at.sql'), 'utf-8');
      await deps.db.pool.query(sql);
      console.log('Migration 006 complete.');
    }

    // Migration 007: pinned_at on content_items, todos, projects
    const m007Check = await deps.db.pool.query(
      `SELECT count(*) as count FROM information_schema.columns
       WHERE table_name = 'content_items' AND column_name = 'pinned_at'`,
    );
    if (parseInt(m007Check.rows[0].count) === 0) {
      console.log('Running migration 007...');
      const sql = readFileSync(migration('007_pinned.sql'), 'utf-8');
      await deps.db.pool.query(sql);
      console.log('Migration 007 complete.');
    }

    // Migration 008: manual_order on todos
    const m008Check = await deps.db.pool.query(
      `SELECT count(*) as count FROM information_schema.columns
       WHERE table_name = 'todos' AND column_name = 'manual_order'`,
    );
    if (parseInt(m008Check.rows[0].count) === 0) {
      console.log('Running migration 008...');
      const sql = readFileSync(migration('008_manual_order.sql'), 'utf-8');
      await deps.db.pool.query(sql);
      console.log('Migration 008 complete.');
    }

    // Migration 009: first-class folder column on content_items (+ backfill
    // from legacy slash-tags). The backfill runs inside the same SQL file, so
    // it's gated by the column-existence probe — runs exactly once.
    const m009Check = await deps.db.pool.query(
      `SELECT count(*) as count FROM information_schema.columns
       WHERE table_name = 'content_items' AND column_name = 'folder'`,
    );
    if (parseInt(m009Check.rows[0].count) === 0) {
      console.log('Running migration 009...');
      const sql = readFileSync(migration('009_content_folder.sql'), 'utf-8');
      await deps.db.pool.query(sql);
      console.log('Migration 009 complete.');
    }

    // Migration 010: strip tags off subtasks (root-only tags invariant).
    // Idempotent data backfill — only runs while offending rows exist.
    const m010Check = await deps.db.pool.query(
      `SELECT count(*) AS count FROM todos WHERE parent_id IS NOT NULL AND cardinality(tags) > 0`,
    );
    const m010Count = parseInt(m010Check.rows[0].count);
    if (m010Count > 0) {
      console.log(`Running migration 010 — subtask-tags cleanup (${m010Count} rows)...`);
      const sql = readFileSync(migration('010_subtask_tags_cleanup.sql'), 'utf-8');
      await deps.db.pool.query(sql);
      console.log('Migration 010 complete.');
    }

    await deps.db.pool.query(readFileSync(migration('011_project_memory.sql'), 'utf8'));
    const timeline = await deps.db.pool.query("SELECT to_regclass('public.project_timeline_events') AS table_name");
    if (!timeline.rows[0].table_name) {
      await deps.db.pool.query(readFileSync(migration('012_project_timeline.sql'), 'utf8'));
    }
    const sessions = await deps.db.pool.query("SELECT 1 FROM information_schema.columns WHERE table_name='content_items' AND column_name='session_id'");
    if (!sessions.rows.length) await deps.db.pool.query(readFileSync(migration('013_session_workspaces.sql'), 'utf8'));
    console.log('All migrations up to date.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

const app = createApp(deps);

runMigrations().then(async () => {
  await trySelectCopilotDefault(config);
  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`Open Brain Lite listening on port ${info.port}`);
    void recoverInterruptedIngests(deps).catch(err => console.error('[recovery]', err));
  });
});
