import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type AssignmentInfo, type AssignmentStatus } from '../lib/api';
import { toast } from '../lib/toast';
import { avatarColor, avatarInitial } from '../lib/avatar';

type Member = AssignmentInfo['members'][number];
type RowState = { assignees: Set<string>; dueAt: string | null };

/**
 * "Assigned people and due dates" — set responsible people + a due date per
 * workflow status (matching the reference). The people picker is a searchable,
 * role-grouped dropdown filtered to each status's reviewing roles, so it scales
 * when a role has many members (the old checkbox grid overflowed). Terminal
 * statuses take neither people nor a due date. Gated by
 * `manage_people_and_deadlines` (the API + RLS enforce it).
 */
export function AssignDialog({
  itemId, itemName, onClose,
}: {
  itemId: string;
  itemName: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  // Always refetch on open so newly-added members or reviewing-role changes show
  // immediately (a stale cache must never hide an assignable person).
  const info = useQuery({
    queryKey: ['assignment', itemId],
    queryFn: () => api.getAssignmentInfo(itemId),
    refetchOnMount: 'always',
  });

  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [openPicker, setOpenPicker] = useState<string | null>(null);

  useEffect(() => {
    if (!info.data) return;
    const init: Record<string, RowState> = {};
    for (const s of info.data.statuses) {
      init[s.id] = { assignees: new Set(s.assignees.map((a) => a.id)), dueAt: s.due_at ? s.due_at.slice(0, 10) : null };
    }
    setRows(init);
  }, [info.data]);

  const data = info.data;
  const currentPos = useMemo(() => {
    if (!data?.currentStatusId) return -1;
    return data.statuses.find((s) => s.id === data.currentStatusId)?.position ?? -1;
  }, [data]);

  const memberById = useMemo(() => {
    const m = new Map<string, Member>();
    (data?.members ?? []).forEach((x) => m.set(x.id, x));
    return m;
  }, [data]);

  const toggle = (statusId: string, pid: string) =>
    setRows((prev) => {
      const set = new Set(prev[statusId]?.assignees);
      set.has(pid) ? set.delete(pid) : set.add(pid);
      return { ...prev, [statusId]: { ...prev[statusId]!, assignees: set } };
    });
  const setDue = (statusId: string, due: string | null) =>
    setRows((prev) => ({ ...prev, [statusId]: { ...prev[statusId]!, dueAt: due } }));

  const save = useMutation({
    mutationFn: async () => {
      for (const s of data!.statuses) {
        if (s.is_terminal) continue;
        const before = new Set(s.assignees.map((a) => a.id));
        const beforeDue = s.due_at ? s.due_at.slice(0, 10) : null;
        const now = rows[s.id];
        if (!now) continue;
        const idsChanged = before.size !== now.assignees.size || [...now.assignees].some((id) => !before.has(id));
        const dueChanged = (beforeDue ?? null) !== (now.dueAt ?? null);
        if (idsChanged || dueChanged) {
          await api.setStatusAssignees(itemId, s.id, [...now.assignees], now.dueAt ? new Date(now.dueAt).toISOString() : null);
        }
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['assignment', itemId] });
      void qc.invalidateQueries({ queryKey: ['item', itemId] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
    onError: () => toast('Could not save — you may need the “manage people & deadlines” permission.'),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-6"
         onMouseDown={(e) => { e.stopPropagation(); onClose(); }}
         onClick={(e) => e.stopPropagation()}>
      <div onMouseDown={(e) => { e.stopPropagation(); setOpenPicker(null); }}
           className="flex max-h-[90vh] w-[1000px] max-w-full flex-col rounded-lg bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 px-8 pt-7">
          <div>
            <h2 className="text-[24px] font-semibold text-slate-900">
              Assigned people and due dates <span className="font-normal text-slate-400">— {itemName}</span>
            </h2>
            <p className="mt-2 text-[15px] text-slate-500">
              You can set or remove assigned people and due dates for each individual status. Note that previously existing data will be overridden.
            </p>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded text-slate-500 hover:bg-slate-100">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
          {info.isLoading || !data ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : (
            <div className="overflow-hidden rounded-md border border-slate-200">
              <table className="w-full border-collapse text-[15px]">
                <thead>
                  <tr className="bg-blue-50 text-slate-800">
                    <th className="w-[280px] px-5 py-3 text-center font-semibold">Status</th>
                    <th className="px-5 py-3 text-center font-semibold">Responsible</th>
                    <th className="w-[220px] px-5 py-3 text-center font-semibold">Due date</th>
                  </tr>
                </thead>
                <tbody>
                  {data.statuses.map((s) => {
                    const isCurrent = s.id === data.currentStatusId;
                    const isComplete = currentPos >= 0 && s.position < currentPos;
                    const row = rows[s.id] ?? { assignees: new Set<string>(), dueAt: null };
                    return (
                      <tr key={s.id} className={`border-t border-slate-200 align-middle ${isCurrent ? 'bg-slate-50' : ''}`}>
                        {/* Status */}
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2.5">
                            <StatusMarker color={s.color} isComplete={isComplete} />
                            <span className={isCurrent ? 'font-semibold text-slate-900' : 'text-slate-700'}>{s.name}</span>
                          </div>
                        </td>

                        {/* Responsible */}
                        <td className="px-5 py-4">
                          {s.is_terminal ? null : (
                            <ResponsibleCell
                              status={s}
                              selected={row.assignees}
                              members={data.members}
                              memberById={memberById}
                              pickerOpen={openPicker === s.id}
                              onOpenPicker={() => setOpenPicker((c) => (c === s.id ? null : s.id))}
                              onToggle={(pid) => toggle(s.id, pid)}
                            />
                          )}
                        </td>

                        {/* Due date */}
                        <td className="px-5 py-4">
                          {s.is_terminal ? null : (
                            <DueDateCell value={row.dueAt} onChange={(d) => setDue(s.id, d)} />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <footer className="flex justify-end gap-3 px-8 py-5">
          <button type="button" onClick={onClose}
                  className="rounded-md bg-slate-100 px-6 py-2.5 text-sm font-semibold uppercase tracking-wide text-slate-700 hover:bg-slate-200">Cancel</button>
          <button type="button" disabled={!data || save.isPending} onClick={() => save.mutate()}
                  className="rounded-md bg-green-500 px-8 py-2.5 text-sm font-semibold uppercase tracking-wide text-white hover:bg-green-600 disabled:opacity-40">
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function StatusMarker({ color, isComplete }: { color: string; isComplete: boolean }) {
  return (
    <span className="grid h-[19px] w-[19px] shrink-0 place-items-center rounded-full"
          style={isComplete ? { background: color } : { border: `2.5px solid ${color}`, background: 'white' }}>
      {isComplete && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4"><path d="M20 6 9 17l-5-5" /></svg>}
    </span>
  );
}

function ResponsibleCell({
  status, selected, members, memberById, pickerOpen, onOpenPicker, onToggle,
}: {
  status: AssignmentStatus;
  selected: Set<string>;
  members: Member[];
  memberById: Map<string, Member>;
  pickerOpen: boolean;
  onOpenPicker: () => void;
  onToggle: (pid: string) => void;
}) {
  const chosen = [...selected].map((id) => memberById.get(id)).filter(Boolean) as Member[];
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const fieldRef = useRef<HTMLDivElement>(null);

  // One input-like field: chips inline, placeholder when empty; clicking anywhere
  // (except a chip's ✕) opens the picker to add more. Stop mousedown too, or the
  // modal's "close picker on mousedown" unmounts an option before its click fires.
  return (
    <div className="relative" onClick={stop} onMouseDown={stop}>
      <div ref={fieldRef} role="button" tabIndex={0} onClick={onOpenPicker}
           className="flex min-h-[46px] w-full cursor-pointer flex-wrap items-center gap-2 rounded-md border border-slate-300 px-2.5 py-2 hover:bg-slate-50">
        {chosen.map((m) => (
          <span key={m.id} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 py-0.5 pl-0.5 pr-2 text-[14px] text-slate-700">
            <Avatar name={m.name} size={22} />
            {m.name}
            <span role="button" tabIndex={0} title="Remove"
                  onClick={(e) => { e.stopPropagation(); onToggle(m.id); }}
                  className="cursor-pointer text-slate-400 hover:text-red-600">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </span>
          </span>
        ))}
        {/* Placeholder when empty; a "+ Add" affordance after existing chips. */}
        <span className="text-[15px] text-slate-400">{chosen.length === 0 ? '+ Assign team member' : '+ Add'}</span>
      </div>

      {pickerOpen && (
        <PeoplePicker anchor={fieldRef.current} status={status} members={members} selected={selected} onToggle={onToggle} />
      )}
    </div>
  );
}

function PeoplePicker({
  anchor, status, members, selected, onToggle,
}: {
  anchor: HTMLElement | null;
  status: AssignmentStatus;
  members: Member[];
  selected: Set<string>;
  onToggle: (pid: string) => void;
}) {
  const [q, setQ] = useState('');

  // Only members whose role is a reviewing role for this status, matching search.
  const groups = useMemo(() => {
    const query = q.trim().toLowerCase();
    const eligible = members.filter(
      (m) => status.reviewing_role_ids.includes(m.role_id) && (!query || m.name.toLowerCase().includes(query)),
    );
    const out: { role: string; people: Member[] }[] = [];
    for (const m of eligible) {
      let g = out.find((x) => x.role === m.role_name);
      if (!g) { g = { role: m.role_name, people: [] }; out.push(g); }
      g.people.push(m);
    }
    return out;
  }, [members, status.reviewing_role_ids, q]);

  // Rendered in a portal at a fixed position under the field — the modal body
  // has overflow-y scrolling, which would clip an absolutely-positioned dropdown
  // for lower rows (hiding groups below the fold). Its own max-height + scroll
  // handles long member lists.
  if (!anchor) return null;
  const r = anchor.getBoundingClientRect();
  return createPortal(
    <div style={{ position: 'fixed', left: r.left, top: r.bottom + 4, width: r.width, zIndex: 60 }}
         onMouseDown={(e) => e.stopPropagation()}
         className="max-h-[340px] overflow-y-auto rounded-md border border-slate-200 bg-white shadow-xl">
      <div className="sticky top-0 border-b border-slate-100 bg-white p-2">
        <div className="relative">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name"
                 className="h-10 w-full rounded-md border border-slate-300 pl-3 pr-9 text-[14px] focus:border-blue-500 focus:outline-none" />
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="px-4 py-6 text-center text-[14px] text-slate-400">
          {members.some((m) => status.reviewing_role_ids.includes(m.role_id))
            ? 'No matches.'
            : 'No members have a reviewing role for this status.'}
        </p>
      ) : (
        groups.map((g) => (
          <div key={g.role} className="py-1">
            <p className="px-4 pb-1 pt-2 text-[13px] font-medium text-slate-400">{g.role}</p>
            {g.people.map((m) => {
              const on = selected.has(m.id);
              return (
                <button key={m.id} type="button" onClick={() => onToggle(m.id)}
                        className={`flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-50 ${on ? 'bg-blue-50/60' : ''}`}>
                  <Avatar name={m.name} size={34} />
                  <span className="flex-1 text-[15px] font-medium text-slate-800">{m.name}</span>
                  {on && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-blue-600"><path d="M20 6 9 17l-5-5" /></svg>}
                </button>
              );
            })}
          </div>
        ))
      )}
    </div>,
    document.body,
  );
}

function DueDateCell({ value, onChange }: { value: string | null; onChange: (d: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  // Open the native calendar directly on click (showPicker), falling back to
  // focus on older browsers. mousedown is stopped so the modal's picker-close
  // handler doesn't swallow the interaction.
  const open = () => {
    const el = ref.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!el) return;
    el.focus();
    try { el.showPicker?.(); } catch { /* not supported — the focused input still works */ }
  };
  return (
    <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
      <input
        ref={ref}
        type="date"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className={`w-full rounded-md border border-slate-300 px-3 py-2.5 text-[15px] focus:border-blue-500 focus:outline-none ${value ? 'text-slate-700' : 'text-transparent'}`}
      />
      {!value && (
        <button type="button" onClick={open}
                className="absolute inset-0 flex items-center rounded-md px-3 text-left text-[15px] text-slate-400 hover:bg-slate-50">
          Set due date
        </button>
      )}
    </div>
  );
}

function Avatar({ name, size }: { name: string; size: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full font-semibold text-white"
          style={{ width: size, height: size, background: avatarColor(name), fontSize: size * 0.4 }}>
      {avatarInitial(name)}
    </span>
  );
}
