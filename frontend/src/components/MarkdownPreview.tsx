import type { ReactNode } from 'react';

function inline(s: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let rest = s;
  let key = 0;
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/;
  while (rest.length) {
    const m = rest.match(re);
    if (!m) {
      parts.push(<span key={key++}>{rest}</span>);
      break;
    }
    const i = m.index ?? 0;
    if (i > 0) parts.push(<span key={key++}>{rest.slice(0, i)}</span>);
    const tok = m[0];
    if (tok.startsWith('`')) parts.push(<code key={key++}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith('**')) parts.push(<b key={key++}>{tok.slice(2, -2)}</b>);
    else parts.push(<i key={key++}>{tok.slice(1, -1)}</i>);
    rest = rest.slice(i + tok.length);
  }
  return parts;
}

export function MarkdownPreview({ src }: { src: string }) {
  const lines = src.split('\n');
  const out: ReactNode[] = [];
  let inCode = false;
  let codeBuf: string[] = [];
  let inList = false;
  let listBuf: string[] = [];
  const flushList = () => {
    if (inList) {
      out.push(
        <ul key={out.length}>
          {listBuf.map((l, i) => (
            <li key={i}>{inline(l)}</li>
          ))}
        </ul>,
      );
      listBuf = [];
      inList = false;
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (ln.trim().startsWith('```')) {
      if (inCode) {
        out.push(<pre key={out.length}>{codeBuf.join('\n')}</pre>);
        codeBuf = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(ln);
      continue;
    }
    if (/^\s*-\s/.test(ln)) {
      inList = true;
      listBuf.push(ln.replace(/^\s*-\s/, ''));
      continue;
    }
    flushList();
    if (/^# /.test(ln)) out.push(<h1 key={out.length}>{ln.slice(2)}</h1>);
    else if (/^## /.test(ln)) out.push(<h2 key={out.length}>{ln.slice(3)}</h2>);
    else if (/^### /.test(ln)) out.push(<h3 key={out.length}>{ln.slice(4)}</h3>);
    else if (ln.trim() === '') out.push(<div key={out.length} style={{ height: 6 }} />);
    else out.push(<p key={out.length}>{inline(ln)}</p>);
  }
  flushList();
  if (inCode) out.push(<pre key={out.length}>{codeBuf.join('\n')}</pre>);
  return <>{out}</>;
}
