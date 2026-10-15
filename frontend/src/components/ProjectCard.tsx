import { Icons } from './Icons';
import { cls, fmtRel } from '../lib/util';
import type { Project } from '../types';

interface Props {
  p: Project;
  size?: 'md' | 'lg';
  onOpen?: () => void;
  onMore?: () => void;
}

export function ProjectCard({ p, size = 'md', onOpen }: Props) {
  return (
    <div className={cls('proj-card', `size-${size}`)} onClick={onOpen}>
      <div className="ph">
        <span className={cls('sb-proj-dot', p.accent)}></span>
        <span>{p.status === 'archived' ? 'ARCHIVED' : 'ACTIVE'}</span>
        {p.pinned ? (
          <span style={{ marginLeft: 'auto', color: 'var(--fg-subtle)' }}>
            <Icons.Pin size={12} />
          </span>
        ) : null}
      </div>
      <div className="nm">{p.name}</div>
      <div className="ds">{p.desc}</div>
      <div className="meta">
        <span className="stat">
          <Icons.Doc size={11} /> {p.counts.docs}
        </span>
        <span className="stat">
          <Icons.Note size={11} /> {p.counts.notes}
        </span>
        <span className="stat">
          <Icons.Check size={11} /> {p.counts.done}/{p.counts.todos}
        </span>
        <span style={{ marginLeft: 'auto' }}>{fmtRel(p.updated_at)}</span>
      </div>
    </div>
  );
}
