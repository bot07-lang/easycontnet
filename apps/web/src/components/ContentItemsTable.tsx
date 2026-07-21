import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type ItemSummary } from '../lib/api';
import { CreateItemDialog } from './CreateItemDialog';

/** Column definitions. Title + Status are fixed (always shown, first). */
type ColKey = 'people' | 'due' | 'template' | 'categories' | 'tags' | 'timeInStatus' | 'lastUpdated';
const COLUMNS: { key: ColKey; label: string; defaultOn: boolean }[] = [
  { key: 'people', label: 'People', defaultOn: true },
  { key: 'due', label: 'Next due date', defaultOn: true },
  { key: 'template', label: 'Template', defaultOn: true },
  { key: 'categories', label: 'Categories', defaultOn: true },
  { key: 'tags', label: 'Tags', defaultOn: true },
  { key: 'timeInStatus', label: 'Time in status', defaultOn: false },
  { key: 'lastUpdated', label: 'Last updated', defaultOn: false },
];

type Filter = 'all' | 'assigned' | 'unassigned' | 'mine';

export function ContentItemsTable({
  projectId,
  onOpenItem,
}: {
  projectId: string;
  onOpenItem: (id: string) => void;
}) {
  const items = useQuery({
    queryKey: ['items', projectId],
    queryFn: () => api.listItems(projectId),
  });

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [hideCompleted, setHideCompleted] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [cols, setCols] = useState<ColKey[]>(COLUMNS.filter((c) => c.defaultOn).map((c) => c.key));
  const [order, setOrder] = useState<ColKey[]>(COLUMNS.map((c) => c.key));

  const shown = useMemo(() => {
    let list = items.data ?? [];
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((i) => i.name.toLowerCase().includes(q));
    if (filter === 'assigned') list = list.filter((i) => i.people.length > 0);
    if (filter === 'unassigned') list = list.filter((i) => i.people.length === 0);
    if (filter === 'mine') list = list.filter((i) => i.mine);
    if (hideCompleted) list = list.filter((i) => !i.is_terminal);
    return list;
  }, [items.data, search, filter, hideCompleted]);

  const activeCols = order.filter((k) => cols.includes(k));

  const TABS: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'assigned', label: 'Assigned' },
    { key: 'unassigned', label: 'Not assigned' },
    { key: 'mine', label: 'My items' },
  ];

  return (
    <div className="flex h-full flex-col">
      <h1 className="mb-4 text-2xl font-semibold text-slate-900">Content Items</h1>

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…"
                 className="w-56 rounded-md border border-slate-300 py-2 pl-3 pr-8 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               className="absolute right-2.5 top-2.5 text-slate-400"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
        </div>

        <div className="flex overflow-hidden rounded-md border border-slate-300 text-sm">
          {TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setFilter(t.key)}
                    className={filter === t.key ? 'bg-blue-50 px-4 py-2 font-medium text-blue-700' : 'px-4 py-2 text-slate-600 hover:bg-slate-50'}>
              {t.label}
            </button>
          ))}
        </div>

        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700">
          <input type="checkbox" checked={hideCompleted} onChange={(e) => setHideCompleted(e.target.checked)}
                 className="h-4 w-4 accent-blue-600" />
          Hide completed
        </label>

        <div className="ml-auto flex items-center gap-2">
          <NewItemButton projectId={projectId} onCreated={onOpenItem} />
          <button type="button" onClick={() => setManageOpen(true)} title="Manage columns"
                  className="grid h-9 w-9 place-items-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="2.5" height="16"/><rect x="10.75" y="4" width="2.5" height="16"/><rect x="17.5" y="4" width="2.5" height="16"/></svg>
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-slate-50 text-slate-700">
            <tr className="border-b border-slate-200">
              <th className="px-4 py-3 font-semibold">Title</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              {activeCols.map((k) => (
                <th key={k} className="px-4 py-3 font-semibold">
                  {COLUMNS.find((c) => c.key === k)!.label}
                </th>
              ))}
              <th className="px-4 py-3 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {items.isLoading && (
              <tr><td colSpan={activeCols.length + 3} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
            )}
            {shown.length === 0 && !items.isLoading && (
              <tr><td colSpan={activeCols.length + 3} className="px-4 py-8 text-center text-slate-400">No items match.</td></tr>
            )}
            {shown.map((it) => (
              <Row key={it.id} item={it} cols={activeCols} onOpen={() => onOpenItem(it.id)} />
            ))}
          </tbody>
        </table>
      </div>

      {manageOpen && (
        <ManageColumns
          cols={cols} order={order}
          onClose={() => setManageOpen(false)}
          onApply={(nextCols, nextOrder) => { setCols(nextCols); setOrder(nextOrder); setManageOpen(false); }}
        />
      )}
    </div>
  );
}

function Row({ item, cols, onOpen }: { item: ItemSummary; cols: ColKey[]; onOpen: () => void }) {
  const cell = (k: ColKey) => {
    switch (k) {
      case 'people':
        return item.people.length === 0
          ? <span className="text-slate-400">—</span>
          : <span className="flex -space-x-2">{item.people.slice(0, 3).map((p) => (
              <span key={p.name} title={p.name}
                    className="grid h-6 w-6 place-items-center rounded-full border-2 border-white text-[10px] font-semibold text-white"
                    style={{ background: avatarColor(p.name) }}>{initials(p.name)}</span>
            ))}</span>;
      case 'due':
        return item.next_due_date ? new Date(item.next_due_date).toLocaleDateString() : <span className="text-slate-400">—</span>;
      case 'template':
        return item.template_name ?? <span className="text-slate-400">—</span>;
      case 'lastUpdated':
        return new Date(item.updated_at).toLocaleDateString();
      case 'categories':
      case 'tags':
      case 'timeInStatus':
      default:
        return <span className="text-slate-400">—</span>;
    }
  };

  return (
    <tr className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={onOpen}>
      <td className="px-4 py-3 font-medium text-slate-800">{item.name}</td>
      <td className="px-4 py-3">
        {item.status_name ? (
          <span className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.status_color ?? '#9ca3af' }} />
            {item.status_name}
          </span>
        ) : <span className="text-slate-400">—</span>}
      </td>
      {cols.map((k) => <td key={k} className="px-4 py-3 text-slate-700">{cell(k)}</td>)}
      <td className="px-4 py-3">
        <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }}
                className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">
          Open
        </button>
      </td>
    </tr>
  );
}

function ManageColumns({
  cols, order, onClose, onApply,
}: {
  cols: ColKey[];
  order: ColKey[];
  onClose: () => void;
  onApply: (cols: ColKey[], order: ColKey[]) => void;
}) {
  const [localCols, setLocalCols] = useState<Set<ColKey>>(new Set(cols));
  const [localOrder, setLocalOrder] = useState<ColKey[]>(order);
  const [drag, setDrag] = useState<ColKey | null>(null);

  const toggle = (k: ColKey) =>
    setLocalCols((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const onDrop = (target: ColKey) => {
    if (!drag || drag === target) return;
    const next = localOrder.filter((k) => k !== drag);
    const idx = next.indexOf(target);
    next.splice(idx, 0, drag);
    setLocalOrder(next);
    setDrag(null);
  };

  const visible = 2 + localOrder.filter((k) => localCols.has(k)).length;
  const hidden = COLUMNS.length - (visible - 2);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} className="w-[560px] max-w-full rounded-lg bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-[19px] font-semibold text-slate-900">Manage columns</h2>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded text-slate-500 hover:bg-slate-100">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>

        <div className="px-6 py-5">
          <p className="mb-5 text-sm text-slate-500">Show, hide, and reorder columns. Drag to reorder.</p>

          <p className="mb-2 text-[15px] font-medium text-slate-700">Fixed columns</p>
          {['Title', 'Status'].map((label) => (
            <div key={label} className="flex items-center gap-3 py-2 text-slate-500">
              <span className="text-slate-300">⋮⋮</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
              <span className="text-slate-800">{label}</span>
            </div>
          ))}

          <p className="mb-2 mt-5 text-[15px] font-medium text-slate-700">Reorderable columns</p>
          {localOrder.map((k) => {
            const meta = COLUMNS.find((c) => c.key === k)!;
            const on = localCols.has(k);
            return (
              <div key={k} draggable onDragStart={() => setDrag(k)} onDragOver={(e) => e.preventDefault()} onDrop={() => onDrop(k)}
                   className="flex cursor-grab items-center gap-3 rounded py-2 hover:bg-slate-50">
                <span className="text-slate-300">⋮⋮</span>
                <input type="checkbox" checked={on} onChange={() => toggle(k)} className="h-[18px] w-[18px] accent-blue-600" />
                {on ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-slate-600"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-slate-400"><path d="m2 2 20 20M6.7 6.7A10.5 10.5 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 4.3-1M9.9 4.2A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.2 3.1"/></svg>
                )}
                <span className={on ? 'text-slate-800' : 'text-slate-400'}>{meta.label}</span>
              </div>
            );
          })}
        </div>

        <footer className="flex items-center justify-between border-t border-slate-200 px-6 py-4">
          <span className="text-sm text-slate-500">{visible} visible, {hidden} hidden</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="button" onClick={() => onApply(localOrder.filter((k) => localCols.has(k)), localOrder)}
                    className="rounded-md bg-green-600 px-5 py-2 text-sm font-semibold text-white hover:bg-green-700">Apply</button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function NewItemButton({ projectId, onCreated }: { projectId: string; onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
              className="flex items-center gap-2 rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700">
        <span className="text-lg leading-none">+</span> Item
      </button>
      {open && (
        <CreateItemDialog projectId={projectId} onClose={() => setOpen(false)}
                          onCreated={(id) => { setOpen(false); onCreated(id); }} />
      )}
    </>
  );
}

function initials(name: string) { return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase(); }
function avatarColor(name: string) {
  const palette = ['#e11d48', '#7c3aed', '#0891b2', '#ea580c', '#059669', '#4f46e5', '#db2777'];
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length]!;
}
