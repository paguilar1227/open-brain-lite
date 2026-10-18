import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config } from '../config.js';
import { discoverCopilotModels } from './subscription.js';

export type ModelCatalog = {
  status: 'available' | 'sign_in_required' | 'manual' | 'unavailable';
  models: Array<{ id: string; name: string }>;
  message: string;
};

export async function getModelCatalog(config: Config, provider: 'ollama' | 'llama.cpp' | 'copilot' | 'chatgpt'): Promise<ModelCatalog> {
  try {
    if (provider === 'copilot') return await discoverCopilotModels(config);
    if (provider === 'chatgpt') {
      let saved = false;
      try { await access(join(config.authDir, 'codex', 'auth.json')); saved = true; } catch { /* No saved sign-in. */ }
      return { status: saved ? 'manual' : 'sign_in_required', models: [], message: saved
        ? 'Sign-in is saved. Enter a model available on your ChatGPT plan; it will be checked when used.'
        : 'Sign in with ChatGPT, then enter a model available on your plan.' };
    }
    const base = provider === 'ollama' ? config.ollamaUrl : config.llamaUrl;
    const response = await fetch(`${base.replace(/\/+$/, '')}/${provider === 'ollama' ? 'api/tags' : 'models'}`);
    if (!response.ok) throw new Error('Model discovery failed');
    const body = await response.json() as { models?: Array<{ name: string }>; data?: Array<{ id: string }> };
    const models = provider === 'ollama'
      ? (body.models ?? []).filter(model => model.name !== config.embeddingModel && model.name !== `${config.embeddingModel}:latest`).map(model => ({ id: model.name, name: model.name }))
      : (body.data ?? []).map(model => ({ id: model.id, name: model.id }));
    return { status: 'available', models, message: models.length ? 'Models available on this local server.' : 'No completion models found. Add a model to this local server first.' };
  } catch {
    return { status: 'unavailable', models: [], message: 'Could not load models. Check the provider connection, or enter a model name manually.' };
  }
}
