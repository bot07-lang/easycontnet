import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ApiItem, type ItemVersion } from '../lib/api';
import { CompareDialog, DIFF_CSS } from './CompareDialog';
import { fieldValueToHtml, isDiffableField } from '../lib/diff-fields';
import * as saveManager from '../lib/save-manager';
import type { ContentField } from '../mock/article';
import { Field } from './Field';
import { toPlainText } from '../lib/counts';

type SaveState = 'idle' | 'saving' | 'saved' | 'retrying' | 'error';

// How long after you stop typing before a field autosaves. With flush-on-leave in
// place this controls save frequency while typing, not data safety, so it can be
// raised to reduce writes without risking edits.
const AUTOSAVE_DEBOUNCE_MS = 700;

/** Update one field's value inside a cached ApiItem, so the item query stays in
 *  sync with autosaves and returning to the editor shows the latest value. */
function patchFieldValue(item: ApiItem, fieldId: string, value: unknown): ApiItem {
  return {
    ...item,
    tabs: item.tabs.map((t) => ({
      ...t,
      fields: t.fields.map((f) => (f.id === fieldId ? { ...f, value } : f)),
    })),
  };
}

/**
 * Loads a real content item from the API, renders its fields, and autosaves
 * each field a short beat after you stop typing. A failed save (e.g. RLS says
 * you can't edit) surfaces rather than silently dropping the change.
 */
export function ItemEditor({ itemId, projectId, onOpenItem }: { itemId: string; projectId?: string; onOpenItem?: (id: string) => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['item', itemId],
    queryFn: () => api.getItem(itemId),
    // Serve a recently-loaded item from cache instead of immediately re-fetching,
    // so leaving and returning shows the value we just saved rather than a stale
    // re-fetch. The cache is kept in sync with each save (patchFieldValue).
    staleTime: 60_000,
  });
  // Bumped after a restore to remount Loaded so its field state re-initialises.
  const [nonce, setNonce] = useState(0);

  if (isLoading) return <div className="p-8 text-slate-400">Loading…</div>;
  if (error) return <div className="p-8 text-red-600">{String(error)}</div>;
  if (!data) return null;
  return <Loaded key={nonce} item={data} projectId={projectId} onReload={() => setNonce((n) => n + 1)} onOpenItem={onOpenItem} />;
}

function Loaded({ item, projectId, onReload, onOpenItem }: { item: ApiItem; projectId?: string; onReload: () => void; onOpenItem?: (id: string) => void }) {
  const [activeTab, setActiveTab] = useState(item.tabs[0]?.id ?? '');
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(item.tabs.flatMap((t) => t.fields).map((f) => [f.id, f.value])),
  );
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>('idle');
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Field values edited but not yet confirmed saved. Drives flush-on-leave and the
  // unsaved-changes guard; a field is removed once its save succeeds.
  const pending = useRef<Record<string, unknown>>({});
  const qc = useQueryClient();

  // Version preview (read-only) + the restore confirmation live here so both the
  // editor area and the versions sidebar can drive them.
  const [preview, setPreview] = useState<{ id: string; createdAt: string } | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<{ id: string; createdAt: string } | null>(null);
  const previewSnap = useQuery({
    queryKey: ['version', preview?.id],
    queryFn: () => api.getVersion(preview!.id),
    enabled: !!preview,
  });
  const saveVersion = useMutation({
    mutationFn: () => api.saveVersion(item.id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['versions', item.id] }); },
  });
  const restore = useMutation({
    mutationFn: (vid: string) => api.restoreVersion(item.id, vid),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['item', item.id] });
      void qc.invalidateQueries({ queryKey: ['versions', item.id] });
      setRestoreTarget(null);
      setPreview(null);
      onReload();
    },
  });

  const tab = item.tabs.find((t) => t.id === activeTab) ?? item.tabs[0];

  // Hand a field off to the save manager (retries + localStorage backup). On
  // confirmed save, drop it from `pending` and sync the item cache so returning
  // shows this value.
  const persist = (fieldId: string, value: unknown) => {
    saveManager.saveField(item.id, fieldId, value, {
      onStatus: setSave,
      onSaved: () => {
        if (pending.current[fieldId] === value) delete pending.current[fieldId];
        qc.setQueryData<ApiItem>(['item', item.id], (old) => (old ? patchFieldValue(old, fieldId, value) : old));
      },
    });
  };

  const onChange = (fieldId: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
    pending.current[fieldId] = value;
    setSave('saving');
    clearTimeout(timers.current[fieldId]);
    timers.current[fieldId] = setTimeout(() => persist(fieldId, value), AUTOSAVE_DEBOUNCE_MS);
  };

  // Flush on leave: when the editor unmounts (back, switch item, go to Dashboard),
  // save any pending edit immediately instead of cancelling it — otherwise an edit
  // made inside the debounce window is lost. Fire-and-forget: on in-app navigation
  // the page stays alive, so the requests finish in the background.
  useEffect(() => {
    const p = pending.current;
    const t = timers.current;
    const itemId = item.id;
    const client = qc;
    return () => {
      for (const [fieldId, value] of Object.entries(p)) {
        clearTimeout(t[fieldId]);
        // Optimistically patch the cache so returning shows the flushed value even
        // before the save commits; the manager retries + backs it up, so it's safe.
        client.setQueryData<ApiItem>(['item', itemId], (old) => (old ? patchFieldValue(old, fieldId, value) : old));
        saveManager.saveField(itemId, fieldId, value);
      }
    };
  }, [item.id, qc]);

  // Recover edits the save manager stashed (a previous save that failed, or a tab
  // closed mid-save): show them in the editor and re-attempt the save.
  useEffect(() => {
    const recovered = saveManager.recoverPending(item.id);
    if (!recovered.length) return;
    setValues((prev) => {
      const next = { ...prev };
      for (const { fieldId, value } of recovered) next[fieldId] = value;
      return next;
    });
    for (const { fieldId, value } of recovered) {
      pending.current[fieldId] = value;
      qc.setQueryData<ApiItem>(['item', item.id], (old) => (old ? patchFieldValue(old, fieldId, value) : old));
      persist(fieldId, value);
    }
    // Runs once per item mount; persist/qc are stable enough for recovery.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  // Hard leave (reload / tab close) can't run the unmount flush reliably, so warn
  // before the browser drops a pending edit.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (Object.keys(pending.current).length > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const totalWords = useMemo(
    () =>
      Object.values(values).reduce<number>((n, v) => {
        const s = toPlainText(v).trim();
        return n + (s ? s.split(/\s+/).length : 0);
      }, 0),
    [values],
  );

  return (
    <div className="flex items-start gap-4">
    <div className="min-w-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 bg-slate-50 px-3 pt-2">
        {item.tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id)}
            className={`rounded-t px-4 py-2.5 text-sm font-semibold transition ${
              t.id === activeTab
                ? 'border-x border-t border-slate-200 bg-white text-slate-900'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.name}
          </button>
        ))}
      </div>

      {/* Action bar — or the preview header when viewing a past version. */}
      {preview ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-blue-50/40 px-5 py-3">
          <button type="button" onClick={() => setPreview(null)} title="Back to current"
                  className="grid h-9 w-9 place-items-center rounded-full border border-blue-400 text-blue-600 hover:bg-blue-100">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          </button>
          <span className="text-[15px] font-semibold text-slate-800">{fmtDateTime(preview.createdAt)}</span>
          <button type="button" onClick={() => setRestoreTarget(preview)}
                  className="ml-2 rounded-md bg-blue-600 px-4 py-2 text-[13px] font-semibold uppercase tracking-wide text-white hover:bg-blue-700">
            Restore this version
          </button>
          <span className="ml-auto text-xs text-slate-400">Read-only preview</span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-5 py-3">
          {item.status && (
            <span className="inline-flex items-center gap-2 rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-800">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.status.color }} />
              {item.status.name}
            </span>
          )}
          <span className="text-xs text-slate-400">Item #{item.itemNumber} · {totalWords} words</span>
          <button type="button" onClick={() => saveVersion.mutate()} disabled={saveVersion.isPending}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" /></svg>
            {saveVersion.isPending ? 'Saving…' : 'Save version'}
          </button>
          <span className="ml-auto text-xs">
            {save === 'saving' && <span className="text-slate-400">Saving…</span>}
            {save === 'retrying' && <span className="text-amber-600">Reconnecting…</span>}
            {save === 'saved' && <span className="text-green-600">Saved</span>}
            {save === 'error' && <span className="text-red-600">Couldn’t save — your changes are kept locally</span>}
          </span>
        </div>
      )}

      {/* Fields — editable, or a read-only render of the previewed version. */}
      <div className="space-y-5 px-5 py-6">
        {preview ? (
          <>
            <style>{DIFF_CSS}</style>
            {previewSnap.isLoading ? (
              <p className="text-sm text-slate-400">Loading version…</p>
            ) : (
              tab?.fields.filter((f) => isDiffableField(f.type)).map((f) => (
                <ReadOnlyField
                  key={f.id}
                  label={f.label}
                  html={fieldValueToHtml(
                    { id: f.id, type: f.type, label: f.label, isPlainText: f.isPlainText, choices: f.choices },
                    (previewSnap.data?.snapshot ?? {})[f.id],
                  )}
                />
              ))
            )}
          </>
        ) : (
          tab?.fields.map((f) => {
            // ApiField → the shape Field renders. field_type strings already match.
            const field: ContentField = {
              id: f.id,
              type: f.type as ContentField['type'],
              label: f.label,
              guidelines: f.guidelines,
              isRequired: f.isRequired,
              isSystem: f.isSystem,
              isPlainText: f.isPlainText,
              recommendedLength: f.recommendedLength,
              recommendedLengthUnits: f.recommendedLengthUnits,
              choices: f.choices,
              value: values[f.id],
            };
            return (
              <Field
                key={f.id}
                field={field}
                onChange={onChange}
                activeFieldId={activeFieldId}
                onActivate={setActiveFieldId}
                docTitle={item.name}
                projectId={projectId}
              />
            );
          })
        )}
      </div>
    </div>

      <VersionsPanel
        item={item}
        onReload={onReload}
        onOpenItem={onOpenItem}
        previewId={preview?.id ?? null}
        onPreview={(v) => setPreview(v ? { id: v.id, createdAt: v.created_at } : null)}
        onRestoreAsk={(v) => setRestoreTarget({ id: v.id, createdAt: v.created_at })}
      />

      {restoreTarget && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-6" onClick={() => !restore.isPending && setRestoreTarget(null)}>
          <div className="w-full max-w-xl rounded-xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <h3 className="text-[19px] font-semibold text-slate-900">Restore this version?</h3>
              <button type="button" onClick={() => !restore.isPending && setRestoreTarget(null)} className="grid h-8 w-8 place-items-center rounded-full text-slate-400 hover:bg-slate-100">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <p className="text-[15px] text-slate-600">
              Your current document will revert to the version from {fmtDate(restoreTarget.createdAt)}.
            </p>
            {restore.isError && <p className="mt-2 text-[13px] text-red-600">Couldn’t restore. Please try again.</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setRestoreTarget(null)} disabled={restore.isPending}
                      className="rounded-md bg-slate-100 px-5 py-2.5 text-[13px] font-semibold uppercase tracking-wide text-slate-700 hover:bg-slate-200 disabled:opacity-50">
                Cancel
              </button>
              <button type="button" onClick={() => restore.mutate(restoreTarget.id)} disabled={restore.isPending}
                      className="rounded-md bg-blue-600 px-6 py-2.5 text-[13px] font-semibold uppercase tracking-wide text-white hover:bg-blue-700 disabled:opacity-50">
                {restore.isPending ? 'Restoring…' : 'Restore'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** A field rendered read-only (used by the version preview). Content is stored
 *  HTML/rendered value, styled with the shared field-content CSS (DIFF_CSS). */
function ReadOnlyField({ label, html }: { label: string; html: string }) {
  return (
    <section className="rounded border border-slate-200 bg-white">
      <header className="border-b border-slate-200 bg-slate-50/70 px-5 py-3">
        <h3 className="text-[15px] font-semibold text-slate-900">{label}</h3>
      </header>
      <div className="cw-diff px-5 py-4" dangerouslySetInnerHTML={{ __html: html || '<span class="cw-empty">Empty</span>' }} />
    </section>
  );
}

/**
 * Right-sidebar with the Controls / Comments / Versions tabs. Only Versions is
 * built (Controls = workflow actions, Comments = Phase 2 — both stubbed). The
 * Versions tab mirrors the reference: Compare, All/Named sub-tabs, versions
 * grouped by date, each with a kind badge, author + role, status dot, and a
 * three-dot menu (rename / restore).
 */
function VersionsPanel({
  item, onReload, onOpenItem, previewId, onPreview, onRestoreAsk,
}: {
  item: ApiItem;
  onReload: () => void;
  onOpenItem?: (id: string) => void;
  previewId: string | null;
  onPreview: (v: ItemVersion | null) => void;
  onRestoreAsk: (v: ItemVersion) => void;
}) {
  const [tab, setTab] = useState<'controls' | 'comments' | 'versions'>('versions');
  return (
    <aside className="w-80 shrink-0 rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="grid grid-cols-3 border-b border-slate-200">
        <SideTab active={tab === 'controls'} onClick={() => setTab('controls')} label="CONTROLS"
                 icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 6h16M4 12h16M4 18h16" /></svg>} />
        <SideTab active={tab === 'comments'} onClick={() => setTab('comments')} label="COMMENTS"
                 icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z" /></svg>} />
        <SideTab active={tab === 'versions'} onClick={() => setTab('versions')} label="VERSIONS"
                 icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l3 3" /></svg>} />
      </div>
      {tab === 'versions' ? (
        <VersionsTab item={item} onReload={onReload} onOpenItem={onOpenItem}
                     previewId={previewId} onPreview={onPreview} onRestoreAsk={onRestoreAsk} />
      ) : (
        <div className="grid place-items-center px-6 py-12 text-center text-[13px] text-slate-400">
          {tab === 'comments' ? 'Comments are coming in a later phase.' : 'Workflow controls (submit / approve / reject) are coming next.'}
        </div>
      )}
    </aside>
  );
}

function SideTab({ active, onClick, label, icon }: { active: boolean; onClick: () => void; label: string; icon: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
            className={`flex flex-col items-center gap-1 py-3 text-[11px] font-bold tracking-wide ${active ? 'bg-white text-slate-800 shadow-[inset_0_-2px_0_0_#1e293b]' : 'bg-slate-50 text-slate-400 hover:text-slate-600'}`}>
      {icon}
      {label}
    </button>
  );
}

function VersionsTab({
  item, onReload, onOpenItem, previewId, onPreview, onRestoreAsk,
}: {
  item: ApiItem;
  onReload: () => void;
  onOpenItem?: (id: string) => void;
  previewId: string | null;
  onPreview: (v: ItemVersion | null) => void;
  onRestoreAsk: (v: ItemVersion) => void;
}) {
  const qc = useQueryClient();
  const versions = useQuery({ queryKey: ['versions', item.id], queryFn: () => api.listVersions(item.id) });
  const [sub, setSub] = useState<'all' | 'named'>('all');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [menuId, setMenuId] = useState<string | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [copyId, setCopyId] = useState<string | null>(null);
  const [copyName, setCopyName] = useState('');
  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['versions', item.id] }); };

  const rename = useMutation({
    mutationFn: (v: { vid: string; label: string }) => api.renameVersion(v.vid, v.label),
    onSuccess: () => { invalidate(); setRenameId(null); },
  });
  const del = useMutation({
    mutationFn: (vid: string) => api.deleteVersion(vid),
    onSuccess: () => { invalidate(); setDeleteConfirmId(null); setMenuId(null); },
  });
  const copy = useMutation({
    mutationFn: (v: { vid: string; name: string }) => api.copyVersionToItem(v.vid, v.name),
    onSuccess: (res) => { setCopyId(null); onOpenItem?.(res.id); },
  });

  const list = versions.data ?? [];
  const filtered = sub === 'named' ? list.filter((v) => v.label) : list;
  const groups = groupByDate(filtered);
  const today = fmtDate(new Date().toISOString());

  return (
    <div>
      <div className="border-b border-slate-200 p-3">
        <button type="button"
                onClick={() => setCompareOpen(true)}
                disabled={list.length === 0}
                title={list.length === 0 ? 'Save a version first to compare against' : 'Compare two versions'}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2.5 text-[13px] font-semibold uppercase tracking-wide text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-500/50">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
          Compare versions
        </button>
      </div>

      {compareOpen && (
        <CompareDialog
          item={item}
          versions={list}
          onClose={() => setCompareOpen(false)}
          onRestored={() => { setCompareOpen(false); void qc.invalidateQueries({ queryKey: ['versions', item.id] }); onReload(); }}
        />
      )}

      {copyId && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-6" onClick={() => !copy.isPending && setCopyId(null)}>
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-5 flex items-start justify-between">
              <h3 className="text-[18px] font-semibold text-slate-900">Copy version into a new content item</h3>
              <button type="button" onClick={() => !copy.isPending && setCopyId(null)} className="grid h-8 w-8 place-items-center rounded-full text-slate-400 hover:bg-slate-100">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <label className="block text-[13px] font-medium text-slate-600">New content item title</label>
            <input
              autoFocus
              value={copyName}
              onChange={(e) => setCopyName(e.target.value)}
              onFocus={(e) => e.target.select()}
              onKeyDown={(e) => { if (e.key === 'Enter' && copyName.trim()) copy.mutate({ vid: copyId, name: copyName }); }}
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-[15px] text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
            {copy.isError && <p className="mt-2 text-[13px] text-red-600">Couldn’t create the item. Please try again.</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setCopyId(null)} disabled={copy.isPending}
                      className="rounded-md bg-slate-100 px-5 py-2.5 text-[13px] font-semibold uppercase tracking-wide text-slate-700 hover:bg-slate-200 disabled:opacity-50">
                Cancel
              </button>
              <button type="button" onClick={() => copyName.trim() && copy.mutate({ vid: copyId, name: copyName })}
                      disabled={copy.isPending || !copyName.trim()}
                      className="rounded-md bg-green-600 px-5 py-2.5 text-[13px] font-semibold uppercase tracking-wide text-white hover:bg-green-700 disabled:opacity-50">
                {copy.isPending ? 'Copying…' : 'Make a copy'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 border-b border-slate-200 text-[13px] font-semibold">
        <button type="button" onClick={() => setSub('all')} className={sub === 'all' ? 'bg-white py-2.5 text-slate-800' : 'bg-slate-50 py-2.5 text-slate-500 hover:text-slate-700'}>ALL VERSIONS</button>
        <button type="button" onClick={() => setSub('named')} className={sub === 'named' ? 'bg-white py-2.5 text-slate-800' : 'bg-slate-50 py-2.5 text-slate-500 hover:text-slate-700'}>NAMED VERSIONS</button>
      </div>

      <div className="max-h-[62vh] overflow-y-auto">
        {sub === 'all' && (
          <>
            <DateHeader label={today} />
            <button type="button" onClick={() => onPreview(null)}
                    className={`block w-full border-b border-slate-100 px-4 py-3 text-left transition ${
                      previewId === null ? 'bg-blue-50/60 shadow-[inset_3px_0_0_0_#2563eb]' : 'hover:bg-slate-50'
                    }`}>
              <div className="flex items-center justify-between">
                <span className="text-[14px] font-semibold text-slate-800">Current</span>
                <Badge kind="current" />
              </div>
              {item.status && <StatusDot color={item.status.color} name={item.status.name} />}
            </button>
          </>
        )}

        {versions.isLoading ? (
          <p className="px-4 py-3 text-sm text-slate-400">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-slate-400">
            {sub === 'named' ? 'No named versions. Rename a version to keep it here.' : 'No saved versions yet.'}
          </p>
        ) : Object.entries(groups).map(([date, vs]) => (
          <div key={date}>
            {!(sub === 'all' && date === today) && <DateHeader label={date} />}
            {vs.map((v) => (
              <VersionEntry key={v.id} v={v}
                selected={previewId === v.id} onSelect={() => onPreview(v)}
                menuOpen={menuId === v.id} onMenu={() => setMenuId(menuId === v.id ? null : v.id)}
                renaming={renameId === v.id} renameText={renameText}
                onRenameStart={() => { setRenameId(v.id); setRenameText(v.label ?? ''); setMenuId(null); }}
                onRenameText={setRenameText}
                onRenameSave={() => renameText.trim() && rename.mutate({ vid: v.id, label: renameText })}
                onRenameCancel={() => setRenameId(null)}
                onRestoreAsk={() => { onRestoreAsk(v); setMenuId(null); }}
                onCopyStart={() => { setCopyId(v.id); setCopyName(item.name); setMenuId(null); }}
                deleteConfirming={deleteConfirmId === v.id} deleting={del.isPending}
                onDeleteAsk={() => { setDeleteConfirmId(v.id); setMenuId(null); }}
                onDeleteCancel={() => setDeleteConfirmId(null)}
                onDeleteConfirm={() => del.mutate(v.id)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function DateHeader({ label }: { label: string }) {
  return <div className="sticky top-0 z-10 border-y border-blue-100 bg-blue-50 px-4 py-2 text-[14px] font-semibold text-slate-800">{label}</div>;
}

function Badge({ kind }: { kind: 'current' | 'manual' | 'status_change' | 'auto' }) {
  const map: Record<string, [string, string]> = {
    current: ['CURRENT', 'bg-green-500'],
    manual: ['MANUAL', 'bg-amber-400'],
    status_change: ['STATUS CHANGE', 'bg-blue-400'],
    auto: ['AUTO', 'bg-slate-400'],
  };
  const [label, bg] = map[kind] ?? ['', 'bg-slate-400'];
  return <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white ${bg}`}>{label}</span>;
}

function StatusDot({ color, name }: { color: string | null; name: string | null }) {
  if (!name) return null;
  return (
    <div className="mt-1.5 flex items-center gap-1.5 text-[13px] text-slate-600">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color ?? '#9ca3af' }} />
      {name}
    </div>
  );
}

/** Status line for a version: a from → to transition for status changes, else a
 *  single dot. */
function StatusLine({ v }: { v: ItemVersion }) {
  if (v.kind === 'status_change' && v.from_status_name) {
    return (
      <div className="mt-1.5 flex items-center gap-1.5 text-[13px] text-slate-600">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: v.from_status_color ?? '#9ca3af' }} title={v.from_status_name} />
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: v.status_color ?? '#9ca3af' }} />
        {v.status_name}
      </div>
    );
  }
  return <StatusDot color={v.status_color} name={v.status_name} />;
}

function VersionEntry({
  v, selected, onSelect, menuOpen, onMenu, renaming, renameText, onRenameStart, onRenameText, onRenameSave, onRenameCancel,
  onRestoreAsk, onCopyStart, deleteConfirming, deleting, onDeleteAsk, onDeleteCancel, onDeleteConfirm,
}: {
  v: ItemVersion;
  selected: boolean;
  onSelect: () => void;
  menuOpen: boolean;
  onMenu: () => void;
  renaming: boolean;
  renameText: string;
  onRenameStart: () => void;
  onRenameText: (s: string) => void;
  onRenameSave: () => void;
  onRenameCancel: () => void;
  onRestoreAsk: () => void;
  onCopyStart: () => void;
  deleteConfirming: boolean;
  deleting: boolean;
  onDeleteAsk: () => void;
  onDeleteCancel: () => void;
  onDeleteConfirm: () => void;
}) {
  const time = fmtTime(v.created_at);
  // Clicks on the card open the read-only preview; interactive controls inside
  // stop propagation so they don't also trigger it.
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };
  return (
    <div
      onClick={() => !renaming && onSelect()}
      className={`relative cursor-pointer border-b border-slate-100 px-4 py-3 transition ${
        selected ? 'bg-blue-50/60 shadow-[inset_3px_0_0_0_#2563eb]' : 'hover:bg-slate-50'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        {renaming ? (
          <input autoFocus value={renameText} onClick={(e) => e.stopPropagation()} onChange={(e) => onRenameText(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter') onRenameSave(); if (e.key === 'Escape') onRenameCancel(); }}
                 onBlur={onRenameCancel}
                 className="w-full rounded border border-slate-300 px-1.5 py-1 text-[13px] focus:border-blue-500 focus:outline-none" />
        ) : (
          <span className="text-[14px] font-semibold text-slate-800">{v.label || time}</span>
        )}
        <Badge kind={v.kind} />
      </div>

      {/* When the version is named, still show its time beneath the name. */}
      {!renaming && v.label && <div className="mt-0.5 text-[13px] font-semibold text-slate-700">{time}</div>}

      <div className="mt-1 flex items-center justify-between">
        <span className="text-[12px] text-slate-500">
          {v.created_by_name}{v.created_by_role ? ` (${v.created_by_role})` : ''}
        </span>
        <button type="button" onClick={stop(onMenu)} className="grid h-6 w-6 place-items-center rounded text-slate-400 hover:bg-slate-100">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></svg>
        </button>
      </div>

      <StatusLine v={v} />

      {deleteConfirming && (
        <div className="mt-2 flex items-center gap-2 text-[12px] text-slate-600" onClick={(e) => e.stopPropagation()}>
          Delete this version?
          <button type="button" onClick={onDeleteConfirm} disabled={deleting} className="font-semibold text-red-600 disabled:opacity-50">{deleting ? '…' : 'Yes, delete'}</button>
          <button type="button" onClick={onDeleteCancel} className="text-slate-400">No</button>
        </div>
      )}

      {menuOpen && (
        <div className="absolute right-3 top-9 z-20 w-48 rounded-lg border border-slate-200 bg-white py-1.5 shadow-xl" onClick={(e) => e.stopPropagation()}>
          <MenuItem onClick={onRestoreAsk} label="Restore this version" />
          <MenuItem onClick={onRenameStart} label="Name this version" />
          <MenuItem onClick={onCopyStart} label="Create an item" />
          <div className="my-1 border-t border-slate-100" />
          <MenuItem onClick={onDeleteAsk} label="Delete this version" danger />
        </div>
      )}
    </div>
  );
}

function MenuItem({ onClick, label, danger }: { onClick: () => void; label: string; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick}
            className={`block w-full px-4 py-2 text-left text-[13px] hover:bg-slate-50 ${danger ? 'text-red-600' : 'text-slate-700'}`}>
      {label}
    </button>
  );
}

// Postgres timestamptz can arrive as ISO ("2026-07-21T18:04:54Z") or as a
// space-separated string with a 2-char offset ("2026-07-21 18:04:54+00"). The
// latter parses in Chrome/Node but is Invalid Date in Safari — which would
// collapse every version under one bogus date header. Normalise both.
function parseTs(ts: string): Date {
  if (!ts) return new Date(NaN);
  let s = ts.trim();
  if (s.includes(' ') && !s.includes('T')) s = s.replace(' ', 'T');
  s = s.replace(/([+-]\d{2})$/, '$1:00'); // "+00" → "+00:00"
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date(ts) : d;
}
function fmtDate(iso: string) {
  return parseTs(iso).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
}
function fmtTime(iso: string) {
  return parseTs(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function fmtDateTime(iso: string) {
  return `${fmtDate(iso)}, ${fmtTime(iso)}`;
}
function groupByDate(list: ItemVersion[]): Record<string, ItemVersion[]> {
  // Sort newest-first defensively (don't rely on server order), then group by
  // local calendar day. Insertion order of the object keys therefore runs newest
  // date → oldest, which is the order they render in.
  const sorted = [...list].sort((a, b) => parseTs(b.created_at).getTime() - parseTs(a.created_at).getTime());
  const g: Record<string, ItemVersion[]> = {};
  for (const v of sorted) { const d = fmtDate(v.created_at); (g[d] ??= []).push(v); }
  return g;
}
