import { LlamaCppProvider } from './llama.js';
import { CopilotClient } from '@github/copilot-sdk';
import { Codex } from '@openai/codex-sdk';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { LLMProvider, LLMMessage, LLMOptions, LLMResponse } from './types.js';
import { extractJson } from './json-utils.js';
import type { Config } from '../config.js';
import { OllamaLLMProvider } from './ollama.js';

function promptFor(messages: LLMMessage[], options: LLMOptions) {
  return [options.systemPrompt ?? '', options.responseFormat === 'json' ? 'Return valid JSON only.' : '',
    ...messages.map(message => `${message.role}: ${typeof message.content === 'string' ? message.content : message.content.filter(part => part.type === 'text').map(part => part.text).join('\n')}`)].join('\n\n');
}

export class SubscriptionLLMProvider implements LLMProvider {
  constructor(private config: Config) {}
  async complete(messages: LLMMessage[], options: LLMOptions = {}): Promise<LLMResponse> {
    if (this.config.llmProvider === 'ollama') return new OllamaLLMProvider(this.config.ollamaUrl, this.config.localModel).complete(messages, options);
    if (this.config.llmProvider === 'llama.cpp') return new LlamaCppProvider(this.config.llamaUrl, this.config.llamaModel).complete(messages, options);
    const workingDirectory = join(this.config.authDir, 'workspace');
    await mkdir(workingDirectory, { recursive: true });
    const prompt = promptFor(messages, options);
    let content: string;
    let usage = { input: 0, output: 0, total: 0 };
    if (this.config.llmProvider === 'copilot') {
      const client = new CopilotClient({ mode: 'empty', baseDirectory: join(this.config.authDir, 'copilot'), workingDirectory });
      await client.start();
      try {
        if (!(await client.getAuthStatus()).isAuthenticated) throw new Error('Sign in to Copilot in Settings first.');
        const session = await client.createSession({ model: this.config.copilotModel, availableTools: [], enableConfigDiscovery: false,
          systemMessage: { mode: 'replace', content: 'You answer using only supplied information. Do not use tools.' },
          onPermissionRequest: () => ({ kind: 'denied-by-rules', rules: [] }) });
        try {
          const answer = await session.sendAndWait({ prompt });
          content = answer?.data.content ?? '';
        } finally { await session.disconnect(); }
      } finally { await client.stop(); }
    } else if (this.config.llmProvider === 'chatgpt') {
      const codex = new Codex({ env: { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string,string] => entry[1] !== undefined && !['OPENAI_API_KEY', 'OPENAI_BASE_URL'].includes(entry[0]))), CODEX_HOME: join(this.config.authDir, 'codex') }, config: { features: { shell_tool: false } } });
      const thread = codex.startThread({ model: this.config.chatgptModel, workingDirectory, skipGitRepoCheck: true, sandboxMode: 'read-only', approvalPolicy: 'never', networkAccessEnabled: false, webSearchMode: 'disabled' });
      const result = await thread.run(prompt);
      content = result.finalResponse;
      if (result.usage) usage = { input: result.usage.input_tokens, output: result.usage.output_tokens, total: result.usage.input_tokens + result.usage.output_tokens };
    } else throw new Error(`Unsupported subscription provider: ${this.config.llmProvider}`);
    if (!content.trim()) throw new Error(`${this.config.llmProvider} returned no answer`);
    return { content: options.responseFormat === 'json' ? extractJson(content) : content, tokensUsed: usage };
  }
}
