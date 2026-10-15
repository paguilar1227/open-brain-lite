import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
export async function scrapeLocal(url: string) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Could not fetch page: HTTP ${response.status}`);
  const { document } = parseHTML(await response.text());
  const article = new Readability(document as unknown as Document).parse();
  const title = article?.title || document.title || new URL(url).hostname;
  document.querySelectorAll('script,style,nav,footer,header,noscript').forEach((node: { remove(): void }) => node.remove());
  const markdown = article?.textContent?.trim() || document.body?.textContent?.trim() || '';
  return { title, markdown, statusCode: response.status };
}
