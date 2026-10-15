import type { LLMProvider, LLMMessage, LLMOptions, LLMResponse } from './types.js';
/** llama.cpp's OpenAI-compatible local server. Embeddings stay in the configured local vector runtime. */
export class LlamaCppProvider implements LLMProvider {
  constructor(private baseUrl: string, private model: string) {}
  async complete(messages: LLMMessage[], options: LLMOptions = {}): Promise<LLMResponse> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        model: this.model, stream: false, temperature: 0,
        messages: [...(options.systemPrompt ? [{ role: 'system', content: options.systemPrompt }] : []), ...messages.map(message => ({ role: message.role,
          content: typeof message.content === 'string' ? message.content : message.content.map(part => part.type === 'text' ? { type: 'text', text: part.text } : { type: 'image_url', image_url: { url: `data:${part.mimeType};base64,${part.data?.toString('base64')}` } }) }))],
        ...(options.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
        ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
      }),
    });
    if (!response.ok) throw new Error(`llama.cpp returned HTTP ${response.status}`);
    const result = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } };
    const content = result.choices?.[0]?.message?.content;
    if (!content) throw new Error('llama.cpp returned no completion');
    const usage = result.usage;
    return { content, tokensUsed: { input: usage?.prompt_tokens ?? 0, output: usage?.completion_tokens ?? 0, total: usage?.total_tokens ?? 0 } };
  }
}
