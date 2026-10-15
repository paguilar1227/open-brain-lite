/**
 * Firecrawl client — HTML scraping with JS-rendered page support and
 * optional stealth mode for sites with anti-scraping (X, some Reddit, etc.).
 *
 * Using @mendable/firecrawl-js SDK. Docs: https://docs.firecrawl.dev
 */

import FirecrawlApp from '@mendable/firecrawl-js';

export interface ScrapeResult {
  title: string;
  markdown: string;
  statusCode?: number;
}

export class FirecrawlClient {
  private app: FirecrawlApp;

  constructor(apiKey: string) {
    this.app = new FirecrawlApp({ apiKey });
  }

  async scrape(url: string, opts: { stealth?: boolean } = {}): Promise<ScrapeResult> {
    const result = await this.app.scrape(url, {
      formats: ['markdown'],
      // Stealth mode bypasses anti-scraping on sites like X and some Reddit pages.
      // Costs more credits per scrape, so only use when needed.
      ...(opts.stealth ? { proxy: 'stealth' as const } : {}),
      // Wait for JS-rendered content
      waitFor: 2000,
    });

    // SDK returns either the scrape payload directly or { success: false, error }
    if ('success' in result && result.success === false) {
      throw new Error(`Firecrawl failed: ${(result as { error?: string }).error ?? 'unknown error'}`);
    }

    const doc = result as {
      metadata?: { title?: string; ogTitle?: string; statusCode?: number };
      markdown?: string;
    };
    const title = doc.metadata?.title ?? doc.metadata?.ogTitle ?? 'Untitled';
    const markdown = doc.markdown ?? '';
    const statusCode = doc.metadata?.statusCode;

    if (!markdown.trim()) {
      throw new Error('Firecrawl returned empty markdown — page may be empty, blocked, or require auth.');
    }

    return { title, markdown, statusCode };
  }
}
