import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Icons } from './Icons';
import { listProjectCounts } from '../lib/api';
import { useProjects } from '../lib/useProjects';
import { toUiProjects } from '../lib/view';
import { cls } from '../lib/util';
import type { ActionDispatch, Route } from '../types';

interface Props {
  route: Route;
  onRoute: (r: Route) => void;
  onAction: ActionDispatch;
}

export function MobileTabbar({ route, onRoute, onAction }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  // Inbox is gone — its content lives on Home. The tabbar drops to two
  // primary entries plus More; Home owns personal-scope, Projects owns
  // structured-scope, More is the sheet of everything else.
  const items = [
    { id: 'home' as const, label: 'Home', icon: <Icons.Home /> },
    { id: 'projects' as const, label: 'Projects', icon: <Icons.Folders /> },
  ];
  const { data: apiProjects = [] } = useProjects();
  const { data: counts = [] } = useQuery({
    queryKey: ['project-counts'],
    queryFn: () => listProjectCounts(),
  });
  const pinned = useMemo(
    () => toUiProjects(apiProjects, counts).filter((p) => p.pinned && p.status === 'active'),
    [apiProjects, counts],
  );

  const go = (next: Route) => {
    setMoreOpen(false);
    onRoute(next);
  };

  return (
    <>
      <nav className="mobile-tabbar show">
        {items.map(it => (
          <div
            key={it.id}
            className={cls('mtab', route.route === it.id && 'active')}
            onClick={() => onRoute({ route: it.id })}
          >
            <span className="ic">{it.icon}</span>
            <span>{it.label}</span>
          </div>
        ))}
        <div className={cls('mtab', moreOpen && 'active')} onClick={() => setMoreOpen(true)}>
          <span className="ic"><Icons.More /></span>
          <span>More</span>
        </div>
      </nav>
      {moreOpen && (
        <>
          <div className="m-sheet-overlay" onClick={() => setMoreOpen(false)} />
          <div className="m-sheet" role="dialog" aria-label="More">
            <div className="m-sheet-grip" />
            <div className="m-sheet-h">
              <span>More</span>
              <button className="btn btn-ghost btn-icon" onClick={() => setMoreOpen(false)}>
                <Icons.X />
              </button>
            </div>

            <div className="m-sheet-section">Workspace</div>
            <div className="m-sheet-list">
              <button className={cls('m-sheet-row', route.route === 'notes' && 'active')} onClick={() => go({ route: 'notes' })}>
                <span className="ic"><Icons.Layers /></span><span>Notes</span>
              </button>
              <button className={cls('m-sheet-row', route.route === 'todos' && 'active')} onClick={() => go({ route: 'todos' })}>
                <span className="ic"><Icons.Check /></span><span>Todos</span>
              </button>
              <button className={cls('m-sheet-row', route.route === 'activity' && 'active')} onClick={() => go({ route: 'activity' })}>
                <span className="ic"><Icons.Activity /></span><span>Activity</span>
              </button>
              <button className={cls('m-sheet-row', route.route === 'tags' && 'active')} onClick={() => go({ route: 'tags' })}>
                <span className="ic"><Icons.Tag /></span><span>Tags</span>
              </button>
              <button className={cls('m-sheet-row', route.route === 'trash' && 'active')} onClick={() => go({ route: 'trash' })}>
                <span className="ic"><Icons.ArchiveBox /></span><span>Archived</span>
              </button>
            </div>

            <div className="m-sheet-section">
              Pinned <span className="ct">{pinned.length}</span>
            </div>
            <div className="m-sheet-list">
              {pinned.map(p => (
                <button key={p.id} className="m-sheet-row" onClick={() => go({ route: 'project', project: p.id })}>
                  <span className={cls('sb-proj-dot', p.accent)}></span>
                  <span>{p.name}</span>
                </button>
              ))}
              {pinned.length === 0 && <div className="m-sheet-empty">No pinned projects yet.</div>}
            </div>

            <div className="m-sheet-section">Settings</div>
            <div className="m-sheet-list">
              <button
                className="m-sheet-row"
                onClick={() => {
                  setMoreOpen(false);
                  onAction({ kind: 'settings' });
                }}
              >
                <span className="ic"><Icons.Cog /></span>
                <span>Account &amp; preferences</span>
                <span className="sub">›</span>
              </button>
              <button className="m-sheet-row" onClick={() => { setMoreOpen(false); onAction({ kind: 'settings' }); }}>
                <span className="ic"><Icons.Inbox /></span><span>Notifications</span><span className="sub">›</span>
              </button>
              <button className="m-sheet-row">
                <span className="ic"><Icons.Sparkle /></span><span>Help &amp; shortcuts</span><span className="sub">›</span>
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
