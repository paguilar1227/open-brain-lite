import type { EmbeddingProvider, LLMProvider, LLMMessage, LLMOptions, LLMResponse, LLMContentPart } from './types.js';

async function post(baseUrl: string, path: string, body: unknown): Promise<any> {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Ollama ${path}: HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response.json();
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  constructor(private baseUrl: string, private model: string, readonly dimensions = 768) {}
  async embed(content: string, files?: Array<{ data: Buffer; mimeType: string }>): Promise<number[]> {
    if (!content.trim()) throw new Error('Local embeddings need extracted text; upload text or a text-based PDF.');
    const result = await post(this.baseUrl, '/api/embed', { model: this.model, input: content, truncate: false });
    const vector: unknown = result.embeddings?.[0];
    if (!Array.isArray(vector) || vector.length !== this.dimensions || !vector.every(v => typeof v === 'number' && Number.isFinite(v))) {
      throw new Error(`Embedding model ${this.model} must return ${this.dimensions} finite dimensions. Reindex before changing models.`);
    }
    return vector;
  }
}

export class OllamaLLMProvider implements LLMProvider {
  constructor(private baseUrl: string, private model: string) {}
  async complete(messages: LLMMessage[], options: LLMOptions = {}): Promise<LLMResponse> {
    const wireMessages: Array<Record<string, unknown>> = [];
    if (options.systemPrompt) wireMessages.push({ role: 'system', content: options.systemPrompt });
    for (const message of messages) {
      const parts: LLMContentPart[] = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content;
      const images = parts.filter(p => p.type === 'image');
      if (images.some(p => !p.mimeType?.startsWith('image/'))) throw new Error('This local model does not transcribe audio or video. Upload a transcript.');
      wireMessages.push({ role: message.role, content: parts.filter(p => p.type === 'text').map(p => p.text).join('\n'),
        ...(images.length ? { images: images.map(p => p.data?.toString('base64')) } : {}) });
    }
    const result = await post(this.baseUrl, '/api/chat', {
      model: this.model, messages: wireMessages, stream: false, think: false,
      ...(options.responseFormat === 'json' ? { format: 'json' } : {}),
      options: { temperature: 0, ...(options.maxTokens ? { num_predict: options.maxTokens } : {}) },
    });
    if (typeof result.message?.content !== 'string' || !result.message.content.trim()) throw new Error('Ollama returned an empty completion');
    const input = result.prompt_eval_count ?? 0, output = result.eval_count ?? 0;
    return { content: result.message.content, tokensUsed: { input, output, total: input + output } };
  }
}
