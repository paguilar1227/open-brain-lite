import { LlamaCppProvider } from './llama.js';
import { CopilotClient, RuntimeConnection } from '@github/copilot-sdk';
import { Codex } from '@openai/codex-sdk';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { LLMProvider, LLMMessage, LLMOptions, LLMResponse } from './types.js';
import { extractJson } from './json-utils.js';
import type { Config } from '../config.js';
import { OllamaLLMProvider } from './ollama.js';
import { providerEnvironment } from './environment.js';
import { DEFAULT_COPILOT_MODEL } from '../config.js';
import type { ModelCatalog } from './model-catalog.js';

function copilotClient(config: Config) {
  return new CopilotClient({ mode: 'empty', connection: RuntimeConnection.forStdio(), env: providerEnvironment(config.authDir, 'copilot'), baseDirectory: join(config.authDir, 'copilot'), workingDirectory: join(config.authDir, 'workspace') });
}

export async function discoverCopilotModels(config: Config): Promise<ModelCatalog> {
  const client = copilotClient(config);
  try {
    await mkdir(join(config.authDir, 'workspace'), { recursive: true });
    await client.start();
    if (!(await client.getAuthStatus()).isAuthenticated) return { status: 'sign_in_required', models: [], message: 'Sign in with GitHub Copilot to see your available models.' };
    const models = (await client.listModels()).filter(model => !model.policy || model.policy.state === 'enabled')
      .map(model => ({ id: model.id, name: model.name || model.id }));
    return { status: 'available', models, message: 'Models available through your GitHub Copilot account.' };
  } finally { await client.stop().catch(() => undefined); }
}

// Only select a default when there is no explicit saved/environment choice.
// A failed discovery leaves the local default intact; inference never falls back.
export async function trySelectCopilotDefault(config: Config): Promise<boolean> {
  if (!config.autoSelectCopilot || config.storageProvider !== 'local') return false;
  let client: CopilotClient | undefined;
  try {
    client = copilotClient(config);
    await mkdir(join(config.authDir, 'workspace'), { recursive: true });
    await client.start();
    if (!(await client.getAuthStatus()).isAuthenticated) return false;
    const models = await client.listModels();
    const model = models.find(model => model.id === DEFAULT_COPILOT_MODEL);
    if (!model || (model.policy && model.policy.state !== 'enabled')) return false;
    // A user may have saved a choice while discovery was in flight.
    if (!config.autoSelectCopilot) return false;
    config.llmProvider = 'copilot';
    config.copilotModel = DEFAULT_COPILOT_MODEL;
    console.info(`[providers] Default: Copilot / ${DEFAULT_COPILOT_MODEL}`);
    return true;
  } catch {
    console.warn('[providers] Copilot availability check failed; keeping the configured provider.');
    return false;
  } finally {
    await client?.stop().catch(() => undefined);
  }
}

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
      const client = copilotClient(this.config);
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
      await mkdir(join(this.config.authDir, 'codex'), { recursive: true });
      const codex = new Codex({ env: providerEnvironment(this.config.authDir, 'chatgpt'), config: { features: { shell_tool: false } } });
      const thread = codex.startThread({ model: this.config.chatgptModel, workingDirectory, skipGitRepoCheck: true, sandboxMode: 'read-only', approvalPolicy: 'never', networkAccessEnabled: false, webSearchMode: 'disabled' });
      const result = await thread.run(prompt);
      content = result.finalResponse;
      if (result.usage) usage = { input: result.usage.input_tokens, output: result.usage.output_tokens, total: result.usage.input_tokens + result.usage.output_tokens };
    } else throw new Error(`Unsupported subscription provider: ${this.config.llmProvider}`);
    if (!content.trim()) throw new Error(`${this.config.llmProvider} returned no answer`);
    return { content: options.responseFormat === 'json' ? extractJson(content) : content, tokensUsed: usage };
  }
}
