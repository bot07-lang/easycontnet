import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type DashboardProject, type DashboardMyItem } from '../lib/api';
import { CreateProjectDialog } from './CreateProjectDialog';

type SortKey = 'created' | 'active' | 'name' | 'items' | 'overdue';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'created', label: 'Last created' },
  { key: 'active', label: 'Last active' },
  { key: 'name', label: 'Name (A-Z)' },
  { key: 'items', label: 'Most items' },
  { key: 'overdue', label: 'Most overdue' },
];

/**
 * The "All Projects" account dashboard: My Items across all projects, plus a
 * card per project with its status breakdown, counts, members and activity.
 * (Recent Messages & Comments omitted until comments exist.)
 */
export function AllProjects({
  onOpenProject,
  onOpenItem,
}: {
  onOpenProject: (projectId: string) => void;
  onOpenItem: (item: DashboardMyItem) => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.getDashboard(),
  });

  if (isLoading) return <p className="p-8 text-slate-400">Loading…</p>;
  if (error) return <p className="p-8 text-red-600">Can’t reach the API. Is it running on :3001?</p>;
  if (!data) return null;

  return (
    <div className="space-y-8">
      {/* My Items */}
      <section>
        <div className="mb-3 flex items-baseline gap-3">
          <h2 className="text-lg font-semibold text-slate-900">My Items</h2>
          <span className="text-sm text-slate-400">Items assigned to you will appear here</span>
        </div>
        {data.myItems.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm text-slate-400">
            No items assigned to you
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
            {data.myItems.map((it) => (
              <li key={it.id}>
                <button
                  type="button"
                  onClick={() => onOpenItem(it)}
                  className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-slate-50"
                >
                  {it.status_color && (
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: it.status_color }} />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[15px] text-slate-800">{it.name}</span>
                  <span className="shrink-0 text-[13px] text-slate-400">{it.project_name}</span>
                  {it.status_name && (
                    <span className="shrink-0 rounded-full border border-slate-200 px-2.5 py-0.5 text-[12px] text-slate-600">
                      {it.status_name}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Projects */}
      <ProjectsSection projects={data.projects} onOpenProject={onOpenProject} />
    </div>
  );
}

function ProjectsSection({
  projects,
  onOpenProject,
}: {
  projects: DashboardProject[];
  onOpenProject: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [sort, setSort] = useState<SortKey>('created');
  const [sortOpen, setSortOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<'active' | 'archived'>('active');

  // Archived projects load only when the tab is opened.
  const archivedQ = useQuery({
    queryKey: ['dashboard', 'archived'],
    queryFn: () => api.getDashboard(true).then((d) => d.projects),
    enabled: tab === 'archived',
  });

  const source = tab === 'archived' ? (archivedQ.data ?? []) : projects;

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? source.filter((p) => p.name.toLowerCase().includes(q)) : [...source];
    list.sort((a, b) => {
      switch (sort) {
        case 'name': return a.name.localeCompare(b.name);
        case 'items': return b.active_count - a.active_count;
        case 'overdue': return b.overdue_count - a.overdue_count;
        case 'active':
          return (b.last_activity ? Date.parse(b.last_activity) : 0) -
                 (a.last_activity ? Date.parse(a.last_activity) : 0);
        case 'created':
        default: return b.project_number - a.project_number;
      }
    });
    return list;
  }, [source, search, sort]);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Projects</h2>
        <a href="#" className="text-sm text-blue-600 hover:underline"
           onClick={(e) => e.preventDefault()}>Learn more about Projects</a>
      </div>

      {/* Toolbar */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by project name"
            className="w-64 rounded-md border border-slate-300 py-2 pl-3 pr-9 text-sm
                       focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               className="absolute right-3 top-2.5 text-slate-400">
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
          </svg>
        </div>

        {/* Active / Archived */}
        <div className="flex overflow-hidden rounded-md border border-slate-300 text-sm">
          <button type="button" onClick={() => setTab('active')}
                  className={tab === 'active' ? 'bg-slate-100 px-4 py-2 font-medium text-slate-800' : 'px-4 py-2 text-slate-500'}>
            Active
          </button>
          <button type="button" onClick={() => setTab('archived')}
                  className={tab === 'archived' ? 'bg-slate-100 px-4 py-2 font-medium text-slate-800' : 'px-4 py-2 text-slate-500'}>
            Archived
          </button>
        </div>

        {/* View toggle */}
        <div className="flex overflow-hidden rounded-md border border-slate-300">
          <button type="button" onClick={() => setView('grid')} title="Grid view"
                  className={`grid h-9 w-9 place-items-center ${view === 'grid' ? 'bg-slate-100 text-slate-800' : 'text-slate-400'}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
          </button>
          <button type="button" onClick={() => setView('list')} title="List view"
                  className={`grid h-9 w-9 place-items-center ${view === 'list' ? 'bg-slate-100 text-slate-800' : 'text-slate-400'}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="4" width="18" height="3" rx="1"/><rect x="3" y="10.5" width="18" height="3" rx="1"/><rect x="3" y="17" width="18" height="3" rx="1"/></svg>
          </button>
        </div>

        {/* Sort */}
        <div className="relative">
          <button type="button" onClick={() => setSortOpen((v) => !v)}
                  onBlur={() => setTimeout(() => setSortOpen(false), 150)}
                  className="flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
            {SORTS.find((s) => s.key === sort)!.label}
            <span className="text-[9px] text-slate-500">▾</span>
          </button>
          {sortOpen && (
            <div className="absolute right-0 top-11 z-20 w-44 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-xl">
              {SORTS.map((s) => (
                <button key={s.key} type="button" onMouseDown={() => { setSort(s.key); setSortOpen(false); }}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-100 ${s.key === sort ? 'font-medium text-blue-700' : 'text-slate-700'}`}>
                  {s.key === sort ? '✓' : <span className="w-3" />} {s.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <button type="button" onClick={() => setCreating(true)}
                className="ml-auto flex items-center gap-2 rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-700">
          <span className="text-lg leading-none">+</span> New project
        </button>
      </div>

      {creating && (
        <CreateProjectDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); onOpenProject(id); }}
        />
      )}

      {tab === 'archived' && archivedQ.isLoading ? (
        <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">
          {tab === 'archived' ? 'No archived projects.' : 'No projects match.'}
        </p>
      ) : view === 'grid' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((p) => (
            <ProjectCard key={p.id} project={p} onOpen={() => onOpenProject(p.id)} />
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
          {shown.map((p) => (
            <li key={p.id}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => onOpenProject(p.id)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpenProject(p.id)}
                className="flex cursor-pointer items-center gap-5 px-4 py-4 transition hover:bg-slate-50"
              >
                {/* Name + mini status bar */}
                <div className="w-56 shrink-0">
                  <div className="truncate font-semibold text-slate-900">{p.name}</div>
                  <div className="mt-2"><StatusBar project={p} /></div>
                </div>

                <MyItemsBadge count={p.my_items_count} />
                <MemberAvatars members={p.members} />

                <div className="ml-auto flex items-center gap-4">
                  <div className="text-right">
                    <div className="text-sm text-slate-700">
                      {p.active_count} active
                      {p.overdue_count > 0 && (
                        <span className="ml-2 font-medium text-red-600">{p.overdue_count} overdue</span>
                      )}
                    </div>
                    <div className="text-[13px] text-slate-400">{formatActivity(p.last_activity)}</div>
                  </div>
                  <CardActions project={p} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Shared pieces used by both the grid card and the list row.

function StatusBar({ project }: { project: DashboardProject }) {
  const total = project.status_breakdown.reduce((n, s) => n + s.count, 0);
  return (
    <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
      {total === 0 ? (
        <span className="w-full bg-slate-100" />
      ) : (
        project.status_breakdown.map((s) => (
          <span key={s.name} title={`${s.name}: ${s.count}`}
                style={{ background: s.color, width: `${(s.count / total) * 100}%` }} />
        ))
      )}
    </div>
  );
}

function MyItemsBadge({ count }: { count: number }) {
  return (
    <span title="Items waiting for your action"
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1 text-[12px] text-slate-600">
      My items
      <span className="grid h-4 min-w-4 place-items-center rounded-full bg-slate-200 px-1 text-[11px] font-semibold text-slate-700">
        {count}
      </span>
    </span>
  );
}

function MemberAvatars({ members }: { members: { name: string }[] }) {
  if (members.length === 0) return <span className="text-[13px] text-slate-400">No members</span>;
  return (
    <div className="flex -space-x-2">
      {members.slice(0, 4).map((m) => (
        <span key={m.name} title={m.name}
              className="grid h-7 w-7 place-items-center rounded-full border-2 border-white text-[10px] font-semibold text-white"
              style={{ background: avatarColor(m.name) }}>
          {initials(m.name)}
        </span>
      ))}
      {members.length > 4 && (
        <span className="grid h-7 w-7 place-items-center rounded-full border-2 border-white bg-slate-500 text-[10px] font-semibold text-white">
          +{members.length - 4}
        </span>
      )}
    </div>
  );
}

function CardActions({ project }: { project: DashboardProject }) {
  const qc = useQueryClient();
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  // Refresh both the active and archived lists — a project can move between them.
  const refresh = () => qc.invalidateQueries({ queryKey: ['dashboard'] });
  const archive = useMutation({ mutationFn: () => api.archiveProject(project.id), onSuccess: refresh });
  const restore = useMutation({ mutationFn: () => api.restoreProject(project.id), onSuccess: refresh });
  const duplicate = useMutation({ mutationFn: () => api.duplicateProject(project.id), onSuccess: refresh });
  const del = useMutation({
    mutationFn: () => api.deleteProject(project.id),
    onSuccess: () => { setConfirmDelete(false); refresh(); },
  });

  const Item = ({ label, danger, onClick }: { label: string; danger?: boolean; onClick: () => void }) => (
    <button type="button"
            onClick={(e) => { stop(e); onClick(); setOpen(false); }}
            className={`block w-full px-4 py-2 text-left text-sm hover:bg-slate-100 ${danger ? 'text-red-600' : 'text-slate-700'}`}>
      {label}
    </button>
  );

  return (
    <div ref={ref} className="relative flex items-center gap-1 text-slate-400">
      <button type="button" onClick={stop} title="Bookmark this project"
              className="grid h-7 w-7 place-items-center rounded hover:bg-slate-100 hover:text-slate-600">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
        </svg>
      </button>
      <button type="button" onClick={(e) => { stop(e); setOpen((v) => !v); }} title="Project options"
              className="grid h-7 w-7 place-items-center rounded hover:bg-slate-100 hover:text-slate-600">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-8 z-20 w-40 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-xl">
          <Item label="Settings" onClick={() => setRenaming(true)} />
          <Item label="Duplicate" onClick={() => duplicate.mutate()} />
          {project.archived ? (
            <Item label="Restore" onClick={() => restore.mutate()} />
          ) : (
            <Item label="Archive" onClick={() => archive.mutate()} />
          )}
          <div className="my-1 border-t border-slate-100" />
          <Item label="Delete" danger onClick={() => setConfirmDelete(true)} />
        </div>
      )}

      {renaming && (
        <RenameDialog project={project} onClose={() => setRenaming(false)}
                      onDone={() => { setRenaming(false); refresh(); }} />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete project?"
          message={`“${project.name}” and all its content will be permanently deleted. This cannot be undone.`}
          confirmLabel={del.isPending ? 'Deleting…' : 'Delete'}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => del.mutate()}
        />
      )}
    </div>
  );
}

function RenameDialog({
  project, onClose, onDone,
}: {
  project: DashboardProject;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(project.name);
  const rename = useMutation({
    mutationFn: () => api.renameProject(project.id, name.trim()),
    onSuccess: onDone,
  });
  return (
    <Dialog title="Project settings" onClose={onClose}
      footer={
        <>
          <BtnGhost onClick={onClose}>Cancel</BtnGhost>
          <BtnPrimary disabled={!name.trim() || rename.isPending} onClick={() => rename.mutate()}>
            {rename.isPending ? 'Saving…' : 'Save'}
          </BtnPrimary>
        </>
      }>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-slate-700">Project name</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
               className="w-full rounded-md border border-slate-300 px-3 py-2.5 text-[15px]
                          focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
      </label>
    </Dialog>
  );
}

function ConfirmDialog({
  title, message, confirmLabel, onCancel, onConfirm,
}: {
  title: string; message: string; confirmLabel: string;
  onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <Dialog title={title} onClose={onCancel}
      footer={
        <>
          <BtnGhost onClick={onCancel}>Cancel</BtnGhost>
          <button type="button" onClick={onConfirm}
                  className="rounded-md bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700">
            {confirmLabel}
          </button>
        </>
      }>
      <p className="text-[15px] text-slate-600">{message}</p>
    </Dialog>
  );
}

function Dialog({
  title, onClose, children, footer,
}: {
  title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4"
         onMouseDown={onClose} onClick={(e) => e.stopPropagation()}>
      <div onMouseDown={(e) => e.stopPropagation()} className="w-[460px] max-w-full rounded-lg bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-[18px] font-semibold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close"
                  className="grid h-8 w-8 place-items-center rounded text-slate-500 hover:bg-slate-100">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>
        <div className="px-6 py-5">{children}</div>
        <footer className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">{footer}</footer>
      </div>
    </div>
  );
}

function BtnGhost({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
      {children}
    </button>
  );
}
function BtnPrimary({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
            className="rounded-md bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40">
      {children}
    </button>
  );
}

function ProjectCard({ project, onOpen }: { project: DashboardProject; onOpen: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen()}
      className="flex cursor-pointer flex-col rounded-lg border border-slate-200 bg-white p-5 text-left shadow-sm
                 transition hover:border-slate-300 hover:shadow-md"
    >
      <div className="mb-4 flex items-start justify-between gap-2">
        <h3 className="text-[16px] font-semibold text-slate-900">{project.name}</h3>
        <CardActions project={project} />
      </div>

      <div className="mb-3"><StatusBar project={project} /></div>

      <div className="mb-3 flex items-center gap-2">
        <span className="rounded border border-slate-300 px-2.5 py-0.5 text-[13px] text-slate-700">
          {project.active_count} active
        </span>
        {project.overdue_count > 0 && (
          <span className="rounded border border-red-200 px-2.5 py-0.5 text-[13px] font-medium text-red-600">
            {project.overdue_count} overdue
          </span>
        )}
      </div>

      <p className="mb-3 text-[13px] text-slate-400">
        Last activity: {formatActivity(project.last_activity)}
      </p>

      <div className="mt-auto flex items-center justify-between">
        <MemberAvatars members={project.members} />
        <MyItemsBadge count={project.my_items_count} />
      </div>
    </div>
  );
}

function formatActivity(ts: string | null): string {
  if (!ts) return 'No activity yet';
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function initials(name: string): string {
  return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

function avatarColor(name: string): string {
  const palette = ['#e11d48', '#7c3aed', '#0891b2', '#ea580c', '#059669', '#4f46e5', '#db2777'];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length]!;
}
