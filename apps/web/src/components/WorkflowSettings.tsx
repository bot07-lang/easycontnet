import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type WorkflowConfig, type WorkflowStatus, type WorkflowRating } from '../lib/api';

/**
 * The per-project Workflow settings page (CONFIG → Workflow). Mirrors the
 * reference, which edits INLINE — clicking Edit (or Add new status) turns the
 * matrix row itself into editable controls, rather than opening a modal.
 *
 * Three sections:
 *   1. The status ladder — a matrix of reviewing roles per status, plus auto
 *      due, read-only and default assignees, each row editable in place.
 *   2. Additional Settings — auto-complete on publish (disabled: WordPress
 *      publishing isn't built yet).
 *   3. Ratings — the 5-star criteria reviewers are prompted for on approval,
 *      added / edited / deleted inline.
 *
 * Everything is scoped to one project: each project owns its own ladder and
 * they never propagate between projects.
 */
export function WorkflowSettings({ projectId }: { projectId: string }) {
  const wf = useQuery({
    queryKey: ['workflow', projectId],
    queryFn: () => api.getWorkflow(projectId),
  });

  if (wf.isLoading) return <p className="text-sm text-slate-400">Loading…</p>;
  if (wf.isError || !wf.data) return <p className="text-sm text-red-600">Couldn’t load the workflow.</p>;

  return (
    <div className="mx-auto max-w-[1200px]">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Workflow</h1>
        <a href="https://easycontent.io/help-article/workflow" target="_blank" rel="noreferrer"
           className="text-sm text-blue-600 hover:underline">Learn more about Workflow</a>
      </div>

      <StatusSection projectId={projectId} data={wf.data} />
      <AdditionalSettings autoComplete={wf.data.auto_complete_on_publish} />
      <RatingsSection projectId={projectId} data={wf.data} />
    </div>
  );
}

/* ------------------------------------------------------------------ statuses */

function StatusSection({ projectId, data }: { projectId: string; data: WorkflowConfig }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const roles = data.roles;
  const totalCols = 1 + roles.length + 3 + 1;

  const nonTerminal = data.statuses.filter((s) => !s.is_terminal);
  const terminal = data.statuses.filter((s) => s.is_terminal);

  const close = () => { setEditingId(null); setAdding(false); };

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
              <th colSpan={4} className="border-b border-slate-200" />
            </tr>
            <tr className="text-slate-600">
              <th className="border-b border-slate-200 px-3 py-3 text-left font-semibold">Status</th>
              {roles.map((r) => (
                <th key={r.id} title={r.name} className="border-b border-l border-slate-200 px-2 py-3 text-center font-medium">
                  <span className="block max-w-[52px] truncate">{r.name}</span>
                </th>
              ))}
              <th className="border-b border-slate-200 px-3 py-3 text-left font-medium">
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
            {nonTerminal.map((s) =>
              editingId === s.id ? (
                <StatusEditRow key={s.id} projectId={projectId} data={data} status={s} onDone={close} />
              ) : (
                <StatusDisplayRow key={s.id} status={s} roles={roles}
                                  disabled={editingId !== null || adding}
                                  onEdit={() => { setAdding(false); setEditingId(s.id); }} />
              ),
            )}

            {adding && <StatusEditRow projectId={projectId} data={data} status={null} onDone={close} />}

            {terminal.map((s) =>
              editingId === s.id ? (
                <StatusEditRow key={s.id} projectId={projectId} data={data} status={s} onDone={close} />
              ) : (
                <StatusDisplayRow key={s.id} status={s} roles={roles}
                                  disabled={editingId !== null || adding}
                                  onEdit={() => { setAdding(false); setEditingId(s.id); }} />
              ),
            )}

            {nonTerminal.length + terminal.length === 0 && (
              <tr><td colSpan={totalCols} className="px-3 py-6 text-center text-slate-400">No statuses.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <button type="button" disabled={editingId !== null || adding}
              onClick={() => { setEditingId(null); setAdding(true); }}
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-semibold uppercase tracking-wide text-white hover:bg-emerald-700 disabled:opacity-40">
        <span className="text-lg leading-none">+</span> Add new status
      </button>
    </section>
  );
}

function StatusDisplayRow({
  status: s, roles, disabled, onEdit,
}: {
  status: WorkflowStatus;
  roles: WorkflowConfig['roles'];
  disabled: boolean;
  onEdit: () => void;
}) {
  return (
    <tr className="align-middle">
      <td className="border-b border-slate-100 px-3 py-3">
        <div className="flex items-center gap-2">
          {s.is_initial || s.is_terminal
            ? <span className="w-3.5" />
            : <span className="cursor-grab select-none text-slate-300" title="Drag to reorder">⋮⋮</span>}
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: s.color }} />
          <span className="font-medium text-slate-800">{s.name}</span>
        </div>
      </td>
      {roles.map((r) => (
        <td key={r.id} className="border-b border-l border-slate-100 px-2 py-3 text-center">
          {s.is_terminal ? null : (
            <input type="checkbox" checked={s.reviewing_role_ids.includes(r.id)} readOnly
                   className="h-4 w-4 accent-slate-500" />
          )}
        </td>
      ))}
      <td className="border-b border-slate-100 px-3 py-3 text-slate-600">
        {s.is_terminal ? null : s.auto_due_days ? `${s.auto_due_days} day${s.auto_due_days > 1 ? 's' : ''}` : '-'}
      </td>
      <td className="border-b border-slate-100 px-3 py-3">
        {/* Read-only is allowed on terminal statuses too (e.g. a locked "Completed"). */}
        {s.read_only
          ? <span className="inline-flex items-center gap-1 text-slate-600" title="Read-only"><LockIcon /> On</span>
          : <span className="text-slate-400">-</span>}
      </td>
      <td className="border-b border-slate-100 px-3 py-3">
        {s.is_terminal ? null : s.default_assignees.length === 0
          ? <span className="text-slate-400">-</span>
          : <Avatars people={s.default_assignees} />}
      </td>
      <td className="border-b border-slate-100 px-3 py-3 text-right">
        <button type="button" onClick={onEdit} disabled={disabled}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">
          <PencilIcon /> Edit
        </button>
      </td>
    </tr>
  );
}

const SWATCHES = ['#22C55E', '#EC4899', '#F59E0B', '#6366F1', '#0EA5E9', '#EF4444', '#9CA3AF', '#14B8A6'];

function StatusEditRow({
  projectId, data, status, onDone,
}: {
  projectId: string;
  data: WorkflowConfig;
  status: WorkflowStatus | null;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const isNew = status === null;
  const terminal = status?.is_terminal ?? false;

  const [name, setName] = useState(status?.name ?? '');
  const [color, setColor] = useState((status?.color ?? SWATCHES[0]!).toUpperCase());
  const [autoDue, setAutoDue] = useState(status?.auto_due_days?.toString() ?? '');
  const [readOnly, setReadOnly] = useState(status?.read_only ?? false);
  const [roleIds, setRoleIds] = useState<Set<string>>(new Set(status?.reviewing_role_ids ?? []));
  const [assignees, setAssignees] = useState<Set<string>>(new Set((status?.default_assignees ?? []).map((a) => a.id)));

  const [colorOpen, setColorOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const colorBtn = useRef<HTMLButtonElement>(null);
  const assignBtn = useRef<HTMLButtonElement>(null);

  const save = useMutation({
    mutationFn: async () => {
      const roleList = terminal ? [] : [...roleIds];
      const dueVal = autoDue.trim() === '' ? null : Number(autoDue);
      let statusId = status?.id;

      if (isNew) {
        const res = await api.createStatus(projectId, {
          name: name.trim(), color, autoDueDays: dueVal, readOnly, reviewingRoleIds: roleList,
        });
        statusId = res.id;
      } else {
        await api.updateStatus(status!.id, {
          name: name.trim(), color, readOnly,
          ...(terminal ? {} : { autoDueDays: dueVal, reviewingRoleIds: roleList }),
        });
      }

      if (!terminal && statusId) {
        const before = new Set((status?.default_assignees ?? []).map((a) => a.id));
        const changed = isNew
          ? assignees.size > 0
          : before.size !== assignees.size || [...assignees].some((id) => !before.has(id));
        if (changed) await api.setDefaultAssignees(statusId, [...assignees]);
      }
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['workflow', projectId] }); onDone(); },
  });

  const toggle = (set: Set<string>, id: string, apply: (s: Set<string>) => void) => {
    const n = new Set(set); n.has(id) ? n.delete(id) : n.add(id); apply(n);
  };

  const selectedAssignees = data.members.filter((m) => assignees.has(m.id));

  return (
    <tr className="align-middle bg-blue-50/40">
      <td className="border-b border-slate-100 px-3 py-3">
        <div className="flex items-center gap-2">
          <button ref={colorBtn} type="button" onClick={() => setColorOpen((v) => !v)}
                  className="h-4 w-4 shrink-0 rounded-full ring-1 ring-slate-300" style={{ background: color }} title="Pick colour" />
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Status name"
                 className="w-40 rounded-md border border-slate-300 px-2 py-1.5 text-[14px] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
        </div>
        {colorOpen && (
          <AnchoredPanel anchorRef={colorBtn} onClose={() => setColorOpen(false)}>
            <div className="flex w-40 flex-wrap gap-2 p-2">
              {SWATCHES.map((c) => (
                <button key={c} type="button" onClick={() => { setColor(c); setColorOpen(false); }}
                        className={`h-6 w-6 rounded-full ${color === c ? 'ring-2 ring-slate-800 ring-offset-1' : ''}`}
                        style={{ background: c }} title={c} />
              ))}
            </div>
          </AnchoredPanel>
        )}
      </td>

      {data.roles.map((r) => (
        <td key={r.id} className="border-b border-l border-slate-100 px-2 py-3 text-center">
          {terminal ? null : (
            <input type="checkbox" checked={roleIds.has(r.id)} onChange={() => toggle(roleIds, r.id, setRoleIds)}
                   className="h-4 w-4 cursor-pointer accent-blue-600" />
          )}
        </td>
      ))}

      <td className="border-b border-slate-100 px-3 py-3">
        {terminal ? null : (
          <span className="inline-flex items-center gap-1.5">
            <input value={autoDue} onChange={(e) => setAutoDue(e.target.value.replace(/[^\d]/g, ''))}
                   placeholder="0" inputMode="numeric"
                   className="w-12 rounded-md border border-slate-300 px-2 py-1.5 text-[14px] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
            <span className="text-slate-500">days</span>
          </span>
        )}
      </td>

      <td className="border-b border-slate-100 px-3 py-3">
        {/* Read-only is editable even for terminal statuses. */}
        <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)}
               className="h-4 w-4 cursor-pointer accent-blue-600" />
      </td>

      <td className="border-b border-slate-100 px-3 py-3">
        {terminal ? null : (
          <>
            <div className="flex items-center gap-2">
              {selectedAssignees.length > 0 && <Avatars people={selectedAssignees} />}
              <button ref={assignBtn} type="button" onClick={() => setAssignOpen((v) => !v)}
                      className="whitespace-nowrap rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
                + Assign team member
              </button>
            </div>
            {assignOpen && (
              <AnchoredPanel anchorRef={assignBtn} onClose={() => setAssignOpen(false)}>
                <div className="max-h-56 w-56 overflow-y-auto p-2">
                  {data.members.length === 0 ? (
                    <p className="px-1 py-2 text-sm text-slate-400">No project members yet.</p>
                  ) : data.members.map((m) => (
                    <label key={m.id} className="flex cursor-pointer items-center gap-2.5 rounded px-1 py-1.5 text-[14px] text-slate-800 hover:bg-slate-50">
                      <input type="checkbox" checked={assignees.has(m.id)}
                             onChange={() => toggle(assignees, m.id, setAssignees)}
                             className="h-4 w-4 accent-blue-600" />
                      {m.name}
                    </label>
                  ))}
                  <p className="mt-1 border-t border-slate-100 px-1 pt-1.5 text-[11px] text-slate-400">
                    Needs “manage people &amp; deadlines”.
                  </p>
                </div>
              </AnchoredPanel>
            )}
          </>
        )}
      </td>

      <td className="border-b border-slate-100 px-3 py-3">
        <div className="flex items-center justify-end gap-1.5">
          {save.isError && <span className="mr-1 text-xs text-red-600">Failed</span>}
          <button type="button" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-40">
            <SaveIcon /> {save.isPending ? 'Saving' : 'Save'}
          </button>
          <button type="button" onClick={onDone} title="Cancel"
                  className="grid h-8 w-8 place-items-center rounded text-slate-500 hover:bg-slate-100">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
      </td>
    </tr>
  );
}

/* ------------------------------------------------------ additional settings */

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

/* -------------------------------------------------------------------- ratings */

function RatingsSection({ projectId, data }: { projectId: string; data: WorkflowConfig }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const close = () => { setEditingId(null); setAdding(false); };
  const busy = editingId !== null || adding;

  return (
    <section className="mb-6 rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="mb-1.5 text-[17px] font-semibold text-slate-800">Ratings</h2>
      <p className="mb-4 text-sm text-slate-500">
        If you want your reviewers to be prompted to leave 5-star ratings when approving content, add them below.
      </p>

      {(data.ratings.length > 0 || adding) && (
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
            {data.ratings.map((r) =>
              editingId === r.id ? (
                <RatingEditRow key={r.id} projectId={projectId} data={data} rating={r} onDone={close} />
              ) : (
                <RatingDisplayRow key={r.id} projectId={projectId} rating={r} disabled={busy}
                                  onEdit={() => { setAdding(false); setEditingId(r.id); }} />
              ),
            )}
            {adding && <RatingEditRow projectId={projectId} data={data} rating={null} onDone={close} />}
          </tbody>
        </table>
      )}

      <button type="button" disabled={busy} onClick={() => { setEditingId(null); setAdding(true); }}
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-semibold uppercase tracking-wide text-white hover:bg-emerald-700 disabled:opacity-40">
        <span className="text-lg leading-none">+</span> Add new field
      </button>
    </section>
  );
}

function RatingDisplayRow({
  projectId, rating: r, disabled, onEdit,
}: {
  projectId: string;
  rating: WorkflowRating;
  disabled: boolean;
  onEdit: () => void;
}) {
  const qc = useQueryClient();
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const del = useMutation({
    mutationFn: () => api.deleteRating(r.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['workflow', projectId] }),
  });
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  return (
    <tr className="border-b border-slate-100 align-top">
      <td className="py-3 pr-4 font-semibold text-slate-800">{r.name}</td>
      <td className="py-3 pr-4 text-slate-600">{r.description}</td>
      <td className="py-3 pr-4">
        <span className="inline-flex items-center gap-2 text-slate-700">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.status_color }} />
          {r.status_name}
        </span>
      </td>
      <td className="py-3 pr-4">
        <div className="flex items-center justify-end gap-1.5">
          <button type="button" onClick={onEdit} disabled={disabled}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">
            <PencilIcon /> Edit
          </button>
          <div ref={ref} className="relative">
            <button type="button" onClick={() => setMenu((v) => !v)} disabled={disabled}
                    className="grid h-8 w-8 place-items-center rounded text-slate-500 hover:bg-slate-100 disabled:opacity-40">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
            </button>
            {menu && (
              <div className="absolute right-0 z-20 mt-1 w-40 rounded-lg border border-slate-200 bg-white py-1.5 shadow-xl">
                <button type="button" onClick={() => { setMenu(false); del.mutate(); }}
                        className="flex w-full items-center gap-2 px-4 py-2 text-left text-[14px] text-red-600 hover:bg-red-50">
                  <TrashIcon /> Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

function RatingEditRow({
  projectId, data, rating, onDone,
}: {
  projectId: string;
  data: WorkflowConfig;
  rating: WorkflowRating | null;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const isNew = rating === null;
  // Ratings are prompted on approval, so they attach to a reviewing (non-terminal) status.
  const statusOptions = data.statuses.filter((s) => !s.is_terminal);
  const [name, setName] = useState(rating?.name ?? '');
  const [description, setDescription] = useState(rating?.description ?? '');
  const [statusId, setStatusId] = useState(rating?.status_id ?? statusOptions[0]?.id ?? '');

  const save = useMutation({
    mutationFn: async () => {
      if (isNew) {
        await api.createRating(projectId, { name: name.trim(), description: description.trim() || null, statusId });
      } else {
        await api.updateRating(rating!.id, { name: name.trim(), description: description.trim() || null, statusId });
      }
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['workflow', projectId] }); onDone(); },
  });

  return (
    <tr className="border-b border-slate-100 bg-blue-50/40 align-top">
      <td className="py-3 pr-4">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter criteria name"
               className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-[14px] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
      </td>
      <td className="py-3 pr-4">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
                  placeholder="Enter criteria description"
                  className="w-full resize-y rounded-md border border-slate-300 px-2.5 py-2 text-[14px] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
      </td>
      <td className="py-3 pr-4">
        <select value={statusId} onChange={(e) => setStatusId(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-[14px] text-slate-800">
          {statusOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </td>
      <td className="py-3 pr-4">
        <div className="flex items-center justify-end gap-1.5">
          {save.isError && <span className="mr-1 text-xs text-red-600">Failed</span>}
          <button type="button" disabled={!name.trim() || !statusId || save.isPending} onClick={() => save.mutate()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-40">
            <SaveIcon /> {save.isPending ? 'Saving' : 'Save'}
          </button>
          <button type="button" onClick={onDone} title="Cancel"
                  className="grid h-8 w-8 place-items-center rounded text-slate-500 hover:bg-slate-100">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
      </td>
    </tr>
  );
}

/* -------------------------------------------------------------------- helpers */

/**
 * A small panel anchored under a button, positioned with `fixed` so it is never
 * clipped by the matrix's horizontal scroll container. Closes on outside click.
 */
function AnchoredPanel({
  anchorRef, onClose, children,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const r = anchorRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: r.left });
  }, [anchorRef]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      if (anchorRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [anchorRef, onClose]);

  if (!pos) return null;
  return (
    <div ref={panelRef} style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 50 }}
         className="rounded-lg border border-slate-200 bg-white shadow-xl">
      {children}
    </div>
  );
}

function Avatars({ people }: { people: { id: string; name: string }[] }) {
  return (
    <span className="flex -space-x-2">
      {people.slice(0, 4).map((a) => (
        <span key={a.id} title={a.name}
              className="grid h-6 w-6 place-items-center rounded-full border-2 border-white text-[10px] font-semibold text-white"
              style={{ background: avatarColor(a.name) }}>{initials(a.name)}</span>
      ))}
    </span>
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

function LockIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>; }
function PencilIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>; }
function TrashIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" /></svg>; }
function SaveIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M8 3v6h7M8 21v-7h8v7" /></svg>; }
function initials(name: string) { return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase(); }
function avatarColor(name: string) {
  const palette = ['#e11d48', '#7c3aed', '#0891b2', '#ea580c', '#059669', '#4f46e5', '#db2777'];
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length]!;
}
