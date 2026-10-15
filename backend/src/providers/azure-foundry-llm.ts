// src/providers/azure-foundry-llm.ts
//
// Thin Azure AI Foundry / Azure OpenAI client. Uses raw fetch against the
// /openai/deployments/{deployment}/chat/completions endpoint so we don't
// pull in the openai SDK just for this one caller.

import type { LLMProvider, LLMMessage, LLMOptions, LLMResponse } from './types.js';
import { extractJson } from './json-utils.js';

const DEFAULT_API_VERSION = '2025-04-01-preview';
const DEFAULT_MAX_TOKENS = 8192;

export interface AzureFoundryConfig {
  endpoint: string;       // e.g. https://pablo-1227-resource.services.ai.azure.com/
  apiKey: string;
  deployment: string;     // e.g. "gpt-5-4-pro"
  apiVersion?: string;
}

interface AzureChatMessage {
  role: 'system' | 'user' | 'assistant';
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      >;
}

interface AzureChatResponse {
  choices: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { code?: string; message?: string };
}

export class AzureFoundryLLMProvider implements LLMProvider {
  private endpoint: string;
  private apiKey: string;
  private defaultDeployment: string;
  private apiVersion: string;

  constructor(config: AzureFoundryConfig) {
    this.endpoint = config.endpoint.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.defaultDeployment = config.deployment;
    this.apiVersion = config.apiVersion ?? DEFAULT_API_VERSION;
  }

  async complete(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    const deployment = options?.model ?? this.defaultDeployment;
    const url = `${this.endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${this.apiVersion}`;

    const chatMessages: AzureChatMessage[] = [];
    // Azure OpenAI enforces: if response_format == json_object, the prompt
    // must literally contain the word "json". Auto-append a system
    // instruction so callers don't have to think about it.
    const systemPieces = [options?.systemPrompt];
    if (options?.responseFormat === 'json') {
      systemPieces.push(
        'Respond with a single JSON value only. No markdown fences, no prose preamble.',
      );
    }
    const systemPrompt = systemPieces.filter(Boolean).join('\n\n');
    if (systemPrompt) {
      chatMessages.push({ role: 'system', content: systemPrompt });
    }
    for (const msg of messages) {
      chatMessages.push({
        role: msg.role,
        content:
          typeof msg.content === 'string'
            ? msg.content
            : msg.content.map((part) =>
                part.type === 'text'
                  ? { type: 'text' as const, text: part.text! }
                  : {
                      type: 'image_url' as const,
                      image_url: {
                        url: `data:${part.mimeType ?? 'image/png'};base64,${part.data!.toString('base64')}`,
                      },
                    },
              ),
      });
    }

    const body: Record<string, unknown> = {
      messages: chatMessages,
      max_completion_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
    };
    if (options?.responseFormat === 'json') {
      body.response_format = { type: 'json_object' };
    }

    const inputChars = chatMessages.reduce((sum, m) => {
      if (typeof m.content === 'string') return sum + m.content.length;
      return sum + m.content.reduce(
        (s, p) => s + (p.type === 'text' ? p.text.length : 0),
        0,
      );
    }, 0);
    const reqStart = performance.now();
    console.log(
      `[foundry-llm] POST ${deployment} — msgs: ${chatMessages.length}, ~${inputChars} chars, max_completion: ${body.max_completion_tokens}`,
    );

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': this.apiKey,
      },
      body: JSON.stringify(body),
    });
    const httpMs = Math.round(performance.now() - reqStart);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[foundry-llm] HTTP ${res.status} after ${httpMs}ms: ${text.slice(0, 300)}`);
      throw new Error(`Azure Foundry ${res.status} (${deployment}): ${text.slice(0, 500)}`);
    }

    const json = (await res.json()) as AzureChatResponse;
    if (json.error) {
      console.error(`[foundry-llm] API error: ${json.error.code} ${json.error.message}`);
      throw new Error(`Azure Foundry error: ${json.error.code ?? ''} ${json.error.message ?? ''}`.trim());
    }

    let content = json.choices?.[0]?.message?.content ?? '';
    if (options?.responseFormat === 'json') {
      content = extractJson(content);
    }

    const usage = json.usage ?? {};
    console.log(
      `[foundry-llm] OK ${deployment} — http ${httpMs}ms, ` +
      `tokens(in/out/total): ${usage.prompt_tokens ?? 0}/${usage.completion_tokens ?? 0}/${usage.total_tokens ?? 0}, ` +
      `content: ${content.length} chars`,
    );

    return {
      content,
      tokensUsed: {
        input: usage.prompt_tokens ?? 0,
        output: usage.completion_tokens ?? 0,
        total: usage.total_tokens ?? 0,
      },
    };
  }
}
