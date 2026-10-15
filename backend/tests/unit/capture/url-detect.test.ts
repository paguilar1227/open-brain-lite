import { describe, it, expect } from 'vitest';
import {
  detectUrlTypeByPattern,
  extractYouTubeVideoId,
  normalizeUrl,
} from '../../../src/capture/url-detect.js';

describe('detectUrlTypeByPattern', () => {
  it('detects youtube.com/watch URLs', () => {
    expect(detectUrlTypeByPattern('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('youtube');
    expect(detectUrlTypeByPattern('https://youtube.com/watch?v=dQw4w9WgXcQ&t=42')).toBe('youtube');
  });

  it('detects youtu.be short URLs', () => {
    expect(detectUrlTypeByPattern('https://youtu.be/dQw4w9WgXcQ')).toBe('youtube');
  });

  it('detects youtube shorts and embeds', () => {
    expect(detectUrlTypeByPattern('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('youtube');
    expect(detectUrlTypeByPattern('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('youtube');
  });

  it('detects x.com status URLs', () => {
    expect(detectUrlTypeByPattern('https://x.com/elonmusk/status/1234567890')).toBe('x');
    expect(detectUrlTypeByPattern('https://www.x.com/jack/status/99999')).toBe('x');
  });

  it('detects twitter.com status URLs (legacy)', () => {
    expect(detectUrlTypeByPattern('https://twitter.com/jack/status/20')).toBe('x');
  });

  it('returns null for non-platform URLs (caller should fall back to HEAD)', () => {
    expect(detectUrlTypeByPattern('https://example.com/article')).toBeNull();
    expect(detectUrlTypeByPattern('https://arxiv.org/pdf/2301.00234')).toBeNull();
    expect(detectUrlTypeByPattern('https://github.com/user/repo')).toBeNull();
  });

  it('does not false-match on URLs that contain youtube/x substrings elsewhere', () => {
    // Blog post mentioning YouTube in the URL path shouldn't trigger YouTube handling
    expect(detectUrlTypeByPattern('https://blog.example.com/reviews/youtube-vs-vimeo')).toBeNull();
    // x.com without a status path shouldn't trigger X handling
    expect(detectUrlTypeByPattern('https://x.com/elonmusk')).toBeNull();
  });
});

describe('extractYouTubeVideoId', () => {
  it('extracts 11-char ID from watch URLs', () => {
    expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYouTubeVideoId('https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s')).toBe('dQw4w9WgXcQ');
  });

  it('extracts ID from youtu.be short URLs', () => {
    expect(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts ID from shorts and embeds', () => {
    expect(extractYouTubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYouTubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('returns null for non-YouTube URLs', () => {
    expect(extractYouTubeVideoId('https://example.com/dQw4w9WgXcQ')).toBeNull();
  });
});

describe('normalizeUrl (dedup key)', () => {
  it('strips URL fragment', () => {
    expect(normalizeUrl('https://example.com/page#section-2')).toBe('https://example.com/page');
  });

  it('strips trailing slash from pathname (but keeps root "/")', () => {
    expect(normalizeUrl('https://example.com/article/')).toBe('https://example.com/article');
    // Root slash is preserved (URL API normalizes "https://example.com" → "https://example.com/")
    expect(normalizeUrl('https://example.com')).toBe('https://example.com/');
  });

  it('preserves query parameters', () => {
    expect(normalizeUrl('https://example.com/p?x=1&y=2')).toBe('https://example.com/p?x=1&y=2');
  });

  it('returns the original string for malformed URLs (graceful)', () => {
    expect(normalizeUrl('not a url')).toBe('not a url');
  });
});
