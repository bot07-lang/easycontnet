import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type LibraryFile } from '../lib/api';
import { supabase } from '../lib/supabase';
import { toast } from '../lib/toast';
import { formatSize, downloadFile, timeAgo, ext } from './AddFilesDialog';

const BUCKET = 'content-files';

type LinkFilter = 'all' | 'linked' | 'unlinked';
type Sort = 'newest' | 'oldest' | 'name-asc' | 'name-desc' | 'size-asc' | 'size-desc';

const SORTS: { key: Sort; label: string }[] = [
  { key: 'newest', label: 'Date: newest first' },
  { key: 'oldest', label: 'Date: oldest first' },
  { key: 'name-asc', label: 'Name: A to Z' },
  { key: 'name-desc', label: 'Name: Z to A' },
  { key: 'size-asc', label: 'Size: smallest first' },
  { key: 'size-desc', label: 'Size: largest first' },
];

/**
 * The standalone "Files & Media" page (sidebar → Files). Browses the whole
 * project file library — the same files a content item's Files field uploads
 * into or links from — with search, a linked/unlinked filter, sorting, and
 * per-file actions. "Add files" uploads new bytes straight into the library
 * (no content item is linked here; linking happens from an item's Files field).
 */
export function FilesPage({
  projectId, onOpenItem,
}: {
  projectId: string;
  onOpenItem: (id: string) => void;
}) {
  const qc = useQueryClient();
  const library = useQuery({ queryKey: ['files', projectId], queryFn: () => api.listFiles(projectId) });

  const [query, setQuery] = useState('');
  const [linkFilter, setLinkFilter] = useState<LinkFilter>('all');
  const [sort, setSort] = useState<Sort>('newest');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menuId, setMenuId] = useState<string | null>(null);
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirm, setConfirm] = useState<LibraryFile[] | null>(null);

  const files = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (library.data ?? []).filter((f) => {
      const linked = f.linkedItems.length > 0;
      if (linkFilter === 'linked' && !linked) return false;
      if (linkFilter === 'unlinked' && linked) return false;
      if (q) {
        const inName = f.name.toLowerCase().includes(q);
        const inItem = f.linkedItems.some((i) => i.name.toLowerCase().includes(q));
        if (!inName && !inItem) return false;
      }
      return true;
    });
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sort) {
        case 'oldest': return a.createdAt.localeCompare(b.createdAt);
        case 'name-asc': return a.name.localeCompare(b.name);
        case 'name-desc': return b.name.localeCompare(a.name);
        case 'size-asc': return (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0);
        case 'size-desc': return (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0);
        default: return b.createdAt.localeCompare(a.createdAt);
      }
    });
    return sorted;
  }, [library.data, query, linkFilter, sort]);

  // Keep the selection pruned to what's actually visible/existing.
  const visibleIds = useMemo(() => files.map((f) => f.id), [files]);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0;

  const toggle = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () =>
    setSelected(() => (allSelected ? new Set() : new Set(visibleIds)));

  const selectedFiles = useMemo(
    () => (library.data ?? []).filter((f) => selected.has(f.id)),
    [library.data, selected],
  );

  const doDelete = async () => {
    const list = confirm;
    if (!list) return;
    setConfirm(null);
    try {
      await Promise.all(list.map((f) => api.deleteFile(f.id)));
      setSelected((prev) => { const n = new Set(prev); list.forEach((f) => n.delete(f.id)); return n; });
      qc.invalidateQueries({ queryKey: ['files', projectId] });
      qc.invalidateQueries({ queryKey: ['file-folders', projectId] });
      toast(list.length > 1 ? `${list.length} files deleted.` : 'File deleted.');
    } catch {
      toast('Could not delete the file(s).');
    }
  };

  const move = async (f: LibraryFile) => {
    setMenuId(null);
    const dest = window.prompt('Move to folder (leave blank to clear):', f.folder ?? '');
    if (dest === null) return;
    try {
      await api.moveFile(f.id, dest.trim() || null);
      qc.invalidateQueries({ queryKey: ['files', projectId] });
      qc.invalidateQueries({ queryKey: ['file-folders', projectId] });
      toast('File moved.');
    } catch {
      toast('Could not move the file.');
    }
  };

  const hasNoFiles = !library.isLoading && (library.data?.length ?? 0) === 0;

  return (
    <div className="mx-auto max-w-[1500px]" onClick={() => setMenuId(null)}>
      <h1 className="mb-5 text-[26px] font-semibold text-slate-800">Files &amp; Media</h1>

      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        {/* Toolbar */}
        <div className="mb-6 flex flex-wrap items-center gap-4">
          <button type="button" onClick={toggleAll} title={allSelected ? 'Deselect all' : 'Select all'}
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded border ${
                    allSelected ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white'
                  }`}>
            {allSelected && <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" /></svg>}
          </button>

          <div className="relative w-80 max-w-full">
            <input value={query} onChange={(e) => setQuery(e.target.value)}
                   placeholder="Search by file or item name"
                   className="h-10 w-full rounded-md border border-slate-300 pl-3 pr-9 text-[14px] text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none" />
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                 className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
            </svg>
          </div>

          <div className="flex overflow-hidden rounded-md border border-slate-300 text-[14px]">
            {(['all', 'linked', 'unlinked'] as const).map((k) => (
              <button key={k} type="button" onClick={() => setLinkFilter(k)}
                      className={`px-4 py-2 capitalize transition ${
                        linkFilter === k ? 'bg-slate-100 font-medium text-slate-900' : 'bg-white text-slate-600 hover:bg-slate-50'
                      }`}>
                {k}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-3">
            {someSelected && (
              <button type="button" onClick={() => setConfirm(selectedFiles)}
                      className="inline-flex items-center gap-2 rounded-md border border-red-300 px-4 py-2 text-[13px] font-semibold uppercase tracking-wide text-red-600 hover:bg-red-50">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6M14 11v6" /></svg>
                Delete ({selected.size})
              </button>
            )}
            <button type="button" onClick={() => setUploading(true)}
                    className="inline-flex items-center gap-2 rounded-md bg-green-500 px-5 py-2.5 text-sm font-semibold uppercase tracking-wide text-white hover:bg-green-600">
              <span className="text-lg leading-none">+</span> Add files
            </button>
          </div>
        </div>

        {/* Files heading + sort */}
        <div className="mb-4 flex items-end justify-between">
          <h2 className="text-[22px] font-semibold text-slate-800">Files</h2>
          <label className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">
            Sort by
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}
                    className="rounded-md border border-slate-300 px-3 py-2 text-[14px] font-normal normal-case text-slate-700 focus:border-blue-500 focus:outline-none">
              {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
        </div>

        {library.isLoading ? (
          <p className="py-10 text-sm text-slate-400">Loading…</p>
        ) : hasNoFiles ? (
          <div className="grid place-items-center py-20 text-center">
            <div>
              <CloudArt />
              <p className="mt-4 text-[22px] text-slate-700">There are no files or media in this project</p>
              <p className="mt-1 text-[15px] text-slate-500">Upload files to build up this project’s library.</p>
            </div>
          </div>
        ) : files.length === 0 ? (
          <p className="py-16 text-center text-sm text-slate-400">No files match your criteria</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-5">
            {files.map((f) => (
              <FileCard
                key={f.id}
                file={f}
                selected={selected.has(f.id)}
                menuOpen={menuId === f.id}
                onToggle={() => toggle(f.id)}
                onMenu={() => setMenuId((cur) => (cur === f.id ? null : f.id))}
                onView={() => { setMenuId(null); if (f.url) setViewUrl(f.fullUrl || f.url); }}
                onDownload={() => { setMenuId(null); if (f.fullUrl || f.url) downloadFile((f.fullUrl || f.url)!, f.name); }}
                onMove={() => move(f)}
                onDelete={() => { setMenuId(null); setConfirm([f]); }}
                onOpenItem={onOpenItem}
              />
            ))}
          </div>
        )}
      </div>

      {uploading && (
        <UploadDialog projectId={projectId} onClose={() => setUploading(false)}
                      onUploaded={() => { qc.invalidateQueries({ queryKey: ['files', projectId] }); }} />
      )}

      {confirm && <DeleteConfirm files={confirm} onCancel={() => setConfirm(null)} onDelete={doDelete} />}

      {viewUrl && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-900/80 p-8" onMouseDown={() => setViewUrl(null)}>
          <img src={viewUrl} alt="" className="max-h-full max-w-full rounded shadow-2xl" onMouseDown={(e) => e.stopPropagation()} />
          <button type="button" onClick={() => setViewUrl(null)}
                  className="absolute right-6 top-6 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
      )}
    </div>
  );
}

function FileCard({
  file, selected, menuOpen, onToggle, onMenu, onView, onDownload, onMove, onDelete, onOpenItem,
}: {
  file: LibraryFile;
  selected: boolean;
  menuOpen: boolean;
  onToggle: () => void;
  onMenu: () => void;
  onView: () => void;
  onDownload: () => void;
  onMove: () => void;
  onDelete: () => void;
  onOpenItem: (id: string) => void;
}) {
  const isImage = (file.mime ?? '').startsWith('image/') && file.url;
  const badge = ext(file.name).toUpperCase();
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className={`flex flex-col overflow-hidden rounded-md border bg-white text-left ${
      selected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200'
    }`}>
      <div className="relative h-[150px] shrink-0 bg-slate-100">
        <button type="button" onClick={(e) => { stop(e); onToggle(); }} title={selected ? 'Deselect' : 'Select'}
                className={`absolute left-2 top-2 z-10 grid h-6 w-6 place-items-center rounded border ${
                  selected ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white'
                }`}>
          {selected && <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" /></svg>}
        </button>

        <button type="button" onClick={(e) => { stop(e); onMenu(); }}
                className="absolute right-2 top-2 z-10 grid h-7 w-7 place-items-center rounded bg-white/85 text-slate-600 shadow hover:bg-white">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
        </button>
        {menuOpen && (
          <div onClick={stop} className="absolute right-2 top-10 z-20 w-40 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg">
            <MenuItem label="View" disabled={!file.url} onClick={onView}><circle cx="11" cy="11" r="6" /><path d="m20 20-3.5-3.5" /></MenuItem>
            <MenuItem label="Download" disabled={!file.url} onClick={onDownload}><path d="M12 3v12m0 0-4-4m4 4 4-4M5 19h14" /></MenuItem>
            <MenuItem label="Move" disabled onClick={onMove}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></MenuItem>
            <div className="my-1 border-t border-slate-100" />
            <MenuItem label="Delete" danger onClick={onDelete}><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6M14 11v6" /></MenuItem>
          </div>
        )}

        {isImage
          ? <img src={file.url!} alt={file.name} className="h-full w-full cursor-pointer object-cover" onClick={onView} />
          : <span className="grid h-full place-items-center text-[13px] font-semibold uppercase text-slate-400">{badge}</span>}
      </div>

      <div className="flex flex-col gap-1 p-3">
        <p className="truncate text-[14px] font-medium text-slate-800" title={file.name}>{file.name}</p>
        {file.createdAt && <p className="text-[12px] text-slate-400">Uploaded {timeAgo(file.createdAt)}</p>}
        {file.uploadedBy && (
          <p className="text-[12px] text-slate-400">
            by <span className="font-medium text-slate-500">{file.uploadedBy}</span>
            {file.uploadedByRole ? ` (${file.uploadedByRole})` : ''}
          </p>
        )}
        <p className="mt-1 flex items-center gap-2">
          <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">{badge}</span>
          <span className="text-[12px] text-slate-500">{formatSize(file.sizeBytes)}</span>
        </p>
        <div className="mt-2 border-t border-slate-100 pt-2">
          {file.linkedItems.length > 0 ? (
            // The icon stays blue either way — it's just a "this file is
            // linked" status indicator. The text only turns blue/underline
            // when it's a REAL link (single item, clickable to jump there);
            // with multiple items there's nowhere single to jump to, so it
            // reads as plain text instead of looking like a dead link.
            <div className="flex items-center gap-1.5 text-[13px] text-blue-600">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
                <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
              </svg>
              {file.linkedItems.length === 1 ? (
                <button type="button" onClick={() => onOpenItem(file.linkedItems[0]!.id)}
                        className="truncate hover:underline" title={file.linkedItems[0]!.name}>
                  {file.linkedItems[0]!.name}
                </button>
              ) : (
                <span className="truncate text-slate-500" title={file.linkedItems.map((i) => i.name).join(', ')}>
                  Linked to {file.linkedItems.length} items
                </span>
              )}
            </div>
          ) : (
            <p className="text-[12px] text-slate-400">Not linked to a content item</p>
          )}
        </div>
      </div>
    </div>
  );
}

function MenuItem({
  label, onClick, disabled, danger, children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
            className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[14px] transition ${
              disabled ? 'cursor-not-allowed text-slate-300' : danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50'
            }`}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
      {label}
    </button>
  );
}

/** Upload-only dialog: stage files, then upload their bytes into the library. */
function UploadDialog({
  projectId, onClose, onUploaded,
}: {
  projectId: string;
  onClose: () => void;
  onUploaded: () => void;
}) {
  type Staged = { key: string; file: File; previewUrl: string | null };
  const [staged, setStaged] = useState<Staged[]>([]);
  const [folder, setFolder] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef(0);
  const stagedRef = useRef<Staged[]>([]);
  stagedRef.current = staged;

  const folders = useQuery({ queryKey: ['file-folders', projectId], queryFn: () => api.listFileFolders(projectId) });

  useEffect(() => () => stagedRef.current.forEach((s) => s.previewUrl && URL.revokeObjectURL(s.previewUrl)), []);

  const add = (list: FileList | null) => {
    if (!list) return;
    const next = Array.from(list).map((file) => ({
      key: String(++keyRef.current),
      file,
      previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
    }));
    setStaged((p) => [...p, ...next]);
  };
  const remove = (key: string) =>
    setStaged((p) => { const item = p.find((x) => x.key === key); if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl); return p.filter((x) => x.key !== key); });

  const upload = async () => {
    if (!staged.length || busy) return;
    setBusy(true);
    try {
      await Promise.all(staged.map(async (s) => {
        const { path, token } = await api.createUploadUrl(projectId, s.file.name);
        const up = await supabase.storage.from(BUCKET).uploadToSignedUrl(path, token, s.file, { contentType: s.file.type });
        if (up.error) throw up.error;
        await api.recordFile({ projectId, path, name: s.file.name, mime: s.file.type || null, size: s.file.size, folder: folder || null });
      }));
      onUploaded();
      toast('New files have been added successfully.');
      onClose();
    } catch (e) {
      setBusy(false);
      toast(e instanceof Error ? e.message : 'Upload failed.');
    }
  };

  const guard = () => { if (!busy) onClose(); };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-6" onMouseDown={guard}>
      <div onMouseDown={(e) => e.stopPropagation()} className="flex h-[560px] w-[860px] max-w-full flex-col rounded-lg bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-[19px] font-semibold text-slate-900">Upload files</h2>
          <button type="button" onClick={guard} className="grid h-8 w-8 place-items-center rounded text-slate-500 hover:bg-slate-100">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-6"
             onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
             onDragLeave={() => setDragOver(false)}
             onDrop={(e) => { e.preventDefault(); setDragOver(false); add(e.dataTransfer.files); }}>
          <div className={`grid min-h-[200px] place-items-center rounded-lg border-2 border-dashed ${dragOver ? 'border-blue-400 bg-blue-50' : 'border-slate-300'}`}>
            <div className="text-center">
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" className="mx-auto">
                <path d="M12 16V4m0 0-4 4m4-4 4 4" /><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
              </svg>
              <input ref={inputRef} type="file" multiple className="sr-only" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
              <button type="button" onClick={() => inputRef.current?.click()} className="mt-3 block w-full text-[15px] font-medium text-blue-600 hover:underline">
                Select files to upload
              </button>
              <p className="mt-1 text-[14px] text-slate-500">or drag and drop here</p>
            </div>
          </div>

          {staged.length > 0 && (
            <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
              {staged.map((s) => (
                <figure key={s.key} className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <div className="relative h-[160px] shrink-0 bg-slate-100">
                    <button type="button" onClick={() => remove(s.key)} title="Remove" disabled={busy}
                            className="absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded bg-white/85 text-slate-600 shadow hover:text-red-600 disabled:opacity-40">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6M14 11v6" /></svg>
                    </button>
                    {s.previewUrl
                      ? <img src={s.previewUrl} alt={s.file.name} className="absolute inset-0 h-full w-full object-contain p-2" />
                      : <span className="grid h-full place-items-center text-[12px] font-semibold uppercase text-slate-400">{ext(s.file.name)}</span>}
                    {busy && <div className="absolute inset-0 grid place-items-center bg-white/60 text-[13px] font-medium text-slate-600">Processing…</div>}
                  </div>
                  <figcaption className="border-t border-slate-100 bg-white p-3">
                    <p className="truncate text-[13px] font-medium text-slate-800" title={s.file.name}>{s.file.name}</p>
                    <p className="text-[12px] text-slate-500">{formatSize(s.file.size)}</p>
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </div>

        <footer className="flex items-center gap-3 border-t border-slate-200 px-6 py-4">
          <select value={folder} onChange={(e) => setFolder(e.target.value)} disabled={busy}
                  className="h-10 rounded-md border border-slate-300 bg-white px-3 text-[14px] text-slate-700 disabled:opacity-50">
            <option value="">Assign a folder</option>
            {folders.data?.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <div className="ml-auto flex items-center gap-2">
            {staged.length > 0 && <span className="text-[13px] text-slate-500">{staged.length} selected</span>}
            <button type="button" onClick={guard} disabled={busy}
                    className="rounded-md border border-slate-300 px-5 py-2 text-sm font-semibold uppercase tracking-wide text-slate-700 hover:bg-slate-50 disabled:opacity-40">Cancel</button>
            <button type="button" onClick={upload} disabled={staged.length === 0 || busy}
                    className="rounded-md bg-green-500 px-6 py-2 text-sm font-semibold uppercase tracking-wide text-white hover:bg-green-600 disabled:opacity-40">
              {busy ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function DeleteConfirm({ files, onCancel, onDelete }: { files: LibraryFile[]; onCancel: () => void; onDelete: () => void }) {
  const many = files.length > 1;
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-900/50 p-6" onMouseDown={onCancel}>
      <div onMouseDown={(e) => e.stopPropagation()} className="w-[560px] max-w-full rounded-lg bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 text-[22px] font-semibold text-slate-900">
            {many ? `Delete ${files.length} files?` : <>Delete <span className="break-all">“{files[0]!.name}”</span>?</>}
          </h2>
          <button type="button" onClick={onCancel} className="grid h-8 w-8 shrink-0 place-items-center rounded text-slate-500 hover:bg-slate-100">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <p className="mt-4 text-[15px] leading-relaxed text-slate-600">
          You are going to permanently delete the selected file{many ? 's' : ''} from the File &amp; Media library. This{' '}
          <strong className="font-semibold text-slate-800">cannot</strong> be undone. The deleted file{many ? 's' : ''} will also
          disappear from all content items they are attached to.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onCancel}
                  className="rounded-md bg-slate-100 px-6 py-2.5 text-sm font-semibold uppercase tracking-wide text-slate-700 hover:bg-slate-200">Cancel</button>
          <button type="button" onClick={onDelete}
                  className="rounded-md bg-red-500 px-6 py-2.5 text-sm font-semibold uppercase tracking-wide text-white hover:bg-red-600">Delete</button>
        </div>
      </div>
    </div>
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
