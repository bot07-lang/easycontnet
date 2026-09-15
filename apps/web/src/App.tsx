import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './lib/api';
import { useSession } from './lib/session';
import { Toaster } from './lib/toast';
import { DevSwitcher } from './components/DevSwitcher';
import { AllProjects } from './components/AllProjects';
import { ContentItemsTable } from './components/ContentItemsTable';
import { CreateItemDialog } from './components/CreateItemDialog';
import { Sidebar, IMPLEMENTED, type NavKey } from './components/Sidebar';
import { ErrorBoundary } from './components/ErrorBoundary';

// Heavy pages not shown on first load are code-split into their own chunks —
// ItemEditor pulls in TipTap (the biggest dependency), so it stays out of the
// initial bundle. They load on demand behind the Suspense fallback below.
const ItemEditor = lazy(() => import('./components/ItemEditor').then((m) => ({ default: m.ItemEditor })));
const WorkflowSettings = lazy(() => import('./components/WorkflowSettings').then((m) => ({ default: m.WorkflowSettings })));
const TemplatesGrid = lazy(() => import('./components/TemplatesGrid').then((m) => ({ default: m.TemplatesGrid })));
const TemplateBuilder = lazy(() => import('./components/TemplateBuilder').then((m) => ({ default: m.TemplateBuilder })));
const CategoriesPage = lazy(() => import('./components/CategoriesPage').then((m) => ({ default: m.CategoriesPage })));
const FilesPage = lazy(() => import('./components/FilesPage').then((m) => ({ default: m.FilesPage })));
const RolesPage = lazy(() => import('./components/RolesPage').then((m) => ({ default: m.RolesPage })));
const ProjectDashboard = lazy(() => import('./components/ProjectDashboard').then((m) => ({ default: m.ProjectDashboard })));

function LazyFallback() {
  return <p className="p-8 text-sm text-slate-400">Loading…</p>;
}

/**
 * Wired app: sign in as a seeded user, pick a project, open an item, edit it.
 * Everything below the header comes from the API under RLS — switch users and
 * the visible projects and items change accordingly.
 */
export default function App() {
  const { session, loading } = useSession();
  const qc = useQueryClient();

  // Different users see different data under RLS. Clearing the cache on a user
  // *switch* avoids briefly showing the previous user's projects while the new
  // user's data refetches. Crucially we do NOT clear on the initial sign-in
  // (undefined -> id): there is no prior user's data to hide, and clearing then
  // races the first queries — wiping their results and forcing a wasteful,
  // sometimes very slow, second fetch round.
  const userId = session?.user?.id;
  const prevUserId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (prevUserId.current !== undefined && prevUserId.current !== userId) {
      qc.clear();
    }
    prevUserId.current = userId;
  }, [userId, qc]);

  // Org-level view toggled from the title bar's "Team" menu (Roles). The project
  // workspace is the default; opening Roles swaps it out.
  const [view, setView] = useState<'workspace' | 'roles'>('workspace');

  return (
    <div className="min-h-screen bg-slate-100">
      <Toaster />
      <header className="flex items-center gap-4 bg-indigo-700 px-6 py-3 text-white">
        <button type="button" onClick={() => setView('workspace')} className="font-semibold tracking-tight hover:opacity-90">
          Content Workflow
        </button>
        {session && <TeamMenu active={view === 'roles'} onOpenRoles={() => setView('roles')} />}
        <div className="ml-auto">
          <DevSwitcher session={session} />
        </div>
      </header>

      {loading ? (
        <p className="p-10 text-slate-400">Loading…</p>
      ) : !session ? (
        <SignedOut />
      ) : view === 'roles' ? (
        <div className="h-[calc(100vh-52px)] overflow-y-auto bg-slate-100">
          <Suspense fallback={<LazyFallback />}>
            <RolesPage />
          </Suspense>
        </div>
      ) : (
        <Workspace key={session.user.id} />
      )}
    </div>
  );
}

/** Title-bar "Team" dropdown → Roles (and future Users/Teams). */
function TeamMenu({ active, onOpenRoles }: { active: boolean; onOpenRoles: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)}
              className={`flex items-center gap-1.5 rounded px-2 py-1 text-[15px] font-medium hover:bg-white/10 ${active ? 'bg-white/10' : ''}`}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11" /></svg>
        Team
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 w-44 overflow-hidden rounded-md border border-slate-200 bg-white py-1 text-slate-700 shadow-xl">
          <button type="button" onClick={() => { setOpen(false); onOpenRoles(); }}
                  className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-[14px] hover:bg-slate-50">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
            Roles
          </button>
        </div>
      )}
    </div>
  );
}

function SignedOut() {
  return (
    <div className="grid place-items-center py-32">
      <div className="max-w-sm rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Choose a user to begin</h1>
        <p className="mt-2 text-sm text-slate-500">
          Use the switcher in the top-right to sign in as one of the seeded users. What you
          can see and edit depends on that user’s role and project membership.
        </p>
      </div>
    </div>
  );
}

function Workspace() {
  // The sidebar always has a project selected (defaults to the first). `showAll`
  // toggles the All Projects dashboard vs the selected project's view. The current
  // view is mirrored to the URL (below) so a browser reload returns to the same
  // place — e.g. the exact content item — instead of the dashboard.
  const url0 = new URLSearchParams(window.location.search);
  const [projectId, setProjectId] = useState<string | null>(() => url0.get('project'));
  const [showAll, setShowAll] = useState(() => !url0.get('project'));
  const [nav, setNav] = useState<NavKey>(() => (url0.get('nav') as NavKey) || 'content');
  const [itemId, setItemId] = useState<string | null>(() => url0.get('item'));
  // The template whose builder is open (templates nav). Lifted here so the item
  // editor's "Template" control can jump straight into it.
  const [openTemplateId, setOpenTemplateId] = useState<string | null>(() => url0.get('template'));

  const projects = useQuery({ queryKey: ['projects'], queryFn: api.listProjects });
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });

  // Default the dropdown to the first visible project once loaded (unless the URL
  // already pinned one).
  if (!projectId && projects.data?.length) setProjectId(projects.data[0]!.id);

  // A nav item the sidebar hides for this user (e.g. Files without
  // manage_asset_library) shouldn't stay reachable via a stale/typed URL.
  useEffect(() => {
    if (nav === 'files' && me.data && !me.data.isOwner && !me.data.permissions.includes('manage_asset_library')) {
      setNav('content');
    }
  }, [nav, me.data]);

  // Keep the URL in sync with the view (replaceState, so it doesn't spam history)
  // so a reload restores the same project / item / tab.
  useEffect(() => {
    const p = new URLSearchParams();
    if (!showAll && projectId) {
      p.set('project', projectId);
      if (nav !== 'content') p.set('nav', nav);
      if (nav === 'content' && itemId) p.set('item', itemId);
      if (nav === 'templates' && openTemplateId) p.set('template', openTemplateId);
    }
    const qs = p.toString();
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  }, [showAll, projectId, nav, itemId, openTemplateId]);

  // Open a project from the All Projects dashboard: land on Content.
  const selectProject = (id: string) => {
    setProjectId(id);
    setShowAll(false);
    setNav('content');
    setItemId(null);
    setOpenTemplateId(null);
  };

  // Switch the project from the sidebar selector: stay on the SAME tab (e.g.
  // Categories → the other project's Categories), just drop the item/template
  // that belonged to the previous project.
  const switchProject = (id: string) => {
    setProjectId(id);
    setShowAll(false);
    setItemId(null);
    setOpenTemplateId(null);
  };

  // Open a specific template's builder (from the item editor's Template control).
  const openTemplate = (id: string) => {
    setShowAll(false);
    setNav('templates');
    setItemId(null);
    setOpenTemplateId(id);
  };

  return (
    <div className="flex h-[calc(100vh-52px)]">
      <Sidebar
        selectedProjectId={projectId}
        activeNav={showAll ? null : nav}
        me={me.data}
        onAllProjects={() => { setShowAll(true); setItemId(null); }}
        onSelectProject={switchProject}
        onNavigate={(key) => { setShowAll(false); setNav(key); setItemId(null); }}
      />

      <div className="min-w-0 flex-1 overflow-y-auto bg-slate-100">
        {/* A crash below here shows a recoverable panel (and auto-clears when the
            user navigates) instead of unmounting the whole app to a blank page. */}
        <ErrorBoundary resetKeys={[showAll, projectId, nav, itemId, openTemplateId]}>
          {showAll || !projectId ? (
            <div className="mx-auto max-w-[1400px] px-6 py-6">
              <AllProjects
                onOpenProject={selectProject}
                onOpenItem={(it) => { setProjectId(it.project_id); setShowAll(false); setNav('content'); setItemId(it.id); }}
              />
            </div>
          ) : (
            <ProjectView projectId={projectId} nav={nav} itemId={itemId}
                         onOpenItem={(id) => { setNav('content'); setItemId(id); }}
                         onOpenTemplate={openTemplate} openTemplateId={openTemplateId} onSetTemplate={setOpenTemplateId} />
          )}
        </ErrorBoundary>
      </div>
    </div>
  );
}

function ProjectView({
  projectId, nav, itemId, onOpenItem, onOpenTemplate, openTemplateId, onSetTemplate,
}: {
  projectId: string;
  nav: NavKey;
  itemId: string | null;
  onOpenItem: (id: string | null) => void;
  onOpenTemplate: (templateId: string) => void;
  openTemplateId: string | null;
  onSetTemplate: (id: string | null) => void;
}) {
  const items = useQuery({
    queryKey: ['items', projectId],
    queryFn: () => api.listItems(projectId),
    enabled: nav === 'content',
  });

  if (nav === 'dashboard') {
    return (
      <div className="h-full overflow-y-auto p-6">
        <Suspense fallback={<LazyFallback />}>
          <ProjectDashboard key={projectId} projectId={projectId} onOpenItem={(id) => onOpenItem(id)} />
        </Suspense>
      </div>
    );
  }

  if (nav === 'workflow') {
    return (
      <div className="h-full overflow-y-auto p-6">
        <Suspense fallback={<LazyFallback />}>
          <WorkflowSettings projectId={projectId} />
        </Suspense>
      </div>
    );
  }

  if (nav === 'categories') {
    return (
      <div className="h-full overflow-y-auto p-6">
        <Suspense fallback={<LazyFallback />}>
          <CategoriesPage key={projectId} projectId={projectId} />
        </Suspense>
      </div>
    );
  }

  if (nav === 'files') {
    return (
      <div className="h-full overflow-y-auto p-6">
        <Suspense fallback={<LazyFallback />}>
          <FilesPage projectId={projectId} onOpenItem={(id) => onOpenItem(id)} />
        </Suspense>
      </div>
    );
  }

  if (nav === 'templates') {
    return (
      <div className="h-full overflow-y-auto p-6">
        <Suspense fallback={<LazyFallback />}>
          {openTemplateId ? (
            <TemplateBuilder templateId={openTemplateId} onBack={() => onSetTemplate(null)} onOpenTemplate={onSetTemplate} />
          ) : (
            <TemplatesGrid projectId={projectId} onOpenTemplate={onSetTemplate} />
          )}
        </Suspense>
      </div>
    );
  }

  if (nav !== 'content' || !IMPLEMENTED[nav]) {
    return (
      <div className="grid h-full place-items-center text-slate-400">
        <p className="text-sm">This section is coming soon.</p>
      </div>
    );
  }

  const empty = items.data?.length === 0;

  // Open item → full editor with a back link. Otherwise the items table (or the
  // empty state when the project has no content).
  if (itemId) {
    return (
      <div className="h-full overflow-y-auto p-6">
        <button type="button" onClick={() => onOpenItem(null)}
                className="mb-3 text-sm text-blue-600 hover:underline">
          ← Content items
        </button>
        <ErrorBoundary label="the editor" resetKeys={[itemId]}>
          <Suspense fallback={<LazyFallback />}>
            <ItemEditor itemId={itemId} projectId={projectId} onOpenItem={onOpenItem} onOpenTemplate={onOpenTemplate} />
          </Suspense>
        </ErrorBoundary>
      </div>
    );
  }

  return (
    <div className="h-full p-6">
      {items.isLoading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : empty ? (
        <EmptyContent projectId={projectId} onCreated={onOpenItem} />
      ) : (
        <ContentItemsTable projectId={projectId} onOpenItem={onOpenItem} />
      )}
    </div>
  );
}

/** Empty-content state with "Add first item" — opens the create dialog. */
function EmptyContent({
  projectId, onCreated,
}: {
  projectId: string;
  onCreated: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="grid h-full place-items-center">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 grid h-28 w-28 place-items-center rounded-full bg-indigo-50">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="1.5">
            <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
            <path d="M14 3v6h6M8 13h6M8 17h5" />
          </svg>
        </div>
        <h2 className="text-2xl font-semibold text-slate-800">No content in this project yet</h2>
        <p className="mx-auto mt-3 max-w-sm text-[15px] text-slate-500">
          A content item usually represents a page, a blog post, or an article. Start by creating
          one and then assigning it to a user or claiming it yourself.
        </p>
        <div className="mt-7">
          <button type="button" onClick={() => setOpen(true)}
                  className="inline-flex items-center gap-2 rounded-md bg-slate-100 px-5 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-200">
            <span className="text-lg leading-none">+</span> Add first item
          </button>
        </div>
      </div>

      {open && (
        <CreateItemDialog projectId={projectId} onClose={() => setOpen(false)}
                          onCreated={(id) => { setOpen(false); onCreated(id); }} />
      )}
    </div>
  );
}
