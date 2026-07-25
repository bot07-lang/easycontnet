import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { ContentList } from './ContentNavPanel';

export type NavKey =
  | 'dashboard'
  | 'content'
  | 'briefs'
  | 'files'
  | 'documentation'
  | 'workflow'
  | 'templates'
  | 'categories';

/** Which nav items have a real page today; the rest are placeholders. */
export const IMPLEMENTED: Record<NavKey, boolean> = {
  dashboard: false,
  content: true,
  briefs: false,
  files: false,
  documentation: false,
  workflow: true,
  templates: true,
  categories: true,
};

const MAIN: { key: NavKey; label: string; icon: React.ReactNode }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: <IconGrid /> },
  { key: 'content', label: 'Content', icon: <IconList /> },
  { key: 'briefs', label: 'Briefs & Ideas', icon: <IconBrief /> },
  { key: 'files', label: 'Files', icon: <IconClip /> },
  { key: 'documentation', label: 'Documentation', icon: <IconBook /> },
];

const CONFIG: { key: NavKey; label: string; icon: React.ReactNode }[] = [
  { key: 'workflow', label: 'Workflow', icon: <IconFlow /> },
  { key: 'templates', label: 'Templates', icon: <IconTemplate /> },
  { key: 'categories', label: 'Categories', icon: <IconTag /> },
];

export function Sidebar({
  selectedProjectId,
  activeNav,
  itemId,
  onAllProjects,
  onSelectProject,
  onNavigate,
  onOpenItem,
}: {
  selectedProjectId: string | null;
  activeNav: NavKey | null;
  itemId?: string | null;
  onAllProjects: () => void;
  onSelectProject: (id: string) => void;
  onNavigate: (key: NavKey) => void;
  onOpenItem?: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.listProjects });
  const current = projects.data?.find((p) => p.id === selectedProjectId);

  if (collapsed) {
    return (
      <aside className="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-slate-200 bg-white py-3">
        <button type="button" onClick={() => setCollapsed(false)} title="Expand sidebar"
                className="grid h-9 w-9 place-items-center rounded text-slate-500 hover:bg-slate-100">
          <Chevron dir="right" />
        </button>
        <button type="button" onClick={onAllProjects} title="All projects"
                className="grid h-9 w-9 place-items-center rounded text-slate-600 hover:bg-slate-100">
          <IconHome />
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="flex items-center justify-between px-4 py-3">
        <button type="button" onClick={onAllProjects}
                className="flex items-center gap-2 text-[15px] font-semibold text-slate-800 hover:text-slate-900">
          <IconHome /> All projects
        </button>
        <button type="button" onClick={() => setCollapsed(true)} title="Collapse sidebar"
                className="grid h-7 w-7 place-items-center rounded text-slate-400 hover:bg-slate-100">
          <Chevron dir="left" />
        </button>
      </div>

      {/* Project selector */}
      <div className="px-3 pb-3">
        <ProjectSelect
          projects={projects.data ?? []}
          current={current?.name ?? null}
          onSelect={onSelectProject}
        />
      </div>

      {/* Project-scoped nav */}
      <nav className={`flex-1 overflow-y-auto px-2 ${selectedProjectId ? '' : 'pointer-events-none opacity-40'} `.trim()}>
        {MAIN.map((item) =>
          item.key === 'content' ? (
            <div key={item.key}>
              <NavItem item={item} active={activeNav === item.key}
                       chevron chevronOpen={activeNav === 'content'}
                       onClick={() => onNavigate(item.key)} />
              {activeNav === 'content' && selectedProjectId && onOpenItem && (
                <ContentList projectId={selectedProjectId} currentId={itemId ?? null} onOpenItem={onOpenItem} />
              )}
            </div>
          ) : (
            <NavItem key={item.key} item={item} active={activeNav === item.key}
                     onClick={() => onNavigate(item.key)} />
          ),
        )}

        <p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Configuration
        </p>
        {CONFIG.map((item) => (
          <NavItem key={item.key} item={item} active={activeNav === item.key}
                   onClick={() => onNavigate(item.key)} />
        ))}
      </nav>
    </aside>
  );
}

function NavItem({
  item, active, onClick, chevron, chevronOpen,
}: {
  item: { key: NavKey; label: string; icon: React.ReactNode };
  active: boolean;
  onClick: () => void;
  chevron?: boolean;
  chevronOpen?: boolean;
}) {
  const implemented = IMPLEMENTED[item.key];
  return (
    <button
      type="button"
      onClick={onClick}
      title={implemented ? undefined : `${item.label} — coming soon`}
      className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-[14px] transition
        ${active ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-700 hover:bg-slate-50'}
        ${implemented ? '' : 'text-slate-400'}`}
    >
      <span className="shrink-0">{item.icon}</span>
      <span className="flex-1">{item.label}</span>
      {chevron && (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
             className={`shrink-0 text-slate-400 transition ${chevronOpen ? '' : '-rotate-90'}`}><path d="m6 9 6 6 6-6" /></svg>
      )}
    </button>
  );
}

function ProjectSelect({
  projects, current, onSelect,
}: {
  projects: { id: string; name: string }[];
  current: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const shown = search.trim()
    ? projects.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()))
    : projects;

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => { setOpen((v) => !v); setSearch(''); }}
              className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-300 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
        <span className="truncate">{current ?? 'Select project'}</span>
        <span className="text-[9px] text-slate-500">▾</span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 max-h-80 w-full overflow-hidden rounded-md border border-slate-200 bg-white shadow-xl">
          <div className="relative border-b border-slate-100 p-2">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              className="w-full rounded border border-slate-200 py-1.5 pl-2 pr-7 text-sm focus:border-blue-500 focus:outline-none"
            />
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                 className="absolute right-4 top-4 text-slate-400"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          </div>
          <div className="max-h-64 overflow-auto py-1">
            {shown.length === 0 && <p className="px-3 py-2 text-sm text-slate-400">No matches</p>}
            {shown.map((p) => (
              <button key={p.id} type="button"
                      onClick={() => { onSelect(p.id); setOpen(false); }}
                      className={`block w-full truncate px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                        p.name === current ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-700'
                      }`}>
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* --- icons (inline, no dependency) --- */
function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         className={dir === 'right' ? 'rotate-180' : ''}>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}
function IconHome() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></svg>; }
function IconGrid() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>; }
function IconList() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="5" width="18" height="2.5" rx="1"/><rect x="3" y="10.75" width="18" height="2.5" rx="1"/><rect x="3" y="16.5" width="18" height="2.5" rx="1"/></svg>; }
function IconBrief() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>; }
function IconClip() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21.4 11.05 12.25 20.2a5 5 0 0 1-7.07-7.07l9.19-9.19a3 3 0 0 1 4.24 4.24l-9.2 9.19a1 1 0 0 1-1.41-1.41l8.48-8.49" /></svg>; }
function IconBook() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 4h13a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4z" /><path d="M4 4v16" /></svg>; }
function IconFlow() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="12" r="2"/><path d="M8 6h6a2 2 0 0 1 2 2v2M8 18h6a2 2 0 0 0 2-2v-2"/></svg>; }
function IconTemplate() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>; }
function IconTag() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.2" fill="currentColor"/></svg>; }
