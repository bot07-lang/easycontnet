import { useState } from 'react';

export interface LinkValues {
  url: string;
  text: string;
  title: string;
  target: string; // '' = current window, '_blank' = new window
}

/**
 * Insert/Edit Link dialog, matching the reference: URL (with a browse
 * affordance), Text to display, Title, and an "Open link in…" selector.
 * Saving with an empty URL removes the link.
 */
export function LinkDialog({
  initial, onSave, onClose,
}: {
  initial: LinkValues;
  onSave: (v: LinkValues) => void;
  onClose: () => void;
}) {
  const [url, setUrl] = useState(initial.url);
  const [text, setText] = useState(initial.text);
  const [title, setTitle] = useState(initial.title);
  const [target, setTarget] = useState(initial.target);

  const save = () => onSave({ url: url.trim(), text, title, target });

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-900/40 p-6" onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} className="w-[560px] max-w-full rounded-lg bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-3.5">
          <h2 className="text-[20px] font-semibold text-slate-900">Insert/Edit Link</h2>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded text-slate-500 hover:bg-slate-100">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>

        <div className="space-y-4 px-6 py-5">
          <div>
            <label className="mb-1.5 block text-[14px] text-slate-500">URL</label>
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
                className="h-11 flex-1 rounded-md border border-slate-300 px-3 text-[15px] text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {/* Browse — asset picker isn't wired for links yet. */}
              <button type="button" disabled title="Browse files — coming later"
                      className="grid h-11 w-11 shrink-0 cursor-not-allowed place-items-center rounded-md border border-slate-300 text-slate-400">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M12 15V4m0 0-4 4m4-4 4 4" /><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
                </svg>
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[14px] text-slate-500">Text to display</label>
            <input value={text} onChange={(e) => setText(e.target.value)}
                   className="h-11 w-full rounded-md border border-slate-300 px-3 text-[15px] text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>

          <div>
            <label className="mb-1.5 block text-[14px] text-slate-500">Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)}
                   className="h-11 w-full rounded-md border border-slate-300 px-3 text-[15px] text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>

          <div>
            <label className="mb-1.5 block text-[14px] text-slate-500">Open link in…</label>
            <select value={target} onChange={(e) => setTarget(e.target.value)}
                    className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-[15px] text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
              <option value="">Current window</option>
              <option value="_blank">New window</option>
            </select>
          </div>
        </div>

        <footer className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={save} className="rounded-md bg-blue-600 px-6 py-2 text-sm font-semibold text-white hover:bg-blue-700">Save</button>
        </footer>
      </div>
    </div>
  );
}
