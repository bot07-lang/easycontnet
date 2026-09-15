import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type OrgUser } from '../lib/api';
import { toast } from '../lib/toast';
import { ConfirmDialog } from './AllProjects';

/**
 * The real EasyContent's Project Settings page: rename, delete, and the
 * "Assigned users" checklist (every org user, grouped by role, checked if
 * they're currently a project member). Rename and delete already had working
 * endpoints; the checklist needed a new one — project_members has no
 * insert/delete policy for the authenticated role, so membership can only be
 * written through api_set_project_members (SECURITY DEFINER), same pattern
 * as api_create_project.
 */
export function ProjectSettingsPage({
  projectId,
  onBack,
  onDeleted,
}: {
  projectId: string;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ['project-settings', projectId],
    queryFn: () => api.getProjectSettings(projectId),
  });
  const users = useQuery({ queryKey: ['users'], queryFn: api.listUsers });

  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!settings.data) return;
    setName(settings.data.name);
    setSelected(new Set(settings.data.memberIds));
  }, [settings.data]);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['project-settings', projectId] });
    qc.invalidateQueries({ queryKey: ['project-dashboard', projectId] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['projects'] });
  };

  const rename = useMutation({
    mutationFn: () => api.renameProject(projectId, name.trim()),
    onSuccess: () => { invalidateAll(); toast('Project renamed.'); },
    onError: () => toast('Could not rename this project — you may not have permission.'),
  });

  const saveMembers = useMutation({
    mutationFn: () => api.setProjectMembers(projectId, [...selected]),
    onSuccess: () => { invalidateAll(); toast('Assigned users updated.'); },
    onError: () => toast('Could not update assigned users — you may not have permission.'),
  });

  const del = useMutation({
    mutationFn: () => api.deleteProject(projectId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dashboard'] }); qc.invalidateQueries({ queryKey: ['projects'] }); onDeleted(); },
    onError: () => { setConfirmDelete(false); toast('Could not delete this project — you may not have permission.'); },
  });

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = users.data ?? [];
    return q ? list.filter((u) => u.full_name.toLowerCase().includes(q)) : list;
  }, [users.data, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, OrgUser[]>();
    for (const u of filteredUsers) {
      if (!map.has(u.role_name)) map.set(u.role_name, []);
      map.get(u.role_name)!.push(u);
    }
    return [...map.entries()];
  }, [filteredUsers]);

  const allUsers = users.data ?? [];
  const allSelected = allUsers.length > 0 && allUsers.every((u) => selected.has(u.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(allUsers.map((u) => u.id)));

  if (settings.isLoading) return <p className="p-8 text-slate-400">Loading…</p>;
  if (settings.error) return <p className="p-8 text-red-600">Can’t reach the API. Is it running on :3001?</p>;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} title="Back to Dashboard"
                className="grid h-8 w-8 place-items-center rounded-full border border-slate-300 text-slate-500 hover:bg-slate-100">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        <h1 className="text-2xl font-semibold text-slate-900">Project Settings</h1>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="min-w-[240px] flex-1 rounded-md border border-slate-300 px-3 py-2.5 text-[15px]
                       focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
          <button type="button"
                  disabled={!name.trim() || rename.isPending || name.trim() === settings.data?.name}
                  onClick={() => rename.mutate()}
                  className="rounded-md border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700
                             hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
            {rename.isPending ? 'Renaming…' : 'RENAME'}
          </button>
          <button type="button" onClick={() => setConfirmDelete(true)}
                  className="rounded-md bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-700">
            DELETE PROJECT
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-4 text-[16px] font-semibold text-slate-900">
          Assigned users <span className="text-slate-400">({selected.size})</span>
        </h2>

        <div className="rounded-md border border-slate-200">
          <div className="border-b border-slate-200 p-3">
            <div className="relative">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…"
                     className="w-full rounded-md border border-slate-300 py-2 pl-3 pr-9 text-sm
                                focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                   className="pointer-events-none absolute right-3 top-2.5 text-slate-400">
                <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
              </svg>
            </div>
          </div>

          <div className="max-h-[420px] overflow-y-auto p-2">
            <button type="button" onClick={toggleAll}
                    className="flex w-full items-center gap-3 rounded px-2 py-2 text-left hover:bg-slate-50">
              <input type="checkbox" checked={allSelected} readOnly className="h-[18px] w-[18px] accent-blue-600" />
              <span className="text-[15px] font-medium text-slate-800">Select all</span>
            </button>

            {users.isLoading && <p className="px-2 py-2 text-sm text-slate-400">Loading…</p>}
            {!users.isLoading && filteredUsers.length === 0 && (
              <p className="px-2 py-4 text-sm text-slate-400">No users match.</p>
            )}

            {grouped.map(([role, list]) => (
              <div key={role}>
                <p className="px-2 pb-1 pt-3 text-[13px] text-slate-400">{role}</p>
                {list.map((u) => (
                  <UserRow key={u.id} user={u} checked={selected.has(u.id)} onToggle={() => toggle(u.id)} />
                ))}
              </div>
            ))}
          </div>
        </div>

        <button type="button" disabled={saveMembers.isPending} onClick={() => saveMembers.mutate()}
                className="mt-4 rounded-md bg-green-600 px-6 py-2.5 text-sm font-semibold text-white
                           hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40">
          {saveMembers.isPending ? 'Saving…' : 'CONFIRM'}
        </button>
      </section>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete project?"
          message={`"${settings.data?.name}" and all its content will be permanently deleted. This cannot be undone.`}
          confirmLabel={del.isPending ? 'Deleting…' : 'Delete'}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => del.mutate()}
        />
      )}
    </div>
  );
}

function UserRow({ user, checked, onToggle }: { user: OrgUser; checked: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle}
            className="flex w-full items-center gap-3 rounded px-2 py-2 text-left hover:bg-slate-50">
      <input type="checkbox" checked={checked} readOnly className="h-[18px] w-[18px] accent-blue-600" />
      <span className="grid h-7 w-7 place-items-center rounded-full text-[10px] font-semibold text-white"
            style={{ background: avatarColor(user.full_name) }}>
        {initials(user.full_name)}
      </span>
      <span className="truncate text-[15px] text-slate-800">{user.full_name}</span>
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
