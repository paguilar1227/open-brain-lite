import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); localStorage.clear(); });
afterEach(() => vi.unstubAllGlobals());

it('boots a fresh local workspace and sends requests without a key', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ projects: [] }), { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  const api = await import('./api');
  await api.bootAuth();
  expect(api.isLocalAccess()).toBe(true);
  await api.listProjects();
  expect(new Headers(fetch.mock.calls.at(-1)?.[1]?.headers).has('Authorization')).toBe(false);
});

it('discards a cached installation key when the local server needs none', async () => {
  localStorage.setItem('ob.api_key', 'old-key');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
  const api = await import('./api');
  await api.bootAuth();
  expect(localStorage.getItem('ob.api_key')).toBeNull();
});

it('still uses an explicit key for an authenticated server', async () => {
  localStorage.setItem('ob.api_key', 'cloud-key');
  const fetch = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 401 })).mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  const api = await import('./api');
  await api.bootAuth();
  expect(api.isLocalAccess()).toBe(false);
  expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer cloud-key');
});

it('sends default AND and explicit OR with tags, search and timeline pagination for both scopes',async()=>{
  const response={events:[],total:0,next_cursor:null,available_tags:[]};
  const fetch=vi.fn().mockImplementation(async()=>new Response(JSON.stringify(response),{status:200}));
  vi.stubGlobal('fetch',fetch);
  const api=await import('./api');
  const id='00000000-0000-4000-8000-000000000001',cursor={at:'2026-01-01T00:00:00Z',id:'12'};
  for(const read of [api.listProjectTimeline,api.listSessionTimeline]){
    await read(id,'needle',cursor,undefined,['design','release']);
    let params=new URL(fetch.mock.calls.at(-1)![0],'https://test.invalid').searchParams;
    expect(params.get('tag_match')).toBe('all');expect(params.getAll('tag')).toEqual(['design','release']);
    expect(params.get('search')).toBe('needle');expect(params.get('before_at')).toBe(cursor.at);expect(params.get('before_id')).toBe('12');
    await read(id,'needle',cursor,undefined,['design','release'],'any');
    params=new URL(fetch.mock.calls.at(-1)![0],'https://test.invalid').searchParams;
    expect(params.get('tag_match')).toBe('any');
  }
});
