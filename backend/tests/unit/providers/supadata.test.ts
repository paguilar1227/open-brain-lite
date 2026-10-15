import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SupadataClient } from '../../../src/providers/supadata.js';

describe('SupadataClient', () => {
  const realFetch = global.fetch;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => { global.fetch = realFetch; });

  it('throws if constructed without an api key', () => {
    expect(() => new SupadataClient('')).toThrow(/apiKey is required/);
  });

  it('GETs /v1/youtube/transcript with x-api-key, url, lang, text=true', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ content: 'hello world', lang: 'en', availableLangs: ['en'] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    global.fetch = mockFetch as any;

    const client = new SupadataClient('test-key');
    const result = await client.fetchYouTubeTranscript('https://youtu.be/abc', { lang: 'en' });

    expect(result.content).toBe('hello world');
    expect(result.lang).toBe('en');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [calledUrl, calledOpts] = mockFetch.mock.calls[0];
    expect(calledUrl).toContain('https://api.supadata.ai/v1/youtube/transcript?');
    expect(calledUrl).toContain('url=https%3A%2F%2Fyoutu.be%2Fabc');
    expect(calledUrl).toContain('text=true');
    expect(calledUrl).toContain('lang=en');
    expect(calledOpts.headers['x-api-key']).toBe('test-key');
  });

  it('defaults lang to en when caller omits it', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ content: 'x', lang: 'en', availableLangs: ['en'] }),
      { status: 200 },
    ));
    global.fetch = mockFetch as any;
    const client = new SupadataClient('k');
    await client.fetchYouTubeTranscript('https://youtu.be/abc');
    const [calledUrl] = mockFetch.mock.calls[0];
    expect(calledUrl).toContain('lang=en');
  });

  it('throws a clean error on non-2xx with the parsed error code + message', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'video-not-found', message: 'Not Found', details: 'Video does not exist' }),
      { status: 404 },
    )) as any;

    const client = new SupadataClient('k');
    await expect(client.fetchYouTubeTranscript('https://youtu.be/zzz')).rejects.toThrow(
      /Supadata: HTTP 404 video-not-found.*Not Found.*Video does not exist/,
    );
  });

  it('throws on a 429 rate-limit response', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'limit-exceeded', message: 'Limit Exceeded' }),
      { status: 429 },
    )) as any;
    const client = new SupadataClient('k');
    await expect(client.fetchYouTubeTranscript('https://youtu.be/x')).rejects.toThrow(/HTTP 429.*limit-exceeded/);
  });

  it('throws when response body is empty content (would silently produce empty docs)', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ content: '   ', lang: 'en', availableLangs: ['en'] }),
      { status: 200 },
    )) as any;
    const client = new SupadataClient('k');
    await expect(client.fetchYouTubeTranscript('https://youtu.be/x')).rejects.toThrow(/missing or empty content/);
  });

  it('throws on network failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;
    const client = new SupadataClient('k');
    await expect(client.fetchYouTubeTranscript('https://youtu.be/x')).rejects.toThrow(/network failure/);
  });
});
