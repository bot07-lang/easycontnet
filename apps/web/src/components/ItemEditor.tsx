import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ApiItem, type ItemVersion } from '../lib/api';
import type { ContentField } from '../mock/article';
import { Field } from './Field';
import { toPlainText } from '../lib/counts';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Loads a real content item from the API, renders its fields, and autosaves
 * each field a short beat after you stop typing. A failed save (e.g. RLS says
 * you can't edit) surfaces rather than silently dropping the change.
 */
export function ItemEditor({ itemId, projectId }: { itemId: string; projectId?: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['item', itemId],
    queryFn: () => api.getItem(itemId),
  });
  // Bumped after a restore to remount Loaded so its field state re-initialises.
  const [nonce, setNonce] = useState(0);

  if (isLoading) return <div className="p-8 text-slate-400">Loading…</div>;
  if (error) return <div className="p-8 text-red-600">{String(error)}</div>;
  if (!data) return null;
  return <Loaded key={nonce} item={data} projectId={projectId} onReload={() => setNonce((n) => n + 1)} />;
}

function Loaded({ item, projectId, onReload }: { item: ApiItem; projectId?: string; onReload: () => void }) {
  const [activeTab, setActiveTab] = useState(item.tabs[0]?.id ?? '');
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(item.tabs.flatMap((t) => t.fields).map((f) => [f.id, f.value])),
  );
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>('idle');
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const tab = item.tabs.find((t) => t.id === activeTab) ?? item.tabs[0];

  const onChange = (fieldId: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
    setSave('saving');
    clearTimeout(timers.current[fieldId]);
    timers.current[fieldId] = setTimeout(async () => {
      try {
        await api.saveField(item.id, fieldId, value);
        setSave('saved');
      } catch {
        setSave('error');
      }
    }, 700);
  };

  useEffect(() => {
    const t = timers.current;
    return () => Object.values(t).forEach(clearTimeout);
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

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-5 py-3">
        {item.status && (
          <span className="inline-flex items-center gap-2 rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-800">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.status.color }} />
            {item.status.name}
          </span>
        )}
        <span className="text-xs text-slate-400">Item #{item.itemNumber} · {totalWords} words</span>
        <span className="ml-auto text-xs">
          {save === 'saving' && <span className="text-slate-400">Saving…</span>}
          {save === 'saved' && <span className="text-green-600">Saved</span>}
          {save === 'error' && <span className="text-red-600">Couldn’t save — you may not have edit access</span>}
        </span>
      </div>

      {/* Fields */}
      <div className="space-y-5 px-5 py-6">
        {tab?.fields.map((f) => {
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
        })}
      </div>
    </div>

      <VersionsPanel item={item} onReload={onReload} />
    </div>
  );
}

/**
 * Right-sidebar with the Controls / Comments / Versions tabs. Only Versions is
 * built (Controls = workflow actions, Comments = Phase 2 — both stubbed). The
 * Versions tab mirrors the reference: Compare, All/Named sub-tabs, versions
 * grouped by date, each with a kind badge, author + role, status dot, and a
 * three-dot menu (rename / restore).
 */
function VersionsPanel({ item, onReload }: { item: ApiItem; onReload: () => void }) {
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
        <VersionsTab item={item} onReload={onReload} />
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

function VersionsTab({ item, onReload }: { item: ApiItem; onReload: () => void }) {
  const qc = useQueryClient();
  const versions = useQuery({ queryKey: ['versions', item.id], queryFn: () => api.listVersions(item.id) });
  const [sub, setSub] = useState<'all' | 'named'>('all');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [menuId, setMenuId] = useState<string | null>(null);
  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['versions', item.id] }); };

  const save = useMutation({ mutationFn: () => api.saveVersion(item.id), onSuccess: invalidate });
  const restore = useMutation({
    mutationFn: (vid: string) => api.restoreVersion(item.id, vid),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['item', item.id] }); invalidate(); setConfirmId(null); setMenuId(null); onReload(); },
  });
  const rename = useMutation({
    mutationFn: (v: { vid: string; label: string }) => api.renameVersion(v.vid, v.label),
    onSuccess: () => { invalidate(); setRenameId(null); },
  });

  const list = versions.data ?? [];
  const filtered = sub === 'named' ? list.filter((v) => v.label) : list;
  const groups = groupByDate(filtered);
  const today = fmtDate(new Date().toISOString());

  return (
    <div>
      <div className="border-b border-slate-200 p-3">
        <button type="button" disabled title="Compare view coming next"
                className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-500/60 px-3 py-2.5 text-[13px] font-semibold uppercase tracking-wide text-white opacity-70">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
          Compare versions
        </button>
      </div>

      <div className="grid grid-cols-2 border-b border-slate-200 text-[13px] font-semibold">
        <button type="button" onClick={() => setSub('all')} className={sub === 'all' ? 'bg-white py-2.5 text-slate-800' : 'bg-slate-50 py-2.5 text-slate-500 hover:text-slate-700'}>ALL VERSIONS</button>
        <button type="button" onClick={() => setSub('named')} className={sub === 'named' ? 'bg-white py-2.5 text-slate-800' : 'bg-slate-50 py-2.5 text-slate-500 hover:text-slate-700'}>NAMED VERSIONS</button>
      </div>

      <div className="border-b border-slate-100 p-2">
        <button type="button" onClick={() => save.mutate()} disabled={save.isPending}
                className="w-full rounded-md border border-slate-300 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40">
          {save.isPending ? 'Saving…' : '+ Save version'}
        </button>
      </div>

      <div className="max-h-[60vh] overflow-y-auto">
        {sub === 'all' && (
          <>
            <DateHeader label={today} />
            <div className="border-b border-slate-100 px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-[14px] font-semibold text-slate-800">Current</span>
                <Badge kind="current" />
              </div>
              {item.status && <StatusDot color={item.status.color} name={item.status.name} />}
            </div>
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
                menuOpen={menuId === v.id} onMenu={() => setMenuId(menuId === v.id ? null : v.id)}
                renaming={renameId === v.id} renameText={renameText}
                onRenameStart={() => { setRenameId(v.id); setRenameText(v.label ?? ''); setMenuId(null); }}
                onRenameText={setRenameText}
                onRenameSave={() => renameText.trim() && rename.mutate({ vid: v.id, label: renameText })}
                onRenameCancel={() => setRenameId(null)}
                confirming={confirmId === v.id} restoring={restore.isPending}
                onRestoreAsk={() => { setConfirmId(v.id); setMenuId(null); }}
                onRestoreCancel={() => setConfirmId(null)}
                onRestoreConfirm={() => restore.mutate(v.id)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function DateHeader({ label }: { label: string }) {
  return <div className="bg-blue-50/60 px-4 py-2 text-[14px] font-semibold text-slate-800">{label}</div>;
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

function VersionEntry({
  v, menuOpen, onMenu, renaming, renameText, onRenameStart, onRenameText, onRenameSave, onRenameCancel,
  confirming, restoring, onRestoreAsk, onRestoreCancel, onRestoreConfirm,
}: {
  v: ItemVersion;
  menuOpen: boolean;
  onMenu: () => void;
  renaming: boolean;
  renameText: string;
  onRenameStart: () => void;
  onRenameText: (s: string) => void;
  onRenameSave: () => void;
  onRenameCancel: () => void;
  confirming: boolean;
  restoring: boolean;
  onRestoreAsk: () => void;
  onRestoreCancel: () => void;
  onRestoreConfirm: () => void;
}) {
  const time = new Date(v.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return (
    <div className="relative border-b border-slate-100 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        {renaming ? (
          <input autoFocus value={renameText} onChange={(e) => onRenameText(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter') onRenameSave(); if (e.key === 'Escape') onRenameCancel(); }}
                 onBlur={onRenameCancel}
                 className="w-full rounded border border-slate-300 px-1.5 py-1 text-[13px] focus:border-blue-500 focus:outline-none" />
        ) : (
          <span className="text-[14px] font-semibold text-slate-800">{v.label || time}</span>
        )}
        <Badge kind={v.kind} />
      </div>

      <div className="mt-1 flex items-center justify-between">
        <span className="text-[12px] text-slate-500">
          {v.created_by_name}{v.created_by_role ? ` (${v.created_by_role})` : ''}
        </span>
        <button type="button" onClick={onMenu} className="grid h-6 w-6 place-items-center rounded text-slate-400 hover:bg-slate-100">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></svg>
        </button>
      </div>

      <StatusDot color={v.status_color} name={v.status_name} />

      {confirming && (
        <div className="mt-2 flex items-center gap-2 text-[12px] text-slate-600">
          Restore this version?
          <button type="button" onClick={onRestoreConfirm} disabled={restoring} className="font-semibold text-blue-600 disabled:opacity-50">{restoring ? '…' : 'Yes'}</button>
          <button type="button" onClick={onRestoreCancel} className="text-slate-400">No</button>
        </div>
      )}

      {menuOpen && (
        <div className="absolute right-3 top-9 z-20 w-40 rounded-lg border border-slate-200 bg-white py-1.5 shadow-xl">
          <button type="button" onClick={onRenameStart} className="block w-full px-4 py-2 text-left text-[13px] text-slate-700 hover:bg-slate-50">Rename</button>
          <button type="button" onClick={onRestoreAsk} className="block w-full px-4 py-2 text-left text-[13px] text-slate-700 hover:bg-slate-50">Restore this version</button>
        </div>
      )}
    </div>
  );
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
}
function groupByDate(list: ItemVersion[]): Record<string, ItemVersion[]> {
  const g: Record<string, ItemVersion[]> = {};
  for (const v of list) { const d = fmtDate(v.created_at); (g[d] ??= []).push(v); }
  return g;
}
