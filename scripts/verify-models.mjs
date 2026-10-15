// Runs only against local Ollama; never invokes a subscription provider.
import assert from 'node:assert/strict';
import { ensureOllamaModels, OllamaEmbeddingProvider, OllamaLLMProvider } from '../backend/dist/providers/ollama.js';
import { loadConfig } from '../backend/dist/config.js';

// Read persisted model settings just as the application does.
const config = loadConfig();
const url = config.ollamaUrl;
const embeddingModel = config.embeddingModel;
const completionModel = config.localModel;
if (process.argv.includes('--pull')) await ensureOllamaModels(url, [embeddingModel, completionModel]);
const embedding = new OllamaEmbeddingProvider(url, embeddingModel);
const completion = new OllamaLLMProvider(url, completionModel);
const started = performance.now();
const vectors = [];
for (const text of [
  'How are project decisions retained between separate AI conversations?',
  'Project sessions persist in the local database, with decisions and next actions for the next agent.',
  'Bake lasagna with tomato sauce, pasta, ricotta and parmesan.',
]) vectors.push(await embedding.embed(text));
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
assert(dot(vectors[0], vectors[1]) > dot(vectors[0], vectors[2]), 'The embedding model must rank relevant project context above unrelated text.');

const response = await completion.complete([
  { role: 'user', content: 'The project uses PostgreSQL for data and Ollama for models. Return their names.' },
], { systemPrompt: 'Extract only the supplied facts as JSON with keys database and model_runtime.', responseFormat: 'json' });
const facts = JSON.parse(response.content);
assert.equal(facts.database?.toLowerCase(), 'postgresql');
assert.equal(facts.model_runtime?.toLowerCase(), 'ollama');
console.log(JSON.stringify({ status: 'passed', embeddingModel, completionModel, dimensions: vectors[0].length, elapsedMs: Math.round(performance.now() - started) }));
