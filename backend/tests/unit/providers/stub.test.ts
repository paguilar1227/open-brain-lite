import { describe, expect, it } from 'vitest';
import { StubEmbeddingProvider, StubLLMProvider } from '../../../src/providers/stub.js';

describe('StubEmbeddingProvider', () => {
  const stub = new StubEmbeddingProvider();

  it('returns 768-dim vectors', async () => {
    const v = await stub.embed('hello world');
    expect(v.length).toBe(768);
    expect(stub.dimensions).toBe(768);
  });

  it('is deterministic — same input → identical vector', async () => {
    const a = await stub.embed('the quick brown fox jumps over the lazy dog');
    const b = await stub.embed('the quick brown fox jumps over the lazy dog');
    expect(a).toEqual(b);
  });

  it('produces unit-norm vectors', async () => {
    const v = await stub.embed('some content');
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('similar texts produce more similar vectors than dissimilar ones', async () => {
    const a = await stub.embed('python data science notebook');
    const b = await stub.embed('python data analysis tutorial');
    const c = await stub.embed('mediterranean lamb stew recipe');
    const cos = (x: number[], y: number[]) => x.reduce((s, xi, i) => s + xi * y[i], 0);
    expect(cos(a, b)).toBeGreaterThan(cos(a, c));
  });
});

describe('StubLLMProvider', () => {
  const stub = new StubLLMProvider();

  it('returns metadata-shaped JSON for metadata prompts', async () => {
    const res = await stub.complete([{ role: 'user', content: 'A long article about distributed systems and consensus.' }], {
      systemPrompt: 'Extract the title, topics, and extracted_text from the document.',
      responseFormat: 'json',
    });
    const parsed = JSON.parse(res.content);
    expect(parsed).toMatchObject({
      title: expect.any(String),
      topics: expect.any(Array),
      extracted_text: expect.any(String),
    });
    // Tags are deliberately NOT part of the metadata schema — they are
    // user-authored only. The extractor doesn't propose them.
    expect(parsed.tags).toBeUndefined();
    expect(parsed.published_at).toBeNull();
  });

  it('returns entity-shaped array for entity-extraction prompts', async () => {
    const res = await stub.complete([{ role: 'user', content: 'OpenAI and Anthropic are AI labs. Claude was made by Anthropic.' }], {
      systemPrompt: 'Extract entities from the text.',
      responseFormat: 'json',
    });
    const parsed = JSON.parse(res.content);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0]).toMatchObject({
      canonical_name: expect.any(String),
      type: expect.any(String),
      aliases: expect.any(Array),
      confidence: expect.any(Number),
      mentions: expect.any(Array),
    });
    expect(parsed[0].mentions.length).toBeGreaterThan(0);
  });

  it('depth classifier returns thorough for analytical questions', async () => {
    const res = await stub.complete([{ role: 'user', content: 'Why does eventual consistency cause issues in financial systems?' }], {
      systemPrompt: 'You classify questions by retrieval depth.',
      responseFormat: 'json',
    });
    const parsed = JSON.parse(res.content);
    expect(parsed.depth).toBe('thorough');
  });

  it('depth classifier returns fast for short factual questions', async () => {
    const res = await stub.complete([{ role: 'user', content: 'TLS port?' }], {
      systemPrompt: 'You classify questions by retrieval depth.',
      responseFormat: 'json',
    });
    const parsed = JSON.parse(res.content);
    expect(parsed.depth).toBe('fast');
  });

  it('returns a stub text answer for RAG synthesis prompts', async () => {
    const res = await stub.complete(
      [{ role: 'user', content: 'Question: What is RAG?\n\nContext chunk:\nRetrieval augmented generation combines search with LLMs.' }],
      { systemPrompt: 'Answer the question using the provided context.' },
    );
    expect(res.content).toContain('[stub]');
    expect(res.content).toContain('What is RAG?');
  });

  it('falls back to {} for unrecognized JSON requests', async () => {
    const res = await stub.complete([{ role: 'user', content: 'anything' }], {
      systemPrompt: 'unknown task',
      responseFormat: 'json',
    });
    expect(res.content).toBe('{}');
  });
});
