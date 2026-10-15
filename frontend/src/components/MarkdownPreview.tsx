import ReactMarkdown from 'react-markdown';

export function MarkdownPreview({ src }: { src: string }) {
  return <ReactMarkdown>{src}</ReactMarkdown>;
}
