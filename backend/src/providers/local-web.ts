import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
export async function scrapeLocal(url: string) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Could not fetch page: HTTP ${response.status}`);
  const { document } = parseHTML(await response.text());
  const article = new Readability(document as unknown as Document).parse();
  const title = article?.title || document.title || new URL(url).hostname;
  const readable = article?.content ? parseHTML(`<html><body>${article.content}</body></html>`).document : document;
  readable.querySelectorAll('script,style,nav,footer,header,noscript').forEach((node: { remove(): void }) => node.remove());
  // textContent alone joins adjacent blocks in minified pages ("word.Next").
  readable.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,li,tr,blockquote,section,article,pre,br,hr').forEach((node: { before(text: string): void; after(text: string): void }) => {
    node.before('\n\n');
    node.after('\n\n');
  });
  const markdown = (readable.body?.textContent || '').replace(/\n[\t ]+/g, '\n').replace(/[\t ]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title, markdown, statusCode: response.status };
}
