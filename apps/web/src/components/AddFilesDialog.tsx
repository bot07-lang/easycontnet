import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type LibraryFile, type StoredFile } from '../lib/api';
import { supabase } from '../lib/supabase';

const BUCKET = 'content-files';

/** A file being uploaded in the "Upload files" tab, before it's confirmed. */
type Pending = {
  key: string;
  file: File;
  previewUrl: string | null;
  status: 'processing' | 'done' | 'error';
  rec?: StoredFile;
  error?: string;
};

/**
 * The "Add files" modal, matching the reference: two tabs — pick from the
 * project's file library, or upload new files into it. Uploaded files show as
 * preview cards (thumbnail + processing state + trash) and are only attached
 * to the field once you press Insert. Uploads go straight to Storage via a
 * signed URL, so they aren't bounded by the serverless body-size cap.
 */
export function AddFilesDialog({
  projectId, existingIds, onInsert, onClose,
}: {
  projectId: string;
  existingIds: string[];
  onInsert: (files: StoredFile[]) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'library' | 'upload'>('library');
  const [libSelected, setLibSelected] = useState<Map<string, StoredFile>>(new Map());
  const [pending, setPending] = useState<Pending[]>([]);
  const [folder, setFolder] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef(0);
  const pendingRef = useRef<Pending[]>([]);
  pendingRef.current = pending;

  const library = useQuery({ queryKey: ['files', projectId], queryFn: () => api.listFiles(projectId) });
  const folders = useQuery({ queryKey: ['file-folders', projectId], queryFn: () => api.listFileFolders(projectId) });

  // Revoke object URLs on unmount so previews don't leak.
  useEffect(() => () => pendingRef.current.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl)), []);

  const already = new Set(existingIds);
  const toggleLib = (f: LibraryFile) => {
    setLibSelected((prev) => {
      const next = new Map(prev);
      if (next.has(f.id)) next.delete(f.id);
      else next.set(f.id, { id: f.id, name: f.name, mime: f.mime, sizeBytes: f.sizeBytes });
      return next;
    });
  };

  const uploadOne = async (file: File) => {
    const key = String(++keyRef.current);
    const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
    setPending((p) => [...p, { key, file, previewUrl, status: 'processing' }]);
    const patch = (u: Partial<Pending>) => setPending((p) => p.map((x) => (x.key === key ? { ...x, ...u } : x)));
    try {
      const { path, token } = await api.createUploadUrl(projectId, file.name);
      const up = await supabase.storage.from(BUCKET).uploadToSignedUrl(path, token, file, { contentType: file.type });
      if (up.error) throw up.error;
      const rec = await api.recordFile({ projectId, path, name: file.name, mime: file.type || null, size: file.size, folder: folder || null });
      patch({ status: 'done', rec: { id: rec.id, name: rec.name, mime: rec.mime, sizeBytes: rec.sizeBytes } });
      qc.invalidateQueries({ queryKey: ['files', projectId] });
      qc.invalidateQueries({ queryKey: ['file-folders', projectId] });
    } catch (e) {
      patch({ status: 'error', error: e instanceof Error ? e.message : 'Upload failed' });
    }
  };

  const handleFiles = (list: FileList | null) => {
    if (!list) return;
    Array.from(list).forEach((f) => void uploadOne(f));
  };

  // Trash a just-uploaded file: drop the card and delete the orphaned object.
  const removePending = async (key: string) => {
    const item = pending.find((x) => x.key === key);
    setPending((p) => p.filter((x) => x.key !== key));
    if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
    if (item?.rec) {
      try {
        await api.deleteFile(item.rec.id);
        qc.invalidateQueries({ queryKey: ['files', projectId] });
      } catch { /* leave the orphan rather than surface a delete error here */ }
    }
  };

  const doneUploads = pending.filter((p) => p.status === 'done' && p.rec).map((p) => p.rec!);
  const totalSelected = libSelected.size + doneUploads.length;
  const insert = () => { onInsert([...libSelected.values(), ...doneUploads]); onClose(); };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-6" onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} className="flex h-[560px] w-[900px] max-w-full flex-col rounded-lg bg-white shadow-2xl">
        <header className="flex items-center gap-6 border-b border-slate-200 px-6 pt-4">
          {(['library', 'upload'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)}
                    className={`-mb-px border-b-2 pb-3 text-[15px] ${
                      tab === t ? 'border-blue-600 font-medium text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}>
              {t === 'library' ? 'From project library' : 'Upload files'}
            </button>
          ))}
          <button type="button" onClick={onClose} className="ml-auto grid h-8 w-8 place-items-center rounded text-slate-500 hover:bg-slate-100">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {tab === 'library' ? (
            library.isLoading ? (
              <p className="text-sm text-slate-400">Loading…</p>
            ) : !library.data?.length ? (
              <div className="grid h-full place-items-center text-center">
                <div>
                  <CloudArt />
                  <p className="mt-4 text-[22px] text-slate-700">There are no files or media in this project</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
                {library.data.map((f) => (
                  <FileTile key={f.id} file={f} selected={libSelected.has(f.id)} already={already.has(f.id)} onClick={() => toggleLib(f)} />
                ))}
              </div>
            )
          ) : (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
            >
              <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
                {/* Drop zone / picker card */}
                <div className={`grid min-h-[230px] place-items-center rounded-lg border-2 border-dashed ${dragOver ? 'border-blue-400 bg-blue-50' : 'border-slate-300'}`}>
                  <div className="text-center">
                    <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" className="mx-auto">
                      <path d="M12 16V4m0 0-4 4m4-4 4 4" /><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                    </svg>
                    <input ref={inputRef} type="file" multiple className="sr-only" onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
                    <button type="button" onClick={() => inputRef.current?.click()}
                            className="mt-3 block w-full text-[15px] font-medium text-blue-600 hover:underline">
                      Select files to upload
                    </button>
                    <p className="mt-1 text-[14px] text-slate-500">or drag and drop here</p>
                  </div>
                </div>

                {/* Preview cards for the files being uploaded */}
                {pending.map((p) => (
                  <figure key={p.key} className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
                    <div className="relative h-[170px] shrink-0 bg-slate-100">
                      <button type="button" onClick={() => removePending(p.key)} title="Remove"
                              className="absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded bg-white/85 text-slate-600 shadow hover:text-red-600">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6M14 11v6" />
                        </svg>
                      </button>
                      {p.previewUrl
                        ? <img src={p.previewUrl} alt={p.file.name} className="absolute inset-0 h-full w-full object-contain p-2" />
                        : <span className="grid h-full place-items-center text-[12px] font-semibold uppercase text-slate-400">{ext(p.file.name)}</span>}
                      {p.status === 'processing' && (
                        <div className="absolute inset-0 grid place-items-center bg-white/60 text-[13px] font-medium text-slate-600">Processing…</div>
                      )}
                    </div>
                    <figcaption className="border-t border-slate-100 bg-white p-3">
                      <p className="truncate text-[13px] font-medium text-slate-800" title={p.file.name}>{p.file.name}</p>
                      <p className={`text-[12px] ${p.status === 'error' ? 'text-red-600' : 'text-slate-500'}`}>
                        {p.status === 'error' ? (p.error ?? 'Failed') : formatSize(p.file.size)}
                      </p>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          )}
        </div>

        <footer className="flex items-center gap-3 border-t border-slate-200 px-6 py-4">
          {tab === 'upload' && (
            <select value={folder} onChange={(e) => setFolder(e.target.value)}
                    className="h-10 rounded-md border border-slate-300 bg-white px-3 text-[14px] text-slate-700">
              <option value="">Assign a folder</option>
              {folders.data?.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          )}
          <div className="ml-auto flex items-center gap-2">
            {totalSelected > 0 && <span className="text-[13px] text-slate-500">{totalSelected} selected</span>}
            <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-5 py-2 text-sm font-semibold uppercase tracking-wide text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="button" onClick={insert} disabled={totalSelected === 0}
                    className="rounded-md bg-green-500 px-6 py-2 text-sm font-semibold uppercase tracking-wide text-white hover:bg-green-600 disabled:opacity-40">Insert</button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function FileTile({ file, selected, already, onClick }: { file: LibraryFile; selected: boolean; already: boolean; onClick: () => void }) {
  const isImage = (file.mime ?? '').startsWith('image/') && file.url;
  return (
    <button type="button" onClick={onClick}
            className={`group relative overflow-hidden rounded-md border text-left transition ${
              selected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200 hover:border-slate-300'
            }`}>
      <div className="grid h-[110px] place-items-center bg-slate-100">
        {isImage
          ? <img src={file.url!} alt={file.name} className="h-full w-full object-cover" />
          : <span className="text-[11px] font-semibold uppercase text-slate-400">{ext(file.name)}</span>}
      </div>
      <div className="px-2 py-1.5">
        <p className="truncate text-[12px] font-medium text-slate-700" title={file.name}>{file.name}</p>
        <p className="text-[11px] text-slate-400">{formatSize(file.sizeBytes)}{already ? ' · added' : ''}</p>
      </div>
      {selected && (
        <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-blue-600 text-white">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" /></svg>
        </span>
      )}
    </button>
  );
}

function CloudArt() {
  return (
    <svg width="120" height="90" viewBox="0 0 120 90" fill="none" className="mx-auto">
      <ellipse cx="60" cy="45" rx="52" ry="38" fill="#eef2ff" />
      <path d="M46 52a10 10 0 0 1 .8-19.9A15 15 0 0 1 76 34a11 11 0 0 1-1 22H46z" fill="#c7d2fe" />
      <path d="M61 30v14m0-14-5 5m5-5 5 5" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ext(name: string) {
  const m = name.match(/\.(\w+)$/);
  return m ? m[1] : 'file';
}
export function formatSize(bytes: number | null) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
