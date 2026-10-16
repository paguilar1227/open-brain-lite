import { z } from 'zod';
import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

const configSchema = z.object({
  databaseUrl: z.string().min(1),
  apiKey: z.string().min(1),
  azureStorageConnectionString: z.string().default(''),
  azureStorageContainer: z.string().default('open-brain'),
  geminiApiKey: z.string(),
  anthropicApiKey: z.string(),
  xaiApiKey: z.string(),
  firecrawlApiKey: z.string(),
  supadataApiKey: z.string(),
  azureOpenAIEndpoint: z.string(),
  azureOpenAIKey: z.string(),
  azureRagDeployment: z.string().min(1),          // fast-path: chat completions (gpt-5-4)
  azureDeepRagDeployment: z.string().min(1),      // thorough-path: Responses API (gpt-5-4-pro)
  port: z.number().int().positive(),
  nodeEnv: z.enum(['development', 'production', 'test']),
  timezone: z.string().min(1),
  // When 'stub', all LLM + embedding calls are routed to deterministic in-memory
  // fakes (see providers/stub.ts). Real upstream API keys are not required.
  llmProvider: z.enum(['real', 'stub', 'ollama', 'llama.cpp', 'copilot', 'chatgpt']),
  ollamaUrl: z.string().default('http://ollama:11434'),
  embeddingModel: z.string().default('embeddinggemma'),
  localModel: z.string().default('qwen3.5:4b'),
  filesDir: z.string().default('/data/files'),
  settingsPath: z.string().default('/data/settings.json'),
  llamaUrl: z.string().default('http://host.docker.internal:8080/v1'),
  llamaModel: z.string().default('local-model'),
  authDir: z.string().default('/data/auth'),
  copilotModel: z.string().default('gpt-5-mini'),
  chatgptModel: z.string().default('gpt-6-luna'),
  storageProvider: z.enum(['local', 'azure']).default('local'),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  const llmProvider = process.env.LLM_PROVIDER || 'ollama';
  // In stub mode, upstream API keys aren't called — fall back to placeholders
  // so the schema's .min(1) doesn't reject local dev .env files that omit them.
  const stubKey = '__stub__';
  const orStub = (v: string | undefined) => v ?? (llmProvider === 'stub' ? stubKey : '');

  const settingsPath = process.env.SETTINGS_PATH || '/data/settings.json';
  const saved = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {};
  return configSchema.parse({
    databaseUrl: process.env.DATABASE_URL,
    apiKey: process.env.OPEN_BRAIN_API_KEY,
    azureStorageConnectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
    azureStorageContainer: process.env.AZURE_STORAGE_CONTAINER,
    geminiApiKey: orStub(process.env.GEMINI_API_KEY),
    anthropicApiKey: orStub(process.env.ANTHROPIC_API_KEY),
    xaiApiKey: orStub(process.env.XAI_API_KEY),
    firecrawlApiKey: orStub(process.env.FIRECRAWL_API_KEY),
    supadataApiKey: orStub(process.env.SUPADATA_API_KEY),
    azureOpenAIEndpoint: orStub(process.env.AZURE_OPENAI_ENDPOINT),
    azureOpenAIKey: orStub(process.env.AZURE_OPENAI_KEY),
    azureRagDeployment: process.env.AZURE_RAG_DEPLOYMENT || 'gpt-5-4',
    azureDeepRagDeployment: process.env.AZURE_DEEP_RAG_DEPLOYMENT || 'gpt-5-4-pro',
    port: Number(process.env.PORT || '3000'),
    nodeEnv: process.env.NODE_ENV || 'development',
    timezone: process.env.TIMEZONE || 'America/Chicago',
    llmProvider: saved.provider ?? llmProvider,
    settingsPath,
    llamaUrl: saved.llamaUrl ?? process.env.LLAMA_URL,
    llamaModel: saved.llamaModel ?? process.env.LLAMA_MODEL,
    authDir: process.env.AUTH_DIR,
    copilotModel: saved.copilotModel ?? process.env.COPILOT_MODEL,
    chatgptModel: saved.chatgptModel ?? process.env.CHATGPT_MODEL,
    ollamaUrl: process.env.OLLAMA_URL,
    embeddingModel: process.env.EMBEDDING_MODEL,
    localModel: saved.localModel ?? process.env.LOCAL_MODEL,
    filesDir: process.env.FILES_DIR,
    storageProvider: process.env.STORAGE_PROVIDER,
  });
}

export async function saveRuntimeConfig(config: Config, values: { provider: 'ollama' | 'llama.cpp' | 'copilot' | 'chatgpt'; llamaUrl: string; llamaModel: string; localModel: string; copilotModel: string; chatgptModel: string }) {
  await mkdir(dirname(config.settingsPath), { recursive: true });
  const temp = `${config.settingsPath}.tmp`;
  await writeFile(temp, JSON.stringify(values), { mode: 0o600 });
  await rename(temp, config.settingsPath);
  Object.assign(config, { llmProvider: values.provider, localModel: values.localModel, copilotModel: values.copilotModel, chatgptModel: values.chatgptModel, llamaUrl: values.llamaUrl, llamaModel: values.llamaModel });
}
