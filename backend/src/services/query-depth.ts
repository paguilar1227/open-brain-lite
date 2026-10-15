// src/services/query-depth.ts
//
// Classifies an incoming RAG question as "fast" (single-fact / direct lookup)
// or "thorough" (multi-hop, synthesis, contradiction analysis). Routing
// decision drives which synthesis model runs: fast stays on gpt-5-4 base
// for snappy answers, thorough escalates to gpt-5-4-pro via Responses API.
//
// Uses Haiku 4.5 — the same provider we already wired for metadata.
// Cost: ~$0.0001 per call, latency ~300ms.

import type { ServiceDeps } from './index.js';

export type QueryDepth = 'fast' | 'thorough';

export interface DepthClassification {
  depth: QueryDepth;
  reason: string;
  entities: Array<{ name: string; type: 'person' | 'org' | 'concept' | 'tool' | 'paper' }>;
}

const CLASSIFIER_SYSTEM_PROMPT = `You classify retrieval-augmented questions and extract named entities for graph expansion.

For each question, return:
- depth: "fast" | "thorough"
- reason: one short sentence
- entities: named entities the question explicitly references, with their type (person/org/concept/tool/paper)

Depth taxonomy:
- "fast" — direct lookup, single-fact retrieval, simple summary, definition query, or question answerable from a single source. Examples:
  - "What did I save about pgvector?"
  - "Summarize the Domain-Driven Design note."
  - "What's the title of the paper I saved last week?"

- "thorough" — multi-hop reasoning, comparison across sources, contradiction / tradeoff analysis, inference beyond explicit text. Examples:
  - "Compare the approach in my research report to the InstructGPT paper."
  - "What are the tradeoffs between the embedding models I've read about?"
  - "Across all my saved material, what's the consensus on GraphRAG?"

When in doubt, lean "fast". Only return "thorough" when multi-hop reasoning is clearly required.

Entity extraction rules:
- Extract only entities EXPLICITLY named in the question.
- Use canonical / full forms where obvious ("pgvector" not "pg"; "GPT-5.4" not "gpt").
- Type taxonomy:
  - person: real named people
  - org: companies, universities, research labs
  - concept: abstract ideas, techniques (RAG, DDD, multi-hop retrieval)
  - tool: concrete products, libraries, models (pgvector, Haiku 4.5, Neo4j)
  - paper: named academic papers / reports
- Empty array is valid when the question has no named entities.

Return a single JSON object:
{"depth": "fast" | "thorough", "reason": "<one short sentence>", "entities": [{"name": "...", "type": "..."}]}`;

export async function classifyQueryDepth(
  deps: ServiceDeps,
  question: string,
): Promise<DepthClassification> {
  try {
    const res = await deps.queryDepthLLM.complete(
      [{ role: 'user', content: question }],
      {
        systemPrompt: CLASSIFIER_SYSTEM_PROMPT,
        responseFormat: 'json',
        maxTokens: 200,
      },
    );

    const parsed = JSON.parse(res.content) as {
      depth?: string;
      reason?: string;
      entities?: Array<{ name?: unknown; type?: unknown }>;
    };
    const depth: QueryDepth = parsed.depth === 'thorough' ? 'thorough' : 'fast';
    const reason = typeof parsed.reason === 'string' && parsed.reason.trim()
      ? parsed.reason.trim().slice(0, 200)
      : 'no reason given';

    const entities: DepthClassification['entities'] = [];
    if (Array.isArray(parsed.entities)) {
      for (const e of parsed.entities) {
        if (!e || typeof e.name !== 'string') continue;
        const type = typeof e.type === 'string' ? e.type.toLowerCase() : '';
        if (!['person', 'org', 'concept', 'tool', 'paper'].includes(type)) continue;
        entities.push({
          name: e.name.trim().slice(0, 80),
          type: type as DepthClassification['entities'][number]['type'],
        });
      }
    }

    console.log(
      `[rag:classify] "${question.slice(0, 80)}" → ${depth} (${reason}), ${entities.length} entities`,
    );
    return { depth, reason, entities };
  } catch (err) {
    console.warn(
      `[rag:classify] Classifier failed, defaulting to fast:`,
      err instanceof Error ? err.message : err,
    );
    return { depth: 'fast', reason: 'classifier error — defaulted to fast', entities: [] };
  }
}
