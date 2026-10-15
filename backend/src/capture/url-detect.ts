/**
 * URL type detection for the ingestion dispatcher.
 *
 * First pass: pattern match against known platforms (YouTube, X/Twitter).
 * Second pass: HEAD request to read Content-Type for direct media URLs
 * (PDF, image, audio, video).
 * Default: HTML scrape.
 */

export type UrlType = 'youtube' | 'x' | 'pdf' | 'image' | 'audio' | 'video' | 'html';

/**
 * Synchronous pattern matcher for known platforms.
 * Returns null if no pattern matches — caller should fall back to HEAD request.
 */
export function detectUrlTypeByPattern(url: string): UrlType | null {
  // YouTube — both youtube.com/watch and youtu.be short links
  if (/(?:^|\/\/(?:www\.)?)(youtube\.com\/(?:watch|shorts|embed)|youtu\.be\/)/i.test(url)) {
    return 'youtube';
  }

  // X / Twitter — match status URL pattern
  if (/(?:^|\/\/(?:www\.)?)(x\.com|twitter\.com)\/[\w.-]+\/status\/\d+/i.test(url)) {
    return 'x';
  }

  return null;
}

/**
 * Full detection. Falls back to HEAD request if no platform pattern matches.
 * If HEAD fails (many servers block HEAD or return wrong Content-Type), default to 'html'.
 */
export async function detectUrlType(url: string): Promise<UrlType> {
  const byPattern = detectUrlTypeByPattern(url);
  if (byPattern) return byPattern;

  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    const ct = (res.headers.get('content-type') ?? '').toLowerCase();

    if (ct.includes('application/pdf')) return 'pdf';
    if (ct.startsWith('image/')) return 'image';
    if (ct.startsWith('audio/')) return 'audio';
    if (ct.startsWith('video/')) return 'video';
    // Anything else (text/html, text/plain, application/xhtml+xml, unknown) → HTML path
    return 'html';
  } catch {
    // HEAD failed — common for servers that block non-GET or CORS-limit HEADs
    return 'html';
  }
}

/** Extract the 11-char YouTube video ID from any canonical URL. */
export function extractYouTubeVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

/**
 * Normalize a URL for consistent dedup: drop fragment, trailing slash.
 * Keep query params as-is (stripping tracking params is a future improvement).
 */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    // Remove trailing slash from pathname but preserve root "/"
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return url;
  }
}
