// src/providers/azure-foundry-responses.ts
//
// Azure Foundry client for the Responses API (`/openai/responses`).
// Required for GPT-5 reasoning-tier deployments like gpt-5-4-pro that
// don't expose chat completions.
//
// Implements the same LLMProvider interface as our chat-completions
// client so the RAG routing code doesn't care which tier is in use.

import type { LLMProvider, LLMMessage, LLMOptions, LLMResponse } from './types.js';
import { extractJson } from './json-utils.js';

const DEFAULT_API_VERSION = '2025-04-01-preview';
const DEFAULT_MAX_TOKENS = 8192;

export interface AzureFoundryResponsesConfig {
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion?: string;
}

interface ResponsesInputItem {
  role: 'system' | 'user' | 'assistant';
  content:
    | string
    | Array<
        | { type: 'input_text'; text: string }
        | { type: 'input_image'; image_url: string }
      >;
}

interface ResponsesAPIResult {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    // Azure Foundry Responses API reports reasoning tokens separately when
    // a reasoning-tier deployment (e.g. gpt-5-4-pro) is in use. Reasoning
    // tokens count toward output_tokens but represent invisible "thinking"
    // — they're often the dominant cost on thorough queries.
    output_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
  error?: { code?: string; message?: string };
}

export class AzureFoundryResponsesProvider implements LLMProvider {
  private endpoint: string;
  private apiKey: string;
  private defaultDeployment: string;
  private apiVersion: string;

  constructor(config: AzureFoundryResponsesConfig) {
    this.endpoint = config.endpoint.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.defaultDeployment = config.deployment;
    this.apiVersion = config.apiVersion ?? DEFAULT_API_VERSION;
  }

  async complete(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    const deployment = options?.model ?? this.defaultDeployment;
    const url = `${this.endpoint}/openai/responses?api-version=${this.apiVersion}`;

    const input: ResponsesInputItem[] = [];
    // Azure Responses API enforces: if text.format == json_object, the input
    // must literally contain the word "json" somewhere. Auto-append a system
    // instruction so callers don't have to think about it.
    const systemPieces = [options?.systemPrompt];
    if (options?.responseFormat === 'json') {
      systemPieces.push(
        'Respond with a single JSON value only. No markdown fences, no prose preamble.',
      );
    }
    const systemPrompt = systemPieces.filter(Boolean).join('\n\n');
    if (systemPrompt) {
      input.push({ role: 'system', content: systemPrompt });
    }
    for (const msg of messages) {
      input.push({
        role: msg.role,
        content:
          typeof msg.content === 'string'
            ? msg.content
            : msg.content.map((part) =>
                part.type === 'text'
                  ? { type: 'input_text' as const, text: part.text! }
                  : {
                      type: 'input_image' as const,
                      image_url: `data:${part.mimeType ?? 'image/png'};base64,${part.data!.toString('base64')}`,
                    },
              ),
      });
    }

    const body: Record<string, unknown> = {
      model: deployment,
      input,
      max_output_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
    };
    if (options?.responseFormat === 'json') {
      body.text = { format: { type: 'json_object' } };
    }
    if (options?.reasoningEffort) {
      body.reasoning = { effort: options.reasoningEffort };
    }

    // Pre-flight diagnostics — input size matters for "why is this slow"
    // triage on thorough RAG queries. Total input char count is a cheap
    // proxy for token count; ~4 chars/token for English.
    const inputChars = input.reduce((sum, item) => {
      if (typeof item.content === 'string') return sum + item.content.length;
      return sum + item.content.reduce(
        (s, p) => s + (p.type === 'input_text' ? p.text.length : 0),
        0,
      );
    }, 0);
    const reqStart = performance.now();
    console.log(
      `[foundry-responses] POST ${deployment} — items: ${input.length}, ~${inputChars} chars, max_output: ${body.max_output_tokens}, effort: ${options?.reasoningEffort ?? 'default'}`,
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
      console.error(`[foundry-responses] HTTP ${res.status} after ${httpMs}ms: ${text.slice(0, 300)}`);
      throw new Error(`Azure Responses ${res.status} (${deployment}): ${text.slice(0, 500)}`);
    }

    const parseStart = performance.now();
    const json = (await res.json()) as ResponsesAPIResult;
    const parseMs = Math.round(performance.now() - parseStart);

    if (json.error) {
      console.error(`[foundry-responses] API error: ${json.error.code} ${json.error.message}`);
      throw new Error(`Azure Responses error: ${json.error.code ?? ''} ${json.error.message ?? ''}`.trim());
    }

    let content = json.output_text ?? extractTextFromOutputArray(json.output) ?? '';
    if (options?.responseFormat === 'json') {
      content = extractJson(content);
    }

    const usage = json.usage ?? {};
    const reasoningTokens = usage.output_tokens_details?.reasoning_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;
    const visibleOutputTokens = Math.max(0, outputTokens - reasoningTokens);
    // Count what kinds of items came back — a reasoning deployment may
    // return both 'reasoning' and 'message' items, and most of the wall
    // time is typically "invisible" reasoning, not message generation.
    const itemCounts = (json.output ?? []).reduce<Record<string, number>>((acc, item) => {
      const t = item.type ?? 'unknown';
      acc[t] = (acc[t] ?? 0) + 1;
      return acc;
    }, {});
    console.log(
      `[foundry-responses] OK ${deployment} — http ${httpMs}ms, parse ${parseMs}ms, ` +
      `tokens(in/out/reason/visible): ${usage.input_tokens ?? 0}/${outputTokens}/${reasoningTokens}/${visibleOutputTokens}, ` +
      `output_items: ${JSON.stringify(itemCounts)}, content: ${content.length} chars`,
    );

    return {
      content,
      tokensUsed: {
        input: usage.input_tokens ?? 0,
        output: outputTokens,
        total: usage.total_tokens ?? 0,
      },
    };
  }
}

/** Fallback extractor when `output_text` is not provided (older preview shapes). */
function extractTextFromOutputArray(
  output: ResponsesAPIResult['output'] | undefined,
): string | null {
  if (!output) return null;
  const parts: string[] = [];
  for (const item of output) {
    if (item.type !== 'message') continue;
    for (const c of item.content ?? []) {
      if (typeof c.text === 'string') parts.push(c.text);
    }
  }
  return parts.length > 0 ? parts.join('\n\n') : null;
}
