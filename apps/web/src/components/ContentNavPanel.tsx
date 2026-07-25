import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

/**
 * The item list shown under the sidebar's "Content" nav item: a title search, a
 * "hide completed items" toggle, and a scrollable list of the project's items
 * (colour dot + title), with the current item highlighted. Clicking one opens it.
 */
export function ContentList({
  projectId, currentId, onOpenItem,
}: {
  projectId: string;
  currentId: string | null;
  onOpenItem: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [hideCompleted, setHideCompleted] = useState(true);

  const items = useQuery({
    queryKey: ['items', projectId],
    queryFn: () => api.listItems(projectId),
  });

  const q = search.trim().toLowerCase();
  const list = (items.data ?? [])
    .filter((it) => !(hideCompleted && it.is_terminal))
    .filter((it) => !q || it.name.toLowerCase().includes(q) || String(it.item_number).includes(q));

  return (
    <div className="mx-1 mb-1 mt-1 rounded-lg border border-slate-200 bg-white p-2.5">
      <div className="relative">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by title"
          className="w-full rounded-md border border-slate-300 py-1.5 pl-2.5 pr-8 text-[13px] focus:border-blue-500 focus:outline-none"
        />
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
             className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400">
          <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
        </svg>
      </div>

      <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-[13px] text-slate-800">
        <input type="checkbox" checked={hideCompleted} onChange={(e) => setHideCompleted(e.target.checked)}
               className="h-4 w-4 accent-blue-600" />
        Hide completed items
      </label>

      <div className="mt-2 max-h-[calc(100vh-320px)] space-y-0.5 overflow-y-auto">
        {items.isLoading ? (
          <p className="px-2 py-3 text-[13px] text-slate-400">Loading…</p>
        ) : list.length === 0 ? (
          <p className="px-2 py-3 text-[13px] text-slate-400">{q ? 'No matching items.' : 'No items.'}</p>
        ) : (
          list.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => onOpenItem(it.id)}
              title={`${it.item_number} ${it.name}`}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left ${
                it.id === currentId ? 'bg-slate-200/70' : 'hover:bg-slate-50'
              }`}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: it.status_color ?? '#cbd5e1' }} />
              <span className="truncate text-[13px] text-slate-800">{it.name}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
