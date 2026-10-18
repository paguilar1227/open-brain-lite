import { expect, it, vi } from 'vitest';
vi.mock('../../src/providers/model-catalog.js',()=>({getModelCatalog:vi.fn().mockResolvedValue({status:'available',models:[{id:'example',name:'Example model'}],message:'Available'})}));
import { createApp } from '../../src/app.js';
import { getModelCatalog } from '../../src/providers/model-catalog.js';
import type { ServiceDeps } from '../../src/services/index.js';

it('serves provider model choices and rejects unsupported providers',async()=>{
  const config={storageProvider:'local'};
  const app=createApp({config} as ServiceDeps);
  const response=await app.request('/api/v1/providers/copilot/models');
  expect(response.status).toBe(200);
  expect((await response.json()).models).toEqual([{id:'example',name:'Example model'}]);
  expect(getModelCatalog).toHaveBeenCalledWith(config,'copilot');
  const invalid=await app.request('/api/v1/providers/unknown/models');
  expect(invalid.status).toBe(400);
});
