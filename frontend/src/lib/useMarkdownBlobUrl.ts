import { useEffect, useMemo } from 'react';

// Synthesize a same-origin blob: URL for a markdown body. Used by the doc
// and note readers so Download / Open chips work for text-only content
// (no Azure blob behind it). Same-origin URLs honor the HTML `download`
// attribute directly — no Content-Disposition / SAS dance needed. We
// revoke the URL on unmount or body change to avoid the leak.
export function useMarkdownBlobUrl(body: string | null | undefined): string | null {
  const hasBody = !!body && body.trim().length > 0;
  const url = useMemo(() => {
    if (!hasBody) return null;
    return URL.createObjectURL(new Blob([body!], { type: 'text/markdown;charset=utf-8' }));
  }, [hasBody, body]);
  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);
  return url;
}

// Sanitize a title into a safe filename. Strips chars Windows refuses,
// appends `.md`. Caller passes the raw entity title.
export function markdownFilename(title: string | null | undefined): string {
  const stem = (title || 'document').replace(/[/\\?%*:|"<>]/g, '_');
  return `${stem}.md`;
}
