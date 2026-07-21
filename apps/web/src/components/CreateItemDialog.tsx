import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

/**
 * "Create new content item" dialog: a title, and a starting structure —
 * Blank (a minimal auto-provisioned template) or one of the project's
 * templates. Matches the reference create flow.
 */
export function CreateItemDialog({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'blank' | 'template'>('template');
  const [templateId, setTemplateId] = useState<string>('');
  const [showOptional, setShowOptional] = useState(false);
  const [description, setDescription] = useState('');
  const [keywords, setKeywords] = useState('');

  const templates = useQuery({
    queryKey: ['templates', projectId],
    queryFn: () => api.listTemplates(projectId),
  });

  // Default the picker to the project's default template once loaded.
  if (mode === 'template' && !templateId && templates.data?.length) {
    setTemplateId(templates.data[0]!.id);
  }
  // If the project has no templates, only Blank is possible.
  const hasTemplates = (templates.data?.length ?? 0) > 0;

  const create = useMutation({
    mutationFn: () =>
      api.createItem(projectId, name.trim(), mode === 'template' && hasTemplates ? templateId : null, {
        description: description.trim() || undefined,
        keywords: keywords.split(',').map((k) => k.trim()).filter(Boolean),
      }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['items', projectId] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      onCreated(res.id);
    },
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} className="w-[600px] max-w-full rounded-lg bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-[19px] font-semibold text-slate-900">Create new content item</h2>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded text-slate-500 hover:bg-slate-100">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>

        <div className="px-6 py-5">
          <label className="mb-5 block">
            <span className="mb-1.5 block text-[15px] font-medium text-slate-700">Title / Summary</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
                   placeholder="Give a name to this content item. What is it going to be about?"
                   className="w-full rounded-md border border-slate-300 px-3 py-2.5 text-[15px]
                              focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
          </label>

          <p className="mb-2 text-[15px] font-medium text-slate-700">Choose starting structure</p>

          <label className="flex items-center gap-3 py-1.5 text-[15px] text-slate-800">
            <input type="radio" checked={mode === 'blank'} onChange={() => setMode('blank')}
                   className="h-4 w-4 accent-blue-600" />
            Blank (free-form)
          </label>

          <label className="flex items-center gap-3 py-1.5 text-[15px] text-slate-800">
            <input type="radio" checked={mode === 'template'} onChange={() => setMode('template')}
                   disabled={!hasTemplates} className="h-4 w-4 accent-blue-600" />
            Use a template
          </label>

          {mode === 'template' && (
            <div className="ml-7 mt-1">
              {templates.isLoading ? (
                <p className="text-sm text-slate-400">Loading templates…</p>
              ) : hasTemplates ? (
                <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}
                        className="w-full rounded-md border border-slate-300 px-3 py-2.5 text-[15px] text-slate-800">
                  {templates.data!.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}{t.is_default ? ' (default)' : ''}</option>
                  ))}
                </select>
              ) : (
                <p className="text-sm text-slate-400">This project has no templates yet — choose Blank.</p>
              )}
            </div>
          )}

          <button type="button" onClick={() => setShowOptional((v) => !v)}
                  className="mt-5 flex items-center gap-1.5 text-[15px] font-medium text-blue-600 hover:text-blue-700">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                 className={`transition-transform ${showOptional ? 'rotate-90' : ''}`}>
              <path d="M9 18l6-6-6-6" />
            </svg>
            {showOptional ? 'Hide optional fields' : 'Show optional fields'}
          </button>

          {showOptional && (
            <div className="mt-4 space-y-5 border-t border-slate-100 pt-4">
              <label className="block">
                <span className="mb-1.5 block text-[15px] font-medium text-slate-700">Description</span>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
                          placeholder="Optionally, provide instructions to the writer."
                          className="w-full resize-y rounded-md border border-slate-300 px-3 py-2.5 text-[15px]
                                     focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[15px] font-medium text-slate-700">Keywords</span>
                <input value={keywords} onChange={(e) => setKeywords(e.target.value)}
                       placeholder="Optionally, add comma separated keywords."
                       className="w-full rounded-md border border-slate-300 px-3 py-2.5 text-[15px]
                                  focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
              </label>

              <div>
                <p className="mb-1.5 text-[15px] font-medium text-slate-700">Categories</p>
                <p className="rounded-md bg-slate-50 px-3 py-3 text-[14px] text-slate-500">
                  Currently there are no categories in this project. Go to the Categories section to create them.
                </p>
              </div>

              {/* Placeholder for the reference's "Assign people after creating" —
                  when checked it opens the assign-people flow right after creation.
                  Disabled until the assignment panel + manage_people_and_deadlines
                  gating are built. */}
              <label className="flex items-center gap-3 text-[15px] text-slate-400" title="Coming soon">
                <input type="checkbox" disabled className="h-4 w-4 accent-blue-600" />
                Assign people after creating
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-400">
                  Coming soon
                </span>
              </label>
            </div>
          )}

          {create.isError && (
            <p className="mt-3 text-sm text-red-600">Couldn’t create — you may not have permission.</p>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <button type="button" onClick={onClose}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button type="button" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}
                  className="rounded-md bg-green-600 px-5 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-40">
            {create.isPending ? 'Creating…' : 'Create item'}
          </button>
        </footer>
      </div>
    </div>
  );
}
