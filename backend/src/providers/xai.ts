/**
 * xAI client using the Agent Tools API (/v1/responses).
 *
 * The older /v1/chat/completions + search_parameters (live_search) flow
 * was deprecated in 2026. The replacement is:
 *   - Endpoint: /v1/responses
 *   - Payload: { model, input: [{role, content}], tools: [{type: '...'}] }
 *   - Built-in tools: 'web_search', 'x_search', 'code_interpreter', etc.
 *     The API executes them server-side and folds results into the response.
 *
 * For X threads: use the `x_search` tool. For YouTube transcripts: `web_search`
 * (no dedicated YouTube tool; web_search can browse video pages).
 */

const XAI_ENDPOINT = 'https://api.x.ai/v1/responses';
const XAI_MODEL = 'grok-4.20-reasoning';

export interface LiveSearchResult {
  title: string;
  content: string;
}

export class XaiClient {
  constructor(private apiKey: string) {}

  /**
   * Fetch an X thread using the x_search built-in tool. Grok browses X
   * server-side and returns the thread content.
   */
  async fetchXThread(url: string): Promise<LiveSearchResult> {
    // x_search is really x_keyword_search — it searches X by keyword/user/date,
    // it doesn't fetch by post ID directly. Strategy:
    //   1. Parse URL → extract @handle and post ID
    //   2. Decode post ID → timestamp (Twitter snowflakes encode millis since 2010-11-04)
    //   3. Build a search prompt that scopes to this user + a ±1 day window around
    //      the timestamp so Grok can find the specific post via keyword search
    const parsed = parseXUrl(url);
    if (!parsed) {
      throw new Error(`URL does not match the X status pattern: ${url}`);
    }

    // Decode post ID → timestamp, then search in a narrow ±6 hour window.
    // x_search mode=Latest returns the N most recent posts in the window;
    // a tight window around the post's exact timestamp maximizes the odds
    // our target is in that N.
    const postDate = snowflakeToDate(parsed.postId);
    const windowMs = 6 * 60 * 60 * 1000; // ±6 hours
    const fromDate = new Date(postDate.getTime() - windowMs).toISOString();
    const toDate = new Date(postDate.getTime() + windowMs).toISOString();
    const postDateStr = postDate.toISOString();

    const prompt = `Use x_search to find a specific X post from @${parsed.handle} and return its content.

Target:
- Author: @${parsed.handle}
- Post ID: ${parsed.postId}
- Timestamp: ${postDateStr}
- URL: ${url}

Call x_search with a high limit (50) and mode=Latest, scoped to the date window already configured. Look through the returned posts for the one with ID ${parsed.postId}. If you find it, return:
- The original post's full text
- Any replies/continuations by @${parsed.handle} that form the thread
- Each post's author and ID

Format: plain prose with "@handle [post_id]: text" blocks separated by blank lines. Do NOT summarize or paraphrase — verbatim content only.

If the post with ID ${parsed.postId} is NOT in the x_search results for that window, respond with exactly this single line and nothing else: X_FETCH_FAILED`;

    const tools = [
      {
        type: 'x_search',
        allowed_x_handles: [parsed.handle],
        from_date: fromDate,
        to_date: toDate,
        enable_image_understanding: true,
        enable_video_understanding: true,
      },
    ];

    const result = await this.callAgentTools(prompt, tools);

    if (
      result.content.trim() === 'X_FETCH_FAILED' ||
      /\bX_FETCH_FAILED\b/.test(result.content) ||
      /fetch error|could not be retrieved|unable to fetch|failed to fetch/i.test(result.content)
    ) {
      // Log the raw Grok reply for ops; keep the thrown message focused and
      // actionable for the end user / MCP caller.
      console.warn(
        `[xai][x] x_search miss for post ${parsed.postId} (@${parsed.handle}). Grok reply: "${result.content.slice(0, 300)}"`,
      );
      throw new Error(
        `X_SEARCH_MISS: Grok's x_search couldn't surface post ${parsed.postId} by @${parsed.handle}. ` +
        `x_search is keyword/date-indexed — older, obscure, or deleted posts often aren't in its results set. ` +
        `Workaround: copy the post text and save it via create(type: 'note', title: ..., content: ..., sourceUrl: '${url}').`,
      );
    }

    return result;
  }

  /**
   * Core Agent Tools API call. Extracts the assistant text from the
   * /v1/responses output.
   */
  private async callAgentTools(
    prompt: string,
    tools: Array<Record<string, unknown>>,
  ): Promise<LiveSearchResult> {
    const res = await fetch(XAI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: XAI_MODEL,
        input: [{ role: 'user', content: prompt }],
        tools,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`xAI /v1/responses ${res.status}: ${body.slice(0, 500)}`);
    }

    const json = (await res.json()) as unknown;
    const text = extractAssistantText(json);

    if (!text.trim()) {
      throw new Error('xAI returned no assistant text (tool may have found nothing).');
    }

    const firstLine = text.split('\n').find((l) => l.trim().length > 0) ?? '';
    const title = firstLine.trim().slice(0, 80);
    return { title, content: text.trim() };
  }
}

/** Extract @handle and post ID from an X URL. Returns null on mismatch. */
function parseXUrl(url: string): { handle: string; postId: string } | null {
  const m = url.match(/(?:x|twitter)\.com\/([^/?#]+)\/status\/(\d+)/i);
  if (!m) return null;
  return { handle: m[1], postId: m[2] };
}

/**
 * Decode a Twitter/X snowflake ID into its creation timestamp.
 * Snowflake format: (ms since 2010-11-04T01:42:54.657Z) << 22 | metadata.
 * Use BigInt because IDs exceed Number.MAX_SAFE_INTEGER.
 */
const TWITTER_EPOCH_MS = 1288834974657n;
function snowflakeToDate(postId: string): Date {
  try {
    const id = BigInt(postId);
    const ms = (id >> 22n) + TWITTER_EPOCH_MS;
    const date = new Date(Number(ms));
    // Sanity: if decoded date is wildly wrong, fall back to "now"
    if (isNaN(date.getTime()) || date.getFullYear() < 2006 || date.getFullYear() > 2100) {
      return new Date();
    }
    return date;
  } catch {
    return new Date();
  }
}

/**
 * The /v1/responses format is similar to OpenAI's: an array of output items,
 * each with a type (e.g. "message", "tool_call"). The assistant's final text
 * lives in items where type === "message", content[].text.
 *
 * This extractor is defensive — the exact shape may evolve. We look for text
 * in the most likely places and concatenate.
 */
function extractAssistantText(resp: unknown): string {
  if (!resp || typeof resp !== 'object') return '';
  const obj = resp as Record<string, unknown>;

  // Shape 1: { output: [{ type: 'message', content: [{ type: 'output_text', text: '...' }] }] }
  if (Array.isArray(obj.output)) {
    const parts: string[] = [];
    for (const item of obj.output) {
      if (!item || typeof item !== 'object') continue;
      const it = item as Record<string, unknown>;
      if (it.type === 'message' && Array.isArray(it.content)) {
        for (const c of it.content) {
          if (!c || typeof c !== 'object') continue;
          const cc = c as Record<string, unknown>;
          if (typeof cc.text === 'string') parts.push(cc.text);
        }
      }
    }
    if (parts.length > 0) return parts.join('\n\n');
  }

  // Shape 2: { output_text: '...' } (OpenAI-compat convenience field)
  if (typeof obj.output_text === 'string') return obj.output_text;

  // Shape 3: legacy choices[].message.content for transition period
  if (Array.isArray(obj.choices) && obj.choices[0]) {
    const choice = obj.choices[0] as Record<string, unknown>;
    const msg = choice.message as Record<string, unknown> | undefined;
    if (msg && typeof msg.content === 'string') return msg.content;
  }

  return '';
}
