import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type LibraryFile, type StoredFile } from '../lib/api';
import { supabase } from '../lib/supabase';
import { toast } from '../lib/toast';

const BUCKET = 'content-files';

/** A file staged in the "Upload files" tab. Nothing is uploaded until Insert. */
type Staged = {
  key: string;
  file: File;
  previewUrl: string | null;
};

type LinkFilter = 'all' | 'linked' | 'unlinked';

/**
 * The "Add files" modal, matching the reference: two tabs — pick from the
 * project's file library, or upload new files into it.
 *
 * Upload is staged, not eager: dropped files are held locally (browser preview)
 * and only committed on **Insert**, which uploads the bytes, records them in the
 * project library, and links them to the current content item. Delete/Cancel
 * before Insert discards them — nothing ever reaches storage or the library.
 * A library pick just links an existing file to the item (no upload).
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
  const [staged, setStaged] = useState<Staged[]>([]);
  const [folder, setFolder] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [inserting, setInserting] = useState(false);
  const [query, setQuery] = useState('');
  const [linkFilter, setLinkFilter] = useState<LinkFilter>('all');
  const [menuId, setMenuId] = useState<string | null>(null);
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const [confirmFile, setConfirmFile] = useState<LibraryFile | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef(0);
  const stagedRef = useRef<Staged[]>([]);
  stagedRef.current = staged;

  const library = useQuery({ queryKey: ['files', projectId], queryFn: () => api.listFiles(projectId) });
  const folders = useQuery({ queryKey: ['file-folders', projectId], queryFn: () => api.listFileFolders(projectId) });

  // Revoke object URLs on unmount so previews don't leak.
  useEffect(() => () => stagedRef.current.forEach((s) => s.previewUrl && URL.revokeObjectURL(s.previewUrl)), []);

  const already = new Set(existingIds);

  const toggleLib = (f: LibraryFile) => {
    setLibSelected((prev) => {
      const next = new Map(prev);
      if (next.has(f.id)) next.delete(f.id);
      else next.set(f.id, { id: f.id, name: f.name, mime: f.mime, sizeBytes: f.sizeBytes });
      return next;
    });
  };

  // Stage picked files locally — no upload yet (that happens on Insert).
  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next = Array.from(list).map((file) => ({
      key: String(++keyRef.current),
      file,
      previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
    }));
    setStaged((p) => [...p, ...next]);
  };

  const removeStaged = (key: string) => {
    setStaged((p) => {
      const item = p.find((x) => x.key === key);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return p.filter((x) => x.key !== key);
    });
  };

  const totalSelected = libSelected.size + staged.length;

  // Insert = the single commit point. Upload staged files (bytes -> storage,
  // record -> library), then hand every chosen file (new + library picks) up to
  // be linked to the content item.
  const insert = async () => {
    if (!totalSelected || inserting) return;
    setInserting(true);
    try {
      const uploaded = await Promise.all(
        staged.map(async (s) => {
          const { path, token } = await api.createUploadUrl(projectId, s.file.name);
          const up = await supabase.storage.from(BUCKET).uploadToSignedUrl(path, token, s.file, {
            contentType: s.file.type,
          });
          if (up.error) throw up.error;
          const rec = await api.recordFile({
            projectId, path, name: s.file.name,
            mime: s.file.type || null, size: s.file.size, folder: folder || null,
          });
          return { id: rec.id, name: rec.name, mime: rec.mime, sizeBytes: rec.sizeBytes } as StoredFile;
        }),
      );
      qc.invalidateQueries({ queryKey: ['files', projectId] });
      qc.invalidateQueries({ queryKey: ['file-folders', projectId] });

      const all = [...libSelected.values(), ...uploaded];
      onInsert(all);
      if (uploaded.length) toast('New files have been added successfully.');
      if (all.length) toast('The files are attached to content item.');
      onClose();
    } catch (e) {
      setInserting(false);
      toast(e instanceof Error ? e.message : 'Upload failed.');
    }
  };

  const download = (f: LibraryFile) => {
    setMenuId(null);
    if (!f.url) return;
    const a = document.createElement('a');
    a.href = f.url;
    a.download = f.name;
    a.target = '_blank';
    a.click();
  };

  const doDelete = async () => {
    const f = confirmFile;
    if (!f) return;
    setConfirmFile(null);
    setLibSelected((prev) => { const n = new Map(prev); n.delete(f.id); return n; });
    try {
      await api.deleteFile(f.id);
      qc.invalidateQueries({ queryKey: ['files', projectId] });
      qc.invalidateQueries({ queryKey: ['file-folders', projectId] });
      toast('File deleted.');
    } catch {
      toast('Could not delete the file.');
    }
  };

  const moveToFolder = async (f: LibraryFile) => {
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (library.data ?? []).filter((f) => {
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
  }, [library.data, query, linkFilter]);

  const closeGuard = () => { if (!inserting) onClose(); };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-6" onMouseDown={closeGuard}>
      <div onMouseDown={(e) => { e.stopPropagation(); setMenuId(null); }}
           className="flex h-[600px] w-[960px] max-w-full flex-col rounded-lg bg-white shadow-2xl">
        <header className="flex items-center gap-6 border-b border-slate-200 px-6 pt-4">
          {(['library', 'upload'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)}
                    className={`-mb-px border-b-2 pb-3 text-[15px] ${
                      tab === t ? 'border-blue-600 font-medium text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}>
              {t === 'library' ? 'From project library' : 'Upload files'}
            </button>
          ))}
          <button type="button" onClick={closeGuard} className="ml-auto grid h-8 w-8 place-items-center rounded text-slate-500 hover:bg-slate-100">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {tab === 'library' ? (
            <>
              {/* Search + Linked/Unlinked filter */}
              <div className="mb-6 flex flex-wrap items-center gap-4">
                <div className="relative w-80 max-w-full">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by file or item name"
                    className="h-10 w-full rounded-md border border-slate-300 pl-3 pr-9 text-[14px] text-slate-800 placeholder:text-slate-400"
                  />
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
              </div>

              <h3 className="mb-3 text-[15px] font-semibold text-slate-800">Files</h3>
              {library.isLoading ? (
                <p className="text-sm text-slate-400">Loading…</p>
              ) : !library.data?.length ? (
                <div className="grid h-full place-items-center text-center">
                  <div>
                    <CloudArt />
                    <p className="mt-4 text-[22px] text-slate-700">There are no files or media in this project</p>
                  </div>
                </div>
              ) : !filtered.length ? (
                <p className="py-10 text-center text-sm text-slate-400">No files match your criteria</p>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
                  {filtered.map((f) => (
                    <FileTile
                      key={f.id}
                      file={f}
                      selected={libSelected.has(f.id)}
                      already={already.has(f.id)}
                      menuOpen={menuId === f.id}
                      onToggle={() => toggleLib(f)}
                      onMenu={() => setMenuId((cur) => (cur === f.id ? null : f.id))}
                      onView={() => { setMenuId(null); if (f.url) setViewUrl(f.url); }}
                      onDownload={() => download(f)}
                      onMove={() => moveToFolder(f)}
                      onDelete={() => { setMenuId(null); setConfirmFile(f); }}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
            >
              {/* Full-width drop zone */}
              <div className={`grid min-h-[220px] place-items-center rounded-lg border-2 border-dashed ${dragOver ? 'border-blue-400 bg-blue-50' : 'border-slate-300'}`}>
                <div className="text-center">
                  <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" className="mx-auto">
                    <path d="M12 16V4m0 0-4 4m4-4 4 4" /><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                  </svg>
                  <input ref={inputRef} type="file" multiple className="sr-only" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
                  <button type="button" onClick={() => inputRef.current?.click()}
                          className="mt-3 block w-full text-[15px] font-medium text-blue-600 hover:underline">
                    Select files to upload
                  </button>
                  <p className="mt-1 text-[14px] text-slate-500">or drag and drop here</p>
                </div>
              </div>

              {/* Staged preview cards (not uploaded until Insert) */}
              {staged.length > 0 && (
                <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
                  {staged.map((s) => (
                    <figure key={s.key} className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
                      <div className="relative h-[170px] shrink-0 bg-slate-100">
                        <button type="button" onClick={() => removeStaged(s.key)} title="Remove" disabled={inserting}
                                className="absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded bg-white/85 text-slate-600 shadow hover:text-red-600 disabled:opacity-40">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                            <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6M14 11v6" />
                          </svg>
                        </button>
                        {s.previewUrl
                          ? <img src={s.previewUrl} alt={s.file.name} className="absolute inset-0 h-full w-full object-contain p-2" />
                          : <span className="grid h-full place-items-center text-[12px] font-semibold uppercase text-slate-400">{ext(s.file.name)}</span>}
                        {inserting && (
                          <div className="absolute inset-0 grid place-items-center bg-white/60 text-[13px] font-medium text-slate-600">Processing…</div>
                        )}
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
          )}
        </div>

        <footer className="flex items-center gap-3 border-t border-slate-200 px-6 py-4">
          {tab === 'upload' && (
            <select value={folder} onChange={(e) => setFolder(e.target.value)} disabled={inserting}
                    className="h-10 rounded-md border border-slate-300 bg-white px-3 text-[14px] text-slate-700 disabled:opacity-50">
              <option value="">Assign a folder</option>
              {folders.data?.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          )}
          <div className="ml-auto flex items-center gap-2">
            {totalSelected > 0 && <span className="text-[13px] text-slate-500">{totalSelected} selected</span>}
            <button type="button" onClick={closeGuard} disabled={inserting}
                    className="rounded-md border border-slate-300 px-5 py-2 text-sm font-semibold uppercase tracking-wide text-slate-700 hover:bg-slate-50 disabled:opacity-40">Cancel</button>
            <button type="button" onClick={insert} disabled={totalSelected === 0 || inserting}
                    className="rounded-md bg-green-500 px-6 py-2 text-sm font-semibold uppercase tracking-wide text-white hover:bg-green-600 disabled:opacity-40">
              {inserting ? 'Inserting…' : 'Insert'}
            </button>
          </div>
        </footer>
      </div>

      {confirmFile && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-900/50 p-6" onMouseDown={(e) => { e.stopPropagation(); setConfirmFile(null); }}>
          <div onMouseDown={(e) => e.stopPropagation()} className="w-[560px] max-w-full rounded-lg bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <h2 className="min-w-0 text-[22px] font-semibold text-slate-900">
                Delete <span className="break-all">“{confirmFile.name}”</span>?
              </h2>
              <button type="button" onClick={() => setConfirmFile(null)}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded text-slate-500 hover:bg-slate-100">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <p className="mt-4 text-[15px] leading-relaxed text-slate-600">
              You are going to permanently delete the selected files from the File &amp; Media library. This{' '}
              <strong className="font-semibold text-slate-800">cannot</strong> be undone. The deleted files will also
              disappear from all content items they are attached to.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setConfirmFile(null)}
                      className="rounded-md bg-slate-100 px-6 py-2.5 text-sm font-semibold uppercase tracking-wide text-slate-700 hover:bg-slate-200">
                Cancel
              </button>
              <button type="button" onClick={doDelete}
                      className="rounded-md bg-red-500 px-6 py-2.5 text-sm font-semibold uppercase tracking-wide text-white hover:bg-red-600">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {viewUrl && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-900/80 p-8" onMouseDown={(e) => { e.stopPropagation(); setViewUrl(null); }}>
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

function FileTile({
  file, selected, already, menuOpen, onToggle, onMenu, onView, onDownload, onMove, onDelete,
}: {
  file: LibraryFile;
  selected: boolean;
  already: boolean;
  menuOpen: boolean;
  onToggle: () => void;
  onMenu: () => void;
  onView: () => void;
  onDownload: () => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  const isImage = (file.mime ?? '').startsWith('image/') && file.url;
  const badge = ext(file.name).toUpperCase();
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
      className={`relative flex cursor-pointer flex-col overflow-hidden rounded-md border bg-white text-left transition ${
        selected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      <div className="relative h-[150px] shrink-0 bg-slate-100">
        {/* select checkbox */}
        <span className={`absolute left-2 top-2 z-10 grid h-6 w-6 place-items-center rounded border ${
          selected ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white'
        }`}>
          {selected && <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" /></svg>}
        </span>

        {/* actions menu */}
        <button type="button" onMouseDown={stop} onClick={(e) => { stop(e); onMenu(); }}
                className="absolute right-2 top-2 z-10 grid h-7 w-7 place-items-center rounded bg-white/85 text-slate-600 shadow hover:bg-white">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
        </button>
        {menuOpen && (
          <div onMouseDown={stop} onClick={stop} className="absolute right-2 top-10 z-20 w-40 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg">
            <MenuItem label="View" disabled={!file.url} onClick={onView}>
              <circle cx="11" cy="11" r="6" /><path d="m20 20-3.5-3.5" />
            </MenuItem>
            <MenuItem label="Download" disabled={!file.url} onClick={onDownload}>
              <path d="M12 3v12m0 0-4-4m4 4 4-4M5 19h14" />
            </MenuItem>
            <MenuItem label="Move" onClick={onMove}>
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </MenuItem>
            <div className="my-1 border-t border-slate-100" />
            <MenuItem label="Delete" danger onClick={onDelete}>
              <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6M14 11v6" />
            </MenuItem>
          </div>
        )}

        {isImage
          ? <img src={file.url!} alt={file.name} className="h-full w-full object-cover" />
          : <span className="grid h-full place-items-center text-[12px] font-semibold uppercase text-slate-400">{badge}</span>}
      </div>

      <div className="flex flex-col gap-1 p-3">
        <p className="truncate text-[13px] font-medium text-slate-800" title={file.name}>{file.name}</p>
        {file.createdAt && <p className="text-[12px] text-slate-500">Uploaded {timeAgo(file.createdAt)}</p>}
        {file.uploadedBy && (
          <p className="text-[12px] text-slate-500">
            by <span className="font-medium text-slate-600">{file.uploadedBy}</span>
            {file.uploadedByRole ? ` (${file.uploadedByRole})` : ''}
          </p>
        )}
        <p className="mt-1 flex items-center gap-2">
          <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">{badge}</span>
          <span className="text-[12px] text-slate-500">{formatSize(file.sizeBytes)}{already ? ' · added' : ''}</span>
        </p>
        <div className="mt-2 border-t border-slate-100 pt-2">
          {file.linkedItems.length > 0 ? (
            <p className="flex items-center gap-1.5 text-[12px] text-blue-600" title={file.linkedItems.map((i) => i.name).join(', ')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
                <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
              </svg>
              <span className="truncate">{linkedLabel(file.linkedItems)}</span>
            </p>
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
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[14px] transition ${
        disabled ? 'cursor-not-allowed text-slate-300' : danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50'
      }`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
      {label}
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

function linkedLabel(items: { name: string }[]): string {
  if (items.length === 1) return items[0]!.name;
  return `Linked to ${items.length} items`;
}

function timeAgo(iso: string): string {
  const secs = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  const mins = Math.floor(secs / 60);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hrs > 0) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
  if (mins > 0) return `${mins} minute${mins > 1 ? 's' : ''} ago`;
  return 'just now';
}

function ext(name: string): string {
  return name.match(/\.(\w+)$/)?.[1] ?? 'file';
}
export function formatSize(bytes: number | null) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
