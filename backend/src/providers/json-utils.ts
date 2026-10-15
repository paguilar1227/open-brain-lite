// src/providers/json-utils.ts

/** Extract JSON from a string that may be wrapped in markdown code blocks or preamble text */
export function extractJson(text: string): string {
  // Already valid JSON? Return as-is.
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return trimmed;
  }

  // Extract from ```json ... ``` or ``` ... ```
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Look for first { ... } or [ ... ] in the text
  const jsonStart = trimmed.search(/[{[]/);
  if (jsonStart >= 0) {
    const candidate = trimmed.slice(jsonStart);
    // Find the matching closing bracket
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // Try to find just the object
      const lastBrace = candidate.lastIndexOf('}');
      const lastBracket = candidate.lastIndexOf(']');
      const end = Math.max(lastBrace, lastBracket);
      if (end > 0) {
        return candidate.slice(0, end + 1);
      }
    }
  }

  // Give up — return original, let caller handle parse error
  return trimmed;
}
