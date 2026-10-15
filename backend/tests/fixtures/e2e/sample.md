# Sample document for E2E tests

This document is the source for `sample.pdf`. It is intentionally long enough to produce multiple chunks under the 500-token / 100-overlap chunker.

## pgvector overview

pgvector is a Postgres extension that adds vector similarity search to standard PostgreSQL. It supports several index types: IVFFlat, HNSW, and exact sequential scan. The extension was first released in 2021 and has become the de-facto vector store for teams that already run Postgres.

## HNSW vs IVFFlat

HNSW (Hierarchical Navigable Small World) gives better recall than IVFFlat at the cost of build time and memory. It maintains a multi-layer graph where each layer halves the search space. Insertions are more expensive than IVFFlat because each new vector traverses the graph and updates neighbor lists.

IVFFlat partitions the vector space into Voronoi cells (probes) at index time. Search lookups scan only the cells closest to the query vector. Build is faster than HNSW but recall depends heavily on the `lists` parameter and probe count at query time.

## Embedding dimensions

For 3072-dimensional embeddings from Gemini Embedding 2 or OpenAI text-embedding-3-large, HNSW init may exceed memory limits on small Postgres tiers (e.g. Azure B1ms 2GB). Workarounds:

1. Sequential scan — fine at single-user scale
2. Reduce dimensions via PCA at ingest time
3. Use IVFFlat instead of HNSW

## Why this matters for Open Brain

Open Brain v2 uses pgvector with 3072-dim Gemini embeddings, no HNSW (sequential scan only). The current corpus size — single user, low thousands of chunks — fits comfortably under sequential scan latency, well below 100ms per query. Adding HNSW would require either upsizing the database tier or reducing embedding dimensions, both of which carry tradeoffs.

The graph layer (entities + chunk_entities tables, migration 003) was added to compensate for the recall gap that HNSW would otherwise close. Instead of trading off recall at the vector layer, retrieval expands seed hits along entity edges, which catches semantic matches that vector cosine alone misses.

## Citations

- pgvector: https://github.com/pgvector/pgvector
- HNSW paper: Malkov & Yashunin, 2018
- Anthropic Haiku 4.5: claude-haiku-4-5-20251001
