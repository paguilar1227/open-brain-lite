import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MarkdownPreview } from './MarkdownPreview';

afterEach(cleanup);

describe('project handoff Markdown', () => {
  it('renders standard lists, nested emphasis and links as structured content', () => {
    const { container } = render(<MarkdownPreview src={'# Current state\n\n* **Status**: in progress\n* Keep *source records*.\n\n1. Verify restart\n2. [Read evidence](https://example.com/evidence)'} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Current state');
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(container.querySelector('strong')?.textContent).toBe('Status');
    expect(container.querySelector('em')?.textContent).toBe('source records');
    expect(screen.getByRole('link', { name: 'Read evidence' }).getAttribute('href')).toBe('https://example.com/evidence');
    expect(container.textContent).not.toContain('**');
  });

  it('keeps code verbatim and does not execute raw HTML from stored source', () => {
    const { container } = render(<MarkdownPreview src={'```sh\necho "**source**"\n```\n\n<script>alert(1)</script>'} />);
    expect(container.querySelector('pre code')?.textContent).toBe('echo "**source**"\n');
    expect(container.querySelector('script')).toBeNull();
  });
});
