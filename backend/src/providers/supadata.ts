/**
 * Supadata client — thin wrapper around the YouTube transcript endpoint.
 *
 * https://docs.supadata.ai/api-reference/endpoint/youtube/transcript
 *
 * Why this exists: Open Brain v2 used to chain three fetchers for YouTube
 * (direct watch-page scrape → Firecrawl stealth → xAI Grok). The chain ran
 * because YouTube rate-limits / CAPTCHAs Azure datacenter IPs. Each tier
 * added 5–60s of latency and the worst case stacked past Azure's 240s
 * response timeout.
 *
 * Supadata is a single paid endpoint that returns clean transcripts in
 * 1–5s. Free tier is 100 calls/month at 1 req/s — plenty for personal use.
 *
 * If Supadata fails, the ingest fails. There is no fallback by design —
 * silent fallbacks were the source of past confusion.
 */

const SUPADATA_BASE_URL = 'https://api.supadata.ai/v1';

export interface YouTubeTranscriptResult {
  /** Plain-text transcript (we always request `text=true`). */
  content: string;
  /** ISO 639-1 language code Supadata picked. May differ from requested if requested lang is unavailable. */
  lang: string;
  /** All language codes available for this video. */
  availableLangs: string[];
}

export class SupadataClient {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) throw new Error('SupadataClient: apiKey is required.');
    this.apiKey = apiKey;
  }

  /**
   * Fetch a transcript for a single YouTube video.
   *
   * Supports any URL format Supadata accepts: standard watch URL, youtu.be
   * short link, /shorts/, /embed/, or a bare 11-char video ID.
   *
   * Throws with a clear, downstream-friendly message on any non-2xx response.
   */
  async fetchYouTubeTranscript(
    url: string,
    opts: { lang?: string } = {},
  ): Promise<YouTubeTranscriptResult> {
    const params = new URLSearchParams({
      url,
      text: 'true',
      lang: opts.lang ?? 'en',
    });

    const endpoint = `${SUPADATA_BASE_URL}/youtube/transcript?${params.toString()}`;
    const startedAt = Date.now();

    let res: Response;
    try {
      res = await fetch(endpoint, { headers: { 'x-api-key': this.apiKey } });
    } catch (err) {
      throw new Error(
        `Supadata: network failure fetching transcript — ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const elapsed = Date.now() - startedAt;
    const bodyText = await res.text();

    if (!res.ok) {
      // Supadata error responses are JSON: { error, message, details, documentationUrl }
      let errCode = 'unknown';
      let errMessage = bodyText.slice(0, 300);
      try {
        const parsed = JSON.parse(bodyText) as { error?: string; message?: string; details?: string };
        errCode = parsed.error ?? errCode;
        errMessage = [parsed.message, parsed.details].filter(Boolean).join(' — ') || errMessage;
      } catch {
        // body wasn't JSON; keep the raw slice
      }
      throw new Error(
        `Supadata: HTTP ${res.status} ${errCode} — ${errMessage} (${elapsed}ms, url: ${url.slice(0, 80)})`,
      );
    }

    let parsed: YouTubeTranscriptResult;
    try {
      parsed = JSON.parse(bodyText) as YouTubeTranscriptResult;
    } catch (err) {
      throw new Error(
        `Supadata: response was not valid JSON (${elapsed}ms) — ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (typeof parsed.content !== 'string' || !parsed.content.trim()) {
      throw new Error(
        `Supadata: response missing or empty content field (${elapsed}ms, lang=${parsed.lang ?? '?'})`,
      );
    }

    console.log(
      `[supadata] transcript ok — ${parsed.content.length} chars, lang=${parsed.lang}, available=[${(parsed.availableLangs ?? []).join(',')}], ${elapsed}ms`,
    );

    return {
      content: parsed.content,
      lang: parsed.lang,
      availableLangs: parsed.availableLangs ?? [],
    };
  }
}
