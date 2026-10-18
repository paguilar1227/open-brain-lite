import type { ServiceDeps } from './index.js';
import { findSimilarChunks, findChunksByLexical, type ChunkSearchResult } from '../db/chunks.js';
import { findSimilarTodos, findTodosByLexical, type TodoSearchResult } from '../db/todos.js';
import {
  findChunksByEntities, findEntityByCanonical, findEntityByAlias,
  type EntityType,
} from '../db/entities.js';
import { withSpan } from '../observability.js';

export interface SearchOptions {
  // Same trinary as /content list filter:
  //   string  = single project scope
  //   null    = personal scope (no project membership)
  //   undef   = global scope (everything)
  sessionId?: string;
  projectId?: string | null;
  entityTypes?: Array<'document' | 'note' | 'todo'>;
  tags?: string[];
  /** Combine multiple `tags`: 'all' = AND (default), 'any' = OR. */
  tagMatch?: 'all' | 'any';
  /**
   * Restrict hits to chunks/todos whose parent content_item IS one of
   * these UUIDs. Drives the `@<name>` mention predicate — the frontend
   * resolves titles to IDs before calling.
   */
  contentItemIds?: string[];
  /**
   * Exclusion filters (driven by `-#tag`, `-in:type`, `-@name` in the
   * universal search bar). Each list is applied as a NOT-matches
   * predicate on its respective field. Mutually compatible with the
   * positive filters above (positives AND-ed with negatives).
   */
  excludedTags?: string[];
  excludedEntityTypes?: Array<'document' | 'note' | 'todo'>;
  excludedContentItemIds?: string[];
  limit?: number;
  threshold?: number;
  /**
   * Query-level entities to seed graph expansion. Typically supplied by the
   * depth classifier on the RAG path. If empty, graph expansion still runs
   * using entities mentioned in the vector-seed chunks.
   */
  queryEntities?: Array<{ name: string; type: EntityType }>;
  /** Disable graph expansion entirely. Default false (expansion on). */
  graph?: boolean;
}

export interface RetrievalPathStep {
  step: 'vector' | 'entity' | 'lexical';
  score?: number;                      // present for vector + lexical steps
  entity?: { canonical_name: string; type: EntityType };  // only for entity step
  confidence?: number;                 // only for entity step
}

export interface SearchHit {
  type: 'chunk' | 'todo';
  similarity: number;                  // preserved for backward compat (vector score, or final RRF score for graph hits)
  final_score: number;
  vector_score?: number;               // present when the hit was in the vector seed list
  retrieval_path: RetrievalPathStep[]; // non-empty list of how this hit was reached
  // chunk-specific (no raw embedding — stripped in DB layer)
  chunk?: ChunkSearchResult;
  // todo-specific (no raw embedding — stripped in DB layer)
  todo?: TodoSearchResult;
}

export interface SearchTimings {
  embed_ms: number;
  db_scan_ms: number;
  graph_ms: number;         // time spent on graph expansion (0 when disabled)
  total_ms: number;
}

export interface SearchResultWithTimings {
  hits: SearchHit[];
  timings: SearchTimings;
}

export async function search(
  deps: ServiceDeps,
  query: string,
  opts: SearchOptions = {},
): Promise<SearchHit[]> {
  const { hits } = await searchWithTimings(deps, query, opts);
  return hits;
}

export async function searchWithTimings(
  deps: ServiceDeps,
  query: string,
  opts: SearchOptions = {},
): Promise<SearchResultWithTimings> {
  return withSpan(
    'search.query',
    {
      'search.project_id': opts.projectId ?? '',
      'search.entity_types': opts.entityTypes?.join(',') ?? 'all',
      'search.graph': opts.graph ?? true,
      'search.limit': opts.limit ?? 10,
    },
    () => searchWithTimingsImpl(deps, query, opts),
  );
}

async function searchWithTimingsImpl(
  deps: ServiceDeps,
  query: string,
  opts: SearchOptions = {},
): Promise<SearchResultWithTimings> {
  // The 0.65 default is calibrated for real Gemini embeddings. Stub embeddings
  // produce lower-magnitude cosines (relative ranking holds, absolute values
  // don't) so we drop the floor to 0.05 in stub mode — enough to filter pure
  // noise while letting any actual hit surface.
  const stubMode = deps.config.llmProvider === 'stub';
  const defaultThreshold = stubMode ? 0.05 : deps.config.llmProvider === 'real' ? 0.65 : -1;
  const {
    sessionId, projectId, entityTypes, tags, tagMatch, limit = 10, threshold = defaultThreshold,
    queryEntities = [], graph = true,
    contentItemIds, excludedTags, excludedEntityTypes, excludedContentItemIds,
  } = opts;
  // Pre-compute the chunk-bearing exclusion list (document/note) since the
  // findSimilarChunks helper only knows about chunk-parent types.
  const excludedChunkParentTypes = excludedEntityTypes
    ? (excludedEntityTypes.filter((t) => t === 'document' || t === 'note') as Array<'document' | 'note'>)
    : undefined;
  // 'todo' in excludedEntityTypes is enforced below in the todo branch.
  const excludeTodos = excludedEntityTypes?.includes('todo') ?? false;
  const totalStart = performance.now();
  // Filter-only mode: empty/blank query but predicates are set (e.g. just
  // `#chore`, `in:todo`, `project:Foo`). Skip the embedding call (Gemini
  // 400s on empty input) and the vector + graph arms (no seed). The lexical
  // helpers handle this by dropping their ILIKE predicate when text is
  // empty; they list rows that match the structural filters.
  const trimmedQuery = query.trim();
  // hasQueryText drives embedding skip + vector-arm skip: any non-empty
  // text justifies embedding (vector path runs even for 1-char queries —
  // the lexical helpers separately apply their 2-char noise floor).
  const hasQueryText = trimmedQuery.length > 0;
  // Service-level "no signal at all" guard: empty query AND no filters of
  // any kind → return [] without doing any work. Otherwise let arms run.
  const hasAnySignal =
    hasQueryText
    || !!tags?.length || !!excludedTags?.length
    || !!entityTypes?.length || !!excludedEntityTypes?.length
    || !!contentItemIds?.length || !!excludedContentItemIds?.length
    || projectId !== undefined || sessionId !== undefined;
  console.log(`[search] query: "${query.slice(0, 80)}", project: ${projectId ?? 'global'}, types: ${entityTypes?.join(',') ?? 'all'}, graph: ${graph}, filter-only: ${!hasQueryText}`);
  if (!hasAnySignal) {
    const totalMs = Math.round(performance.now() - totalStart);
    console.log(`[search] returning 0 hits (no-signal short-circuit) — total ${totalMs}ms`);
    return { hits: [], timings: { embed_ms: 0, db_scan_ms: 0, graph_ms: 0, total_ms: totalMs } };
  }

  // ---- 1. Vector seed ----------------------------------------------------
  const embedStart = performance.now();
  const queryEmbedding = hasQueryText ? await deps.embeddingProvider.embed(query) : null;
  const embedMs = Math.round(performance.now() - embedStart);

  const searchChunks = !entityTypes || entityTypes.some((t) => t === 'document' || t === 'note');
  const searchTodos = !entityTypes || entityTypes.includes('todo');

  const dbStart = performance.now();
  const chunkFilterOpts = {
    projectId, sessionId,
    parentType: entityTypes && entityTypes.length === 1
      ? (entityTypes[0] === 'document' || entityTypes[0] === 'note' ? entityTypes[0] : undefined)
      : undefined,
    tags,
    tagMatch,
    contentItemIds,
    excludedTags,
    excludedContentItemIds,
    excludedParentTypes: excludedChunkParentTypes,
  };
  // allowEmptyQuery: the todos helper's own opts only carry tags. When the
  // caller has empty text + no tags but DID specify a service-level filter
  // (entity_types restriction, projectId scope, etc.), tell the helper to
  // proceed with a filter-only listing instead of short-circuiting.
  const todoFilterOpts = {
    projectId, sessionId,
    tags,
    tagMatch,
    excludedTags,
    allowEmptyQuery: !hasQueryText && hasAnySignal,
  };
  const [vectorChunks, todos, lexicalChunks, lexicalTodos] = await Promise.all([
    searchChunks && queryEmbedding
      ? findSimilarChunks(deps.db, queryEmbedding, threshold, limit, chunkFilterOpts)
      : Promise.resolve([]),
    // Todos: skipped when the caller restricted to specific content
    // items (todos aren't chunks under a parent — they can't match a
    // content_item_id filter by definition) OR when 'todo' is in the
    // exclusion list. Tag + excluded-tag filters are applied IN-DB by
    // findSimilarTodos so todos can co-exist with tag-scoped searches.
    searchTodos && !excludeTodos && !(contentItemIds && contentItemIds.length > 0) && queryEmbedding
      ? findSimilarTodos(deps.db, queryEmbedding, threshold, limit, todoFilterOpts)
          .then((t) => filterTodosByProject(t, projectId))
      : Promise.resolve([]),
    // Lexical chunk seed — third retrieval arm, fused via RRF below.
    // Same filter opts as vector chunks so scope predicates apply
    // identically. Short queries (<2 chars) return [] from the helper
    // unless filters are present (filter-only listing mode).
    searchChunks
      ? findChunksByLexical(deps.db, query, limit, chunkFilterOpts)
      : Promise.resolve([]),
    // Lexical todo seed — parallel arm for todos.
    searchTodos && !excludeTodos && !(contentItemIds && contentItemIds.length > 0)
      ? findTodosByLexical(deps.db, query, limit, todoFilterOpts)
          .then((t) => filterTodosByProject(t, projectId))
      : Promise.resolve([]),
  ]);
  const dbMs = Math.round(performance.now() - dbStart);

  // ---- 2. Graph expansion (chunks only; todos are never graph-expanded) --
  const graphStart = performance.now();
  let expandedChunks: ChunkSearchResult[] = [];
  const entityByChunk = new Map<string, { canonical_name: string; type: EntityType; confidence: number }>();
  let graphMs = 0;

  if (graph && searchChunks) {
    // Seed entity set: query entities (resolved to DB rows) + entities already
    // mentioned in vector-seed chunks.
    const seedEntityIds = new Set<string>();

    // Resolve query entities against the DB.
    for (const qe of queryEntities) {
      const byCanon = await findEntityByCanonical(deps.db, qe.name, qe.type);
      if (byCanon) { seedEntityIds.add(byCanon.id); continue; }
      const byAlias = await findEntityByAlias(deps.db, qe.name, qe.type);
      if (byAlias) { seedEntityIds.add(byAlias.id); }
    }

    // Pull entity ids for the vector-seed chunks from chunk_entities.
    if (vectorChunks.length > 0) {
      const chunkIds = vectorChunks.map((c) => c.id);
      const rows = await deps.db.query(
        `SELECT DISTINCT entity_id FROM chunk_entities WHERE chunk_id = ANY($1::uuid[])`,
        [chunkIds],
      );
      for (const r of rows.rows) seedEntityIds.add(r.entity_id);
    }

    if (seedEntityIds.size > 0) {
      // Find additional chunks that mention those entities (excluding seeds).
      const seedChunkIds = vectorChunks.map((c) => c.id);
      const hits = await findChunksByEntities(deps.db, [...seedEntityIds], seedChunkIds);

      // For each unique chunk, pick the highest-confidence entity as its
      // "reason" and stash for retrieval_path.
      const chunkBestEntity = new Map<string, { entity_id: string; confidence: number }>();
      for (const h of hits) {
        const cur = chunkBestEntity.get(h.chunk_id);
        if (!cur || h.confidence > cur.confidence) {
          chunkBestEntity.set(h.chunk_id, { entity_id: h.entity_id, confidence: h.confidence });
        }
      }

      // Fetch the actual chunk rows + parent info. Apply the SAME filters
      // (project / tags / parent type) here as the vector-seed path, so
      // graph-expanded chunks can't slip past user-specified scopes.
      // Without this, e.g. tags:['pgvector'] would correctly drop the
      // vector seed list to tagged chunks but expanded chunks would
      // bypass the filter and leak in via entity edges.
      const expandedChunkIds = [...chunkBestEntity.keys()];
      if (expandedChunkIds.length > 0) {
        // Mirror the vector-path parent_type filter: only when entityTypes
        // restricts to a single chunk-bearing type (document or note).
        const restrictParentType = entityTypes && entityTypes.length === 1
          && (entityTypes[0] === 'document' || entityTypes[0] === 'note')
            ? entityTypes[0]
            : null;

        const conditions: string[] = [
          'c.id = ANY($1::uuid[])',
          'ci.archived = false',
          "ci.processing_status = 'ready'",
        ];
        const paramsList: unknown[] = [expandedChunkIds];
        if (sessionId) { paramsList.push(sessionId); conditions.push(`ci.session_id = $${paramsList.length}`); }
        if (projectId === null) {
          conditions.push('cardinality(ci.project_ids) = 0');
        } else if (typeof projectId === 'string') {
          paramsList.push(projectId);
          conditions.push(`$${paramsList.length}::uuid = ANY(ci.project_ids)`);
        }
        if (tags && tags.length > 0) {
          paramsList.push(tags);
          conditions.push(`ci.tags @> $${paramsList.length}::text[]`);
        }
        if (restrictParentType) {
          paramsList.push(restrictParentType);
          conditions.push(`ci.type = $${paramsList.length}`);
        }
        // Mirror the new positive + negative predicates here so graph-
        // expanded chunks can't slip past mention or exclusion scopes.
        if (contentItemIds && contentItemIds.length > 0) {
          paramsList.push(contentItemIds);
          conditions.push(`ci.id = ANY($${paramsList.length}::uuid[])`);
        }
        if (excludedTags && excludedTags.length > 0) {
          paramsList.push(excludedTags);
          conditions.push(`NOT (ci.tags && $${paramsList.length}::text[])`);
        }
        if (excludedContentItemIds && excludedContentItemIds.length > 0) {
          paramsList.push(excludedContentItemIds);
          conditions.push(`NOT (ci.id = ANY($${paramsList.length}::uuid[]))`);
        }
        if (excludedChunkParentTypes && excludedChunkParentTypes.length > 0) {
          paramsList.push(excludedChunkParentTypes);
          conditions.push(`NOT (ci.type = ANY($${paramsList.length}::text[]))`);
        }

        const res = await deps.db.query(
          `SELECT c.id, c.content_item_id, c.chunk_index, c.chunk_type, c.content, c.metadata, c.created_at,
                  ci.type AS parent_type, ci.title AS parent_title, ci.project_ids AS parent_project_ids,
                  ci.tags AS parent_tags, ci.source_url AS parent_source_url
             FROM chunks c
             JOIN content_items ci ON ci.id = c.content_item_id
            WHERE ${conditions.join(' AND ')}`,
          paramsList,
        );

        expandedChunks = res.rows.map((r) => ({
          ...r,
          // Synthesize a "similarity" for expanded chunks using entity
          // confidence — used as a tiebreaker within the expanded list only.
          similarity: chunkBestEntity.get(r.id)!.confidence,
        }));

        // Look up canonical entity names for retrieval_path attribution.
        const bestEntityIds = [...new Set([...chunkBestEntity.values()].map((v) => v.entity_id))];
        if (bestEntityIds.length > 0) {
          const entRes = await deps.db.query(
            `SELECT id, canonical_name, type FROM entities WHERE id = ANY($1::uuid[])`,
            [bestEntityIds],
          );
          const entityById = new Map<string, { canonical_name: string; type: EntityType }>();
          for (const e of entRes.rows) {
            entityById.set(e.id, { canonical_name: e.canonical_name, type: e.type as EntityType });
          }
          for (const [chunkId, { entity_id, confidence }] of chunkBestEntity) {
            const ent = entityById.get(entity_id);
            if (ent) entityByChunk.set(chunkId, { ...ent, confidence });
          }
        }
      }
    }
    graphMs = Math.round(performance.now() - graphStart);
  }

  // ---- 3. RRF fusion -----------------------------------------------------
  // Reciprocal Rank Fusion: final_score = Σ 1/(k + rank_in_each_list). k=60
  // is the standard IR default. Items caught by multiple arms (vector +
  // graph + lexical) rise to the top; items in only one list fall behind.
  // Robust without needing tuned per-arm weights.
  const K = 60;
  const rrfScores = new Map<string, number>();
  const vectorRank = new Map<string, number>();
  const graphRank = new Map<string, number>();
  const lexicalRank = new Map<string, number>();

  vectorChunks.forEach((c, i) => {
    vectorRank.set(c.id, i + 1);
    rrfScores.set(c.id, (rrfScores.get(c.id) ?? 0) + 1 / (K + i + 1));
  });
  // Sort expanded chunks by entity confidence for ranking.
  expandedChunks.sort((a, b) => b.similarity - a.similarity);
  expandedChunks.forEach((c, i) => {
    graphRank.set(c.id, i + 1);
    rrfScores.set(c.id, (rrfScores.get(c.id) ?? 0) + 1 / (K + i + 1));
  });
  // Lexical hits already arrive ranked by title-match-priority then recency
  // (findChunksByLexical does the ORDER BY). Same RRF weight as the other
  // arms — no preferential boost; fusion handles overlap natively.
  lexicalChunks.forEach((c, i) => {
    lexicalRank.set(c.id, i + 1);
    rrfScores.set(c.id, (rrfScores.get(c.id) ?? 0) + 1 / (K + i + 1));
  });

  // ---- 4. Build hits with retrieval_path --------------------------------
  const allChunks = new Map<string, ChunkSearchResult>();
  for (const c of vectorChunks) allChunks.set(c.id, c);
  for (const c of expandedChunks) if (!allChunks.has(c.id)) allChunks.set(c.id, c);
  for (const c of lexicalChunks) if (!allChunks.has(c.id)) allChunks.set(c.id, c);

  const chunkHits: SearchHit[] = [];
  for (const [id, chunk] of allChunks) {
    const path: RetrievalPathStep[] = [];
    let vectorScore: number | undefined;

    if (vectorRank.has(id)) {
      vectorScore = chunk.similarity;   // this is the real cosine, set by findSimilarChunks
      path.push({ step: 'vector', score: vectorScore });
    }
    if (graphRank.has(id)) {
      const ent = entityByChunk.get(id);
      if (ent) {
        path.push({
          step: 'entity',
          entity: { canonical_name: ent.canonical_name, type: ent.type },
          confidence: ent.confidence,
        });
      }
    }
    if (lexicalRank.has(id)) {
      // Synthetic similarity from findChunksByLexical: 1.0 for title hits,
      // 0.5 for content-only hits. Surfacing it lets the UI distinguish
      // "the search term is in the title" from "buried in the body."
      const lexChunk = lexicalChunks.find((c) => c.id === id);
      path.push({ step: 'lexical', score: lexChunk?.similarity });
    }

    chunkHits.push({
      type: 'chunk',
      similarity: vectorScore ?? chunk.similarity,
      final_score: rrfScores.get(id) ?? 0,
      vector_score: vectorScore,
      retrieval_path: path,
      chunk,
    });
  }

  // Todos — vector + lexical (no graph expansion for v1). Fuse the two
  // arms via the same RRF as chunks so dual-source todos rise to the top.
  const todoVectorRank = new Map<string, number>();
  const todoLexicalRank = new Map<string, number>();
  const todoScores = new Map<string, number>();
  todos.forEach((t, i) => {
    todoVectorRank.set(t.id, i + 1);
    todoScores.set(t.id, (todoScores.get(t.id) ?? 0) + 1 / (K + i + 1));
  });
  lexicalTodos.forEach((t, i) => {
    todoLexicalRank.set(t.id, i + 1);
    todoScores.set(t.id, (todoScores.get(t.id) ?? 0) + 1 / (K + i + 1));
  });
  const allTodos = new Map<string, TodoSearchResult>();
  for (const t of todos) allTodos.set(t.id, t);
  for (const t of lexicalTodos) if (!allTodos.has(t.id)) allTodos.set(t.id, t);

  const todoHits: SearchHit[] = [];
  for (const [id, todo] of allTodos) {
    const path: RetrievalPathStep[] = [];
    if (todoVectorRank.has(id)) {
      path.push({ step: 'vector', score: todo.similarity });
    }
    if (todoLexicalRank.has(id)) {
      const lexTodo = lexicalTodos.find((t) => t.id === id);
      path.push({ step: 'lexical', score: lexTodo?.similarity });
    }
    todoHits.push({
      type: 'todo' as const,
      similarity: todo.similarity,
      final_score: todoScores.get(id) ?? 0,
      retrieval_path: path,
      todo,
    });
  }

  const allHits: SearchHit[] = [...chunkHits, ...todoHits];
  allHits.sort((a, b) => b.final_score - a.final_score);
  const result = allHits.slice(0, limit);
  const totalMs = Math.round(performance.now() - totalStart);

  console.log(
    `[search] returning ${result.length} hits ` +
    `(vector-chunks ${vectorChunks.length}, graph-expanded ${expandedChunks.length}, ` +
    `lexical-chunks ${lexicalChunks.length}, vector-todos ${todos.length}, ` +
    `lexical-todos ${lexicalTodos.length}) ` +
    `— embed ${embedMs}ms, db ${dbMs}ms, graph ${graphMs}ms, total ${totalMs}ms`,
  );
  return {
    hits: result,
    timings: { embed_ms: embedMs, db_scan_ms: dbMs, graph_ms: graphMs, total_ms: totalMs },
  };
}

/** Apply the trinary projectId filter to a todo list (extracted so the
 *  vector + lexical todo fetches don't duplicate the predicate). */
function filterTodosByProject(
  todos: TodoSearchResult[],
  projectId: string | null | undefined,
): TodoSearchResult[] {
  if (projectId === null) return todos.filter((t) => t.project_id === null);
  if (typeof projectId === 'string') return todos.filter((t) => t.project_id === projectId);
  return todos;
}

/**
 * Exact entity lookup. Resolves `entityName` against the entities table
 * (canonical or alias match), then returns all chunks that mention it.
 * Powers the `find_mentions` MCP tool.
 */
export interface FindMentionsResult {
  entity: { id: string; canonical_name: string; type: EntityType; aliases: string[] } | null;
  mentions: Array<{
    chunk_id: string;
    content_item_id: string;
    parent_title: string;
    parent_type: string;
    parent_source_url: string | null;
    mention_text: string | null;
    confidence: number;
    chunk_preview: string;
  }>;
}

export async function findMentions(
  deps: ServiceDeps,
  entityName: string,
  opts: { type?: EntityType; projectId?: string; sessionId?: string; limit?: number } = {},
): Promise<FindMentionsResult> {
  const limit = opts.limit ?? 20;

  // Resolution across all types if not specified. We look up by canonical
  // name first, then alias, trying each allowed type.
  const types: EntityType[] = opts.type
    ? [opts.type]
    : ['tool', 'concept', 'person', 'org', 'paper'];

  let matched: FindMentionsResult['entity'] = null;
  for (const t of types) {
    const byCanon = await findEntityByCanonical(deps.db, entityName, t);
    if (byCanon) {
      matched = { id: byCanon.id, canonical_name: byCanon.canonical_name, type: byCanon.type, aliases: byCanon.aliases };
      break;
    }
    const byAlias = await findEntityByAlias(deps.db, entityName, t);
    if (byAlias) {
      matched = { id: byAlias.id, canonical_name: byAlias.canonical_name, type: byAlias.type, aliases: byAlias.aliases };
      break;
    }
  }

  if (!matched) return { entity: null, mentions: [] };

  const projFilter = opts.projectId ? `AND $2::uuid = ANY(ci.project_ids)` : ``;
  const params: unknown[] = [matched.id];
  if (opts.projectId) params.push(opts.projectId);
  const sessionFilter=opts.sessionId ? `AND ci.session_id=$${params.length+1}::uuid` : '';
  if(opts.sessionId) params.push(opts.sessionId);

  const res = await deps.db.query(
    `SELECT ce.chunk_id, c.content_item_id, ci.title AS parent_title, ci.type AS parent_type,
            ci.source_url AS parent_source_url, ce.mention_text, ce.confidence,
            LEFT(COALESCE(c.content, ''), 200) AS chunk_preview
       FROM chunk_entities ce
       JOIN chunks c ON c.id = ce.chunk_id
       JOIN content_items ci ON ci.id = c.content_item_id
      WHERE ce.entity_id = $1
        AND ci.archived = false
        ${projFilter}
        ${sessionFilter}
      ORDER BY ce.confidence DESC
      LIMIT ${limit}`,
    params,
  );

  return {
    entity: matched,
    mentions: res.rows.map((r) => ({
      chunk_id: r.chunk_id,
      content_item_id: r.content_item_id,
      parent_title: r.parent_title,
      parent_type: r.parent_type,
      parent_source_url: r.parent_source_url,
      mention_text: r.mention_text,
      confidence: r.confidence,
      chunk_preview: r.chunk_preview,
    })),
  };
}
