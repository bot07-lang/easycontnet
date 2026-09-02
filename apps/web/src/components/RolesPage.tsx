import { Fragment, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type PermissionDef, type Role } from '../lib/api';
import { toast } from '../lib/toast';

/**
 * The "?" next to a permission — hovering shows its description. Rendered through
 * a portal with fixed positioning so the permission matrix's horizontal scroll
 * container can't clip it (why the plain native title was used before).
 */
function InfoTip({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: r.left, y: r.bottom + 6 });
  };
  return (
    <span ref={ref} onMouseEnter={show} onMouseLeave={() => setPos(null)} className="inline-flex">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="cursor-help text-slate-400 hover:text-slate-600"><circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></svg>
      {pos && createPortal(
        <div style={{ position: 'fixed', left: Math.max(8, Math.min(pos.x, window.innerWidth - 320)), top: pos.y, zIndex: 60 }}
             className="w-[300px] rounded-md bg-slate-900 px-3 py-2 text-left text-[12px] font-normal leading-snug text-white shadow-xl">
          {text}
        </div>,
        document.body,
      )}
    </span>
  );
}

const GROUP_LABELS: Record<string, string> = {
  account: 'Account',
  project: 'Project',
  briefs: 'Briefs',
  content: 'Content',
  reports: 'Reports',
};

/**
 * Roles & Permissions (Team → Roles). One scrolling page: a reorderable roles
 * list on top (add / edit / duplicate / deactivate / delete) and, below it, the
 * permission matrix (permissions grouped down the side, roles across the top,
 * a checkbox per cell). Everything is gated by `manage_roles`.
 */
export function RolesPage() {
  const qc = useQueryClient();
  const rolesQ = useQuery({ queryKey: ['roles'], queryFn: api.listRoles });
  const permsQ = useQuery({ queryKey: ['permissions-catalogue'], queryFn: api.listPermissionsCatalogue });

  const forbidden =
    (rolesQ.error instanceof Error && rolesQ.error.message.startsWith('403')) ||
    (permsQ.error instanceof Error && permsQ.error.message.startsWith('403'));

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['roles'] });

  if (forbidden) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold text-slate-800">Roles</h1>
        <p className="mt-3 text-slate-500">You need the <strong>“manage roles”</strong> permission to view this page.</p>
      </div>
    );
  }

  const roles = rolesQ.data ?? [];
  const perms = permsQ.data ?? [];

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-[26px] font-semibold text-slate-800">Roles</h1>
        <a href="https://easycontent.io/help-article/how-to-create-a-custom-role" target="_blank" rel="noreferrer"
           className="text-[15px] font-medium text-blue-600 hover:underline">
          Learn more about Roles and Permissions
        </a>
      </div>

      {rolesQ.isLoading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : (
        <>
          <RolesList roles={roles} onChanged={invalidate} />
          <PermissionsMatrix roles={roles} perms={perms} onChanged={invalidate} />
        </>
      )}
    </div>
  );
}

/* --------------------------------- Roles list --------------------------------- */

function RolesList({ roles, onChanged }: { roles: Role[]; onChanged: () => void }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Role | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const reorder = useMutation({
    mutationFn: (order: { id: string; position: number }[]) => api.reorderRoles(order),
    onSuccess: onChanged,
    onError: () => toast('Could not reorder roles.'),
  });

  const onDrop = (targetId: string) => {
    setOverId(null);
    const from = roles.findIndex((r) => r.id === dragId);
    const to = roles.findIndex((r) => r.id === targetId);
    setDragId(null);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...roles];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    reorder.mutate(next.map((r, i) => ({ id: r.id, position: (i + 1) * 1024 })));
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm" onClick={() => setMenuId(null)}>
      <p className="mb-4 text-[14px] text-slate-500">Use drag&amp;drop to reorder items</p>

      <div className="space-y-3">
        {roles.map((role) => (
          <RoleRow
            key={role.id}
            role={role}
            editing={editingId === role.id}
            menuOpen={menuId === role.id}
            dragging={dragId === role.id}
            dragOver={overId === role.id}
            onEdit={() => { setEditingId(role.id); setMenuId(null); }}
            onDoneEdit={() => { setEditingId(null); onChanged(); }}
            onMenu={() => setMenuId((c) => (c === role.id ? null : role.id))}
            onCloseMenu={() => setMenuId(null)}
            onChanged={onChanged}
            onAskDelete={() => { setMenuId(null); setConfirmDelete(role); }}
            onDragStart={() => setDragId(role.id)}
            onDragOver={() => setOverId(role.id)}
            onDrop={() => onDrop(role.id)}
          />
        ))}

        {adding && <AddRoleRow onDone={() => { setAdding(false); onChanged(); }} onCancel={() => setAdding(false)} />}
      </div>

      <button type="button" onClick={() => setAdding(true)}
              className="mt-6 inline-flex items-center gap-2 rounded-md bg-green-500 px-5 py-2.5 text-sm font-semibold uppercase tracking-wide text-white hover:bg-green-600">
        <span className="text-lg leading-none">+</span> Add new role
      </button>

      {confirmDelete && (
        <DeleteRoleModal role={confirmDelete} onCancel={() => setConfirmDelete(null)}
                         onDeleted={() => { setConfirmDelete(null); onChanged(); }} />
      )}
    </section>
  );
}

function RoleRow({
  role, editing, menuOpen, dragging, dragOver,
  onEdit, onDoneEdit, onMenu, onCloseMenu, onChanged, onAskDelete,
  onDragStart, onDragOver, onDrop,
}: {
  role: Role;
  editing: boolean;
  menuOpen: boolean;
  dragging: boolean;
  dragOver: boolean;
  onEdit: () => void;
  onDoneEdit: () => void;
  onMenu: () => void;
  onCloseMenu: () => void;
  onChanged: () => void;
  onAskDelete: () => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
}) {
  const [name, setName] = useState(role.name);
  const [desc, setDesc] = useState(role.description ?? '');
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const save = useMutation({
    mutationFn: () => api.updateRole(role.id, { name: name.trim(), description: desc }),
    onSuccess: onDoneEdit,
    onError: (e) => toast(e instanceof Error && e.message.includes('already exists') ? 'A role with this name already exists.' : 'Could not save the role.'),
  });
  const duplicate = useMutation({
    mutationFn: () => api.duplicateRole(role.id),
    onSuccess: () => { onCloseMenu(); onChanged(); toast('Role duplicated.'); },
    onError: () => toast('Could not duplicate the role.'),
  });
  const deactivate = useMutation({
    mutationFn: () => api.updateRole(role.id, { isActive: !role.is_active }),
    onSuccess: () => { onCloseMenu(); onChanged(); },
    onError: () => toast('Could not update the role.'),
  });

  const draggable = !role.is_system;

  if (editing) {
    return (
      <div className="flex items-center gap-3">
        <span className="w-4" />
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
               className="w-[300px] rounded-md border border-slate-300 px-3 py-2.5 text-[15px] focus:border-blue-500 focus:outline-none" />
        <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description"
               className="flex-1 rounded-md border border-slate-300 px-3 py-2.5 text-[15px] focus:border-blue-500 focus:outline-none" />
        <button type="button" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}
                className="rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-40">
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onDoneEdit}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-3 ${dragOver ? 'border-t-2 border-blue-400' : ''} ${dragging ? 'opacity-40' : ''}`}
      onDragOver={(e) => { if (draggable) { e.preventDefault(); onDragOver(); } }}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
    >
      {/* Drag handle (system roles are pinned — no handle). */}
      {draggable ? (
        <span draggable onDragStart={onDragStart} title="Drag to reorder"
              className="cursor-grab select-none text-slate-300 active:cursor-grabbing">⋮⋮</span>
      ) : (
        <span className="w-4" />
      )}

      <div className={`flex flex-1 items-center gap-3 rounded ${role.is_active ? '' : 'opacity-50'}`}>
        <div className="w-[300px] rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-[15px] text-slate-800">
          {role.name}{!role.is_active && <span className="ml-2 text-[12px] text-slate-400">(inactive)</span>}
        </div>
        <div className="flex-1 rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-[15px] text-slate-600">
          {role.description || <span className="text-slate-300">—</span>}
        </div>
      </div>

      {/* Edit button (hidden for non-editable Admin). */}
      {role.is_editable ? (
        <button type="button" onClick={onEdit}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
          Edit
        </button>
      ) : (
        <span className="w-[76px]" />
      )}

      {/* ⋮ menu */}
      <div className="relative" onClick={stop}>
        <button type="button" onClick={onMenu} title="More"
                className="grid h-8 w-8 place-items-center rounded text-slate-500 hover:bg-slate-100">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-9 z-20 w-48 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-xl">
            {/* Deactivate/Delete only for non-system roles; Duplicate always. */}
            {!role.is_system && (
              <MenuRow onClick={() => deactivate.mutate()}>
                <path d="M4 11h16v10H4z" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
                {role.is_active ? ' Deactivate' : ' Activate'}
              </MenuRow>
            )}
            <MenuRow onClick={() => duplicate.mutate()}>
              <path d="M9 9h10v10H9z" /><path d="M5 15V5h10" /> Duplicate
            </MenuRow>
            {!role.is_system && (
              <>
                <div className="my-1 border-t border-slate-100" />
                <MenuRow danger onClick={onAskDelete}>
                  <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6M14 11v6" /> Delete
                </MenuRow>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** A row in the ⋮ menu. The leading SVG paths + trailing text label are children. */
function MenuRow({ onClick, danger, children }: { onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  // Split children: SVG path elements render inside the icon; strings are the label.
  const nodes = Array.isArray(children) ? children : [children];
  const paths = nodes.filter((n) => typeof n !== 'string');
  const label = nodes.filter((n) => typeof n === 'string').join('');
  return (
    <button type="button" onClick={onClick}
            className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[14px] ${danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50'}`}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths}</svg>
      {label}
    </button>
  );
}

function AddRoleRow({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const create = useMutation({
    mutationFn: () => api.createRole(name.trim(), desc.trim()),
    onSuccess: onDone,
    onError: (e) => toast(e instanceof Error && e.message.includes('already exists') ? 'A role with this name already exists.' : 'Could not create the role.'),
  });
  return (
    <div className="flex items-center gap-3">
      <span className="w-4" />
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Role name"
             className="w-[300px] rounded-md border border-slate-300 px-3 py-2.5 text-[15px] focus:border-blue-500 focus:outline-none" />
      <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description"
             className="flex-1 rounded-md border border-slate-300 px-3 py-2.5 text-[15px] focus:border-blue-500 focus:outline-none" />
      <button type="button" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}
              className="rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-40">
        {create.isPending ? 'Saving…' : 'Save'}
      </button>
      <button type="button" onClick={onCancel}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
    </div>
  );
}

function DeleteRoleModal({ role, onCancel, onDeleted }: { role: Role; onCancel: () => void; onDeleted: () => void }) {
  const del = useMutation({
    mutationFn: () => api.deleteRole(role.id),
    onSuccess: () => { onDeleted(); toast('Role deleted.'); },
    onError: () => toast('Could not delete the role.'),
  });
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-6" onMouseDown={onCancel}>
      <div onMouseDown={(e) => e.stopPropagation()} className="w-[520px] max-w-full rounded-lg bg-white p-6 shadow-2xl">
        <h2 className="text-[20px] font-semibold text-slate-900">Delete “{role.name}”?</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-slate-600">
          This role will be permanently deleted. Users who hold it will need to be reassigned a role. This cannot be undone.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onCancel}
                  className="rounded-md bg-slate-100 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200">Cancel</button>
          <button type="button" disabled={del.isPending} onClick={() => del.mutate()}
                  className="rounded-md bg-red-500 px-6 py-2.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50">
            {del.isPending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Permissions matrix ------------------------------ */

function PermissionsMatrix({ roles, perms, onChanged }: { roles: Role[]; perms: PermissionDef[]; onChanged: () => void }) {
  const qc = useQueryClient();
  // Group permissions preserving DB order (already sorted by position).
  const groups = useMemo(() => {
    const out: { key: string; label: string; items: PermissionDef[] }[] = [];
    for (const p of perms) {
      let g = out.find((x) => x.key === p.group_name);
      if (!g) { g = { key: p.group_name, label: GROUP_LABELS[p.group_name] ?? p.group_name, items: [] }; out.push(g); }
      g.items.push(p);
    }
    return out;
  }, [perms]);

  // Optimistic toggle: flip the cache immediately, then persist.
  const toggle = useMutation({
    mutationFn: ({ roleId, key, on }: { roleId: string; key: string; on: boolean }) => api.setRolePermission(roleId, key, on),
    onMutate: async ({ roleId, key, on }) => {
      await qc.cancelQueries({ queryKey: ['roles'] });
      const prev = qc.getQueryData<Role[]>(['roles']);
      qc.setQueryData<Role[]>(['roles'], (old) =>
        (old ?? []).map((r) =>
          r.id !== roleId ? r : { ...r, permissions: on ? [...r.permissions, key] : r.permissions.filter((k) => k !== key) },
        ),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(['roles'], ctx.prev); toast('Could not update the permission.'); },
    onSettled: onChanged,
  });

  const held = (r: Role, key: string) => r.permissions.includes(key);

  return (
    <section className="mt-8 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-[22px] font-semibold text-slate-800">Permissions</h2>
      <p className="mb-4 mt-1 text-[14px] text-slate-500">Configure your roles by selecting appropriate permissions for each role</p>

      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-[14px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 border-b border-slate-200 bg-white px-3 py-3 text-left font-semibold text-slate-800">Permission / Role</th>
              {roles.map((r) => (
                <th key={r.id} className="border-b border-l border-slate-200 px-3 py-3 text-center font-medium text-slate-700 whitespace-nowrap">{r.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.key}>
                <tr>
                  <td className="sticky left-0 z-10 bg-white px-3 pb-2 pt-4 text-[13px] font-bold uppercase tracking-wide text-slate-800" colSpan={roles.length + 1}>
                    {g.label}
                  </td>
                </tr>
                {g.items.map((p) => (
                  <tr key={p.key} className="hover:bg-slate-50/60">
                    <td className="sticky left-0 z-10 border-b border-slate-100 bg-white px-3 py-2.5 text-slate-700">
                      <span className="inline-flex items-center gap-1.5">
                        {p.label}
                        <InfoTip text={p.description} />
                      </span>
                    </td>
                    {roles.map((r) => {
                      const on = held(r, p.key);
                      const locked = !r.is_editable; // Admin's column is fixed
                      return (
                        <td key={r.id} className="border-b border-l border-slate-100 px-3 py-2.5 text-center">
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={locked || toggle.isPending}
                            onChange={() => toggle.mutate({ roleId: r.id, key: p.key, on: !on })}
                            className="h-[18px] w-[18px] cursor-pointer accent-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
