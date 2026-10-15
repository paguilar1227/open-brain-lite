import { createServer, type Server } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { OllamaLLMProvider, ensureOllamaModels } from '../../src/providers/ollama.js';
import { LlamaCppProvider } from '../../src/providers/llama.js';
import { postLocalJson } from '../../src/providers/local-http.js';

const servers: Server[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  })));
});

async function localRuntime(reply: unknown) {
  const received: Array<{ path: string; body: unknown }> = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    received.push({ path: request.url!, body: JSON.parse(Buffer.concat(chunks).toString()) });
    // Model servers can withhold headers while computing a complete response.
    await new Promise<void>(resolve => setImmediate(resolve));
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(reply));
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing local runtime port');
  return { url: `http://127.0.0.1:${address.port}`, received };
}

it('accepts delayed local Ollama responses without the fetch headers deadline', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(new Error('fetch failed'), { cause: { code: 'UND_ERR_HEADERS_TIMEOUT' } })));
  const runtime = await localRuntime({ message: { content: 'Durable handoff' }, prompt_eval_count: 4, eval_count: 5 });
  await expect(new OllamaLLMProvider(runtime.url, 'local').complete([{ role: 'user', content: 'Summarize' }]))
    .resolves.toMatchObject({ content: 'Durable handoff', tokensUsed: { total: 9 } });
  expect(runtime.received[0]).toMatchObject({ path: '/api/chat', body: { model: 'local' } });
  expect(fetch).not.toHaveBeenCalled();
});

it('uses the same deadline-free local transport for model preparation and llama.cpp', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch headers timeout')));
  const ollama = await localRuntime({ status: 'success' });
  await expect(ensureOllamaModels(ollama.url, ['embeddinggemma'])).resolves.toBeUndefined();
  const llama = await localRuntime({ choices: [{ message: { content: 'Local answer' } }] });
  await expect(new LlamaCppProvider(`${llama.url}/v1`, 'local').complete([{ role: 'user', content: 'Summarize' }]))
    .resolves.toMatchObject({ content: 'Local answer' });
  expect(ollama.received[0].path).toBe('/api/pull');
  expect(llama.received[0].path).toBe('/v1/chat/completions');
  expect(fetch).not.toHaveBeenCalled();
});

it('rejects invalid JSON and dropped responses instead of reporting a completion', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/invalid') { response.end('not JSON'); return; }
    response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '1000' });
    response.write('{"partial":');
    response.destroy();
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing port');
  const base = `http://127.0.0.1:${address.port}`;
  await expect(postLocalJson(`${base}/invalid`, {}, 'test')).rejects.toThrow();
  await expect(postLocalJson(`${base}/dropped`, {}, 'test')).rejects.toThrow();
});
