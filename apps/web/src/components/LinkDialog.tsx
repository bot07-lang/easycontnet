import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ext, formatSize, timeAgo } from './AddFilesDialog';
import { isSafeUrl } from './editor-extensions';

export interface LinkValues {
  url: string;
  text: string;
  title: string;
  target: string; // '' = current window, '_blank' = new window
}

/** A file attached to the current content item, pickable in the Browse dialog. */
export interface LinkedFile {
  url: string;
  name: string;
  mime?: string | null;
  /** Small image preview URL, or null for a non-image file (shown as a badge). */
  thumbUrl: string | null;
  uploadedAt?: string;
  sizeBytes?: number | null;
}

/**
 * "Browse files" — pick a file already attached to this content item, matching
 * the Insert/Edit Image dialog's "Please select an image" picker (same layout,
 * generalized: a non-image file shows its extension as a badge instead of a
 * thumbnail, since most files have no visual preview).
 */
function FilePicker({
  files, onPick, onClose,
}: {
  files: LinkedFile[];
  onPick: (f: LinkedFile) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<LinkedFile | null>(null);

  return createPortal(
    // z-[71] — above LinkDialog itself (z-[70]), same reasoning as the image
    // picker: a portal sibling needs an unambiguous edge over what it layers on.
    <div className="fixed inset-0 z-[71] grid place-items-start bg-black/40 p-6" onMouseDown={onClose}>
      <div className="mx-auto w-full max-w-6xl rounded-lg bg-white p-6 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-slate-900">Please select a file</h2>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-800" aria-label="Close">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        {files.length === 0 ? (
          <p className="py-16 text-center text-[15px] text-slate-400">No files are linked to this content item yet.</p>
        ) : (
          <div className="flex gap-6">
            <div className="grid flex-1 grid-cols-[repeat(auto-fill,minmax(190px,1fr))] content-start gap-4">
              {files.map((f) => {
                const isSel = selected?.url === f.url;
                return (
                  <button
                    key={f.url}
                    type="button"
                    onClick={() => setSelected(f)}
                    onDoubleClick={() => onPick(f)}
                    className={`flex flex-col overflow-hidden rounded-md border-2 text-left transition ${
                      isSel ? 'border-amber-400 shadow-md' : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <span className="grid h-[150px] place-items-center overflow-hidden bg-slate-50">
                      {f.thumbUrl
                        ? <img src={f.thumbUrl} alt={f.name} className="h-full w-full object-contain" />
                        : <span className="text-[12px] font-semibold uppercase text-slate-400">{ext(f.name)}</span>}
                    </span>
                    <span className="border-t border-slate-200 px-3 py-2">
                      <span className="block truncate text-[13px] font-semibold text-slate-800">{f.name}</span>
                      <span className="block text-[12px] text-slate-400">
                        {[f.uploadedAt ? `Uploaded ${timeAgo(f.uploadedAt)}` : null, formatSize(f.sizeBytes ?? null) || null].filter(Boolean).join(' — ')}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex shrink-0 flex-col items-center gap-4 self-center">
              <button
                type="button"
                disabled={!selected}
                onClick={() => selected && onPick(selected)}
                title="Use selected file"
                className="grid h-14 w-14 place-items-center rounded-full bg-green-500 text-white shadow-md transition hover:bg-green-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6 9 17l-5-5" /></svg>
              </button>
              <button
                type="button"
                onClick={onClose}
                title="Cancel"
                className="grid h-14 w-14 place-items-center rounded-full border border-slate-300 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Insert/Edit Link dialog, matching the reference: URL (with a browse
 * affordance), Text to display, Title, and an "Open link in…" selector.
 * Saving with an empty URL removes the link.
 */
export function LinkDialog({
  initial, onSave, onClose, linkedFiles,
}: {
  initial: LinkValues;
  onSave: (v: LinkValues) => void;
  onClose: () => void;
  /** Files attached to the current item — enables the Browse button. */
  linkedFiles?: LinkedFile[];
}) {
  const [url, setUrl] = useState(initial.url);
  const [text, setText] = useState(initial.text);
  const [title, setTitle] = useState(initial.title);
  const [target, setTarget] = useState(initial.target);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [urlError, setUrlError] = useState(false);

  const save = () => {
    const trimmed = url.trim();
    if (!isSafeUrl(trimmed)) { setUrlError(true); return; }
    setUrlError(false);
    onSave({ url: trimmed, text, title, target });
  };

  const pickFile = (f: LinkedFile) => {
    setUrl(f.url);
    setPickerOpen(false);
  };

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
                onChange={(e) => { setUrl(e.target.value); setUrlError(false); }}
                onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
                className={`h-11 flex-1 rounded-md border px-3 text-[15px] text-slate-800 focus:outline-none focus:ring-1 ${
                  urlError ? 'border-red-400 focus:border-red-500 focus:ring-red-200' : 'border-slate-300 focus:border-blue-500 focus:ring-blue-500'
                }`}
              />
              <button type="button" onClick={() => setPickerOpen(true)} title="Browse files linked to this item"
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M12 15V4m0 0-4 4m4-4 4 4" /><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
                </svg>
              </button>
            </div>
            {urlError && (
              <p className="mt-1.5 text-[13px] text-red-600">
                That URL isn’t allowed — links must start with http://, https://, mailto:, or tel:.
              </p>
            )}
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

      {pickerOpen && (
        <FilePicker files={linkedFiles ?? []} onPick={pickFile} onClose={() => setPickerOpen(false)} />
      )}
    </div>
  );
}
