import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './lib/api';
import { useSession } from './lib/session';
import { DevSwitcher } from './components/DevSwitcher';
import { ItemEditor } from './components/ItemEditor';
import { AllProjects } from './components/AllProjects';

/**
 * Wired app: sign in as a seeded user, pick a project, open an item, edit it.
 * Everything below the header comes from the API under RLS — switch users and
 * the visible projects and items change accordingly.
 */
export default function App() {
  const { session, loading } = useSession();

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
  // null projectId = the All Projects dashboard (home).
  const [projectId, setProjectId] = useState<string | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);

  const items = useQuery({
    queryKey: ['items', projectId],
    queryFn: () => api.listItems(projectId!),
    enabled: !!projectId,
  });

  const goHome = () => {
    setProjectId(null);
    setItemId(null);
  };

  // The dashboard (home) is full width; a project view has the sidebar.
  if (!projectId) {
    return (
      <div className="mx-auto max-w-[1400px] px-6 py-6">
        <AllProjects
          onOpenProject={(id) => { setProjectId(id); setItemId(null); }}
          onOpenItem={(it) => { /* project id unknown here; open item directly */ setItemId(it.id); }}
        />
        {/* Opening a My Item drills straight into the editor without a project sidebar. */}
        {itemId && (
          <div className="mt-6">
            <button type="button" onClick={() => setItemId(null)}
                    className="mb-3 text-sm text-blue-600 hover:underline">
              ← Back to all projects
            </button>
            <ItemEditor itemId={itemId} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-[1400px] gap-5 px-6 py-6">
      {/* Sidebar */}
      <aside className="w-72 shrink-0 space-y-4">
        <button
          type="button"
          onClick={goHome}
          className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          ← All projects
        </button>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <h2 className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-[13px] font-bold tracking-wide text-slate-700">
            CONTENT
          </h2>
          {items.isLoading && <p className="px-4 py-3 text-sm text-slate-400">Loading…</p>}
          {items.error && (
            <p className="px-4 py-3 text-sm text-red-600">Can’t reach the API.</p>
          )}
          {items.data?.length === 0 && (
            <p className="px-4 py-3 text-sm text-slate-400">No items in this project.</p>
          )}
          {items.data?.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => setItemId(it.id)}
              className={`flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition hover:bg-slate-50 ${
                it.id === itemId ? 'bg-blue-50 text-blue-700' : 'text-slate-700'
              }`}
            >
              {it.status_color && (
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: it.status_color }} />
              )}
              <span className="truncate">{it.name}</span>
            </button>
          ))}
        </section>
      </aside>

      {/* Main */}
      <main className="min-w-0 flex-1">
        {itemId ? (
          <ItemEditor itemId={itemId} />
        ) : (
          <div className="grid h-64 place-items-center rounded-lg border border-dashed border-slate-300 text-slate-400">
            Select a content item to open it
          </div>
        )}
      </main>
    </div>
  );
}
