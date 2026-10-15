import type { LLMProvider, LLMMessage } from '../providers/types.js';

export interface CaptureMetadata {
  title: string;                    // auto-generated concise title
  topics: string[];
  extracted_text: string | null;
  published_at: string | null;      // ISO-8601 publication date if explicit in the content (not the save time)
}

// Tags are deliberately NOT in the metadata payload. They are user-
// authored only — the LLM does not propose tags during ingest. The
// MCP `INSTRUCTIONS` string tells AI clients to prompt the user for
// tags at capture time so the user's tag namespace stays clean and
// curated.

export interface FileInput {
  data: Buffer;
  mimeType: string;
}

const PUBLISHED_AT_FIELD = `- published_at: ISO-8601 datetime (YYYY-MM-DD or full timestamp) if the content has an EXPLICIT publication or creation date visible in the text. Look for: arXiv dates (e.g. "arXiv:2301.00234v1 [cs.CL] 12 Jan 2023"), blog post dates ("Published on April 15, 2024"), YouTube upload dates, news article dates. Use null for: user's own notes, content with no visible date, dates that only refer to events within the content (not the publication itself).`;

const EXTRACTION_PROMPT_WITH_MEDIA = `You analyze a piece of content (text + attached media) and produce structured metadata for a personal knowledge base.

Return JSON with these fields:
- title: a short, descriptive title (max 80 chars) capturing the essence of the content. For media files, describe what they show. Never return an empty title.
- topics: array of topics/subjects discussed (max 10)
- extracted_text: if media files contain clearly legible text (documents, signs, whiteboards, printed/handwritten text, captions in images), extract ALL of it verbatim. For audio/video, transcribe speech. Return null if media doesn't contain readable text (photos of people, animals, scenery, food, objects, etc.). Do NOT hallucinate text that isn't clearly there.
${PUBLISHED_AT_FIELD}

Return ONLY valid JSON, no markdown formatting.`;

const EXTRACTION_PROMPT_TEXT_ONLY = `You analyze a piece of text content and produce structured metadata for a personal knowledge base.

Return JSON with these fields:
- title: a short, descriptive title (max 80 chars) capturing the essence of the content. Never return an empty title.
- topics: array of topics/subjects discussed (max 10)
- extracted_text: always null — the caller already has the full text.
${PUBLISHED_AT_FIELD}

Return ONLY valid JSON, no markdown formatting.`;

const FALLBACK: CaptureMetadata = {
  title: 'Untitled',
  topics: [],
  extracted_text: null,
  published_at: null,
};

export async function extractMetadata(
  llm: LLMProvider,
  content: string,
  files?: FileInput[],
): Promise<CaptureMetadata> {
  const fileCount = files?.length ?? 0;
  const mimeTypes = files?.map((f) => f.mimeType).join(', ') ?? 'none';
  console.log(`[metadata] Extracting — files: ${fileCount} (${mimeTypes}), content: ${content.length} chars`);

  try {
    const messageContent: LLMMessage['content'] = files && files.length > 0
      ? [
          { type: 'text' as const, text: content || '(no text content)' },
          ...files.map((f) => ({
            type: 'image' as const,
            data: f.data,
            mimeType: f.mimeType,
          })),
        ]
      : content;

    // Flash 2.5 uses internal "thinking" tokens that count against the output
    // budget. For PDF-scale inputs (50K chars) the model needs room to both
    // think and emit large extracted_text fields — 2048 was truncating mid-JSON.
    // Pick the right prompt: text-only cases don't need extracted_text, which
    // was causing Flash to echo the entire 50K-char PDF body and overflow JSON.
    const systemPrompt = files && files.length > 0
      ? EXTRACTION_PROMPT_WITH_MEDIA
      : EXTRACTION_PROMPT_TEXT_ONLY;

    const response = await llm.complete(
      [{ role: 'user', content: messageContent }],
      { systemPrompt, responseFormat: 'json', maxTokens: 8192 },
    );

    console.log(`[metadata] LLM response — tokens: ${response.tokensUsed.total}, raw length: ${response.content.length}`);

    let parsed: any;
    try {
      parsed = JSON.parse(response.content);
    } catch {
      console.error(`[metadata] JSON parse failed — first 500 chars: ${response.content.slice(0, 500)}`);
      console.error(`[metadata] JSON parse failed — last 200 chars: ${response.content.slice(-200)}`);
      return FALLBACK;
    }

    const extractedText = typeof parsed.extracted_text === 'string' && parsed.extracted_text.trim()
      ? parsed.extracted_text.trim()
      : null;
    const title = typeof parsed.title === 'string' && parsed.title.trim()
      ? parsed.title.trim().slice(0, 120)
      : 'Untitled';

    // Validate published_at — accept ISO 8601-parseable strings only.
    let publishedAt: string | null = null;
    if (typeof parsed.published_at === 'string' && parsed.published_at.trim()) {
      const candidate = parsed.published_at.trim();
      const parsedDate = new Date(candidate);
      if (!isNaN(parsedDate.getTime()) && parsedDate.getFullYear() > 1900 && parsedDate.getFullYear() < 2100) {
        publishedAt = parsedDate.toISOString();
      }
    }

    const result: CaptureMetadata = {
      title,
      topics: Array.isArray(parsed.topics) ? parsed.topics.slice(0, 10) : [],
      extracted_text: extractedText,
      published_at: publishedAt,
    };

    // Loud warning when binary input produces no text. The audio/mp4 silent-failure
    // bug (Voice Memos uploads → empty content → "Untitled" title) hid here for a
    // while because a successful empty result was indistinguishable from a real
    // unsupported-mime / unsupported-codec failure.
    if (files && files.length > 0 && extractedText === null) {
      console.warn(
        `[metadata] WARN: binary input(s) [${mimeTypes}] produced null extracted_text — ` +
        `likely an unsupported mime/codec or empty media. Title fell back to "${result.title}".`,
      );
    }

    console.log(`[metadata] Result — title: "${result.title}", topics: [${result.topics.join(', ')}], extracted_text: ${extractedText ? `${extractedText.length} chars` : 'null'}, published: ${publishedAt ?? 'null'}`);
    return result;
  } catch (err) {
    console.error(`[metadata] Extraction failed:`, err);
    return FALLBACK;
  }
}
