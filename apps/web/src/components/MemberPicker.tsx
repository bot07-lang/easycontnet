import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { toast } from '../lib/toast';
import { initials, avatarColor } from '../lib/avatar';

/**
 * The dashed "add member" circle on a project card: a compact popover over
 * the same full org-user checklist as Project Settings' "Assigned users"
 * (same PATCH /projects/:id/members, same full-replace semantics), so you
 * can add someone to a project without leaving the grid.
 */
export function MemberPickerButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  const settings = useQuery({
    queryKey: ['project-settings', projectId],
    queryFn: () => api.getProjectSettings(projectId),
    enabled: open,
  });
  const users = useQuery({ queryKey: ['users'], queryFn: api.listUsers, enabled: open });

  useEffect(() => {
    if (settings.data && selected === null) setSelected(new Set(settings.data.memberIds));
  }, [settings.data, selected]);

  // Whenever the popover closes — via the toggle button, an outside click, or
  // a successful save — drop the local selection so the next open re-syncs
  // from a fresh fetch instead of showing what could now be stale state.
  useEffect(() => {
    if (!open) { setSelected(null); return; }
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const save = useMutation({
    mutationFn: () => api.setProjectMembers(projectId, [...(selected ?? [])]),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['project-dashboard', projectId] });
      qc.invalidateQueries({ queryKey: ['project-settings', projectId] });
      toast('Assigned users updated.');
      setOpen(false);
    },
    onError: () => toast('Could not update assigned users — you may not have permission.'),
  });

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev ?? []);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
              title="Add member"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-dashed border-slate-300
                         text-slate-400 hover:border-slate-400 hover:text-slate-600">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      {open && (
        <div onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
             className="absolute left-0 top-9 z-30 w-72 overflow-hidden rounded-md border border-slate-200 bg-white shadow-xl">
          <p className="border-b border-slate-100 px-3 py-2 text-[12px] font-medium text-slate-500">Assigned users</p>
          <div className="max-h-60 overflow-y-auto p-2">
            {(settings.isLoading || users.isLoading) && <p className="px-2 py-2 text-sm text-slate-400">Loading…</p>}
            {users.data?.map((u) => (
              <button key={u.id} type="button" onClick={() => toggle(u.id)}
                      className="flex w-full items-center gap-3 rounded px-2 py-2 text-left hover:bg-slate-50">
                <input type="checkbox" checked={selected?.has(u.id) ?? false} readOnly
                       className="h-[16px] w-[16px] accent-blue-600" />
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white"
                      style={{ background: avatarColor(u.full_name) }}>
                  {initials(u.full_name)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-slate-800">{u.full_name}</span>
                <span className="shrink-0 text-[11px] text-slate-400">{u.role_name}</span>
              </button>
            ))}
          </div>
          <div className="flex justify-end border-t border-slate-100 p-2">
            <button type="button" disabled={save.isPending || selected === null} onClick={() => save.mutate()}
                    className="rounded-md bg-green-600 px-4 py-1.5 text-[13px] font-semibold text-white
                               hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40">
              {save.isPending ? 'Saving…' : 'Confirm'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

