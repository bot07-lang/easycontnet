import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type TemplateSummary } from '../lib/api';

/**
 * The Templates grid (CONFIG → Templates): a "Create template" card followed by
 * one card per template, each with a Default badge and a three-dot menu (open,
 * set default, duplicate, rename, delete). Clicking a template opens the
 * builder. Mirrors the reference.
 */
export function TemplatesGrid({
  projectId, onOpenTemplate,
}: {
  projectId: string;
  onOpenTemplate: (id: string) => void;
}) {
  const templates = useQuery({
    queryKey: ['templates', projectId],
    queryFn: () => api.listProjectTemplates(projectId),
  });
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<TemplateSummary | null>(null);
  const [deleting, setDeleting] = useState<TemplateSummary | null>(null);
  const [cloning, setCloning] = useState<TemplateSummary | null>(null);

  return (
    <div className="mx-auto max-w-[1100px]">
      <h1 className="text-2xl font-semibold text-slate-900">Templates</h1>
      <p className="mt-1.5 text-[15px] text-slate-500">
        A template defines how a content item should be written and structured.{' '}
        <a href="https://easycontent.io/help-article/templates" target="_blank" rel="noreferrer"
           className="text-blue-600 hover:underline">Learn more</a>
      </p>

      {templates.isLoading ? (
        <p className="mt-8 text-sm text-slate-400">Loading…</p>
      ) : templates.isError ? (
        <p className="mt-8 text-sm text-red-600">Couldn’t load templates.</p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
          <button type="button" onClick={() => setCreating(true)}
                  className="grid h-[150px] place-items-center rounded-lg border border-dashed border-slate-300 bg-white text-slate-600 transition hover:border-slate-400 hover:bg-slate-50">
            <span className="flex flex-col items-center gap-1">
              <span className="text-3xl font-light leading-none">+</span>
              <span className="text-[15px] font-medium">Create template</span>
            </span>
          </button>

          {templates.data!.map((t) => (
            <TemplateCard key={t.id} projectId={projectId} template={t}
                          onOpen={() => onOpenTemplate(t.id)}
                          onRename={() => setRenaming(t)}
                          onDelete={() => setDeleting(t)}
                          onClone={() => setCloning(t)} />
          ))}
        </div>
      )}

      {creating && (
        <CreateTemplateDialog projectId={projectId}
                              onClose={() => setCreating(false)}
                              onCreated={(id) => { setCreating(false); onOpenTemplate(id); }} />
      )}
      {renaming && (
        <RenameTemplateDialog projectId={projectId} template={renaming} onClose={() => setRenaming(null)} />
      )}
      {deleting && (
        <DeleteTemplateDialog projectId={projectId} template={deleting} onClose={() => setDeleting(null)} />
      )}
      {cloning && (
        <CloneTemplateDialog projectId={projectId} template={cloning} onClose={() => setCloning(null)} />
      )}
    </div>
  );
}

function TemplateCard({
  projectId, template: t, onOpen, onRename, onDelete, onClone,
}: {
  projectId: string;
  template: TemplateSummary;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  onClone: () => void;
}) {
  const qc = useQueryClient();
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  const setDefault = useMutation({
    mutationFn: () => api.updateTemplate(t.id, { isDefault: true }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['templates', projectId] }),
  });
  const duplicate = useMutation({
    mutationFn: () => api.duplicateTemplate(t.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['templates', projectId] }),
  });

  return (
    <div className="relative flex h-[150px] flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      {t.is_default && (
        <span className="absolute -top-2.5 left-4 rounded border border-slate-300 bg-white px-2 py-0.5 text-[12px] font-medium text-slate-600">
          Default
        </span>
      )}

      <div ref={ref} className="absolute right-3 top-3">
        <button type="button" onClick={() => setMenu((v) => !v)} title="Actions"
                className="grid h-8 w-8 place-items-center rounded text-slate-500 hover:bg-slate-100">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
        </button>
        {menu && (
          <div className="absolute right-0 z-20 mt-1 w-60 rounded-lg border border-slate-200 bg-white py-1.5 shadow-xl">
            {!t.is_default && <MenuItem icon={IconMakeDefault} label="Make default" onClick={() => { setMenu(false); setDefault.mutate(); }} />}
            <MenuItem icon={IconDuplicate} label="Duplicate template" onClick={() => { setMenu(false); duplicate.mutate(); }} />
            <MenuItem icon={IconRename} label="Rename" onClick={() => { setMenu(false); onRename(); }} />
            <MenuItem icon={IconClone} label="Clone into another project" onClick={() => { setMenu(false); onClone(); }} />
            <div className="my-1 border-t border-slate-100" />
            <MenuItem icon={IconTrash} label="Delete" danger onClick={() => { setMenu(false); onDelete(); }} />
          </div>
        )}
      </div>

      <button type="button" onClick={onOpen}
              className="mt-1 self-start text-left text-[19px] font-semibold text-blue-600 hover:underline">
        {t.name}
      </button>

      <p className="mt-auto text-[13px] text-slate-400">
        {t.field_count} field{t.field_count === 1 ? '' : 's'} · {t.tab_count} tab{t.tab_count === 1 ? '' : 's'}
        {t.item_count > 0 && ` · ${t.item_count} item${t.item_count === 1 ? '' : 's'}`}
      </p>
    </div>
  );
}

function MenuItem({
  icon, label, danger, onClick,
}: {
  icon?: React.ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick}
            className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-[14px] ${danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50'}`}>
      {icon && <span className="shrink-0">{icon}</span>}
      {label}
    </button>
  );
}

/* menu icons — inherit the item's text colour via currentColor */
const IconMakeDefault = <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M12 8v8M8 12h8" /></svg>;
const IconDuplicate = <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>;
const IconRename = <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>;
const IconClone = <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
const IconTrash = <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" /></svg>;

function CreateTemplateDialog({
  projectId, onClose, onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => api.createTemplate(projectId, name.trim()),
    onSuccess: (res) => { void qc.invalidateQueries({ queryKey: ['templates', projectId] }); onCreated(res.id); },
  });
  return (
    <Dialog title="Create template" onClose={onClose}
            footer={
              <>
                <GhostButton onClick={onClose}>Cancel</GhostButton>
                <PrimaryButton disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
                  {create.isPending ? 'Creating…' : 'Create template'}
                </PrimaryButton>
              </>
            }>
      <label className="block">
        <span className="mb-1.5 block text-[15px] font-medium text-slate-700">Template name</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Blog Post"
               onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) create.mutate(); }}
               className="w-full rounded-md border border-slate-300 px-3 py-2.5 text-[15px] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
      </label>
      <p className="mt-2 text-[13px] text-slate-400">
        Starts with a Main Content tab and Title + Content fields — add more in the builder.
      </p>
      {create.isError && <p className="mt-3 text-sm text-red-600">Couldn’t create — you may not have permission.</p>}
    </Dialog>
  );
}

function RenameTemplateDialog({
  projectId, template, onClose,
}: {
  projectId: string;
  template: TemplateSummary;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(template.name);
  const rename = useMutation({
    mutationFn: () => api.updateTemplate(template.id, { name: name.trim() }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['templates', projectId] }); onClose(); },
  });
  return (
    <Dialog title="Rename template" onClose={onClose}
            footer={
              <>
                <GhostButton onClick={onClose}>Cancel</GhostButton>
                <PrimaryButton disabled={!name.trim() || rename.isPending} onClick={() => rename.mutate()}>
                  {rename.isPending ? 'Saving…' : 'Save'}
                </PrimaryButton>
              </>
            }>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
             onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) rename.mutate(); }}
             className="w-full rounded-md border border-slate-300 px-3 py-2.5 text-[15px] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
      {rename.isError && <p className="mt-3 text-sm text-red-600">Couldn’t rename — name may be taken.</p>}
    </Dialog>
  );
}

function DeleteTemplateDialog({
  projectId, template, onClose,
}: {
  projectId: string;
  template: TemplateSummary;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: () => api.deleteTemplate(template.id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['templates', projectId] }); onClose(); },
  });
  return (
    <Dialog title="Delete template?" onClose={onClose}
            footer={
              <>
                <GhostButton onClick={onClose}>Cancel</GhostButton>
                <button type="button" disabled={del.isPending} onClick={() => del.mutate()}
                        className="rounded-md bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40">
                  {del.isPending ? 'Deleting…' : 'Delete'}
                </button>
              </>
            }>
      <p className="text-[15px] text-slate-600">
        <span className="font-medium text-slate-800">{template.name}</span> and its tabs and fields will be
        permanently removed.
      </p>
      {template.item_count > 0 && (
        <p className="mt-2 text-[13px] text-amber-600">
          {template.item_count} content item{template.item_count === 1 ? '' : 's'} use this template —
          deletion will be blocked until they’re reassigned.
        </p>
      )}
      {del.isError && <p className="mt-3 text-sm text-red-600">Couldn’t delete — it may still be in use.</p>}
    </Dialog>
  );
}

function CloneTemplateDialog({
  projectId, template, onClose,
}: {
  projectId: string;
  template: TemplateSummary;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.listProjects });
  // Clone targets are the caller's OTHER projects.
  const targets = (projects.data ?? []).filter((p) => p.id !== projectId);
  const [targetId, setTargetId] = useState('');
  if (!targetId && targets.length) setTargetId(targets[0]!.id);
  const [done, setDone] = useState(false);

  const clone = useMutation({
    mutationFn: () => api.cloneTemplateToProject(template.id, targetId),
    onSuccess: (res) => { void qc.invalidateQueries({ queryKey: ['templates', res.projectId] }); setDone(true); },
  });

  const targetName = targets.find((p) => p.id === targetId)?.name;

  return (
    <Dialog title="Clone into another project" onClose={onClose}
            footer={
              done ? (
                <PrimaryButton onClick={onClose}>Done</PrimaryButton>
              ) : (
                <>
                  <GhostButton onClick={onClose}>Cancel</GhostButton>
                  <PrimaryButton disabled={!targetId || clone.isPending} onClick={() => clone.mutate()}>
                    {clone.isPending ? 'Cloning…' : 'Clone template'}
                  </PrimaryButton>
                </>
              )
            }>
      {done ? (
        <p className="text-[15px] text-slate-600">
          <span className="font-medium text-slate-800">{template.name}</span> was cloned into{' '}
          <span className="font-medium text-slate-800">{targetName}</span>, with all its tabs and fields.
        </p>
      ) : targets.length === 0 ? (
        <p className="text-[15px] text-slate-500">You don’t have another project to clone this into.</p>
      ) : (
        <>
          <p className="mb-3 text-[15px] text-slate-600">
            Copy <span className="font-medium text-slate-800">{template.name}</span> — its tabs and fields — into
            another project you manage.
          </p>
          <label className="block">
            <span className="mb-1.5 block text-[15px] font-medium text-slate-700">Target project</span>
            <select value={targetId} onChange={(e) => setTargetId(e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2.5 text-[15px] text-slate-800">
              {targets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          {clone.isError && (
            <p className="mt-3 text-sm text-red-600">Couldn’t clone — you may not manage templates in that project.</p>
          )}
        </>
      )}
    </Dialog>
  );
}

/* -------------------------------------------------------------- small shared */

function Dialog({
  title, children, footer, onClose,
}: {
  title: string;
  children: React.ReactNode;
  footer: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} className="w-[460px] max-w-full rounded-lg bg-white shadow-2xl">
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

function GhostButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
      {children}
    </button>
  );
}
function PrimaryButton({ children, disabled, onClick }: { children: React.ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
            className="rounded-md bg-green-600 px-5 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-40">
      {children}
    </button>
  );
}
