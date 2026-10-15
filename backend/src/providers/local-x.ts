import { parseHTML } from 'linkedom';

// The public embed contains the referenced post, not an entire conversation.
// Fetch it directly from X; no account, hosted extractor, or model is involved.
export async function fetchPublicXPost(url: string): Promise<{ title: string; text: string }> {
  const endpoint = new URL('https://publish.twitter.com/oembed');
  endpoint.searchParams.set('url', url);
  endpoint.searchParams.set('omit_script', '1');
  const response = await fetch(endpoint, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Could not fetch public X post: HTTP ${response.status}`);
  const embed = await response.json() as { html?: string; author_name?: string };
  const { document } = parseHTML(typeof embed.html === 'string' ? embed.html : '');
  document.querySelectorAll('script,style').forEach((node: { remove(): void }) => node.remove());
  document.querySelectorAll('br').forEach((node: { replaceWith(text: string): void }) => node.replaceWith('\n'));
  const paragraphs = document.querySelectorAll('blockquote.twitter-tweet p') as ArrayLike<{ textContent: string | null }>;
  const text = Array.from(paragraphs)
    .map(node => node.textContent?.trim() ?? '').filter(Boolean).join('\n\n');
  if (!text) throw new Error('Public X embed returned no readable post text');
  return { title: `Post by ${embed.author_name || 'X author'}`, text };
}
