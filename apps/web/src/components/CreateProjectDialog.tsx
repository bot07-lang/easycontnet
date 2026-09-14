import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type OrgUser } from '../lib/api';
import { toast } from '../lib/toast';

/**
 * Create-a-new-project dialog: a required name and an optional multi-select of
 * users to assign. The creator is always added by the backend; RLS + the
 * manage_projects check gate the whole thing.
 */
export function CreateProjectDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (projectId: string) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const users = useQuery({ queryKey: ['users'], queryFn: api.listUsers });

  const create = useMutation({
    mutationFn: () => api.createProject(name.trim(), [...selected]),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      onCreated(res.id);
    },
    onError: () => toast('Could not create this project — you may not have permission.'),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!pickerOpen) return;
    const close = (e: MouseEvent) => {
      if (!pickerRef.current?.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [pickerOpen]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const selectedUsers = (users.data ?? []).filter((u) => selected.has(u.id));

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4"
         onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()}
           className="w-[560px] max-w-full rounded-lg bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-[19px] font-semibold text-slate-900">Create a new project</h2>
          <button type="button" onClick={onClose} aria-label="Close"
                  className="grid h-8 w-8 place-items-center rounded text-slate-500 hover:bg-slate-100">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="px-6 py-5">
          <label className="mb-5 block">
            <span className="mb-1.5 block text-[14px] font-medium text-slate-700">Project name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Project name"
              className="w-full rounded-md border border-slate-300 px-3 py-2.5 text-[15px]
                         focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </label>

          <div ref={pickerRef} className="relative">
            <span className="mb-1.5 block text-[14px] text-slate-500">
              Assign users to your new project (optional)
            </span>
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-300
                         px-3 py-2.5 text-left text-[15px] text-slate-700 hover:bg-slate-50"
            >
              <span className="truncate">
                {selectedUsers.length === 0
                  ? 'Select users…'
                  : selectedUsers.map((u) => u.full_name).join(', ')}
              </span>
              <span className="text-[10px] text-slate-500">▾</span>
            </button>

            {pickerOpen && (
              <div className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border
                              border-slate-200 bg-white py-1 shadow-xl">
                {users.isLoading && <p className="px-3 py-2 text-sm text-slate-400">Loading…</p>}
                {users.data?.map((u) => (
                  <UserRow key={u.id} user={u} checked={selected.has(u.id)} onToggle={() => toggle(u.id)} />
                ))}
              </div>
            )}
          </div>

          {create.isError && (
            <p className="mt-3 text-sm text-red-600">
              Couldn’t create the project. You may not have permission.
            </p>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <button type="button" onClick={onClose}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="button"
            disabled={!name.trim() || create.isPending}
            onClick={() => create.mutate()}
            className="rounded-md bg-green-600 px-5 py-2 text-sm font-semibold text-white
                       hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {create.isPending ? 'Creating…' : 'Create project'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function UserRow({ user, checked, onToggle }: { user: OrgUser; checked: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle}
            className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50">
      <input type="checkbox" checked={checked} readOnly className="h-[18px] w-[18px] accent-blue-600" />
      <span className="grid h-7 w-7 place-items-center rounded-full text-[10px] font-semibold text-white"
            style={{ background: avatarColor(user.full_name) }}>
        {initials(user.full_name)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[15px] text-slate-800">{user.full_name}</span>
        <span className="block truncate text-[12px] text-slate-500">{user.role_name}</span>
      </span>
    </button>
  );
}

function initials(name: string) {
  return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}
function avatarColor(name: string) {
  const palette = ['#e11d48', '#7c3aed', '#0891b2', '#ea580c', '#059669', '#4f46e5', '#db2777'];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length]!;
}
