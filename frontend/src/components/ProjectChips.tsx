import { Tag } from './primitives';
import { useProjects } from '../lib/useProjects';
import type { Route } from '../types';

// Renders a row of project pills given a list of project IDs. When
// onRoute is provided, each pill is a button that closes the containing
// surface (onClose) and navigates to the project page. When onRoute is
// absent, pills render as plain tags. Used by the doc / note / todo
// readers so the project-pill rendering isn't hand-rolled 3x.
interface Props {
  ids: string[];
  onRoute?: (r: Route) => void;
  onClose?: () => void;
  className?: string;
}

export function ProjectChips({ ids, onRoute, onClose, className }: Props) {
  const projectsQ = useProjects();
  if (ids.length === 0) return null;
  const projectById = new Map((projectsQ.data ?? []).map((p) => [p.id, p]));
  return (
    <span className={`row-flex gap-1 meta-projects${className ? ` ${className}` : ''}`}>
      {ids.map((id) => {
        const p = projectById.get(id);
        const label = p?.name ?? (projectsQ.isLoading ? '…' : id.slice(0, 8));
        return onRoute ? (
          <button
            key={id}
            type="button"
            className="tag tag-link"
            onClick={() => {
              onClose?.();
              onRoute({ route: 'project', project: id });
            }}
            title={p ? `Open ${p.name}` : 'Open project'}
          >
            {label}
          </button>
        ) : (
          <Tag key={id}>{label}</Tag>
        );
      })}
    </span>
  );
}
