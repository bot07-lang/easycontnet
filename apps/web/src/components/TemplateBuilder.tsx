import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type TemplateDetail, type TemplateField, type TemplateTab } from '../lib/api';
import { Modal, inputClass } from './Modal';

/* ---------------------------------------------------- field-type metadata */

type Cat = 'input' | 'section' | 'choice';
interface TypeMeta { label: string; cat: Cat; hasLength: boolean; icon: string }
const TYPE: Record<string, TypeMeta> = {
  single_line_text: { label: 'Single line of text', cat: 'input', hasLength: true, icon: '≡' },
  paragraph_text: { label: 'Paragraph text', cat: 'input', hasLength: true, icon: '¶' },
  file_image_upload: { label: 'File/Image upload', cat: 'input', hasLength: false, icon: '📎' },
  single_image: { label: 'Single image', cat: 'input', hasLength: false, icon: '🖼' },
  checkboxes: { label: 'Checkboxes', cat: 'choice', hasLength: false, icon: '☑' },
  radio_buttons: { label: 'Radio buttons', cat: 'choice', hasLength: false, icon: '⦿' },
  date: { label: 'Date', cat: 'input', hasLength: false, icon: '📅' },
  dropdown_select: { label: 'Dropdown select', cat: 'choice', hasLength: false, icon: '▾' },
  heading: { label: 'Heading', cat: 'section', hasLength: false, icon: 'T' },
  guidelines: { label: 'Guidelines', cat: 'section', hasLength: false, icon: '“' },
};
const ADD_MENU: { group: string; types: string[] }[] = [
  { group: 'Content', types: ['single_line_text', 'paragraph_text', 'file_image_upload', 'single_image', 'date'] },
  { group: 'Choices', types: ['checkboxes', 'radio_buttons', 'dropdown_select'] },
  { group: 'Layout', types: ['heading', 'guidelines'] },
];

/**
 * Template builder — the editable, type-aware structure editor. Tabs (system +
 * custom, with show/hide/rename), and per-tab field cards whose controls depend
 * on the field type and whether it is a system field. Field settings autosave
 * (debounced); structural changes (add/delete/move/tabs) refetch. Mirrors the
 * reference builder.
 */
export function TemplateBuilder({ templateId, onBack, onOpenTemplate }: { templateId: string; onBack: () => void; onOpenTemplate?: (id: string) => void }) {
  const qc = useQueryClient();
  const tpl = useQuery({ queryKey: ['template', templateId], queryFn: () => api.getTemplate(templateId) });
  const [tabId, setTabId] = useState<string | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['template', templateId] });

  if (tpl.isLoading) return <p className="text-sm text-slate-400">Loading…</p>;
  if (tpl.isError || !tpl.data) return <p className="text-sm text-red-600">Couldn’t load this template.</p>;

  const t = tpl.data;
  const activeTab = t.tabs.find((tb) => tb.id === tabId) ?? t.tabs[0];

  return (
    <div className="mx-auto max-w-[1040px]">
      <Header template={t} onBack={onBack} onRenamed={invalidate} onOpenTemplate={onOpenTemplate} />

      <div className="mt-5 rounded-lg border border-slate-200 bg-white">
        <TabBar template={t} activeId={activeTab?.id ?? null} onSelect={setTabId} onChanged={invalidate} />

        {activeTab && (activeTab.isHidden ? (
          <HiddenTabState />
        ) : (
          <div className="space-y-4 p-4">
            {activeTab.fields.length === 0 && (
              <p className="py-6 text-center text-sm text-slate-400">This tab has no fields yet.</p>
            )}
            {activeTab.fields.map((f, i) => (
              <FieldCard key={f.id} field={f} isFirst={i === 0} isLast={i === activeTab.fields.length - 1}
                         onStructuralChange={invalidate} />
            ))}
            <AddFieldButton tabId={activeTab.id} onAdded={invalidate} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- header */

function Header({ template: t, onBack, onRenamed, onOpenTemplate }: { template: TemplateDetail; onBack: () => void; onRenamed: () => void; onOpenTemplate?: (id: string) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(t.name);
  const [desc, setDesc] = useState(t.description ?? '');
  const nameRef = useRef<HTMLInputElement>(null);
  const saveName = useDebounced((v: string) => { if (v.trim()) api.updateTemplate(t.id, { name: v.trim() }).then(onRenamed).catch(() => {}); });
  const saveDesc = useDebounced((v: string) => { api.updateTemplate(t.id, { description: v.trim() || null }).then(onRenamed).catch(() => {}); });

  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useOutside(menuRef, () => setMenu(false), menu);
  const [creating, setCreating] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const refreshList = () => qc.invalidateQueries({ queryKey: ['templates', t.projectId] });
  const setDefault = useMutation({ mutationFn: () => api.updateTemplate(t.id, { isDefault: true }), onSuccess: () => { onRenamed(); refreshList(); } });
  const duplicate = useMutation({ mutationFn: () => api.duplicateTemplate(t.id), onSuccess: (res) => { refreshList(); onOpenTemplate?.(res.id); } });

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} title="Back to templates"
                className="grid h-9 w-9 place-items-center rounded text-slate-500 hover:bg-slate-100">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <input ref={nameRef} value={name} onChange={(e) => { setName(e.target.value); saveName(e.target.value); }}
               className="w-[360px] max-w-full rounded-md border border-slate-300 px-3 py-2 text-[16px] font-medium text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
        {t.isDefault && <span className="rounded border border-slate-300 px-2 py-0.5 text-[12px] font-medium text-slate-600">Default</span>}
        <button type="button" onClick={() => setCreating(true)}
                className="ml-auto rounded-md border border-slate-300 px-4 py-2 text-[13px] font-semibold uppercase tracking-wide text-slate-600 hover:bg-slate-50">
          + Create template
        </button>
        <div ref={menuRef} className="relative">
          <button type="button" onClick={() => setMenu((v) => !v)} title="Actions"
                  className="grid h-9 w-9 place-items-center rounded-full text-slate-500 hover:bg-slate-100">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
          </button>
          {menu && (
            <div className="absolute right-0 z-30 mt-1 w-60 rounded-lg border border-slate-200 bg-white py-1.5 shadow-xl">
              {!t.isDefault && <MenuRow icon={MenuIcons.makeDefault} label="Make default" onClick={() => { setMenu(false); setDefault.mutate(); }} />}
              <MenuRow icon={MenuIcons.duplicate} label="Duplicate template" onClick={() => { setMenu(false); duplicate.mutate(); }} />
              <MenuRow icon={MenuIcons.rename} label="Rename" onClick={() => { setMenu(false); nameRef.current?.focus(); nameRef.current?.select(); }} />
              <MenuRow icon={MenuIcons.clone} label="Clone into another project" onClick={() => { setMenu(false); setCloning(true); }} />
              <div className="my-1 border-t border-slate-100" />
              <MenuRow icon={MenuIcons.trash} label="Delete" danger onClick={() => { setMenu(false); setDeleting(true); }} />
            </div>
          )}
        </div>
      </div>
      <input value={desc} onChange={(e) => { setDesc(e.target.value); saveDesc(e.target.value); }}
             placeholder="Template description (optional)"
             className="ml-12 mt-2 w-[min(100%-3rem,42rem)] rounded-md border border-transparent px-2 py-1 text-[14px] text-slate-500 placeholder:text-slate-400 hover:border-slate-200 focus:border-blue-500 focus:text-slate-700 focus:outline-none" />

      {creating && (
        <CreateTemplateModal projectId={t.projectId}
                             onClose={() => setCreating(false)}
                             onCreated={(id) => { setCreating(false); refreshList(); onOpenTemplate?.(id); }} />
      )}
      {cloning && <CloneTemplateModal templateId={t.id} templateName={t.name} projectId={t.projectId} onClose={() => setCloning(false)} />}
      {deleting && <DeleteTemplateModal templateId={t.id} templateName={t.name} onClose={() => setDeleting(false)} onDeleted={onBack} />}
    </div>
  );
}

function MenuRow({ icon, label, danger, onClick }: { icon: React.ReactNode; label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
            className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-[14px] ${danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50'}`}>
      <span className="shrink-0">{icon}</span>{label}
    </button>
  );
}

const MenuIcons = {
  makeDefault: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M12 8v8M8 12h8" /></svg>,
  duplicate: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>,
  rename: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>,
  clone: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
  trash: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" /></svg>,
};

function CreateTemplateModal({ projectId, onClose, onCreated }: { projectId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const create = useMutation({ mutationFn: () => api.createTemplate(projectId, name.trim(), desc.trim() || null), onSuccess: (res) => onCreated(res.id) });
  return (
    <Modal title="Create template" onClose={onClose} width={460}
           footer={<>
             <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
             <button type="button" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}
                     className="rounded-md bg-green-600 px-5 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-40">{create.isPending ? 'Creating…' : 'Create'}</button>
           </>}>
      <label className="mb-3 block">
        <span className="mb-1.5 block text-[15px] font-medium text-slate-700">Template name</span>
        <input autoFocus className={inputClass} value={name} onChange={(e) => setName(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) create.mutate(); }} placeholder="e.g. Blog Post" />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[15px] font-medium text-slate-700">Description (optional)</span>
        <input className={inputClass} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What this template is for" />
      </label>
      {create.isError && <p className="mt-3 text-sm text-red-600">Couldn’t create — you may not have permission.</p>}
    </Modal>
  );
}

function CloneTemplateModal({ templateId, templateName, projectId, onClose }: { templateId: string; templateName: string; projectId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.listProjects });
  const targets = (projects.data ?? []).filter((p) => p.id !== projectId);
  const [targetId, setTargetId] = useState('');
  if (!targetId && targets.length) setTargetId(targets[0]!.id);
  const [done, setDone] = useState(false);
  const clone = useMutation({ mutationFn: () => api.cloneTemplateToProject(templateId, targetId), onSuccess: (res) => { void qc.invalidateQueries({ queryKey: ['templates', res.projectId] }); setDone(true); } });
  const targetName = targets.find((p) => p.id === targetId)?.name;
  return (
    <Modal title="Clone into another project" onClose={onClose} width={460}
           footer={done ? (
             <button type="button" onClick={onClose} className="rounded-md bg-green-600 px-5 py-2 text-sm font-semibold text-white hover:bg-green-700">Done</button>
           ) : (<>
             <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
             <button type="button" disabled={!targetId || clone.isPending} onClick={() => clone.mutate()}
                     className="rounded-md bg-green-600 px-5 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-40">{clone.isPending ? 'Cloning…' : 'Clone'}</button>
           </>)}>
      {done ? (
        <p className="text-[15px] text-slate-600"><span className="font-medium text-slate-800">{templateName}</span> was cloned into <span className="font-medium text-slate-800">{targetName}</span>.</p>
      ) : targets.length === 0 ? (
        <p className="text-[15px] text-slate-500">You don’t have another project to clone this into.</p>
      ) : (
        <label className="block">
          <span className="mb-1.5 block text-[15px] font-medium text-slate-700">Target project</span>
          <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className={inputClass}>
            {targets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {clone.isError && <p className="mt-3 text-sm text-red-600">Couldn’t clone — you may not manage templates in that project.</p>}
        </label>
      )}
    </Modal>
  );
}

function DeleteTemplateModal({ templateId, templateName, onClose, onDeleted }: { templateId: string; templateName: string; onClose: () => void; onDeleted: () => void }) {
  const del = useMutation({ mutationFn: () => api.deleteTemplate(templateId), onSuccess: onDeleted });
  return (
    <Modal title="Delete template?" onClose={onClose} width={440}
           footer={<>
             <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
             <button type="button" disabled={del.isPending} onClick={() => del.mutate()}
                     className="rounded-md bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40">{del.isPending ? 'Deleting…' : 'Delete'}</button>
           </>}>
      <p className="text-[15px] text-slate-600"><span className="font-medium text-slate-800">{templateName}</span> and its tabs and fields will be permanently removed.</p>
      {del.isError && <p className="mt-3 text-sm text-red-600">Couldn’t delete — it may still be in use by content items.</p>}
    </Modal>
  );
}

/* ------------------------------------------------------------------ tabs */

function TabBar({
  template: t, activeId, onSelect, onChanged,
}: {
  template: TemplateDetail;
  activeId: string | null;
  onSelect: (id: string) => void;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const create = useMutation({
    mutationFn: () => api.createTab(t.id, newName.trim()),
    onSuccess: () => { setAdding(false); setNewName(''); onChanged(); },
  });
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 px-3 pt-3">
      {t.tabs.map((tb) => (
        <TabPill key={tb.id} tab={tb} active={tb.id === activeId} onSelect={() => onSelect(tb.id)} onChanged={onChanged} />
      ))}
      {adding ? (
        <span className="mb-2 inline-flex items-center gap-1">
          <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) create.mutate(); if (e.key === 'Escape') setAdding(false); }}
                 placeholder="Tab name"
                 className="w-32 rounded-md border border-slate-300 px-2 py-1.5 text-[14px] focus:border-blue-500 focus:outline-none" />
          <button type="button" disabled={!newName.trim()} onClick={() => create.mutate()}
                  className="rounded bg-green-600 px-2 py-1.5 text-[13px] font-semibold text-white disabled:opacity-40">Add</button>
          <button type="button" onClick={() => setAdding(false)} className="px-1 text-slate-400">✕</button>
        </span>
      ) : (
        <button type="button" onClick={() => setAdding(true)}
                className="mb-2 rounded-md border border-slate-200 px-3 py-1.5 text-[13px] font-medium text-slate-600 hover:bg-slate-50">
          + New tab
        </button>
      )}
    </div>
  );
}

function TabPill({ tab, active, onSelect, onChanged }: { tab: TemplateTab; active: boolean; onSelect: () => void; onChanged: () => void }) {
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(tab.name);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setMenu(false), menu);

  const rename = useMutation({ mutationFn: () => api.updateTab(tab.id, { name: name.trim() }), onSuccess: () => { setRenaming(false); onChanged(); } });
  const toggleHide = useMutation({ mutationFn: () => api.updateTab(tab.id, { isHidden: !tab.isHidden }), onSuccess: () => { setMenu(false); onChanged(); } });
  const del = useMutation({ mutationFn: () => api.deleteTab(tab.id), onSuccess: () => { setMenu(false); onChanged(); } });

  if (renaming) {
    return (
      <span className="mb-2 inline-flex items-center gap-1">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) rename.mutate(); if (e.key === 'Escape') setRenaming(false); }}
               className="w-32 rounded-md border border-slate-300 px-2 py-1.5 text-[14px] focus:border-blue-500 focus:outline-none" />
        <button type="button" disabled={!name.trim()} onClick={() => rename.mutate()} className="rounded bg-green-600 px-2 py-1.5 text-[13px] font-semibold text-white disabled:opacity-40">Save</button>
        <button type="button" onClick={() => setRenaming(false)} className="px-1 text-slate-400">✕</button>
      </span>
    );
  }

  return (
    <div ref={ref} className="relative mb-0">
      <div className={`flex items-center gap-1.5 rounded-t-md px-3 py-2.5 text-[15px] font-medium ${active ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
        <span className="cursor-grab select-none text-slate-300">⋮⋮</span>
        <button type="button" onClick={onSelect} className={tab.isHidden ? 'text-slate-400 line-through' : ''}>{tab.name}</button>
        <button type="button" onClick={() => setMenu((v) => !v)} className="grid h-6 w-6 place-items-center rounded text-slate-400 hover:bg-slate-200/60">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></svg>
        </button>
      </div>
      {menu && (
        <div className="absolute left-0 z-30 mt-1 w-40 rounded-lg border border-slate-200 bg-white py-1.5 shadow-xl">
          <button type="button" onClick={() => { setMenu(false); setRenaming(true); }} className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-[14px] text-slate-700 hover:bg-slate-50">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg> Rename
          </button>
          <button type="button" onClick={() => toggleHide.mutate()} className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-[14px] text-slate-700 hover:bg-slate-50">
            {tab.isHidden ? <>👁 Show</> : <>🚫 Hide</>}
          </button>
          {!tab.isSystem && (
            <>
              <div className="my-1 border-t border-slate-100" />
              <button type="button" onClick={() => del.mutate()} className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-[14px] text-red-600 hover:bg-red-50">🗑 Delete</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function HiddenTabState() {
  return (
    <div className="m-4 grid place-items-center rounded-lg border-2 border-dashed border-slate-200 py-16 text-center">
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#93c5fd" strokeWidth="1.6"><path d="m2 2 20 20M6.7 6.7A10.5 10.5 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 4.3-1M9.9 4.2A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.2 3.1" /></svg>
      <p className="mt-3 text-[17px] font-semibold text-slate-700">The tab is hidden</p>
      <p className="text-sm text-slate-400">It won’t be visible in your content. Use the tab menu → Show to enable it.</p>
    </div>
  );
}

/** Confirmation before removing a field — deletion is destructive and can't be undone. */
function ConfirmDeleteField({
  pending, onCancel, onConfirm,
}: {
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" onMouseDown={onCancel}>
      <div onMouseDown={(e) => e.stopPropagation()} className="w-[400px] max-w-full rounded-lg bg-white shadow-2xl">
        <div className="px-6 py-5">
          <h2 className="text-[18px] font-semibold text-slate-900">Delete this field?</h2>
          <p className="mt-1.5 text-[15px] text-slate-600">This can’t be undone.</p>
        </div>
        <footer className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <button type="button" onClick={onCancel}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" disabled={pending} onClick={onConfirm}
                  className="rounded-md bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40">
            {pending ? 'Deleting…' : 'Delete'}
          </button>
        </footer>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ field card */

function FieldCard({ field, isFirst, isLast, onStructuralChange }: { field: TemplateField; isFirst: boolean; isLast: boolean; onStructuralChange: () => void }) {
  const meta = TYPE[field.type] ?? { label: field.type, cat: 'input' as Cat, hasLength: false, icon: '?' };
  const { draft, set } = useFieldSave(field);
  const [confirmDel, setConfirmDel] = useState(false);

  const move = useMutation({ mutationFn: (dir: 'up' | 'down') => api.moveField(field.id, dir), onSuccess: onStructuralChange });
  const del = useMutation({ mutationFn: () => api.deleteField(field.id), onSuccess: () => { setConfirmDel(false); onStructuralChange(); } });

  const system = field.isSystem;
  const isParagraph = field.type === 'paragraph_text';

  return (
    <div className="flex items-stretch gap-2">
      <ReorderRail isFirst={isFirst} isLast={isLast} onUp={() => move.mutate('up')} onDown={() => move.mutate('down')} />

      <div className="relative flex-1 rounded-lg border border-blue-200 bg-blue-50/40">
        {/* type pill (custom fields) */}
        {!system && (
          <span className="absolute -top-3 left-4 inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[13px] font-semibold text-slate-700">
            <span className="text-slate-400">{meta.icon}</span> {meta.label}
          </span>
        )}

        <div className={`px-4 ${system ? 'pt-4' : 'pt-5'} pb-4`}>
          {meta.cat === 'section' ? (
            <SectionBody field={field} draft={draft} set={set} onDelete={() => setConfirmDel(true)} />
          ) : system ? (
            <SystemBody field={field} meta={meta} draft={draft} set={set} />
          ) : (
            <CustomBody field={field} meta={meta} isParagraph={isParagraph} draft={draft} set={set} onDelete={() => setConfirmDel(true)} />
          )}
        </div>

        {confirmDel && (
          <ConfirmDeleteField pending={del.isPending}
                              onCancel={() => setConfirmDel(false)} onConfirm={() => del.mutate()} />
        )}

        {/* guidelines row (not for section fields) */}
        {meta.cat !== 'section' && (
          <div className="border-t border-blue-200 px-4 py-2.5">
            <GuidelineInput value={draft.guidelines ?? ''} placeholder="Field guidelines (optional)"
                            onChange={(v) => set({ guidelines: v }, true)} />
          </div>
        )}
      </div>
    </div>
  );
}

function SystemBody({ field, meta, draft, set }: BodyProps & { meta: TypeMeta }) {
  // Files is the one system field with no Visible/Required toggles.
  const noToggles = field.type === 'file_image_upload';
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-semibold text-slate-800">{field.label}</span>
          <Help />
        </div>
        {meta.hasLength && <LengthControl draft={draft} set={set} />}
        {field.type === 'paragraph_text' && field.label === 'Main content' && (
          <span className="mt-2 inline-flex items-center gap-1.5">
            <button type="button" className="text-[13px] font-medium text-blue-600 hover:underline">▾ Add/edit default content</button>
            <span className="cursor-help text-slate-300" title="Content that will be displayed in your text editor by default after an article is assigned to a writer.">
              <Help />
            </span>
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-4 text-[14px]">
        {!noToggles && <Check label="Visible" checked={draft.isVisible} onChange={(v) => set({ isVisible: v }, false)} />}
        {!noToggles && <Check label="Required" checked={draft.isRequired} onChange={(v) => set({ isRequired: v }, false)} />}
        <span className="inline-flex items-center gap-1 text-slate-400">System field <Help /></span>
      </div>
    </div>
  );
}

function CustomBody({ meta, isParagraph, draft, set, onDelete }: BodyProps & { meta: TypeMeta; isParagraph: boolean; onDelete: () => void }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <input value={draft.label} onChange={(e) => set({ label: e.target.value }, true)}
               placeholder={`Name this ${meta.label.toLowerCase()} field`}
               className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-[14px] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
        <div className="flex shrink-0 items-center gap-4 text-[14px]">
          {isParagraph && <Check label="Plain text" checked={draft.isPlainText} onChange={(v) => set({ isPlainText: v }, false)} />}
          <Check label="Required" checked={draft.isRequired} onChange={(v) => set({ isRequired: v }, false)} />
          <button type="button" onClick={onDelete} title="Delete field" className="text-slate-400 hover:text-red-600">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" /></svg>
          </button>
        </div>
      </div>
      {meta.hasLength && <LengthControl draft={draft} set={set} />}
      {meta.cat === 'choice' && <OptionsEditor draft={draft} set={set} />}
    </div>
  );
}

function SectionBody({ field, draft, set, onDelete }: BodyProps & { onDelete: () => void }) {
  const isGuidelines = field.type === 'guidelines';
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1">
        {isGuidelines ? (
          <textarea value={draft.label} onChange={(e) => set({ label: e.target.value }, true)} rows={3}
                    placeholder="Write the guidelines / instructions for this section"
                    className="w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-[14px] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
        ) : (
          <input value={draft.label} onChange={(e) => set({ label: e.target.value }, true)}
                 placeholder="Heading text (e.g. — SEO Fields —)"
                 className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-[14px] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
        )}
      </div>
      <button type="button" onClick={onDelete} title="Delete field" className="shrink-0 text-slate-400 hover:text-red-600">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" /></svg>
      </button>
    </div>
  );
}

interface BodyProps { field: TemplateField; draft: TemplateField; set: SetFn }
type SetFn = (patch: Partial<TemplateField>, debounced: boolean) => void;

function LengthControl({ draft, set }: { draft: TemplateField; set: SetFn }) {
  return (
    <div className="mt-2 flex items-center gap-2 text-[13px] text-slate-600">
      <span className="font-medium">Set recommended length to</span>
      <input type="number" min={0} value={draft.recommendedLength ?? ''} placeholder="0"
             onChange={(e) => { const v = e.target.value; set({ recommendedLength: v === '' ? undefined : Math.max(0, Math.floor(Number(v))) }, true); }}
             className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1.5 focus:border-blue-500 focus:outline-none" />
      <select value={draft.recommendedLengthUnits ?? 'words'} onChange={(e) => set({ recommendedLengthUnits: e.target.value }, false)}
              className="rounded-md border border-slate-300 bg-white px-2 py-1.5">
        <option value="words">Words</option>
        <option value="characters">Characters</option>
      </select>
    </div>
  );
}

function OptionsEditor({ draft, set }: { draft: TemplateField; set: SetFn }) {
  const choices = draft.choices ?? [];
  const update = (next: string[]) => set({ choices: next }, true);
  return (
    <div className="mt-3 space-y-2">
      {choices.map((opt, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-slate-400">✓</span>
          <input value={opt} onChange={(e) => { const n = [...choices]; n[i] = e.target.value; update(n); }}
                 placeholder="Add your label for this option"
                 className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[14px] focus:border-blue-500 focus:outline-none" />
          <button type="button" onClick={() => update(choices.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600">✕</button>
        </div>
      ))}
      <button type="button" onClick={() => set({ choices: [...choices, ''] }, false)} className="text-[14px] font-medium text-blue-600 hover:underline">+ Add option</button>
    </div>
  );
}

function GuidelineInput({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="1.7" className="shrink-0"
           aria-label="Guidance for the person writing this field. Shown to the author as they work.">
        <title>Guidance for the person writing this field. Shown to the author as they work.</title>
        <rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h5M8 12l2 2 4-4" /></svg>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
             className="w-full bg-transparent text-[14px] text-slate-700 placeholder:text-slate-400 focus:outline-none" />
    </div>
  );
}

function ReorderRail({ isFirst, isLast, onUp, onDown }: { isFirst: boolean; isLast: boolean; onUp: () => void; onDown: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-blue-200 bg-blue-50/40 px-1.5">
      <button type="button" onClick={onUp} disabled={isFirst} className="text-slate-400 hover:text-slate-700 disabled:opacity-30"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 15l6-6 6 6" /></svg></button>
      <span className="select-none text-slate-300">⋮⋮</span>
      <button type="button" onClick={onDown} disabled={isLast} className="text-slate-400 hover:text-slate-700 disabled:opacity-30"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg></button>
    </div>
  );
}

function AddFieldButton({ tabId, onAdded }: { tabId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false), open);
  const add = useMutation({ mutationFn: (type: string) => api.createField(tabId, type), onSuccess: () => { setOpen(false); onAdded(); } });
  return (
    <div ref={ref} className="relative inline-block">
      <button type="button" onClick={() => setOpen((v) => !v)}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-slate-50 px-5 py-2.5 text-[13px] font-semibold uppercase tracking-wide text-slate-700 hover:bg-slate-100">
        <span className="text-lg leading-none">+</span> Add a new field <span className="text-slate-400">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-56 rounded-lg border border-slate-200 bg-white py-1.5 shadow-xl">
          {ADD_MENU.map((g) => (
            <div key={g.group}>
              <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{g.group}</p>
              {g.types.map((ty) => (
                <button key={ty} type="button" onClick={() => add.mutate(ty)} className="flex w-full items-center gap-3 px-4 py-2 text-left text-[14px] text-slate-700 hover:bg-slate-50">
                  <span className="w-4 text-center text-slate-400">{TYPE[ty]!.icon}</span> {TYPE[ty]!.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- helpers */

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 font-medium text-slate-700">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 cursor-pointer accent-blue-600" />
      {label}
    </label>
  );
}

function Help() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-300"><circle cx="12" cy="12" r="10" /><path d="M9.5 9a2.5 2.5 0 0 1 4.5 1.5c0 1.5-2 2-2 3.5" /><path d="M12 17h.01" /></svg>;
}

/** Debounced field save. `set(patch, debounced)` updates local draft; text edits debounce, toggles save now. */
function useFieldSave(field: TemplateField) {
  const [draft, setDraft] = useState<TemplateField>(field);
  const pending = useRef<Record<string, unknown>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-sync when the underlying field identity/props change (after refetch).
  useEffect(() => { setDraft(field); }, [field.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const flush = () => {
    const p = pending.current; pending.current = {};
    if (Object.keys(p).length) api.updateField(field.id, p).catch(() => {});
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); flush(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const set: SetFn = (patch, debounced) => {
    setDraft((d) => ({ ...d, ...patch }));
    pending.current = { ...pending.current, ...patch };
    if (timer.current) clearTimeout(timer.current);
    if (debounced) { timer.current = setTimeout(flush, 600); } else { flush(); }
  };
  return { draft, set };
}

function useOutside(ref: React.RefObject<HTMLElement | null>, onClose: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [ref, onClose, active]);
}

function useDebounced<T>(fn: (v: T) => void, ms = 600) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (v: T) => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => fn(v), ms); };
}
