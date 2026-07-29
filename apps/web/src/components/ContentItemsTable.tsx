import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ItemSummary } from '../lib/api';
import { AssignDialog } from './AssignDialog';
import { CreateItemDialog } from './CreateItemDialog';
import { getItemCategories, setItemCategories, getProjectCategories } from '../lib/categories-store';
import { TimelineHover } from './ItemTimeline';
import { avatarColor, avatarInitial } from '../lib/avatar';
import { downloadItemHtml } from '../lib/export-html';
import { toast } from '../lib/toast';

type AvatarSpec = { name: string; dim: boolean };
type PeopleDisplay =
  | { kind: 'add' }
  | { kind: 'avatars'; avatars: AvatarSpec[]; overflow: number; overflowNames: string[] };

/**
 * The People-column avatars, per EasyContent's rules:
 *  - The leading avatar is the writer — the first person assigned to the FIRST
 *    status — dimmed once the item has moved past the first status.
 *  - The rest are the CURRENT status's assignees.
 *  - Up to 4 slots. Past the first status the writer takes slot 1 and the
 *    current-status users fill the rest; with 4+ current users only the first
 *    two show and a "+N" bubble stands in for the remainder (exactly three fill
 *    all slots with no bubble). In the first status the writer is just the first
 *    current assignee at full opacity.
 *  - Nobody assigned anywhere → the add-people icon.
 */
function peopleDisplay(item: ItemSummary): PeopleDisplay {
  const current = item.people;
  const author = item.author;

  // Helper for the simple "just show current, 4 slots, 3 + +N over four" case.
  const fromCurrent = (): PeopleDisplay => {
    if (current.length === 0) return { kind: 'add' };
    const cap = current.length > 4 ? 3 : 4;
    return {
      kind: 'avatars',
      avatars: current.slice(0, cap).map((p) => ({ name: p.name, dim: false })),
      overflow: current.length > 4 ? current.length - 3 : 0,
      overflowNames: current.slice(3).map((p) => p.name),
    };
  };

  // In the first status (or when the first status has no writer), the writer is
  // simply the first current assignee — no dimmed leading avatar.
  if (item.in_first_status || !author) {
    if (!author && current.length === 0) return { kind: 'add' };
    return fromCurrent();
  }

  // Past the first status: the writer leads (dimmed), current users follow.
  const lead: AvatarSpec = { name: author.name, dim: true };
  if (current.length === 0) return { kind: 'avatars', avatars: [lead], overflow: 0, overflowNames: [] };
  if (current.length <= 3) {
    return { kind: 'avatars', avatars: [lead, ...current.map((p) => ({ name: p.name, dim: false }))], overflow: 0, overflowNames: [] };
  }
  return {
    kind: 'avatars',
    avatars: [lead, { name: current[0]!.name, dim: false }, { name: current[1]!.name, dim: false }],
    overflow: current.length - 2,
    overflowNames: current.slice(2).map((p) => p.name),
  };
}

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

type Filter = 'all' | 'assigned' | 'unassigned';

/** Advanced filters (funnel menu). Empty arrays / nulls mean "no constraint". */
type AdvFilters = {
  people: string[];
  statuses: string[];
  templates: string[];
  categories: string[];
  dueFrom: string | null;
  dueTo: string | null;
};
const EMPTY_ADV: AdvFilters = { people: [], statuses: [], templates: [], categories: [], dueFrom: null, dueTo: null };

// Title and Status are fixed columns; the rest come from ColKey.
type SortKey = 'title' | 'status' | ColKey;

/** Comparable value for a column, or null when the column has no data to sort by. */
function sortValue(it: ItemSummary, key: SortKey): string | number | null {
  switch (key) {
    case 'title': return it.name.toLowerCase();
    case 'status': return it.status_name?.toLowerCase() ?? null;
    case 'people': return it.people.length;
    case 'due': return it.next_due_date ? new Date(it.next_due_date).getTime() : null;
    case 'template': return it.template_name?.toLowerCase() ?? null;
    case 'lastUpdated':
    case 'timeInStatus': return new Date(it.updated_at).getTime();
    default: return null; // categories, tags — not populated yet
  }
}

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
  const [tab, setTab] = useState<Filter>('all');
  const [mine, setMine] = useState(false);
  const [hideCompleted, setHideCompleted] = useState(false);
  const [adv, setAdv] = useState<AdvFilters>(EMPTY_ADV);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterBtn = useRef<HTMLButtonElement>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [cols, setCols] = useState<ColKey[]>(COLUMNS.filter((c) => c.defaultOn).map((c) => c.key));
  const [order, setOrder] = useState<ColKey[]>(COLUMNS.map((c) => c.key));
  // Column sort: click a header to cycle asc → desc → off.
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);
  const toggleSort = (key: SortKey) =>
    setSort((s) => (!s || s.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null));

  // Filter options come from the data actually present in the list, so a filter
  // only ever offers values that exist on some item.
  const opts = useMemo(() => {
    const data = items.data ?? [];
    const statusMap = new Map<string, string>();
    data.forEach((i) => { if (i.status_name) statusMap.set(i.status_name, i.status_color ?? '#9ca3af'); });
    // Map each assignee name → role so the people filter can group by role.
    const roleByName = new Map<string, string>();
    data.forEach((i) => i.people.forEach((p) => { if (p.role) roleByName.set(p.name, p.role); }));
    return {
      people: [...new Set(data.flatMap((i) => i.people.map((p) => p.name)))].sort((a, b) => a.localeCompare(b)),
      roleByName,
      statuses: [...statusMap.entries()].map(([name, color]) => ({ name, color })),
      templates: [...new Set(data.map((i) => i.template_name).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b)),
      // All categories defined in the project (not just those assigned to items).
      categories: getProjectCategories(projectId).slice().sort((a, b) => a.localeCompare(b)),
    };
  }, [items.data, projectId]);

  const shown = useMemo(() => {
    let list = [...(items.data ?? [])];
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((i) => i.name.toLowerCase().includes(q));
    if (tab === 'assigned') list = list.filter((i) => i.people.length > 0);
    if (tab === 'unassigned') list = list.filter((i) => i.people.length === 0);
    if (mine) list = list.filter((i) => i.mine);
    if (hideCompleted) list = list.filter((i) => !i.is_terminal);
    if (adv.people.length) list = list.filter((i) => i.people.some((p) => adv.people.includes(p.name)));
    if (adv.statuses.length) list = list.filter((i) => i.status_name != null && adv.statuses.includes(i.status_name));
    if (adv.templates.length) list = list.filter((i) => i.template_name != null && adv.templates.includes(i.template_name));
    if (adv.categories.length) list = list.filter((i) => getItemCategories(i.id).some((c) => adv.categories.includes(c)));
    if (adv.dueFrom) list = list.filter((i) => i.next_due_date != null && i.next_due_date.slice(0, 10) >= adv.dueFrom!);
    if (adv.dueTo) list = list.filter((i) => i.next_due_date != null && i.next_due_date.slice(0, 10) <= adv.dueTo!);
    if (sort) {
      list.sort((a, b) => {
        const av = sortValue(a, sort.key);
        const bv = sortValue(b, sort.key);
        // Empty values always sort last, regardless of direction.
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        const r = av < bv ? -1 : av > bv ? 1 : 0;
        return sort.dir === 'asc' ? r : -r;
      });
    }
    return list;
  }, [items.data, search, tab, mine, hideCompleted, adv, sort]);

  const activeCols = order.filter((k) => cols.includes(k));

  // Applied-filter chips (from the advanced filters only).
  const chips = buildFilterChips(adv, setAdv);
  const clearAllFilters = () => { setSearch(''); setTab('all'); setMine(false); setHideCompleted(false); setAdv(EMPTY_ADV); };

  const TABS: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'assigned', label: 'Assigned' },
    { key: 'unassigned', label: 'Not assigned' },
  ];

  return (
    <div className="flex h-full flex-col">
      <h1 className="mb-4 text-2xl font-semibold text-slate-900">Content Items</h1>

      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…"
                 className="w-56 rounded-md border border-slate-300 py-2 pl-3 pr-8 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               className="absolute right-2.5 top-2.5 text-slate-400"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
        </div>

        {/* All / Assigned / Not assigned */}
        <div className="flex overflow-hidden rounded-md border border-slate-300 text-sm">
          {TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
                    className={tab === t.key ? 'bg-blue-50 px-4 py-2 font-medium text-blue-700' : 'px-4 py-2 text-slate-600 hover:bg-slate-50'}>
              {t.label}
            </button>
          ))}
        </div>

        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="h-4 w-4 accent-blue-600" />
          My items
        </label>
        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700">
          <input type="checkbox" checked={hideCompleted} onChange={(e) => setHideCompleted(e.target.checked)} className="h-4 w-4 accent-blue-600" />
          Hide completed
        </label>

        {/* Advanced filter funnel */}
        <div className="relative">
          <button ref={filterBtn} type="button" onClick={() => setFilterOpen((v) => !v)} title="Filters"
                  className={`grid h-9 w-9 place-items-center rounded-md border ${chips.length ? 'border-blue-400 bg-blue-50 text-blue-600' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" /></svg>
          </button>
          {filterOpen && (
            <FilterMenu opts={opts} adv={adv} onChange={setAdv} onClose={() => setFilterOpen(false)} />
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <NewItemButton projectId={projectId} onCreated={onOpenItem} />
          <button type="button" onClick={() => setManageOpen(true)} title="Manage columns"
                  className="grid h-9 w-9 place-items-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="2.5" height="16"/><rect x="10.75" y="4" width="2.5" height="16"/><rect x="17.5" y="4" width="2.5" height="16"/></svg>
          </button>
        </div>
      </div>

      {/* Applied filters */}
      {chips.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-600">Applied filters:</span>
          {chips.map((chip) => (
            <span key={chip.label} className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700">
              {chip.label}
              <button type="button" onClick={chip.onRemove} className="text-slate-400 hover:text-red-600">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </span>
          ))}
          <button type="button" onClick={() => setAdv(EMPTY_ADV)} className="rounded-md border border-blue-300 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50">
            Clear all
          </button>
        </div>
      )}

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-slate-50 text-slate-700">
            <tr className="border-b border-slate-200">
              <SortTh label="Title" sortKey="title" sort={sort} onSort={toggleSort} />
              <SortTh label="Status" sortKey="status" sort={sort} onSort={toggleSort} />
              {activeCols.map((k) => (
                <SortTh key={k} label={COLUMNS.find((c) => c.key === k)!.label} sortKey={k} sort={sort} onSort={toggleSort} />
              ))}
              <th className="px-4 py-3 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {items.isLoading && (
              <tr><td colSpan={activeCols.length + 3} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
            )}
            {shown.length === 0 && !items.isLoading && (
              <tr>
                <td colSpan={activeCols.length + 3} className="px-4 py-16 text-center">
                  <p className="text-[17px] text-slate-500">No content items found that match your criteria</p>
                  <button type="button" onClick={clearAllFilters} className="mt-3 text-[15px] font-semibold text-blue-600 hover:underline">
                    Clear all filters
                  </button>
                </td>
              </tr>
            )}
            {shown.map((it) => (
              <Row key={it.id} projectId={projectId} item={it} cols={activeCols} onOpen={() => onOpenItem(it.id)} />
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

type Sub = 'people' | 'status' | 'due' | 'template' | 'category';

/** The funnel dropdown: five submenus that filter the list. Options are passed
 *  in from the data actually present, and flyouts open to the left (the funnel
 *  sits on the right of the toolbar). */
function FilterMenu({
  opts, adv, onChange, onClose,
}: {
  opts: { people: string[]; roleByName: Map<string, string>; statuses: { name: string; color: string }[]; templates: string[]; categories: string[] };
  adv: AdvFilters;
  onChange: React.Dispatch<React.SetStateAction<AdvFilters>>;
  onClose: () => void;
}) {
  const [sub, setSub] = useState<Sub | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [onClose]);

  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const rows: { key: Sub; label: string }[] = [
    { key: 'people', label: 'Assigned people' },
    { key: 'status', label: 'Workflow status' },
    { key: 'due', label: 'Due date range' },
    { key: 'template', label: 'Template' },
    { key: 'category', label: 'Categories' },
  ];

  return (
    <div ref={ref} className="absolute right-0 top-full z-30 mt-1 w-60 rounded-md border border-slate-200 bg-white py-1 shadow-xl">
      {rows.map((r) => (
        <div key={r.key} className="relative" onMouseEnter={() => setSub(r.key)}>
          <button type="button" className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-[15px] ${sub === r.key ? 'bg-slate-100' : 'hover:bg-slate-100'} text-slate-700`}>
            {r.label} <span className="text-slate-400">›</span>
          </button>
          {sub === r.key && (
            <div className="absolute right-full top-0 z-40 mr-1 w-64 rounded-md border border-slate-200 bg-white p-2 shadow-xl">
              {r.key === 'people' && <CheckList options={opts.people} groupOf={(n) => opts.roleByName.get(n)} selected={adv.people} onToggle={(v) => onChange((p) => ({ ...p, people: toggle(p.people, v) }))} />}
              {r.key === 'status' && <CheckList options={opts.statuses.map((s) => s.name)} colorOf={(n) => opts.statuses.find((s) => s.name === n)?.color} selected={adv.statuses} onToggle={(v) => onChange((p) => ({ ...p, statuses: toggle(p.statuses, v) }))} />}
              {r.key === 'template' && <CheckList options={opts.templates} selected={adv.templates} onToggle={(v) => onChange((p) => ({ ...p, templates: toggle(p.templates, v) }))} />}
              {r.key === 'category' && <CheckList options={opts.categories} selected={adv.categories} onToggle={(v) => onChange((p) => ({ ...p, categories: toggle(p.categories, v) }))} />}
              {r.key === 'due' && <DateRange from={adv.dueFrom} to={adv.dueTo} onChange={(from, to) => onChange((p) => ({ ...p, dueFrom: from, dueTo: to }))} />}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** Searchable checkbox list used by the filter submenus. */
function CheckList({
  options, selected, onToggle, colorOf, groupOf,
}: {
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
  colorOf?: (v: string) => string | undefined;
  groupOf?: (v: string) => string | undefined;
}) {
  const [q, setQ] = useState('');
  const shown = options.filter((o) => !q.trim() || o.toLowerCase().includes(q.trim().toLowerCase()));
  const row = (o: string) => (
    <label key={o} className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 text-[14px] text-slate-800 hover:bg-slate-50">
      <input type="checkbox" checked={selected.includes(o)} onChange={() => onToggle(o)} className="h-4 w-4 accent-blue-600" />
      {colorOf && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorOf(o) ?? '#9ca3af' }} />}
      <span className="truncate">{o}</span>
    </label>
  );
  // When groupOf is given, bucket the shown options under role headers.
  const groups: { role: string; items: string[] }[] = [];
  if (groupOf) {
    for (const o of shown) {
      const g = groupOf(o) ?? '—';
      let bucket = groups.find((x) => x.role === g);
      if (!bucket) { bucket = { role: g, items: [] }; groups.push(bucket); }
      bucket.items.push(o);
    }
  }
  return (
    <div>
      <div className="relative mb-1">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
               className="h-9 w-full rounded-md border border-slate-300 pl-2.5 pr-8 text-[14px] focus:border-blue-500 focus:outline-none" />
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute right-2.5 top-2.5 text-slate-400"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      </div>
      <div className="max-h-56 overflow-y-auto">
        {shown.length === 0 ? (
          <p className="px-2 py-3 text-center text-[13px] text-slate-400">No matches</p>
        ) : groupOf ? (
          groups.map((g) => (
            <div key={g.role} className="pb-1">
              <p className="px-2 pb-0.5 pt-2 text-[12px] font-medium text-slate-400">{g.role}</p>
              {g.items.map(row)}
            </div>
          ))
        ) : shown.map(row)}
      </div>
    </div>
  );
}

/** Due-date range: a From/To pair. */
function DateRange({ from, to, onChange }: { from: string | null; to: string | null; onChange: (from: string | null, to: string | null) => void }) {
  return (
    <div className="w-60 space-y-3 p-1">
      <label className="block">
        <span className="mb-1 block text-[13px] text-slate-500">From</span>
        <input type="date" value={from ?? ''} onChange={(e) => onChange(e.target.value || null, to)}
               className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-[14px] focus:border-blue-500 focus:outline-none" />
      </label>
      <label className="block">
        <span className="mb-1 block text-[13px] text-slate-500">To</span>
        <input type="date" value={to ?? ''} onChange={(e) => onChange(from, e.target.value || null)}
               className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-[14px] focus:border-blue-500 focus:outline-none" />
      </label>
      {(from || to) && (
        <button type="button" onClick={() => onChange(null, null)} className="text-[13px] font-medium text-blue-600 hover:underline">Clear dates</button>
      )}
    </div>
  );
}

/** Build the applied-filter chips (label + a remover) from the advanced filters. */
function buildFilterChips(adv: AdvFilters, setAdv: (fn: (p: AdvFilters) => AdvFilters) => void): { label: string; onRemove: () => void }[] {
  const chips: { label: string; onRemove: () => void }[] = [];
  const listChip = (key: 'people' | 'statuses' | 'templates' | 'categories', title: string) => {
    if (adv[key].length) chips.push({ label: `${title}: ${adv[key].join(', ')}`, onRemove: () => setAdv((p) => ({ ...p, [key]: [] })) });
  };
  listChip('people', 'People');
  listChip('statuses', 'Status');
  listChip('templates', 'Template');
  listChip('categories', 'Categories');
  if (adv.dueFrom || adv.dueTo) {
    const fmt = (d: string) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    const label = adv.dueFrom && adv.dueTo ? `From ${fmt(adv.dueFrom)} to ${fmt(adv.dueTo)}` : adv.dueFrom ? `From ${fmt(adv.dueFrom)}` : `Until ${fmt(adv.dueTo!)}`;
    chips.push({ label: `Due date: ${label}`, onRemove: () => setAdv((p) => ({ ...p, dueFrom: null, dueTo: null })) });
  }
  return chips;
}

/** Fast tooltip for a possibly-truncated title: shows the full name after a
 *  short delay (unlike the ~1s native `title`), and only when actually cut off.
 *  Portal-rendered so the table's overflow can't clip it. */
function TitleTip({ text, children }: { text: string; children: React.ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = () => {
    const btn = ref.current?.querySelector('button');
    if (!btn) return;
    // Only bother when the title is actually cut off.
    if (btn.scrollWidth - btn.clientWidth < 2) return;
    const r = btn.getBoundingClientRect();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setPos({ x: Math.round(r.left), y: Math.round(r.bottom + 4) }), 120);
  };
  const hide = () => { clearTimeout(timer.current); setPos(null); };
  return (
    <span ref={ref} className="inline-flex min-w-0" onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {pos && createPortal(
        <div style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 60 }}
             className="max-w-[380px] rounded-md bg-slate-900 px-3 py-2 text-[13px] leading-snug text-white shadow-xl">
          {text}
        </div>,
        document.body,
      )}
    </span>
  );
}

function Row({
  projectId, item, cols, onOpen,
}: {
  projectId: string;
  item: ItemSummary;
  cols: ColKey[];
  onOpen: () => void;
}) {
  const [assign, setAssign] = useState(false);
  const [catsOpen, setCatsOpen] = useState(false);
  const [cats, setCats] = useState<string[]>(() => getItemCategories(item.id));
  const openAssign = (e: React.MouseEvent) => { e.stopPropagation(); setAssign(true); };
  const openCats = (e: React.MouseEvent) => { e.stopPropagation(); setCatsOpen(true); };
  const cell = (k: ColKey) => {
    switch (k) {
      case 'people': {
        // Avatars per EasyContent's rules (writer + current-status assignees).
        // The dashed add-person affordance — and clicking to open the assign
        // modal — is shown ONLY to users who may assign people; others see the
        // avatars read-only (and get a Claim button in the Action column).
        const disp = peopleDisplay(item);
        const avatars = disp.kind === 'avatars' && (
          <span className="flex -space-x-2">
            {disp.avatars.map((a, i) => (
              <span key={i} title={a.name}
                    className={`grid h-6 w-6 place-items-center rounded-full border-2 border-white text-[11px] font-semibold text-white ${a.dim ? 'opacity-40' : ''}`}
                    style={{ background: avatarColor(a.name) }}>{avatarInitial(a.name)}</span>
            ))}
            {disp.overflow > 0 && (
              <span title={disp.overflowNames.join(', ')}
                    className="grid h-6 w-6 place-items-center rounded-full border-2 border-white bg-slate-200 text-[10px] font-semibold text-slate-600">
                +{disp.overflow}
              </span>
            )}
          </span>
        );
        return (
          <TimelineHover itemId={item.id}>
            {item.can_assign ? (
              <button type="button" onClick={openAssign} title={disp.kind === 'add' ? 'Assign people' : 'Edit assignees'}
                      className="flex items-center gap-1.5">
                {avatars}
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border border-dashed border-slate-300 text-slate-500 transition hover:border-slate-500 hover:text-slate-700 ${disp.kind === 'add' ? '' : 'opacity-0 group-hover:opacity-100'}`}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="9" cy="8" r="3.2" /><path d="M3 20a6 6 0 0 1 12 0M18 8v6M15 11h6" /></svg>
                </span>
              </button>
            ) : (
              <span className="flex items-center gap-1.5">{avatars}</span>
            )}
          </TimelineHover>
        );
      }
      case 'due': {
        // Timer icon + date — RED when overdue, BLUE when upcoming (per EC).
        // Editing (change / add) is limited to users who may set due dates;
        // everyone else sees it read-only. Wrapped in the timeline hover so it
        // shows each status's due date even when the current one has none.
        const due = item.next_due_date ? new Date(item.next_due_date) : null;
        const overdue = due ? due.getTime() < Date.now() : false;
        const dueColor = overdue ? 'text-red-600' : 'text-blue-600';
        const label = due
          ? due.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).replace(' ', '-')
          : '';
        const timer = (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <line x1="10" x2="14" y1="2" y2="2" /><line x1="12" x2="15" y1="14" y2="11" /><circle cx="12" cy="14" r="8" />
          </svg>
        );
        return (
          <TimelineHover itemId={item.id}>
            {due ? (
              item.can_assign ? (
                <button type="button" onClick={openAssign} title="Change due date"
                        className={`inline-flex items-center gap-1.5 font-medium ${dueColor} hover:underline`}>
                  {timer}{label}
                </button>
              ) : (
                <span className={`inline-flex items-center gap-1.5 font-medium ${dueColor}`}>{timer}{label}</span>
              )
            ) : item.can_assign ? (
              <button type="button" onClick={openAssign} title="Set due date"
                      className="grid h-7 w-7 place-items-center rounded-full text-blue-600 opacity-0 transition hover:bg-blue-50 group-hover:opacity-100">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></svg>
              </button>
            ) : null}
          </TimelineHover>
        );
      }
      case 'template':
        return item.template_name ?? <span className="text-slate-400">—</span>;
      case 'lastUpdated':
        return new Date(item.updated_at).toLocaleDateString();
      case 'categories':
        // Category pills, plus a + on hover to open the category picker.
        return (
          <button type="button" onClick={openCats} title="Change categories" className="flex items-center gap-1.5">
            {cats.length > 0 && (
              <span className="flex flex-wrap items-center gap-1">
                {cats.slice(0, 2).map((c) => (
                  <span key={c} className="whitespace-nowrap rounded-full border border-slate-200 px-2 py-0.5 text-[12px] text-slate-600">{c}</span>
                ))}
                {cats.length > 2 && <span className="text-[12px] text-slate-400">+{cats.length - 2}</span>}
              </span>
            )}
            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 ${cats.length ? 'opacity-0 group-hover:opacity-100' : ''}`}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
            </span>
          </button>
        );
      case 'tags':
      case 'timeInStatus':
      default:
        return <span className="text-slate-400">—</span>;
    }
  };

  return (
    <tr className="group cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={onOpen}>
      <td className="px-4 py-3">
        <TitleCell projectId={projectId} item={item} onOpen={onOpen} />
      </td>
      <td className="px-4 py-3">
        {item.status_name ? (
          <TimelineHover itemId={item.id}>
            <button type="button" onClick={openAssign} title="Assigned people and due dates"
                    className="inline-flex items-center gap-2 text-left hover:text-blue-600">
              {/* Numbered stage circle in the status colour. */}
              <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white"
                    style={{ background: item.status_color ?? '#9ca3af' }}>
                {item.status_index ?? ''}
              </span>
              <span>{item.status_name}</span>
            </button>
          </TimelineHover>
        ) : <span className="text-slate-400">—</span>}
      </td>
      {cols.map((k) => <td key={k} className="px-4 py-3 text-slate-700">{cell(k)}</td>)}
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1.5">
          {item.can_claim && <ClaimButton projectId={projectId} itemId={item.id} />}
          <RowActions projectId={projectId} item={item} />
        </div>
        {assign && <AssignDialog itemId={item.id} itemName={item.name} onClose={() => setAssign(false)} />}
        {catsOpen && (
          <ChangeCategoriesDialog
            projectId={projectId}
            selected={cats}
            onClose={() => setCatsOpen(false)}
            onSaved={(next) => { setItemCategories(item.id, next); setCats(next); setCatsOpen(false); }}
          />
        )}
      </td>
    </tr>
  );
}

/** Change an item's categories — a searchable multi-select of the project's
 *  categories (frontend-only, from the shared categories store). */
function ChangeCategoriesDialog({
  projectId, selected, onSaved, onClose,
}: {
  projectId: string;
  selected: string[];
  onSaved: (next: string[]) => void;
  onClose: () => void;
}) {
  const all = getProjectCategories(projectId);
  const [sel, setSel] = useState<Set<string>>(new Set(selected));
  const [q, setQ] = useState('');
  const shown = all.filter((c) => !q.trim() || c.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (c: string) => setSel((prev) => { const n = new Set(prev); n.has(c) ? n.delete(c) : n.add(c); return n; });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-6" onMouseDown={onClose} onClick={(e) => e.stopPropagation()}>
      <div onMouseDown={(e) => e.stopPropagation()} className="w-[560px] max-w-full rounded-lg bg-white shadow-2xl">
        <header className="flex items-center justify-between px-6 pt-5">
          <h2 className="text-[22px] font-semibold text-slate-900">Change categories</h2>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded text-slate-500 hover:bg-slate-100">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>
        <div className="px-6 py-5">
          <p className="mb-4 text-[15px] text-slate-500">Note that previously existing data will be overridden.</p>
          <div className="overflow-hidden rounded-md border border-slate-300">
            <div className="border-b border-slate-200 px-4 py-3 text-[15px] text-slate-500">
              {sel.size === 0 ? 'None selected' : `${sel.size} selected`}
            </div>
            <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search"
                     className="flex-1 text-[15px] text-slate-800 focus:outline-none" />
              {q && <button type="button" onClick={() => setQ('')} className="text-slate-400 hover:text-slate-600"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg></button>}
            </div>
            <div className="max-h-64 overflow-y-auto py-1">
              {all.length === 0 ? (
                <p className="px-4 py-6 text-center text-[14px] text-slate-400">No categories in this project yet.</p>
              ) : shown.length === 0 ? (
                <p className="px-4 py-6 text-center text-[14px] text-slate-400">No matches.</p>
              ) : shown.map((c) => (
                <label key={c} className="flex cursor-pointer items-center gap-3 px-4 py-2 text-[15px] text-slate-800 hover:bg-slate-50">
                  <input type="checkbox" checked={sel.has(c)} onChange={() => toggle(c)} className="h-[18px] w-[18px] accent-blue-600" />
                  {c}
                </label>
              ))}
            </div>
          </div>
        </div>
        <footer className="flex justify-end gap-3 px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-md bg-slate-100 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200">Cancel</button>
          <button type="button" onClick={() => onSaved([...sel])} className="rounded-md bg-green-500 px-6 py-2.5 text-sm font-semibold text-white hover:bg-green-600">Save</button>
        </footer>
      </div>
    </div>
  );
}

/** Item title: a blue link (opens the item) with a pencil that turns it into an inline rename. */
function TitleCell({ projectId, item, onOpen }: { projectId: string; item: ItemSummary; onOpen: () => void }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const rename = useMutation({
    mutationFn: () => api.renameItem(item.id, name.trim()),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['items', projectId] }); setEditing(false); },
  });
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  if (editing) {
    return (
      <span className="flex items-center gap-1.5" onClick={stop}>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) rename.mutate(); if (e.key === 'Escape') { setName(item.name); setEditing(false); } }}
               className="w-56 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
        <button type="button" disabled={!name.trim() || rename.isPending} onClick={() => rename.mutate()} title="Save"
                className="grid h-7 w-7 place-items-center rounded text-slate-500 hover:bg-slate-100 disabled:opacity-40">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M8 3v6h7M8 21v-7h8v7" /></svg>
        </button>
        <button type="button" onClick={() => { setName(item.name); setEditing(false); }} title="Cancel"
                className="grid h-7 w-7 place-items-center rounded text-slate-400 hover:bg-slate-100">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </span>
    );
  }

  return (
    <span className="group flex items-center gap-2">
      <TitleTip text={item.name}>
        <button type="button" onClick={(e) => { stop(e); onOpen(); }}
                className="block max-w-[340px] truncate text-left font-medium text-blue-600 hover:underline">
          {item.name}
        </button>
      </TitleTip>
      <button type="button" onClick={(e) => { stop(e); setEditing(true); }} title="Rename"
              className="shrink-0 opacity-0 transition group-hover:opacity-100 text-slate-400 hover:text-slate-600">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
      </button>
    </span>
  );
}

/**
 * The Claim button (EasyContent "claiming items"). Shown in the Action column
 * only when the caller may claim the item — self-assigns them to the current
 * status. The server re-checks the reviewing-role + unassigned gates.
 */
function ClaimButton({ projectId, itemId }: { projectId: string; itemId: string }) {
  const qc = useQueryClient();
  const claim = useMutation({
    mutationFn: () => api.claimItem(itemId),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['items', projectId] }); toast('Claimed — assigned to you.'); },
    onError: () => toast('Could not claim this item.'),
  });
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); claim.mutate(); }} disabled={claim.isPending}
            className="rounded border border-slate-300 bg-white px-3 py-1 text-[13px] font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50">
      Claim
    </button>
  );
}

/**
 * Per-row action menu, mirroring the reference. Only Delete is wired today —
 * RLS enforces manage_content_items. The rest depend on features not yet built
 * (assignment, deadlines, workflow transitions, categories, briefs, export) and
 * render disabled so the full surface is remembered without pretending to work.
 */
function RowActions({
  projectId, item,
}: {
  projectId: string;
  item: ItemSummary;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [changeStatus, setChangeStatus] = useState(false);
  const [assign, setAssign] = useState(false);
  const [catsOpen, setCatsOpen] = useState(false);
  const [cats, setCats] = useState<string[]>(() => getItemCategories(item.id));
  const ref = useRef<HTMLDivElement>(null);

  // Export to HTML from the row: fetch the full item + fresh asset URLs, then
  // build + download (reuses the same builder as the editor's export).
  const exportItem = async () => {
    setOpen(false);
    try {
      const full = await api.getItem(item.id);
      const fileUrls = new Map<string, string>();
      try { (await api.listFiles(projectId)).forEach((f) => { if (f.fullUrl) fileUrls.set(f.id, f.fullUrl); }); } catch { /* export without live URLs */ }
      downloadItemHtml(full, fileUrls);
    } catch {
      toast('Could not export the item.');
    }
  };

  // Export to DOCX: same data as the HTML export, but the docx builder (which
  // pulls the heavy `docx` library) is dynamically imported so it never lands in
  // the main bundle.
  const exportDocx = async () => {
    setOpen(false);
    try {
      const full = await api.getItem(item.id);
      const fileUrls = new Map<string, string>();
      try { (await api.listFiles(projectId)).forEach((f) => { if (f.fullUrl) fileUrls.set(f.id, f.fullUrl); }); } catch { /* export without live URLs */ }
      const { downloadItemDocx } = await import('../lib/export-docx');
      await downloadItemDocx(full, fileUrls);
    } catch {
      toast('Could not export the item.');
    }
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const del = useMutation({
    mutationFn: () => api.deleteItem(item.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['items', projectId] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      setConfirm(false);
      setOpen(false);
    },
  });

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div ref={ref} className="relative" onClick={stop}>
      <button type="button" onClick={() => setOpen((v) => !v)} title="Actions"
              className="grid h-8 w-8 place-items-center rounded text-slate-500 hover:bg-slate-100">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-slate-200 bg-white py-1.5 shadow-xl">
          {/* Assigning people / due dates needs manage_people_and_deadlines. */}
          {item.can_assign && <MenuItem icon="assign" label="Assign people" onClick={() => { setOpen(false); setAssign(true); }} />}
          {item.can_assign && <MenuItem icon="calendar" label="Manage due dates" onClick={() => { setOpen(false); setAssign(true); }} />}
          <MenuItem icon="status" label="Change status" onClick={() => { setOpen(false); setChangeStatus(true); }} />
          <MenuItem icon="template" label="Change template" disabled />
          <MenuItem icon="folder" label="Change category" onClick={() => { setOpen(false); setCatsOpen(true); }} />
          <MenuItem icon="duplicate" label="Duplicate item" disabled />
          <MenuItem icon="brief" label="Convert to Brief" disabled />
          <MenuItem icon="cloud" label="Export to DOCX" onClick={exportDocx} />
          <MenuItem icon="cloud" label="Export to HTML" onClick={exportItem} />
          <div className="my-1.5 border-t border-slate-100" />
          <MenuItem icon="trash" label="Delete" danger onClick={() => setConfirm(true)} />
        </div>
      )}

      {confirm && (
        <ConfirmDelete
          name={item.name}
          pending={del.isPending}
          error={del.isError}
          onCancel={() => setConfirm(false)}
          onConfirm={() => del.mutate()}
        />
      )}
      {changeStatus && (
        <ChangeStatusDialog projectId={projectId} item={item} onClose={() => setChangeStatus(false)} />
      )}
      {assign && (
        <AssignDialog itemId={item.id} itemName={item.name} onClose={() => setAssign(false)} />
      )}
      {catsOpen && (
        <ChangeCategoriesDialog
          projectId={projectId}
          selected={cats}
          onClose={() => setCatsOpen(false)}
          onSaved={(next) => { setItemCategories(item.id, next); setCats(next); setCatsOpen(false); }}
        />
      )}
    </div>
  );
}

type IconKey = 'assign' | 'calendar' | 'status' | 'template' | 'folder' | 'duplicate' | 'brief' | 'cloud' | 'trash';

function MenuItem({
  icon, label, disabled, danger, onClick,
}: {
  icon: IconKey;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onClick?: () => void;
}) {
  const tone = disabled
    ? 'text-slate-300 cursor-not-allowed'
    : danger
      ? 'text-red-600 hover:bg-red-50'
      : 'text-slate-700 hover:bg-slate-50';
  return (
    <button type="button" disabled={disabled} onClick={onClick}
            title={disabled ? 'Coming soon' : undefined}
            className={`flex w-full items-center gap-3 px-4 py-2 text-left text-[14px] ${tone}`}>
      <ActionIcon icon={icon} />
      {label}
    </button>
  );
}

function ActionIcon({ icon }: { icon: IconKey }) {
  const p = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 } as const;
  switch (icon) {
    case 'assign': return <svg {...p}><circle cx="9" cy="8" r="3.2" /><path d="M3 20a6 6 0 0 1 12 0M18 8v6M15 11h6" /></svg>;
    case 'calendar': return <svg {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v4M16 3v4" /></svg>;
    case 'status': return <svg {...p}><path d="M4 8h13l-3-3M20 16H7l3 3" /></svg>;
    case 'template': return <svg {...p}><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></svg>;
    case 'folder': return <svg {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>;
    case 'duplicate': return <svg {...p}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>;
    case 'brief': return <svg {...p}><path d="M4 6h16M4 12h10M4 18h16" /></svg>;
    case 'cloud': return <svg {...p}><path d="M17 18a4 4 0 0 0 0-8 5 5 0 0 0-9.6-1.3A3.5 3.5 0 0 0 7 18z" /></svg>;
    case 'trash': return <svg {...p}><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" /></svg>;
  }
}

function ConfirmDelete({
  name, pending, error, onCancel, onConfirm,
}: {
  name: string;
  pending: boolean;
  error: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4"
         onMouseDown={onCancel} onClick={(e) => e.stopPropagation()}>
      <div onMouseDown={(e) => e.stopPropagation()} className="w-[440px] max-w-full rounded-lg bg-white shadow-2xl">
        <div className="px-6 py-5">
          <h2 className="text-[18px] font-semibold text-slate-900">Delete content item?</h2>
          <p className="mt-2 text-[15px] text-slate-600">
            <span className="font-medium text-slate-800">{name}</span> and all of its field values,
            assignees, and history will be permanently removed. This cannot be undone.
          </p>
          {error && <p className="mt-3 text-sm text-red-600">Couldn’t delete — you may not have permission.</p>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <button type="button" onClick={onCancel}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button type="button" disabled={pending} onClick={onConfirm}
                  className="rounded-md bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40">
            {pending ? 'Deleting…' : 'Delete'}
          </button>
        </footer>
      </div>
    </div>
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

/** Shared modal shell for the row-action dialogs. */
function Modal({
  title, children, footer, onClose,
}: {
  title: string;
  children: React.ReactNode;
  footer: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4"
         onMouseDown={onClose} onClick={(e) => e.stopPropagation()}>
      <div onMouseDown={(e) => e.stopPropagation()} className="max-h-[85vh] w-[500px] max-w-full overflow-y-auto rounded-lg bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-[19px] font-semibold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded text-slate-500 hover:bg-slate-100">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>
        <div className="px-6 py-5">{children}</div>
        <footer className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">{footer}</footer>
      </div>
    </div>
  );
}

/**
 * Manual status change (manage_content_items). Per the docs this clears reviews
 * and offers no feedback — an escape hatch. Any status → any status.
 */
function ChangeStatusDialog({ projectId, item, onClose }: { projectId: string; item: ItemSummary; onClose: () => void }) {
  const qc = useQueryClient();
  const wf = useQuery({ queryKey: ['workflow', projectId], queryFn: () => api.getWorkflow(projectId) });
  const statuses = wf.data?.statuses ?? [];
  const [statusId, setStatusId] = useState('');
  if (!statusId && statuses.length) setStatusId(statuses.find((s) => s.name === item.status_name)?.id ?? statuses[0]!.id);

  const change = useMutation({
    mutationFn: () => api.changeItemStatus(item.id, statusId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['items', projectId] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
  });

  return (
    <Modal title="Change status" onClose={onClose}
           footer={
             <>
               <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
               <button type="button" disabled={!statusId || change.isPending} onClick={() => change.mutate()}
                       className="rounded-md bg-green-600 px-5 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-40">
                 {change.isPending ? 'Changing…' : 'Change status'}
               </button>
             </>
           }>
      <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-[13px] text-amber-700">
        Manually changing status moves the item without submit/approve. It clears any reviews, and no feedback is recorded.
      </p>
      {wf.isLoading ? (
        <p className="text-sm text-slate-400">Loading statuses…</p>
      ) : (
        <div className="space-y-1">
          {statuses.map((s) => (
            <label key={s.id} className="flex cursor-pointer items-center gap-2.5 rounded px-1 py-1.5 text-[15px] text-slate-800 hover:bg-slate-50">
              <input type="radio" checked={statusId === s.id} onChange={() => setStatusId(s.id)} className="h-4 w-4 accent-blue-600" />
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
              {s.name}
            </label>
          ))}
        </div>
      )}
      {change.isError && <p className="mt-3 text-sm text-red-600">Couldn’t change — you may need the “manage content items” permission.</p>}
    </Modal>
  );
}


/**
 * Split "+ Item" button: the left half creates a single item; the chevron opens
 * a menu (Add multiple items · Add folder · Export all items). Those three are
 * unbuilt features (bulk create, folders, export), so they're present but
 * disabled — the surface is mirrored without inventing behavior.
 */
function NewItemButton({ projectId, onCreated }: { projectId: string; onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  return (
    <div ref={ref} className="relative flex">
      <button type="button" onClick={() => setOpen(true)}
              className="flex items-center gap-2 rounded-l-md border-r border-green-700 bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700">
        <span className="text-lg leading-none">+</span> Item
      </button>
      <button type="button" onClick={() => setMenu((v) => !v)} title="More"
              className="grid w-8 place-items-center rounded-r-md bg-green-600 text-white hover:bg-green-700">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6" /></svg>
      </button>

      {menu && (
        <div className="absolute right-0 top-full z-20 mt-1 w-60 rounded-lg border border-slate-200 bg-white py-1.5 shadow-xl">
          <ItemMenuOpt label="Add multiple items"
                       icon={<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="5" width="14" height="16" rx="2" /><path d="M21 7v12a2 2 0 0 1-2 2h-9M8 11h4M10 9v4" /></svg>} />
          <ItemMenuOpt label="Add folder"
                       icon={<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>} />
          <ItemMenuOpt label="Export all items"
                       icon={<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M17 18a4 4 0 0 0 0-8 5 5 0 0 0-9.6-1.3A3.5 3.5 0 0 0 7 18z" /></svg>} />
        </div>
      )}

      {open && (
        <CreateItemDialog projectId={projectId} onClose={() => setOpen(false)}
                          onCreated={(id) => { setOpen(false); onCreated(id); }} />
      )}
    </div>
  );
}

/** Disabled item-menu option — the underlying feature isn't built yet. */
function ItemMenuOpt({ label, icon }: { label: string; icon: React.ReactNode }) {
  return (
    <button type="button" disabled title="Coming soon"
            className="flex w-full cursor-not-allowed items-center gap-3 px-4 py-2.5 text-left text-[14px] text-slate-400">
      {icon}
      {label}
      <span className="ml-auto rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">Soon</span>
    </button>
  );
}

/** Sortable column header — shows ↕ when inactive, ↑/↓ when it's the active sort. */
function SortTh({
  label, sortKey, sort, onSort,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: 'asc' | 'desc' } | null;
  onSort: (key: SortKey) => void;
}) {
  const active = sort?.key === sortKey;
  return (
    <th className="px-4 py-3 font-semibold">
      <button type="button" onClick={() => onSort(sortKey)}
              className="inline-flex items-center gap-1 hover:text-slate-900">
        {label}
        <SortIcon active={active} dir={active ? sort!.dir : undefined} />
      </button>
    </th>
  );
}

function SortIcon({ active, dir }: { active: boolean; dir?: 'asc' | 'desc' }) {
  // Inactive arrows are a clearly-visible slate; the active direction turns blue.
  const up = active && dir === 'asc' ? '#2563eb' : '#64748b';
  const down = active && dir === 'desc' ? '#2563eb' : '#64748b';
  return (
    <svg width="12" height="15" viewBox="0 0 12 15" aria-hidden>
      <path d="M6 0L9.5 4.5H2.5z" fill={up} />
      <path d="M6 15L2.5 10.5h7z" fill={down} />
    </svg>
  );
}

