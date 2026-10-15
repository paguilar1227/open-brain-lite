import { Fragment, useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { ActivityRow } from '../components/ActivityRow';
import { FilterChip } from '../components/primitives';
import { listActivity, listProjects } from '../lib/api';
import { toUiActivity } from '../lib/view';
import { openEntity } from '../lib/openEntity';
import type { ActionDispatch, ActivityEvent, ActivityKind } from '../types';

type FilterKind = 'all' | ActivityKind;

interface Props {
  onAction: ActionDispatch;
}

export function ActivityPage({ onAction }: Props) {
  const [kind, setKind] = useState<FilterKind>('all');
  const [activityQ, projectsQ] = useQueries({
    queries: [
      { queryKey: ['activity', 'page', 200], queryFn: () => listActivity({ limit: 200 }) },
      { queryKey: ['projects', 'all'], queryFn: () => listProjects() },
    ],
  });

  const projectsById = useMemo(
    () => new Map((projectsQ.data ?? []).map((p) => [p.id, p])),
    [projectsQ.data],
  );
  const all = useMemo(
    () => (activityQ.data ?? []).map((e) => toUiActivity(e, projectsById)),
    [activityQ.data, projectsById],
  );

  const filtered = kind === 'all' ? all : all.filter(a => a.kind === kind);
  const grouped = useMemo(() => {
    const groups: Record<string, ActivityEvent[]> = {};
    filtered.forEach(a => {
      const ms = Date.now() - new Date(a.at).getTime();
      const day =
        ms < 86400e3 ? 'Today' : ms < 86400e3 * 2 ? 'Yesterday' : ms < 86400e3 * 7 ? 'This week' : 'Earlier';
      (groups[day] ||= []).push(a);
    });
    return groups;
  }, [filtered]);

  if (activityQ.error || projectsQ.error) {
    const err = activityQ.error || projectsQ.error;
    return (
      <div className="page">
        <div className="page-subtle" style={{ color: 'var(--danger)' }}>
          Failed to load activity: {err instanceof Error ? err.message : String(err)}
        </div>
      </div>
    );
  }

  return (
    <div className="page page-narrow">
      <div className="proj-hero">
        <div>
          <h1>Activity</h1>
          <p className="page-subtle">
            Everything that happened across your brain — ingests, edits, comments. Use this to find your way back to whatever you were
            working on yesterday.
          </p>
        </div>
      </div>
      <div className="filter-bar">
        <FilterChip active={kind === 'all'} onClick={() => setKind('all')}>
          All <span style={{ marginLeft: 4 }}>{all.length}</span>
        </FilterChip>
        <FilterChip active={kind === 'ingest'} onClick={() => setKind('ingest')}>
          Ingests
        </FilterChip>
        <FilterChip active={kind === 'edit'} onClick={() => setKind('edit')}>
          Edits
        </FilterChip>
        <FilterChip active={kind === 'comment'} onClick={() => setKind('comment')}>
          Comments
        </FilterChip>
      </div>
      {activityQ.isLoading ? (
        <div className="page-subtle">Loading activity…</div>
      ) : all.length === 0 ? (
        <div className="page-subtle">No activity yet.</div>
      ) : (
        <div className="row-list activity-list">
          {Object.entries(grouped).map(([day, items]) => (
            <Fragment key={day}>
              <div className="activity-day">{day}</div>
              {items.map(a => (
                <ActivityRow
                  key={a.id}
                  activity={a}
                  showEntityKind
                  onClick={() => openEntity(a, onAction)}
                />
              ))}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
