import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type WorkflowConfig, type WorkflowStatus } from '../lib/api';

/**
 * The per-project Workflow settings page (CONFIG → Workflow). Three sections,
 * mirroring the reference:
 *   1. The status ladder — a matrix of reviewing roles per status, plus auto
 *      due, read-only, and default assignees, each row editable.
 *   2. Additional Settings — auto-complete on publish (disabled: WordPress
 *      publishing isn't built yet).
 *   3. Ratings — the 5-star criteria reviewers are prompted for on approval
 *      (read-only display for now).
 *
 * Everything is scoped to one project: each project owns its own ladder and
 * they never propagate between projects.
 */
export function WorkflowSettings({ projectId }: { projectId: string }) {
  const wf = useQuery({
    queryKey: ['workflow', projectId],
    queryFn: () => api.getWorkflow(projectId),
  });
  const [editing, setEditing] = useState<WorkflowStatus | null>(null);

  if (wf.isLoading) return <p className="text-sm text-slate-400">Loading…</p>;
  if (wf.isError || !wf.data) return <p className="text-sm text-red-600">Couldn’t load the workflow.</p>;

  const data = wf.data;

  return (
    <div className="mx-auto max-w-[1200px]">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Workflow</h1>
        <a href="https://easycontent.io/help-article/workflow" target="_blank" rel="noreferrer"
           className="text-sm text-blue-600 hover:underline">Learn more about Workflow</a>
      </div>

      <StatusTable data={data} onEdit={setEditing} />

      <AdditionalSettings autoComplete={data.auto_complete_on_publish} />

      <Ratings data={data} />

      {editing && (
        <EditStatusDialog projectId={projectId} status={editing} roles={data.roles}
                          members={data.members} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function StatusTable({ data, onEdit }: { data: WorkflowConfig; onEdit: (s: WorkflowStatus) => void }) {
  const roles = data.roles;
  return (
    <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="border-b border-slate-200 px-3 py-2" />
              <th colSpan={roles.length} className="border-b border-l border-slate-200 px-3 py-2 text-center text-[15px] font-semibold text-slate-800">
                Reviewing roles
              </th>
              <th colSpan={4} className="border-b border-l border-slate-200" />
            </tr>
            <tr className="text-slate-600">
              <th className="border-b border-slate-200 px-3 py-3 text-left font-semibold">Status</th>
              {roles.map((r) => (
                <th key={r.id} title={r.name}
                    className="border-b border-l border-slate-200 px-2 py-3 text-center font-medium">
                  <span className="block max-w-[52px] truncate">{r.name}</span>
                </th>
              ))}
              <th className="border-b border-l border-slate-200 px-3 py-3 text-left font-medium">
                <HeaderWithHelp label="Auto due" help="Automatically set a due date this many days after an item enters this status." />
              </th>
              <th className="border-b border-slate-200 px-3 py-3 text-left font-medium">
                <HeaderWithHelp label="Read-only" help="Items in this status cannot be edited by anyone, regardless of permissions." />
              </th>
              <th className="border-b border-slate-200 px-3 py-3 text-left font-medium">
                <HeaderWithHelp label="Default assignees" help="Users automatically assigned when an item enters this status." />
              </th>
              <th className="border-b border-slate-200 px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {data.statuses.map((s) => (
              <tr key={s.id} className="align-middle">
                <td className="border-b border-slate-100 px-3 py-3">
                  <div className="flex items-center gap-2">
                    {/* Initial and terminal statuses are pinned — no drag handle. */}
                    {s.is_initial || s.is_terminal ? (
                      <span className="w-3.5" />
                    ) : (
                      <span className="cursor-grab select-none text-slate-300" title="Drag to reorder">⋮⋮</span>
                    )}
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: s.color }} />
                    <span className="font-medium text-slate-800">{s.name}</span>
                  </div>
                </td>

                {roles.map((r) => {
                  const checked = s.reviewing_role_ids.includes(r.id);
                  // Terminal status has no reviewing roles at all.
                  return (
                    <td key={r.id} className="border-b border-l border-slate-100 px-2 py-3 text-center">
                      {s.is_terminal ? null : (
                        <input type="checkbox" checked={checked} readOnly
                               className="h-4 w-4 accent-slate-500" />
                      )}
                    </td>
                  );
                })}

                <td className="border-b border-l border-slate-100 px-3 py-3 text-slate-600">
                  {s.is_terminal ? null : s.auto_due_days ? `${s.auto_due_days} day${s.auto_due_days > 1 ? 's' : ''}` : '-'}
                </td>
                <td className="border-b border-slate-100 px-3 py-3">
                  {s.is_terminal ? null : s.read_only ? (
                    <span className="inline-flex items-center gap-1 text-slate-600" title="Read-only">
                      <LockIcon /> On
                    </span>
                  ) : <span className="text-slate-400">-</span>}
                </td>
                <td className="border-b border-slate-100 px-3 py-3">
                  {s.is_terminal ? null : s.default_assignees.length === 0 ? (
                    <span className="text-slate-400">-</span>
                  ) : (
                    <span className="flex -space-x-2">
                      {s.default_assignees.slice(0, 4).map((a) => (
                        <span key={a.id} title={a.name}
                              className="grid h-6 w-6 place-items-center rounded-full border-2 border-white text-[10px] font-semibold text-white"
                              style={{ background: avatarColor(a.name) }}>{initials(a.name)}</span>
                      ))}
                    </span>
                  )}
                </td>
                <td className="border-b border-slate-100 px-3 py-3 text-right">
                  <button type="button" onClick={() => onEdit(s)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                    <PencilIcon /> Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button type="button" disabled title="Coming soon"
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-emerald-600/50 px-5 py-2.5 text-sm font-semibold uppercase tracking-wide text-white opacity-60">
        <span className="text-lg leading-none">+</span> Add new status
      </button>
    </section>
  );
}

function AdditionalSettings({ autoComplete }: { autoComplete: boolean }) {
  return (
    <section className="mb-6 rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="mb-3 text-[17px] font-semibold text-slate-800">Additional Settings</h2>
      <label className="flex items-center gap-3 text-[15px] text-slate-400" title="Requires WordPress publishing (coming soon)">
        <input type="checkbox" checked={autoComplete} disabled className="h-4 w-4 accent-blue-600" />
        Automatically mark assignment as <span className="font-semibold">Completed</span> after it’s published to WordPress
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-400">Coming soon</span>
      </label>
    </section>
  );
}

function Ratings({ data }: { data: WorkflowConfig }) {
  return (
    <section className="mb-6 rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="mb-1.5 text-[17px] font-semibold text-slate-800">Ratings</h2>
      <p className="mb-4 text-sm text-slate-500">
        If you want your reviewers to be prompted to leave 5-star ratings when approving content, add them below.
      </p>

      {data.ratings.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead className="text-slate-600">
            <tr className="border-b border-slate-200">
              <th className="py-2 pr-4 font-semibold">Name</th>
              <th className="py-2 pr-4 font-semibold">Description</th>
              <th className="py-2 pr-4 font-semibold">Workflow status</th>
              <th className="py-2 pr-4 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.ratings.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 align-top">
                <td className="py-3 pr-4 font-semibold text-slate-800">{r.name}</td>
                <td className="py-3 pr-4 text-slate-600">{r.description}</td>
                <td className="py-3 pr-4">
                  <span className="inline-flex items-center gap-2 text-slate-700">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.status_color }} />
                    {r.status_name}
                  </span>
                </td>
                <td className="py-3 pr-4 text-right">
                  <button type="button" disabled title="Coming soon"
                          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-400">
                    <PencilIcon /> Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <button type="button" disabled title="Coming soon"
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-emerald-600/50 px-5 py-2.5 text-sm font-semibold uppercase tracking-wide text-white opacity-60">
        <span className="text-lg leading-none">+</span> Add new field
      </button>
    </section>
  );
}

const SWATCHES = ['#22C55E', '#EC4899', '#F59E0B', '#6366F1', '#0EA5E9', '#EF4444', '#9CA3AF', '#14B8A6'];

function EditStatusDialog({
  projectId, status, roles, members, onClose,
}: {
  projectId: string;
  status: WorkflowStatus;
  roles: WorkflowConfig['roles'];
  members: WorkflowConfig['members'];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const terminal = status.is_terminal;
  const [name, setName] = useState(status.name);
  const [color, setColor] = useState(status.color.toUpperCase());
  const [autoDue, setAutoDue] = useState<string>(status.auto_due_days?.toString() ?? '');
  const [readOnly, setReadOnly] = useState(status.read_only);
  const [roleIds, setRoleIds] = useState<Set<string>>(new Set(status.reviewing_role_ids));
  const [assignees, setAssignees] = useState<Set<string>>(new Set(status.default_assignees.map((a) => a.id)));

  const save = useMutation({
    mutationFn: async () => {
      await api.updateStatus(status.id, {
        name: name.trim(),
        color,
        autoDueDays: autoDue.trim() === '' ? null : Number(autoDue),
        readOnly,
        reviewingRoleIds: terminal ? [] : [...roleIds],
      });
      // Default assignees are a separate permission; only push if it changed.
      const before = new Set(status.default_assignees.map((a) => a.id));
      const changed = before.size !== assignees.size || [...assignees].some((id) => !before.has(id));
      if (changed && !terminal) await api.setDefaultAssignees(status.id, [...assignees]);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['workflow', projectId] });
      onClose();
    },
  });

  const toggle = (set: Set<string>, id: string, apply: (s: Set<string>) => void) => {
    const n = new Set(set); n.has(id) ? n.delete(id) : n.add(id); apply(n);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()}
           className="max-h-[90vh] w-[560px] max-w-full overflow-y-auto rounded-lg bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-[19px] font-semibold text-slate-900">Edit status</h2>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded text-slate-500 hover:bg-slate-100">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>

        <div className="space-y-5 px-6 py-5">
          <label className="block">
            <span className="mb-1.5 block text-[15px] font-medium text-slate-700">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)}
                   className="w-full rounded-md border border-slate-300 px-3 py-2.5 text-[15px] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
          </label>

          <div>
            <span className="mb-1.5 block text-[15px] font-medium text-slate-700">Color</span>
            <div className="flex flex-wrap items-center gap-2">
              {SWATCHES.map((c) => (
                <button key={c} type="button" onClick={() => setColor(c)}
                        className={`h-7 w-7 rounded-full ${color === c ? 'ring-2 ring-slate-800 ring-offset-2' : ''}`}
                        style={{ background: c }} title={c} />
              ))}
              <span className="ml-2 inline-flex items-center gap-2 text-sm text-slate-500">
                <span className="h-4 w-4 rounded-full" style={{ background: color }} /> {color}
              </span>
            </div>
          </div>

          {terminal ? (
            <p className="rounded-md bg-slate-50 px-3 py-3 text-sm text-slate-500">
              This is the final status — items here have come to rest, so it has no reviewing roles,
              auto due date, or assignees.
            </p>
          ) : (
            <>
              <div>
                <span className="mb-1.5 block text-[15px] font-medium text-slate-700">Reviewing roles</span>
                <p className="mb-2 text-[13px] text-slate-500">Roles that can claim or be assigned to items in this status.</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {roles.map((r) => (
                    <label key={r.id} className="flex items-center gap-2.5 rounded px-1 py-1 text-[15px] text-slate-800">
                      <input type="checkbox" checked={roleIds.has(r.id)}
                             onChange={() => toggle(roleIds, r.id, setRoleIds)}
                             className="h-4 w-4 accent-blue-600" />
                      {r.name}{!r.is_active && <span className="text-xs text-slate-400">(inactive)</span>}
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex gap-4">
                <label className="block flex-1">
                  <span className="mb-1.5 block text-[15px] font-medium text-slate-700">Auto due (days)</span>
                  <input value={autoDue} onChange={(e) => setAutoDue(e.target.value.replace(/[^\d]/g, ''))}
                         placeholder="None" inputMode="numeric"
                         className="w-full rounded-md border border-slate-300 px-3 py-2.5 text-[15px] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
                </label>
                <label className="flex flex-1 items-end gap-2.5 pb-2.5 text-[15px] text-slate-800">
                  <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)}
                         className="h-4 w-4 accent-blue-600" />
                  Read-only
                </label>
              </div>

              <div>
                <span className="mb-1.5 block text-[15px] font-medium text-slate-700">Default assignees</span>
                {members.length === 0 ? (
                  <p className="text-sm text-slate-400">No project members to assign yet.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-1.5">
                    {members.map((m) => (
                      <label key={m.id} className="flex items-center gap-2.5 rounded px-1 py-1 text-[15px] text-slate-800">
                        <input type="checkbox" checked={assignees.has(m.id)}
                               onChange={() => toggle(assignees, m.id, setAssignees)}
                               className="h-4 w-4 accent-blue-600" />
                        {m.name}
                      </label>
                    ))}
                  </div>
                )}
                <p className="mt-1 text-[12px] text-slate-400">Setting assignees needs the “manage people & deadlines” permission.</p>
              </div>
            </>
          )}

          {save.isError && (
            <p className="text-sm text-red-600">Couldn’t save — you may not have permission, or the name is taken.</p>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <button type="button" onClick={onClose}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}
                  className="rounded-md bg-green-600 px-5 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-40">
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function HeaderWithHelp({ label, help }: { label: string; help: string }) {
  return (
    <span className="inline-flex items-center gap-1" title={help}>
      {label}
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400">
        <circle cx="12" cy="12" r="10" /><path d="M9.5 9a2.5 2.5 0 0 1 4.5 1.5c0 1.5-2 2-2 3.5" /><path d="M12 17h.01" />
      </svg>
    </span>
  );
}

function LockIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>;
}
function PencilIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>;
}
function initials(name: string) { return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase(); }
function avatarColor(name: string) {
  const palette = ['#e11d48', '#7c3aed', '#0891b2', '#ea580c', '#059669', '#4f46e5', '#db2777'];
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length]!;
}
