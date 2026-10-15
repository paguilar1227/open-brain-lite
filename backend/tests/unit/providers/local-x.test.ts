import { afterEach, expect, it, vi } from 'vitest';
import { fetchPublicXPost } from '../../../src/providers/local-x.js';

afterEach(() => vi.unstubAllGlobals());

it('imports a text-only public post without requiring video or account credentials', async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({
    author_name: 'Test Author',
    html: '<blockquote class="twitter-tweet"><p>Keep notes &amp; decisions.<br>Continue tomorrow.</p>— Test Author <a>October 15</a></blockquote><script>ignore()</script>',
  }));
  vi.stubGlobal('fetch', fetchMock);
  const post = await fetchPublicXPost('https://x.com/author/status/123');
  expect(post).toEqual({ title: 'Post by Test Author', text: 'Keep notes & decisions.\nContinue tomorrow.' });
  const endpoint = new URL(fetchMock.mock.calls[0][0]);
  expect(endpoint.origin).toBe('https://publish.twitter.com');
  expect(endpoint.searchParams.get('url')).toBe('https://x.com/author/status/123');
  expect(endpoint.searchParams.get('omit_script')).toBe('1');
});

it('rejects unavailable posts and embed shells without post text', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
  await expect(fetchPublicXPost('https://x.com/author/status/123')).rejects.toThrow('HTTP 404');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ html: '<blockquote>Post unavailable</blockquote>' })));
  await expect(fetchPublicXPost('https://x.com/author/status/123')).rejects.toThrow('no readable post text');
});
