// src/providers/anthropic-llm.ts
import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, LLMMessage, LLMOptions, LLMResponse } from './types.js';
import { extractJson } from './json-utils.js';

const DEFAULT_MAX_TOKENS = 8192;

export class AnthropicLLMProvider implements LLMProvider {
  private client: Anthropic;
  private defaultModel: string;

  constructor(apiKey: string, defaultModel: string = 'claude-opus-4-6') {
    this.client = new Anthropic({ apiKey });
    this.defaultModel = defaultModel;
  }

  async complete(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    const anthropicMessages = messages.map((msg) => ({
      role: msg.role as 'user' | 'assistant',
      content: typeof msg.content === 'string'
        ? msg.content
        : msg.content.map((part) =>
            part.type === 'text'
              ? { type: 'text' as const, text: part.text! }
              : { type: 'image' as const, source: {
                  type: 'base64' as const,
                  media_type: (part.mimeType ?? 'image/png') as 'image/png',
                  data: part.data!.toString('base64'),
                } }
          ),
    }));

    // For JSON tasks we steer the model toward a bare JSON response by
    // appending a system instruction and then stripping any wrapping
    // (Claude occasionally still wraps in ```json). Mirrors the pattern
    // we already use for Gemini.
    const systemPromptPieces = [options?.systemPrompt];
    if (options?.responseFormat === 'json') {
      systemPromptPieces.push(
        'Respond with a single JSON value only. No markdown code fences, no preamble, no trailing commentary.',
      );
    }
    const systemPrompt = systemPromptPieces.filter(Boolean).join('\n\n') || undefined;

    const inputChars = anthropicMessages.reduce((sum, m) => {
      if (typeof m.content === 'string') return sum + m.content.length;
      return sum + m.content.reduce(
        (s, p: any) => s + (p.type === 'text' ? (p.text as string).length : 0),
        0,
      );
    }, 0);
    const reqStart = performance.now();
    const model = options?.model ?? this.defaultModel;
    console.log(
      `[anthropic] POST ${model} — msgs: ${anthropicMessages.length}, ~${inputChars} chars, max_tokens: ${options?.maxTokens ?? DEFAULT_MAX_TOKENS}`,
    );

    const response = await this.client.messages.create({
      model,
      max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(systemPrompt && { system: systemPrompt }),
      messages: anthropicMessages,
    });
    const httpMs = Math.round(performance.now() - reqStart);

    let content = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    if (options?.responseFormat === 'json') {
      content = extractJson(content);
    }

    console.log(
      `[anthropic] OK ${model} — http ${httpMs}ms, ` +
      `tokens(in/out): ${response.usage.input_tokens}/${response.usage.output_tokens}, ` +
      `content: ${content.length} chars`,
    );

    return {
      content,
      tokensUsed: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
        total: response.usage.input_tokens + response.usage.output_tokens,
      },
    };
  }
}
