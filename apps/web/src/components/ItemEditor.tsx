import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ApiItem, type ItemVersion, type StoredFile } from '../lib/api';
import { CompareDialog, DIFF_CSS } from './CompareDialog';
import { fieldValueToHtml, isDiffableField } from '../lib/diff-fields';
import * as saveManager from '../lib/save-manager';
import type { ContentField } from '../mock/article';
import { Field } from './Field';
import { ControlsTab } from './ControlsTab';
import { toast } from '../lib/toast';
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

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => esc(s).replace(/"/g, '&quot;');

/** Human field-type tag shown before each field name, matching the reference. */
function fieldTypeTag(type: string, isPlainText: boolean): string {
  switch (type) {
    case 'single_line_text': return '[text field]';
    case 'paragraph_text': return isPlainText ? '[text area – plain text]' : '[text area - rich text]';
    case 'file_image_upload': return '[asset]';
    case 'featured_image': return '[asset]';
    case 'checkboxes': return '[checkboxes]';
    case 'radio_buttons': return '[radio buttons]';
    case 'dropdown_select': return '[dropdown]';
    case 'date': return '[date]';
    case 'heading': return '[heading]';
    case 'guidelines': return '[guidelines]';
    default: return `[${type}]`;
  }
}

/** Render one field to an `.ec-field` block: [type] label + guideline + value. */
function renderExportField(
  f: { id: string; type: string; label: string; isPlainText: boolean; guidelines?: string; choices: string[] },
  value: unknown,
  fileUrls: Map<string, string>,
): string {
  const tag = fieldTypeTag(f.type, f.isPlainText);
  const guideline = f.guidelines ? `<p class="field-guideline">${esc(f.guidelines)}</p>` : '';
  const name = (label: string) => `<p class="field-name">${tag} ${esc(label)}</p>`;

  // Section fields carry their text in the label / value, not a widget.
  if (f.type === 'heading') return `<div class="ec-field">${name('')}<p>${esc(f.label)}</p></div>`;
  if (f.type === 'guidelines') return `<div class="ec-field">${name('')}<p>${esc(String(value ?? f.label ?? ''))}</p></div>`;

  let body: string;
  if (f.type === 'checkboxes' || f.type === 'radio_buttons') {
    const sel = Array.isArray(value) ? (value as string[]) : [];
    const inputType = f.type === 'radio_buttons' ? 'radio' : 'checkbox';
    body = (f.choices ?? [])
      .map((c, i) => {
        const cid = `${f.id}-${i}`;
        const checked = sel.includes(c) ? ' checked' : '';
        return `<input type="${inputType}" id="${escAttr(cid)}" name="${escAttr(f.id)}"${checked} disabled><label for="${escAttr(cid)}">${esc(c)}</label><br>`;
      })
      .join('');
  } else if (f.type === 'file_image_upload') {
    const files = Array.isArray(value) ? (value as { id: string; name: string; mime: string | null }[]) : [];
    if (!files.length) {
      body = '<p class="empty">—</p>';
    } else {
      const rows = files
        .map((sf) => {
          const url = fileUrls.get(sf.id);
          const link = url ? `<a href="${escAttr(url)}">Link</a>` : '—';
          const preview = url && (sf.mime ?? '').startsWith('image/') ? `<img src="${escAttr(url)}">` : '';
          return `<tr><td>${esc(sf.name)}</td><td>${link}</td><td>${preview}</td></tr>`;
        })
        .join('');
      body = `<table><tbody><tr><th>File name</th><th>File URL</th><th>Preview</th></tr>${rows}</tbody></table>`;
    }
  } else {
    body = fieldValueToHtml({ id: f.id, type: f.type, label: f.label, isPlainText: f.isPlainText, choices: f.choices }, value) || '<p class="empty">—</p>';
  }
  return `<div class="ec-field">${name(f.label)}${guideline}${body}</div>`;
}

const EXPORT_STYLE = `
body { background:#eee; min-height:100vh; box-sizing:border-box; font-family:"Helvetica Neue",Helvetica,Arial,sans-serif; font-weight:300; max-width:60rem; margin:0 auto; }
.item-details { padding:1rem; }
.main-content { display:flex; flex-wrap:wrap; }
.main-content label { order:1; display:block; padding:1rem 2rem; margin:0 0.2rem 0.2rem 0; cursor:pointer; background:#90CAF9; font-weight:bold; transition:background ease 0.2s; }
.main-content .tab { order:99; flex-grow:1; width:100%; display:none; padding:1rem; background:#fff; }
.main-content input[type="radio"] { display:none; }
.main-content input[type="radio"]:checked + label { background:#fff; }
.main-content input[type="radio"]:checked + label + .tab { display:block; }
.ec-field { border:2px solid; padding:8px; margin:8px; }
.ec-field img { max-width:100%; height:auto; }
.ec-field input, .ec-field label { all: revert !important; }
.field-name { text-decoration:underline; font-weight:bold; }
.field-guideline { color:#878787; font-style:italic; }
.empty { color:#878787; font-style:italic; }
table { border-collapse:collapse; width:100%; }
td, th { border:1px solid #ddd; text-align:left; padding:8px; }
tr:nth-child(even) { background:#ddd; }
@media (max-width:45em) { .main-content .tab, .main-content label { order:initial; } .main-content label { width:100%; margin-right:0; margin-top:0.2rem; } }
`;

/** Assemble the whole item into a standalone HTML document that mirrors the
 *  reference export: a details header, a tabbed layout, and every field wrapped
 *  in an `.ec-field` block with its [type] tag, guideline and value. fileUrls
 *  supplies live signed URLs for the asset table (resolved at export time). */
function buildItemHtml(
  item: ApiItem,
  values: Record<string, unknown>,
  fileUrls: Map<string, string>,
  exportDate: string,
): string {
  const tabs = item.tabs
    .map((t, ti) => {
      const fields = t.fields.map((f) => renderExportField(f, values[f.id], fileUrls)).join('');
      const id = `ec-tab-${ti}`;
      return `<input type="radio" id="${id}" name="ec-tabs"${ti === 0 ? ' checked' : ''}><label for="${id}">${esc(t.name)}</label><div class="tab">${fields}</div>`;
    })
    .join('');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="generator" content="Content Workflow"/>
<title>${esc(item.name)}</title>
<style>${EXPORT_STYLE}</style></head>
<body>
<div class="item-details">
  <p><span style="font-weight:bold;">Brief Title: </span>${esc(item.name)}</p>
  <p><span style="font-weight:bold;">Status: </span>${esc(item.status?.name ?? '')}</p>
  <p><span style="font-weight:bold;">Export Date: </span>${esc(exportDate)}</p>
</div>
<div class="main-content">${tabs}</div>
</body></html>`;
}

/** Trigger a client-side file download of a text blob. */
function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Loads a real content item from the API, renders its fields, and autosaves
 * each field a short beat after you stop typing. A failed save (e.g. RLS says
 * you can't edit) surfaces rather than silently dropping the change.
 */
export function ItemEditor({ itemId, projectId, onOpenItem, onOpenTemplate }: { itemId: string; projectId?: string; onOpenItem?: (id: string) => void; onOpenTemplate?: (templateId: string) => void }) {
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
  // The right-rail tab lives out here (above the nonce key) so a restore's remount
  // doesn't bounce the user off the Versions tab back to Controls.
  const [sideTab, setSideTab] = useState<'controls' | 'comments' | 'versions'>('controls');

  if (isLoading) return <div className="p-8 text-slate-400">Loading…</div>;
  if (error) return <div className="p-8 text-red-600">{String(error)}</div>;
  if (!data) return null;
  return <Loaded key={nonce} item={data} projectId={projectId} onReload={() => setNonce((n) => n + 1)}
                 onOpenItem={onOpenItem} onOpenTemplate={onOpenTemplate} sideTab={sideTab} onSideTab={setSideTab} />;
}

function Loaded({ item, projectId, onReload, onOpenItem, onOpenTemplate, sideTab, onSideTab }: { item: ApiItem; projectId?: string; onReload: () => void; onOpenItem?: (id: string) => void; onOpenTemplate?: (templateId: string) => void; sideTab: 'controls' | 'comments' | 'versions'; onSideTab: (t: 'controls' | 'comments' | 'versions') => void }) {
  const [activeTab, setActiveTab] = useState(item.tabs[0]?.id ?? '');
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(item.tabs.flatMap((t) => t.fields).map((f) => [f.id, f.value])),
  );
  // Latest values, for callbacks that fire from async work (e.g. paste upload).
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [save, setSave] = useState<SaveState>('idle');
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Field values edited but not yet confirmed saved. Drives flush-on-leave and the
  // unsaved-changes guard; a field is removed once its save succeeds.
  const pending = useRef<Record<string, unknown>>({});
  const qc = useQueryClient();

  // The main content field (rich body) — the only field keyword-highlight targets
  // ("count only in the main content", per the reference).
  const mainFieldId = useMemo(() => {
    const rich = item.tabs.flatMap((t) => t.fields).filter((f) => f.type === 'paragraph_text' && !f.isPlainText);
    return (rich.find((f) => f.isSystem) ?? rich[0])?.id ?? null;
  }, [item]);
  // Keywords currently highlighted in the body (empty = highlight off).
  const [highlightKeywords, setHighlightKeywords] = useState<string[]>([]);
  const mainContentText = mainFieldId ? toPlainText(String(values[mainFieldId] ?? '')) : '';

  // Approval info drives the top-bar status dropdown (current status + ladder).
  const approval = useQuery({ queryKey: ['approval', item.id], queryFn: () => api.getApprovalInfo(item.id) });
  const changeStatus = useMutation({
    mutationFn: (statusId: string) => api.changeItemStatus(item.id, statusId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['item', item.id] });
      void qc.invalidateQueries({ queryKey: ['approval', item.id] });
      void qc.invalidateQueries({ queryKey: ['assignment', item.id] });
      void qc.invalidateQueries({ queryKey: ['versions', item.id] });
      onReload();
    },
  });

  // Export the item as a standalone HTML file. Resolves fresh signed URLs for any
  // asset fields first (the stored value only keeps file references, not URLs).
  const exportHtml = async () => {
    setExportOpen(false);
    const fileUrls = new Map<string, string>();
    const hasFiles = item.tabs.some((t) => t.fields.some((f) => f.type === 'file_image_upload'));
    if (hasFiles && projectId) {
      try {
        const files = await api.listFiles(projectId);
        // The export's file table is a download list → use the original, not the thumbnail.
        files.forEach((f) => { if (f.fullUrl) fileUrls.set(f.id, f.fullUrl); });
      } catch {
        /* fall back to exporting without live URLs */
      }
    }
    const exportDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    downloadText(`${item.name || 'content'}.html`, buildItemHtml(item, values, fileUrls, exportDate), 'text/html');
  };

  // Version preview (read-only) + the restore confirmation live here so both the
  // editor area and the versions sidebar can drive them.
  const [preview, setPreview] = useState<{ id: string; createdAt: string } | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<{ id: string; createdAt: string } | null>(null);
  const previewSnap = useQuery({
    queryKey: ['version', preview?.id],
    queryFn: () => api.getVersion(preview!.id),
    enabled: !!preview,
  });
  // Library files → id→thumbnail URL, so the read-only preview shows the file/asset
  // field as image thumbnails (like the compare view), not bare names.
  const previewFiles = useQuery({
    queryKey: ['files', projectId],
    queryFn: () => api.listFiles(projectId!),
    enabled: !!projectId && !!preview,
  });
  const previewFileUrls = useMemo(() => {
    const m = new Map<string, string>();
    (previewFiles.data ?? []).forEach((f) => { if (f.url) m.set(f.id, f.url); });
    return m;
  }, [previewFiles.data]);
  // "Save version" flashes ✓ Saved for a couple of seconds, then reverts.
  const [savedFlash, setSavedFlash] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const saveVersion = useMutation({
    mutationFn: () => api.saveVersion(item.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['versions', item.id] });
      setSavedFlash(true);
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSavedFlash(false), 2500);
    },
  });
  useEffect(() => () => clearTimeout(savedTimer.current), []);
  const restore = useMutation({
    mutationFn: (vid: string) => api.restoreVersion(item.id, vid),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['item', item.id] });
      void qc.invalidateQueries({ queryKey: ['versions', item.id] });
      setRestoreTarget(null);
      setPreview(null);
      onReload();
      toast('The version has been restored');
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

  // A pasted image became a library file — attach it to the item's Files field so
  // it shows there, linked to this item. Persists immediately (discrete action).
  const attachFile = (sf: StoredFile) => {
    const fileField = item.tabs.flatMap((t) => t.fields).find((f) => f.type === 'file_image_upload');
    if (!fileField) return;
    const current = Array.isArray(valuesRef.current[fileField.id]) ? (valuesRef.current[fileField.id] as StoredFile[]) : [];
    if (current.some((f) => f.id === sf.id)) return; // already attached
    const next = [...current, sf];
    setValues((prev) => ({ ...prev, [fileField.id]: next }));
    pending.current[fileField.id] = next;
    persist(fileField.id, next);
    if (projectId) void qc.invalidateQueries({ queryKey: ['files', projectId] });
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
        {item.templateId && onOpenTemplate && (
          <button type="button" onClick={() => onOpenTemplate(item.templateId!)} title="Open template"
                  className="mb-1 ml-1 grid h-8 w-8 shrink-0 place-items-center self-center rounded text-slate-500 hover:bg-slate-200 hover:text-slate-700">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
            </svg>
          </button>
        )}
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
          <TopStatusSelect
            current={approval.data?.currentStatus ?? (item.status ? { id: '', name: item.status.name, color: item.status.color } : null)}
            statuses={approval.data?.statuses ?? []}
            busy={changeStatus.isPending}
            onChange={(id) => changeStatus.mutate(id)}
          />
          <div className="inline-flex items-center gap-2">
            <button type="button" onClick={() => saveVersion.mutate()} disabled={saveVersion.isPending || savedFlash}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-100">
              {savedFlash ? (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M20 6 9 17l-5-5" /></svg>
                  Saved
                </>
              ) : (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" /></svg>
                  {saveVersion.isPending ? 'Saving…' : 'Save version'}
                </>
              )}
            </button>
            <div className="relative">
              <button type="button" onClick={() => setExportOpen((o) => !o)} title="Export"
                      className="grid h-full place-items-center rounded-md border border-slate-300 bg-white px-1.5 py-1.5 text-slate-600 hover:bg-slate-50">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
              </button>
              {exportOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
                  <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-slate-200 bg-white py-1.5 shadow-xl">
                    <button type="button"
                            onClick={() => void exportHtml()}
                            className="block w-full px-4 py-2 text-left text-[13px] text-slate-700 hover:bg-slate-50">
                      Export as HTML
                    </button>
                    <button type="button" disabled title="Coming soon"
                            className="block w-full cursor-not-allowed px-4 py-2 text-left text-[13px] text-slate-400">
                      Export as DOCX
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
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
                    previewFileUrls,
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
                onAttachFile={attachFile}
                highlightKeywords={f.id === mainFieldId ? highlightKeywords : undefined}
              />
            );
          })
        )}
      </div>
    </div>

      <VersionsPanel
        item={item}
        projectId={projectId}
        onReload={onReload}
        onOpenItem={onOpenItem}
        onOpenTemplate={onOpenTemplate}
        tab={sideTab}
        onTab={onSideTab}
        highlightKeywords={highlightKeywords}
        onSetHighlight={setHighlightKeywords}
        mainContentText={mainContentText}
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
  item, projectId, onReload, onOpenItem, onOpenTemplate, tab, onTab, highlightKeywords, onSetHighlight, mainContentText, previewId, onPreview, onRestoreAsk,
}: {
  item: ApiItem;
  projectId?: string;
  onReload: () => void;
  onOpenItem?: (id: string) => void;
  onOpenTemplate?: (templateId: string) => void;
  tab: 'controls' | 'comments' | 'versions';
  onTab: (t: 'controls' | 'comments' | 'versions') => void;
  highlightKeywords: string[];
  onSetHighlight: (keywords: string[]) => void;
  mainContentText: string;
  previewId: string | null;
  onPreview: (v: ItemVersion | null) => void;
  onRestoreAsk: (v: ItemVersion) => void;
}) {
  return (
    <aside className="w-80 shrink-0 rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="grid grid-cols-3 border-b border-slate-200">
        <SideTab active={tab === 'controls'} onClick={() => onTab('controls')} label="CONTROLS"
                 icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 6h16M4 12h16M4 18h16" /></svg>} />
        <SideTab active={tab === 'comments'} onClick={() => onTab('comments')} label="COMMENTS"
                 icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z" /></svg>} />
        <SideTab active={tab === 'versions'} onClick={() => onTab('versions')} label="VERSIONS"
                 icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l3 3" /></svg>} />
      </div>
      {tab === 'versions' ? (
        <VersionsTab item={item} projectId={projectId} onReload={onReload} onOpenItem={onOpenItem}
                     previewId={previewId} onPreview={onPreview} onRestoreAsk={onRestoreAsk} />
      ) : tab === 'controls' ? (
        <ControlsTab
          item={item}
          onReload={onReload}
          onOpenTemplate={onOpenTemplate}
          highlightKeywords={highlightKeywords}
          onSetHighlight={onSetHighlight}
          mainContentText={mainContentText}
        />
      ) : (
        <div className="grid place-items-center px-6 py-12 text-center text-[13px] text-slate-400">
          Comments are coming in a later phase.
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
  item, projectId, onReload, onOpenItem, previewId, onPreview, onRestoreAsk,
}: {
  item: ApiItem;
  projectId?: string;
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
  // Render only the first `visibleCount`, with a Load more button, so a long
  // history doesn't mount hundreds of cards at once. (Client-side — see note.)
  const PAGE = 15;
  const [visibleCount, setVisibleCount] = useState(PAGE);
  useEffect(() => { setVisibleCount(PAGE); }, [sub]);
  const groups = groupByDate(filtered.slice(0, visibleCount));
  const hasMore = filtered.length > visibleCount;
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
          projectId={projectId}
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
                <span className="text-[14px] font-semibold text-slate-800">{fmtTime(new Date().toISOString())}</span>
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
                onDeleteAsk={() => { setDeleteConfirmId(v.id); setMenuId(null); }}
              />
            ))}
          </div>
        ))}

        {hasMore && (
          <button type="button" onClick={() => setVisibleCount((c) => c + PAGE)}
                  className="block w-full border-t border-slate-100 px-4 py-3 text-center text-[13px] font-semibold text-blue-600 hover:bg-slate-50">
            Load more versions ({filtered.length - visibleCount} more)
          </button>
        )}
      </div>

      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-6"
             onClick={() => !del.isPending && setDeleteConfirmId(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-[16px] leading-relaxed text-slate-800">
              Are you sure you want to delete this version? This action can’t be undone!
            </p>
            {del.isError && <p className="mt-2 text-[13px] text-red-600">Couldn’t delete. Please try again.</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setDeleteConfirmId(null)} disabled={del.isPending}
                      className="rounded-md bg-slate-100 px-5 py-2.5 text-[13px] font-semibold uppercase tracking-wide text-slate-700 hover:bg-slate-200 disabled:opacity-50">
                Cancel
              </button>
              <button type="button" onClick={() => del.mutate(deleteConfirmId)} disabled={del.isPending}
                      className="rounded-md bg-red-600 px-6 py-2.5 text-[13px] font-semibold uppercase tracking-wide text-white hover:bg-red-700 disabled:opacity-50">
                {del.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DateHeader({ label }: { label: string }) {
  return <div className="sticky top-0 z-10 border-y border-blue-100 bg-blue-50 px-4 py-2 text-[14px] font-semibold text-slate-800">{label}</div>;
}

/** The item's status shown as a dropdown in the top bar — pick a status to change
 *  it (any-to-any, like the Controls panel's changer). */
function TopStatusSelect({
  current, statuses, busy, onChange,
}: {
  current: { id: string; name: string; color: string } | null;
  statuses: { id: string; name: string; color: string }[];
  busy: boolean;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  if (!current) return null;
  return (
    <div ref={ref} className="relative">
      <button type="button" disabled={busy} onClick={() => setOpen((v) => !v)}
              className="inline-flex items-center gap-2 rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-50">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: current.color }} />
        <span className="font-medium">{busy ? 'Changing…' : current.name}</span>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`text-slate-500 transition ${open ? 'rotate-180' : ''}`}><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && statuses.length > 0 && (
        <div className="absolute left-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-xl">
          {statuses.map((s) => (
            <button key={s.id} type="button" onClick={() => { if (s.id !== current.id) onChange(s.id); setOpen(false); }}
                    className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm hover:bg-slate-100 ${s.id === current.id ? 'bg-slate-100' : ''}`}>
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: s.color }} />
              <span className={s.id === current.id ? 'font-semibold text-slate-900' : 'text-slate-700'}>{s.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Badge({ kind }: { kind: 'current' | 'manual' | 'status_change' | 'auto' }) {
  const map: Record<string, [string, string]> = {
    current: ['CURRENT', 'bg-green-500'],
    manual: ['MANUAL', 'bg-amber-400'],
    status_change: ['STATUS CHANGE', 'bg-blue-400'],
    auto: ['AUTO', 'bg-slate-400'],
  };
  const [label, bg] = map[kind] ?? ['', 'bg-slate-400'];
  return <span className={`shrink-0 whitespace-nowrap rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white ${bg}`}>{label}</span>;
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
  onRestoreAsk, onCopyStart, onDeleteAsk,
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
  onDeleteAsk: () => void;
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
          <input autoFocus placeholder="Version name" value={renameText} onClick={(e) => e.stopPropagation()} onChange={(e) => onRenameText(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter') onRenameSave(); if (e.key === 'Escape') onRenameCancel(); }}
                 onBlur={() => (renameText.trim() ? onRenameSave() : onRenameCancel())}
                 className="min-w-0 flex-1 rounded border border-blue-500 px-2 py-1.5 text-[14px] text-slate-800 focus:outline-none" />
        ) : v.label ? (
          // Named version: the name is clickable too, so it can be re-edited.
          <button type="button" onClick={stop(onRenameStart)} title="Click to rename this version"
                  className="min-w-0 truncate text-left text-[14px] font-semibold text-slate-800 hover:underline">{v.label}</button>
        ) : (
          // Unnamed version: the timestamp is the heading — click it to name the version.
          <button type="button" onClick={stop(onRenameStart)} title="Click to name this version"
                  className="text-left text-[14px] font-semibold text-slate-800 hover:underline">{time}</button>
        )}
        <Badge kind={v.kind} />
      </div>

      {/* The timestamp sits beneath the name (or beneath the input while editing).
          Clicking it opens the name editor (#152). */}
      {renaming ? (
        <div className="mt-1 text-[13px] font-semibold text-slate-700">{time}</div>
      ) : v.label ? (
        <button type="button" onClick={stop(onRenameStart)} title="Click to rename this version"
                className="mt-0.5 block text-left text-[13px] font-semibold text-slate-700 hover:underline">{time}</button>
      ) : null}

      <div className="mt-1 flex items-center justify-between">
        <span className="text-[12px] text-slate-500">
          {v.created_by_name}{v.created_by_role ? ` (${v.created_by_role})` : ''}
        </span>
        <button type="button" onClick={stop(onMenu)} className="grid h-6 w-6 place-items-center rounded text-slate-400 hover:bg-slate-100">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></svg>
        </button>
      </div>

      <StatusLine v={v} />

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
