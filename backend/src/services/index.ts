import type { DbClient } from '../db/client.js';
import type { EmbeddingProvider, LLMProvider } from '../providers/types.js';
import type { BlobStorage } from '../storage/blob.js';
import type { Config } from '../config.js';

export interface ServiceDeps {
  db: DbClient;
  embeddingProvider: EmbeddingProvider;
  metadataLLM: LLMProvider;       // Claude Haiku 4.5 — low-hallucination metadata + entity extraction
                                  //                    (text, image OCR, pdf-extracted text)
  mediaMetadataLLM: LLMProvider;  // Gemini 3 Flash Preview — for audio/video where Haiku has no support.
                                  //                          Falls back here only when Haiku can't handle the media.
  ragFastLLM: LLMProvider;        // Azure gpt-5-4 (chat completions) — default RAG synthesis, 2-5s
  ragDeepLLM: LLMProvider;        // Azure gpt-5-4-pro (Responses API) — reasoning-heavy RAG, 15-60s
  queryDepthLLM: LLMProvider;     // Haiku 4.5 — classifies question as fast|thorough
  blobStorage: BlobStorage;
  config: Config;
}
