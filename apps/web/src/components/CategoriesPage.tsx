import { useEffect, useState } from 'react';
import { getProjectCategories, setProjectCategories } from '../lib/categories-store';

interface Cat { id: string; name: string }

/**
 * Categories page (CONFIG › Categories). Categories have no backend yet, so this
 * is frontend-only: the empty state matches the reference, and once categories
 * exist they list with drag-to-reorder, inline Edit and delete. Persistence lands
 * with the backend model.
 */
export function CategoriesPage({ projectId }: { projectId: string }) {
  // `cats` only ever loads from the store in the useState initializer (once per
  // mount) and every change writes straight back to `projectId` — so this relies
  // on the caller remounting the component (key={projectId}) when the project
  // changes. Without that, switching projects on the sidebar while this stays
  // mounted would keep showing/editing the OLD project's categories and then
  // overwrite the NEW project's stored list with them.
  const [cats, setCats] = useState<Cat[]>(() => getProjectCategories(projectId).map((name) => ({ id: crypto.randomUUID(), name })));
  // Persist names to the shared store so the item editor's picker sees them.
  useEffect(() => { setProjectCategories(projectId, cats.map((c) => c.name)); }, [cats, projectId]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);

  const add = () => {
    const v = name.trim();
    if (v) setCats((c) => [...c, { id: crypto.randomUUID(), name: v }]);
    setName('');
    setAdding(false);
  };
  const saveEdit = () => {
    const v = editName.trim();
    if (v) setCats((c) => c.map((x) => (x.id === editId ? { ...x, name: v } : x)));
    setEditId(null);
  };
  const reorder = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    setCats((cur) => {
      const from = cur.findIndex((c) => c.id === dragId);
      const to = cur.findIndex((c) => c.id === targetId);
      if (from < 0 || to < 0) return cur;
      const next = [...cur];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return next;
    });
    setDragId(null);
  };

  return (
    <div className="mx-auto max-w-[1100px]">
      <div className="mb-1 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold text-slate-900">Categories</h1>
        {cats.length > 0 && (
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={() => setAdding(true)}
                    className="inline-flex items-center gap-2 rounded-md bg-green-600 px-4 py-2 text-[13px] font-semibold uppercase tracking-wide text-white hover:bg-green-700">
              <span className="text-base leading-none">+</span> Add category
            </button>
            <button type="button" onClick={() => setCats([])}
                    className="rounded-md border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold uppercase tracking-wide text-slate-700 hover:bg-slate-50">
              Delete all
            </button>
          </div>
        )}
      </div>
      <p className="mb-5 text-[15px] text-slate-500">
        {cats.length > 0
          ? 'We use categories to classify content. Drag & drop to rearrange items.'
          : 'Create new categories or import them from your website.'}
      </p>

      <div className="rounded-lg border border-slate-200 bg-white">
        {cats.length === 0 ? (
          <div className="grid place-items-center px-6 py-20 text-center">
            <svg width="150" height="150" viewBox="0 0 24 24" fill="none" stroke="#c7d2fe" strokeWidth="1.4" strokeLinejoin="round">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <path d="M12 9v4" strokeWidth="2" strokeLinecap="round" /><path d="M12 17h.01" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <h2 className="mt-6 text-[26px] font-normal text-slate-500">This project doesn’t have any categories yet</h2>
            <p className="mt-3 text-[20px] text-slate-500">Create new categories or import them from your website</p>
            <p className="mt-5 max-w-2xl text-[15px] text-slate-500">
              After you create categories, you can then assign your content items to those categories.
            </p>
            <p className="mt-2 max-w-3xl text-[15px] text-slate-500">
              Your writers will be able to use category filter to select content items in the categories they are most familiar with.
            </p>
            <button type="button" onClick={() => setAdding(true)}
                    className="mt-8 inline-flex items-center gap-2 rounded-md bg-green-600 px-6 py-3 text-[14px] font-semibold uppercase tracking-wide text-white hover:bg-green-700">
              <span className="text-lg leading-none">+</span> Add your first category
            </button>
          </div>
        ) : (
          <div className="space-y-2 p-4">
            {cats.map((c) => (
              <div
                key={c.id}
                draggable={editId !== c.id}
                onDragStart={() => setDragId(c.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => reorder(c.id)}
                className={`flex items-center gap-3 rounded ${dragId === c.id ? 'opacity-50' : ''}`}
              >
                <span className="cursor-grab select-none text-slate-400" title="Drag to rearrange">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 8h16M4 16h16" /></svg>
                </span>
                {editId === c.id ? (
                  <input
                    autoFocus value={editName} onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditId(null); }}
                    onBlur={saveEdit}
                    className="w-[360px] max-w-full rounded-md border border-blue-500 bg-white px-3 py-2 text-[15px] focus:outline-none"
                  />
                ) : (
                  // Plain text, not input-styled — this is read-only display;
                  // the separate Edit button is the only way to change it, so
                  // a bordered/filled "field" look would suggest otherwise.
                  <span className="w-[360px] max-w-full px-3 py-2 text-[15px] text-slate-800">
                    {c.name}
                  </span>
                )}
                <button type="button" onClick={() => { setEditId(c.id); setEditName(c.name); }}
                        className="rounded-md border border-slate-300 bg-white px-4 py-2 text-[13px] font-semibold uppercase tracking-wide text-slate-700 hover:bg-slate-50">
                  Edit
                </button>
                <button type="button" onClick={() => setCats((cur) => cur.filter((x) => x.id !== c.id))}
                        title="Delete category"
                        className="grid h-9 w-9 place-items-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" /></svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {adding && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" onMouseDown={() => setAdding(false)}>
          <div className="w-[420px] max-w-full rounded-lg bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
            <header className="border-b border-slate-200 px-6 py-4">
              <h2 className="text-[18px] font-semibold text-slate-900">Add category</h2>
            </header>
            <div className="px-6 py-5">
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
                     onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) add(); }}
                     placeholder="Category name"
                     className="w-full rounded-md border border-slate-300 px-3 py-2.5 text-[15px] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
            </div>
            <footer className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
              <button type="button" onClick={() => setAdding(false)}
                      className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" disabled={!name.trim()} onClick={add}
                      className="rounded-md bg-green-600 px-5 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-40">Add</button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
