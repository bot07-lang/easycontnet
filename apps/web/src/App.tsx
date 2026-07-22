import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './lib/api';
import { useSession } from './lib/session';
import { DevSwitcher } from './components/DevSwitcher';
import { ItemEditor } from './components/ItemEditor';
import { AllProjects } from './components/AllProjects';
import { ContentItemsTable } from './components/ContentItemsTable';
import { CreateItemDialog } from './components/CreateItemDialog';
import { WorkflowSettings } from './components/WorkflowSettings';
import { TemplatesGrid } from './components/TemplatesGrid';
import { TemplateBuilder } from './components/TemplateBuilder';
import { Sidebar, IMPLEMENTED, type NavKey } from './components/Sidebar';

/**
 * Wired app: sign in as a seeded user, pick a project, open an item, edit it.
 * Everything below the header comes from the API under RLS — switch users and
 * the visible projects and items change accordingly.
 */
export default function App() {
  const { session, loading } = useSession();
  const qc = useQueryClient();

  // Different users see different data under RLS. Clearing the cache on a user
  // switch avoids briefly showing the previous user's projects while the new
  // user's data refetches.
  const userId = session?.user?.id;
  useEffect(() => { qc.clear(); }, [userId, qc]);

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="flex items-center gap-4 bg-indigo-700 px-6 py-3 text-white">
        <span className="font-semibold tracking-tight">Content Workflow</span>
        <div className="ml-auto">
          <DevSwitcher session={session} />
        </div>
      </header>

      {loading ? (
        <p className="p-10 text-slate-400">Loading…</p>
      ) : !session ? (
        <SignedOut />
      ) : (
        <Workspace key={session.user.id} />
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
  // toggles the All Projects dashboard vs the selected project's view.
  const [projectId, setProjectId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(true);
  const [nav, setNav] = useState<NavKey>('content');
  const [itemId, setItemId] = useState<string | null>(null);

  const projects = useQuery({ queryKey: ['projects'], queryFn: api.listProjects });

  // Default the dropdown to the first visible project once loaded.
  if (!projectId && projects.data?.length) setProjectId(projects.data[0]!.id);

  const selectProject = (id: string) => {
    setProjectId(id);
    setShowAll(false);
    setNav('content');
    setItemId(null);
  };

  return (
    <div className="flex h-[calc(100vh-52px)]">
      <Sidebar
        selectedProjectId={projectId}
        activeNav={showAll ? null : nav}
        onAllProjects={() => { setShowAll(true); setItemId(null); }}
        onSelectProject={selectProject}
        onNavigate={(key) => { setShowAll(false); setNav(key); setItemId(null); }}
      />

      <div className="min-w-0 flex-1 overflow-y-auto bg-slate-100">
        {showAll || !projectId ? (
          <div className="mx-auto max-w-[1400px] px-6 py-6">
            <AllProjects
              onOpenProject={selectProject}
              onOpenItem={(it) => { setProjectId(it.project_id); setShowAll(false); setNav('content'); setItemId(it.id); }}
            />
          </div>
        ) : (
          <ProjectView projectId={projectId} nav={nav} itemId={itemId} onOpenItem={setItemId} />
        )}
      </div>
    </div>
  );
}

function ProjectView({
  projectId, nav, itemId, onOpenItem,
}: {
  projectId: string;
  nav: NavKey;
  itemId: string | null;
  onOpenItem: (id: string | null) => void;
}) {
  const items = useQuery({
    queryKey: ['items', projectId],
    queryFn: () => api.listItems(projectId),
    enabled: nav === 'content',
  });

  // The template whose builder is open (templates nav only). Reset when the
  // project changes so we never show another project's template.
  const [openTemplateId, setOpenTemplateId] = useState<string | null>(null);
  useEffect(() => { setOpenTemplateId(null); }, [projectId]);

  if (nav === 'workflow') {
    return (
      <div className="h-full overflow-y-auto p-6">
        <WorkflowSettings projectId={projectId} />
      </div>
    );
  }

  if (nav === 'templates') {
    return (
      <div className="h-full overflow-y-auto p-6">
        {openTemplateId ? (
          <TemplateBuilder templateId={openTemplateId} onBack={() => setOpenTemplateId(null)} />
        ) : (
          <TemplatesGrid projectId={projectId} onOpenTemplate={setOpenTemplateId} />
        )}
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
        <ItemEditor itemId={itemId} />
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
