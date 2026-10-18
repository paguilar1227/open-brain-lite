import { onHostEvent } from './lib/host';
import { embeddedHost, navigation, onNavigation } from './lib/host';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CommandPalette } from './components/CommandPalette';
import { MobileTabbar } from './components/MobileTabbar';
import { Sidebar } from './components/Sidebar';
import { Topbar, type Crumb } from './components/Topbar';
import { ConfirmModal } from './components/modals/ConfirmModal';
import { DocReaderDrawer } from './components/modals/DocReaderDrawer';
import { ProjectModal } from './components/modals/ProjectModal';
import { NoteEditorModal } from './components/modals/NoteEditorModal';
import { NoteListDrawer } from './components/modals/NoteListDrawer';
import { DocListDrawer } from './components/modals/DocListDrawer';
import { TodoDetailDrawer } from './components/modals/TodoDetailDrawer';
import { TodoListDrawer } from './components/modals/TodoListDrawer';
import { UploadModal } from './components/modals/UploadModal';
import { useIsMobile } from './lib/useIsMobile';
import { useProjects } from './lib/useProjects';
import { cls } from './lib/util';
import { ActivityPage } from './pages/ActivityPage';
import { HomePage } from './pages/HomePage';
import { ProjectPage } from './pages/ProjectPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { SessionsPage } from './pages/SessionsPage';
import { SessionPage } from './pages/SessionPage';
import { SettingsPage } from './pages/SettingsPage';
import { TagsPage } from './pages/TagsPage';
import { TagDetailPage } from './pages/TagDetailPage';
import { NotesPage } from './pages/NotesPage';
import { TodosPage } from './pages/TodosPage';
import { RenameTagModal } from './components/modals/RenameTagModal';
import { TrashPage } from './pages/TrashPage';
import { ErrorBoundary, ViewErrorFallback, ModalErrorFallback } from './components/ErrorBoundary';
import type { ModalKind, Route, SidebarMode, Theme } from './types';

function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  const v = localStorage.getItem('ob.theme');
  return v === 'dark' ? 'dark' : 'light';
}

function readInitialSidebarMode(): SidebarMode {
  if (typeof window === 'undefined') return 'collapsed';
  const v = localStorage.getItem('ob.sidebarMode');
  return v === 'expanded' || v === 'hidden' ? v : 'collapsed';
}

function readRoute(): Route {
  if (navigation.location.pathname === '/sessions') return {route:'sessions'};
  const session=navigation.location.pathname.match(/^\/sessions\/([0-9a-f-]{36})$/i);
  if(session) return {route:'session',session:session[1]};
  if (navigation.location.pathname === '/settings') return { route: 'settings' };
  return (navigation.history.state?.obRoute as Route | undefined) ?? { route: 'home' };
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);
  const [route, setRoute] = useState<Route>(readRoute);
  const [modal, setModal] = useState<ModalKind | null>(null);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(readInitialSidebarMode);
  const mainScroll = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    (embeddedHost()?.element ?? document.documentElement).dataset.theme = theme;
    if (!embeddedHost()) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#151715' : '#ffffff');
    localStorage.setItem('ob.theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('ob.sidebarMode', sidebarMode);
  }, [sidebarMode]);

  useEffect(() => {
    const onPopState = () => setRoute(readRoute());
    return onNavigation(onPopState);
  }, []);
  useEffect(() => {
    if (route.route === 'settings' && mainScroll.current) mainScroll.current.scrollTop = 0;
  }, [route]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdkOpen(o => !o);
      }
      if (e.key === 'Escape') {
        setModal(null);
        setCmdkOpen(false);
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        setTheme(t => (t === 'dark' ? 'light' : 'dark'));
      }
    };
    const stopKey = onHostEvent('keydown', onKey);
    return () => stopKey();
  }, []);

  const onAction = useCallback((m: ModalKind) => setModal(m), []);

  // Bumped whenever the user explicitly "goes home" with no search seed
  // (sidebar Home click, palette Go to Home, etc). Used as a `key` on the
  // HomePage instance so internal state resets cleanly — useState
  // initializers re-run, the URL is re-read fresh. Without this, clicking
  // Home while a search is active leaves the search active because the
  // existing HomePage instance hangs onto its query state.
  const [homeNonce, setHomeNonce] = useState(0);

  const navigate = useCallback((r: Route) => {
    if(r.route==='sessions'||r.route==='session'){
      const path=r.route==='sessions'?'/sessions':`/sessions/${r.session}`;
      navigation.history.replaceState({obRoute:route},'',navigation.location.href);
      navigation.history.pushState({obRoute:r},'',path);
    }else if(navigation.location.pathname.startsWith('/sessions')){
      navigation.history.pushState({obRoute:r},'',r.route==='settings'?'/settings':'/');
    }
    if (r.route === 'settings' && navigation.location.pathname !== '/settings') {
      setModal(null);
      navigation.history.replaceState({ obRoute: route }, '', navigation.location.href);
      navigation.history.pushState({ obRoute: r, settingsEntry: true }, '', '/settings');
    } else if (r.route !== 'settings' && navigation.location.pathname === '/settings') {
      navigation.history.pushState({ obRoute: r }, '', '/');
    }
    if (r.route === 'home' && !r.q && !r.scope) {
      // "Fresh home" intent — wipe URL view-state (q, scope, tag, mode)
      // and force a HomePage remount so its internal state matches.
      navigation.history.replaceState(null, '', '/');
      setHomeNonce((n) => n + 1);
    }
    setRoute(r);
    if (r.route === 'projects' && r.action === 'new') {
      setModal({ kind: 'new-project' });
    }
  }, [route]);

  const { data: projects = [] } = useProjects();
  const project = route.route === 'project' ? projects.find((p) => p.id === route.project) ?? null : null;
  // Stable key for the page-view ErrorBoundary: any route change resets it, so a
  // crash in one view clears the instant the user navigates away.
  const routeKey = JSON.stringify(route);

  const crumbs: Crumb[] = (() => {
    switch (route.route) {
      case 'home':
        return [{ label: 'Home' }];
      case 'sessions': return [{label:'Sessions'}];
      case 'session': return [{label:'Sessions',onClick:()=>navigate({route:'sessions'})},{label:'Session workspace'}];
      case 'projects':
        return [{ label: 'Projects' }];
      case 'project':
        return [
          { label: 'Projects', onClick: () => setRoute({ route: 'projects' }) },
          { label: project?.name || 'Project' },
        ];
      case 'activity':
        return [{ label: 'Activity' }];
      case 'tags':
        return [{ label: 'Tags' }];
      case 'notes':
        return [{ label: 'Notes' }];
      case 'todos':
        return [{ label: 'Todos' }];
      case 'trash':
        return [{ label: 'Archived' }];
      case 'settings':
        return [{ label: 'Settings' }];
      default:
        return [{ label: '—' }];
    }
  })();

  const sb: SidebarMode = isMobile ? 'hidden' : sidebarMode;
  const appProps: Record<string, string> = { 'data-sb': sb };
  if (isMobile) appProps['data-mobile'] = 'true';

  return (
    <div className={cls('app')} {...appProps}>
      {!isMobile && (
        <Sidebar
          route={route}
          onRoute={navigate}
          onAction={onAction}
          collapsed={sidebarMode === 'collapsed'}
          onToggleCollapsed={() =>
            setSidebarMode(sidebarMode === 'collapsed' ? 'expanded' : 'collapsed')
          }
        />
      )}
      <main className="main">
        <Topbar crumbs={crumbs} />
        <div className="main-scroll" ref={mainScroll}>
          <ErrorBoundary
            label={`view:${route.route}`}
            resetKeys={[routeKey]}
            fallback={(error, reset) => (
              <ViewErrorFallback error={error} reset={reset} onHome={() => navigate({ route: 'home' })} />
            )}
          >
          {route.route === 'home' && (
            <HomePage
              key={homeNonce}
              onRoute={navigate}
              onAction={onAction}
              // q + scope on the home route are the cross-page search
              // seed; HomePage reads them on mount.
              initialSearch={route.q || route.scope ? { query: route.q, scope: route.scope } : undefined}
            />
          )}
          {route.route === 'sessions' && <SessionsPage onRoute={navigate} />}
          {route.route === 'session' && <SessionPage key={route.session} sessionId={route.session} onRoute={navigate} onAction={onAction} />}
          {route.route === 'projects' && <ProjectsPage onRoute={navigate} onAction={onAction} />}
          {route.route === 'project' && <ProjectPage projectId={route.project} onAction={onAction} onRoute={navigate} />}
          {route.route === 'activity' && <ActivityPage onAction={onAction} />}
          {route.route === 'tags' && (route.name
            ? <TagDetailPage key={route.name} name={route.name} onAction={onAction} onRoute={setRoute} />
            : <TagsPage onAction={onAction} onRoute={setRoute} />
          )}
          {route.route === 'notes' && (
            <NotesPage onAction={onAction} onRoute={navigate} initialPath={route.path} initialScope={route.scope} />
          )}
          {route.route === 'todos' && (
            <TodosPage onAction={onAction} initialScope={route.scope} />
          )}
          {route.route === 'trash' && <TrashPage />}
          {route.route === 'settings' && <SettingsPage theme={theme} onTheme={setTheme} onBack={() => {
            if (navigation.history.state?.settingsEntry) navigation.history.back();
            else navigate({ route: 'home' });
          }} />}
          </ErrorBoundary>
        </div>
      </main>
      {isMobile && <MobileTabbar route={route} onRoute={navigate} onAction={onAction} />}

      <ErrorBoundary
        label={`modal:${modal?.kind ?? 'none'}`}
        resetKeys={[modal?.kind ?? null]}
        fallback={(error) => <ModalErrorFallback error={error} onClose={() => setModal(null)} />}
      >
      {modal?.kind === 'upload' && <UploadModal project={modal.payload} sessionId={modal.sessionId} onClose={() => setModal(null)} />}
      {modal?.kind === 'note-edit' && <NoteEditorModal note={modal.payload} projectId={modal.projectId} sessionId={modal.sessionId} initialFolder={modal.folder} onClose={() => setModal(null)} />}
      {modal?.kind === 'doc-read' && <DocReaderDrawer doc={modal.payload} onClose={() => setModal(null)} onRoute={navigate} />}
      {modal?.kind === 'todo-detail' && <TodoDetailDrawer key={modal.payload.id} todo={modal.payload} onClose={() => setModal(null)} onAction={onAction} />}
      {modal?.kind === 'bulk-confirm' && (
        <ConfirmModal
          title={`Archive ${modal.payload.count} ${modal.payload.kind}?`}
          message="Items will be moved to the Archive. They'll be excluded from chat retrieval but remain searchable from the Archived view. You can restore at any time."
          confirmLabel="Archive"
          danger
          onClose={() => setModal(null)}
          onConfirm={() => setModal(null)}
        />
      )}
      {modal?.kind === 'confirm-rename' && (
        <RenameTagModal tag={modal.payload} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'new-project' && <ProjectModal onClose={() => setModal(null)} />}
      {/* Search is inline on HomePage; no modal here. */}
      {modal?.kind === 'personal-todos' && (
        <TodoListDrawer initialSort={modal.sort} initialTagFilter={modal.tagFilter} onClose={() => setModal(null)} onAction={onAction} />
      )}
      {modal?.kind === 'personal-notes' && (
        <NoteListDrawer initialTagFilter={modal.tagFilter} onClose={() => setModal(null)} onAction={onAction} onRoute={navigate} />
      )}
      {modal?.kind === 'personal-docs' && (
        <DocListDrawer initialTagFilter={modal.tagFilter} onClose={() => setModal(null)} onAction={onAction} onRoute={navigate} />
      )}
      </ErrorBoundary>

      <ErrorBoundary
        label="command-palette"
        resetKeys={[cmdkOpen]}
        fallback={(error) => <ModalErrorFallback error={error} onClose={() => setCmdkOpen(false)} />}
      >
      {cmdkOpen && (
        <CommandPalette
          onClose={() => setCmdkOpen(false)}
          onRoute={(r) => {
            navigate(r);
            setCmdkOpen(false);
          }}
          onAction={(m) => {
            onAction(m);
            setCmdkOpen(false);
          }}
          onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          theme={theme}
        />
      )}
      </ErrorBoundary>
    </div>
  );
}
