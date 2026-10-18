import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { LocalFileStorage } from '../../src/storage/local.js';
import type { ServiceDeps } from '../../src/services/index.js';

function localApp() {
  const storage = new LocalFileStorage('/unused', '');
  vi.spyOn(storage, 'download').mockResolvedValue(Buffer.from('saved document'));
  vi.spyOn(storage, 'getContentType').mockResolvedValue('text/plain');
  const deps = {
    config: { storageProvider: 'local', apiKey: '' },
    db: { query: vi.fn().mockResolvedValue({ rows: [] }) },
    blobStorage: storage,
  } as unknown as ServiceDeps;
  return { app: createApp(deps), deps };
}

describe('keyless local installation', () => {
  it('opens projects, API documentation, and original files without credentials', async () => {
    const { app } = localApp();
    for (const path of ['/api/v1/projects', '/api/openapi.json', '/api/docs', '/api/files/saved.txt']) {
      const response = await app.request(path);
      expect(response.status, path).toBe(200);
    }
  });

  it('initializes MCP without an API key', async () => {
    const { app } = localApp();
    const response = await app.request('/mcp', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'keyless-test', version: '1' } } }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).result.serverInfo.name).toBeTruthy();
  });

  it('rejects requests and preflights from foreign browser origins before accessing data', async () => {
    const { app, deps } = localApp();
    for (const method of ['GET', 'POST', 'OPTIONS']) {
      const response = await app.request('/api/v1/projects', { method, headers: { Origin: 'https://foreign.example' } });
      expect(response.status).toBe(403);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    }
    expect(deps.db.query).not.toHaveBeenCalled();
  });

  it('allows same-origin browser requests and keeps cloud authentication required', async () => {
    const { app, deps } = localApp();
    expect((await app.request('http://localhost/api/v1/projects', { headers: { Origin: 'http://localhost' } })).status).toBe(200);
    deps.config.storageProvider = 'azure';
    deps.config.apiKey = 'cloud-key';
    const cloud = createApp(deps);
    expect((await cloud.request('/api/v1/projects')).status).toBe(401);
    expect((await cloud.request('/api/v1/projects', { headers: { Authorization: 'Bearer cloud-key' } })).status).toBe(200);
  });
});
