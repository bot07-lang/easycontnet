import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ApiItem, type ItemVersion } from '../lib/api';
import {
  diffFieldHtml,
  fieldChanged,
  fieldValueToHtml,
  isDiffableField,
  type DiffFieldMeta,
} from '../lib/diff-fields';

/**
 * Compare two versions of an item, field by field, with formatting preserved.
 *
 * The two sides are chosen with a dual-handle slider over the version timeline
 * (oldest → newest, with the live "Current" at the far right). By default the two
 * handles are locked one step apart, so scrubbing compares each version against
 * the one just before it. Ticking "Compare any two versions" unlocks the handles
 * to pick any pair.
 *
 * The two chosen versions sit as side-by-side column headers, each with its own
 * RESTORE VERSION button. Each field diffs independently and has its own
 * unified ⇄ split-view toggle. HTML-diff (lib/diff-fields) preserves all
 * formatting — bold, headings, tables, images — marking removals red and
 * additions green.
 */

const CURRENT = 'current';

/** A selectable point on the slider: a saved version, or the live current values. */
type Point = { id: string; version: ItemVersion | null };

const CURRENT_POINT: Point = { id: CURRENT, version: null };

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Hover tooltip for a handle. */
function pointTooltip(p: Point, currentTime: string): string {
  if (!p.version) return `Current version from ${currentTime}`;
  const v = p.version;
  const who = v.created_by_name ? ` by ${v.created_by_name}${v.created_by_role ? ` (${v.created_by_role})` : ''}` : '';
  return `Version from ${fmtDate(v.created_at)}, ${fmtTime(v.created_at)}${who}`;
}

export function CompareDialog({
  item,
  projectId,
  versions,
  onClose,
  onRestored,
}: {
  item: ApiItem;
  projectId?: string;
  versions: ItemVersion[];
  onClose: () => void;
  onRestored: () => void;
}) {
  const qc = useQueryClient();

  // Library files → id→thumbnail URL, so the file/asset field diffs as image
  // thumbnails rather than bare names.
  const filesQuery = useQuery({
    queryKey: ['files', projectId],
    queryFn: () => api.listFiles(projectId!),
    enabled: !!projectId,
  });
  const fileUrls = useMemo(() => {
    const m = new Map<string, string>();
    (filesQuery.data ?? []).forEach((f) => { if (f.url) m.set(f.id, f.url); });
    return m;
  }, [filesQuery.data]);

  // Timeline points, oldest → newest, with Current appended at the far right.
  const points = useMemo<Point[]>(() => {
    const list: Point[] = [...versions].reverse().map((v) => ({ id: v.id, version: v }));
    list.push(CURRENT_POINT);
    return list;
  }, [versions]);
  const n = points.length;
  const currentTime = fmtTime(new Date().toISOString());

  // Handle indices: a = older (left), b = newer (right). Default: last two.
  const [aIdx, setAIdx] = useState(Math.max(0, n - 2));
  const [bIdx, setBIdx] = useState(n - 1);
  const [anyTwo, setAnyTwo] = useState(false);
  const [restoreModal, setRestoreModal] = useState<Point | null>(null);

  const a = points[aIdx] ?? CURRENT_POINT;
  const b = points[bIdx] ?? CURRENT_POINT;

  const aSnap = useQuery({ queryKey: ['version', a.id], queryFn: () => api.getVersion(a.id), enabled: a.id !== CURRENT });
  const bSnap = useQuery({ queryKey: ['version', b.id], queryFn: () => api.getVersion(b.id), enabled: b.id !== CURRENT });

  // fieldId → current live value, from the item the editor already loaded.
  const currentMap = useMemo(() => {
    const m = new Map<string, unknown>();
    item.tabs.flatMap((t) => t.fields).forEach((f) => m.set(f.id, f.value));
    return m;
  }, [item]);

  const resolve = (p: Point, snap: Record<string, unknown> | undefined) =>
    p.id === CURRENT ? (fid: string) => currentMap.get(fid) : (fid: string) => (snap ?? {})[fid];
  const aResolve = resolve(a, aSnap.data?.snapshot);
  const bResolve = resolve(b, bSnap.data?.snapshot);

  const restore = useMutation({
    mutationFn: (vid: string) => api.restoreVersion(item.id, vid),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['item', item.id] });
      setRestoreModal(null);
      onRestored();
    },
  });

  const loading = (a.id !== CURRENT && aSnap.isLoading) || (b.id !== CURRENT && bSnap.isLoading);
  const failed = (a.id !== CURRENT && aSnap.isError) || (b.id !== CURRENT && bSnap.isError);

  // Move a handle to an index, honouring locked (adjacent) vs free mode.
  const moveHandle = (which: 'a' | 'b', idx: number) => {
    const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
    if (anyTwo) {
      if (which === 'a') setAIdx(clamp(idx, 0, bIdx - 1));
      else setBIdx(clamp(idx, aIdx + 1, n - 1));
    } else {
      if (which === 'a') { const na = clamp(idx, 0, n - 2); setAIdx(na); setBIdx(na + 1); }
      else { const nb = clamp(idx, 1, n - 1); setBIdx(nb); setAIdx(nb - 1); }
    }
  };

  const toggleAnyTwo = (on: boolean) => {
    setAnyTwo(on);
    if (!on) setAIdx(Math.max(0, bIdx - 1));
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-100">
      <style>{DIFF_CSS}</style>

      {/* Header */}
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <h2 className="truncate text-[17px] font-semibold text-slate-900">Compare versions of “{item.name}”</h2>
        <button type="button" onClick={onClose} title="Close"
                className="grid h-9 w-9 place-items-center rounded-full text-slate-500 hover:bg-slate-100">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </header>

      {/* Slider + the any-two toggle */}
      <div className="flex flex-wrap items-center gap-6 border-b border-slate-200 bg-white px-6 py-4">
        <div className="min-w-[280px] flex-1">
          <VersionSlider points={points} aIdx={aIdx} bIdx={bIdx} anyTwo={anyTwo} currentTime={currentTime} onMove={moveHandle} />
        </div>
        <label className="flex cursor-pointer select-none items-center gap-2 text-[14px] text-slate-700">
          <input type="checkbox" checked={anyTwo} onChange={(e) => toggleAnyTwo(e.target.checked)} className="h-4 w-4 accent-blue-600" />
          Compare any two versions
        </label>
      </div>

      {/* Two version column headers, each with its own RESTORE VERSION */}
      <div className="grid grid-cols-2 divide-x divide-slate-200 border-b border-slate-200 bg-white">
        <VersionColumn p={a} currentTime={currentTime} status={item.status} onRestore={() => setRestoreModal(a)} />
        <VersionColumn p={b} currentTime={currentTime} status={item.status} onRestore={() => setRestoreModal(b)} />
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {failed ? (
          <p className="mx-auto max-w-3xl rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Couldn’t load one of the versions. Please close and try again.
          </p>
        ) : loading ? (
          <p className="mx-auto max-w-3xl text-center text-sm text-slate-400">Loading versions…</p>
        ) : (
          <div className="mx-auto w-full max-w-[1800px] space-y-6 px-6">
            {item.tabs.map((t) => {
              const fields = t.fields.filter((f) => isDiffableField(f.type));
              if (!fields.length) return null;
              return (
                <section key={t.id} className="space-y-4">
                  <h3 className="text-center text-[15px] font-semibold text-slate-700">{t.name}</h3>
                  {fields.map((f) => (
                    <FieldDiff
                      key={f.id}
                      field={{ id: f.id, type: f.type, label: f.label, isPlainText: f.isPlainText, choices: f.choices }}
                      aValue={aResolve(f.id)}
                      bValue={bResolve(f.id)}
                      fileUrls={fileUrls}
                    />
                  ))}
                </section>
              );
            })}
          </div>
        )}
      </div>

      {restoreModal?.version && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-900/50 p-6" onClick={() => !restore.isPending && setRestoreModal(null)}>
          <div className="w-full max-w-xl rounded-xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <h3 className="text-[19px] font-semibold text-slate-900">Restore this version?</h3>
              <button type="button" onClick={() => !restore.isPending && setRestoreModal(null)} className="grid h-8 w-8 place-items-center rounded-full text-slate-400 hover:bg-slate-100">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <p className="text-[15px] text-slate-600">
              Your current document will revert to the version from {fmtDate(restoreModal.version.created_at)}.
            </p>
            {restore.isError && <p className="mt-2 text-[13px] text-red-600">Couldn’t restore. Please try again.</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setRestoreModal(null)} disabled={restore.isPending}
                      className="rounded-md bg-slate-100 px-5 py-2.5 text-[13px] font-semibold uppercase tracking-wide text-slate-700 hover:bg-slate-200 disabled:opacity-50">
                Cancel
              </button>
              <button type="button" onClick={() => restore.mutate(restoreModal.id)} disabled={restore.isPending}
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

/** One version's column header: title, RESTORE VERSION, kind badge, author, status. */
function VersionColumn({
  p, currentTime, status, onRestore,
}: {
  p: Point;
  currentTime: string;
  status: { name: string; color: string } | null;
  onRestore: () => void;
}) {
  const v = p.version;
  const title = v ? (v.label || `Version from ${fmtDate(v.created_at)}, ${fmtTime(v.created_at)}`) : `Current version from ${currentTime}`;
  const kindLabel: Record<string, string> = { manual: 'MANUAL', status_change: 'STATUS CHANGE', auto: 'AUTO' };
  const statusName = v ? v.status_name : status?.name ?? null;
  const statusColor = v ? v.status_color : status?.color ?? null;

  return (
    <div className="flex items-start justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <p className="truncate text-[15px] font-semibold text-slate-900">{title}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
          {v && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-700">{kindLabel[v.kind] ?? v.kind}</span>}
          {v?.created_by_name && <span>{v.created_by_name}{v.created_by_role ? ` (${v.created_by_role})` : ''}</span>}
          {statusName && (
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: statusColor ?? '#9ca3af' }} />
              {statusName}
            </span>
          )}
        </div>
      </div>

      {/* Current is the live doc — nothing to restore to. */}
      {v && (
        <button type="button" onClick={onRestore}
                className="shrink-0 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-[12px] font-semibold uppercase tracking-wide text-slate-700 hover:bg-slate-100">
          Restore version
        </button>
      )}
    </div>
  );
}

/** The dual-handle timeline slider. Handles snap to version ticks. */
function VersionSlider({
  points, aIdx, bIdx, anyTwo, currentTime, onMove,
}: {
  points: Point[];
  aIdx: number;
  bIdx: number;
  anyTwo: boolean;
  currentTime: string;
  onMove: (which: 'a' | 'b', idx: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<'a' | 'b' | null>(null);
  const n = points.length;
  const pct = (idx: number) => (n <= 1 ? 0 : (idx / (n - 1)) * 100);
  const at = (i: number): Point => points[i] ?? CURRENT_POINT;

  const idxFromClientX = (clientX: number) => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    const r = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(r * (n - 1));
  };

  const startDrag = (which: 'a' | 'b') => (e: React.PointerEvent) => {
    e.preventDefault();
    onMove(which, idxFromClientX(e.clientX));
    const onPointerMove = (ev: PointerEvent) => onMove(which, idxFromClientX(ev.clientX));
    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  const onTrackClick = (e: React.PointerEvent) => {
    const idx = idxFromClientX(e.clientX);
    const which = Math.abs(idx - aIdx) <= Math.abs(idx - bIdx) ? 'a' : 'b';
    onMove(which, idx);
  };

  const Handle = ({ which, idx }: { which: 'a' | 'b'; idx: number }) => (
    <button
      type="button"
      onPointerDown={startDrag(which)}
      onMouseEnter={() => setHover(which)}
      onMouseLeave={() => setHover((h) => (h === which ? null : h))}
      aria-label={which === 'a' ? 'Base version' : 'Compared version'}
      className="absolute top-1/2 z-10 grid h-8 w-8 -translate-x-1/2 -translate-y-1/2 cursor-grab place-items-center rounded-full bg-blue-600 text-white shadow-md ring-2 ring-white active:cursor-grabbing"
      style={{ left: `${pct(idx)}%` }}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M9 6l-4 6 4 6M15 6l4 6-4 6" /></svg>
      {hover === which && (
        <span className="pointer-events-none absolute bottom-9 left-1/2 w-max max-w-xs -translate-x-1/2 rounded-md bg-slate-800 px-3 py-1.5 text-[12px] font-medium text-white shadow-lg">
          {pointTooltip(at(idx), currentTime)}
          <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-slate-800" />
        </span>
      )}
    </button>
  );

  return (
    <div className="px-4 pt-2">
      <div ref={trackRef} onPointerDown={onTrackClick} className="relative h-2 cursor-pointer rounded-full bg-slate-200">
        {/* ticks — one per version, no filled segment between handles */}
        {points.map((p, i) => (
          <span key={p.id} className="absolute top-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-slate-300" style={{ left: `${pct(i)}%` }} />
        ))}
        <Handle which="a" idx={aIdx} />
        <Handle which="b" idx={bIdx} />
      </div>
      <p className="mt-3 text-[11px] text-slate-400">
        {anyTwo ? 'Drag either handle to compare any two versions.' : 'Drag to compare each version with the one before it.'}
      </p>
    </div>
  );
}

/** One field diffed, with its own unified ⇄ split view toggle. */
function FieldDiff({
  field, aValue, bValue, fileUrls,
}: {
  field: DiffFieldMeta;
  aValue: unknown;
  bValue: unknown;
  fileUrls?: Map<string, string>;
}) {
  const [view, setView] = useState<'unified' | 'split'>('unified');
  const aHtml = fieldValueToHtml(field, aValue, fileUrls);
  const bHtml = fieldValueToHtml(field, bValue, fileUrls);
  const changed = fieldChanged(aHtml, bHtml);
  const diffed = diffFieldHtml(aHtml, bHtml);
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center gap-4 border-b border-slate-200 bg-slate-50/70 px-5 py-2.5">
        <h4 className="text-[14px] font-semibold text-slate-800">{field.label}</h4>
        {/* Toggle shows on every field, matching the reference — even unchanged
            ones can be viewed side by side. */}
        <button type="button" onClick={() => setView(view === 'unified' ? 'split' : 'unified')}
                className="text-[13px] font-medium text-blue-600 hover:underline">
          {view === 'unified' ? 'Switch to split view' : 'Switch to unified view'}
        </button>
        <span className="ml-auto">
          {changed ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Changed</span>
          ) : (
            <span className="text-[11px] text-slate-400">No changes</span>
          )}
        </span>
      </div>

      {view === 'split' ? (
        // Each side renders its OWN raw HTML — old (as it was) | new (as it is) —
        // so formatting/colour changes show by the sides differing, no overlay.
        <div className="grid grid-cols-2 divide-x divide-slate-200">
          <div className="cw-diff min-w-0 overflow-x-auto px-5 py-4" dangerouslySetInnerHTML={{ __html: aHtml || '<span class="cw-empty">Empty</span>' }} />
          <div className="cw-diff min-w-0 overflow-x-auto px-5 py-4" dangerouslySetInnerHTML={{ __html: bHtml || '<span class="cw-empty">Empty</span>' }} />
        </div>
      ) : (
        // Unified: one combined block with htmldiff's inline del (red) + ins (green).
        <div className="cw-diff px-5 py-4" dangerouslySetInnerHTML={{ __html: (changed ? diffed : bHtml) || '<span class="cw-empty">Empty</span>' }} />
      )}
    </div>
  );
}

/** Diff styling + the split-view filter (one diff, two filtered columns). Also
 *  reused (base typography only) by the read-only version preview. */
export const DIFF_CSS = `
.cw-diff { color: #1e293b; font-size: 15px; line-height: 1.6; word-break: break-word; }
.cw-diff p { margin: 0 0 0.6em; }
.cw-diff p:last-child { margin-bottom: 0; }
.cw-diff h1 { font-size: 1.6em; font-weight: 700; margin: 0.4em 0; }
.cw-diff h2 { font-size: 1.35em; font-weight: 700; margin: 0.4em 0; }
.cw-diff h3 { font-size: 1.15em; font-weight: 600; margin: 0.4em 0; }
.cw-diff ul { list-style: disc; padding-left: 1.4em; margin: 0.4em 0; }
.cw-diff ol { list-style: decimal; padding-left: 1.4em; margin: 0.4em 0; }
.cw-diff a { color: #2563eb; text-decoration: underline; }
.cw-diff img { max-width: 100%; height: auto; border-radius: 4px; margin: 0.3em 0; }
/* Videos/embeds and wide tables must stay inside their (split) column, not
   overflow into the other side. */
.cw-diff iframe, .cw-diff video { max-width: 100%; }
.cw-diff table { border-collapse: collapse; width: 100%; margin: 0.5em 0; display: block; overflow-x: auto; }
.cw-diff td, .cw-diff th { border: 1px solid #cbd5e1; padding: 6px 10px; }
.cw-diff pre { background: #f1f5f9; padding: 0.6em; border-radius: 6px; overflow-x: auto; }
.cw-diff code { background: #f1f5f9; padding: 0.1em 0.3em; border-radius: 4px; }

.cw-diff ins { background: #dcfce7; color: #14532d; text-decoration: none; border-radius: 2px; }
.cw-diff del { background: #fee2e2; color: #7f1d1d; text-decoration: line-through; border-radius: 2px; }
/* Block-replace fallback (formatting/structure-only change): the red/green
   highlight hugs each line's text — even lines broken inside one block — via an
   inline box-decoration-break, keeping the content's own colours. Each block is
   made inline and given a forced line break after it (::after "\A") so paragraph
   separation is preserved. */
.cw-diff del.cw-block, .cw-diff ins.cw-block { display: block; color: inherit; background: none; }
.cw-diff del.cw-block { text-decoration-color: #ef4444; }
.cw-diff del.cw-block :where(p, li, h1, h2, h3, h4, blockquote, pre),
.cw-diff ins.cw-block :where(p, li, h1, h2, h3, h4, blockquote, pre) {
  display: inline; -webkit-box-decoration-break: clone; box-decoration-break: clone;
  border-radius: 2px; padding: 0 2px;
}
.cw-diff del.cw-block :where(p, li, h1, h2, h3, h4, blockquote, pre) { background: #fee2e2; }
.cw-diff ins.cw-block :where(p, li, h1, h2, h3, h4, blockquote, pre) { background: #dcfce7; }
.cw-diff del.cw-block :where(p, li, h1, h2, h3, h4, blockquote, pre)::after,
.cw-diff ins.cw-block :where(p, li, h1, h2, h3, h4, blockquote, pre)::after { content: "\A"; white-space: pre; }
.cw-diff del.cw-block :where(ul, ol), .cw-diff ins.cw-block :where(ul, ol) { padding-left: 0; list-style: none; margin: 0; }
.cw-diff ins img { outline: 2px solid #22c55e; }
.cw-diff del img { outline: 2px solid #ef4444; opacity: 0.7; }
.cw-empty { color: #94a3b8; font-style: italic; }

/* File/asset field diff — thumbnails laid out in a row. */
.cw-diff .cw-file { display: inline-block; vertical-align: top; margin: 0 10px 10px 0; text-align: center; }
.cw-diff .cw-file img { max-width: 140px; max-height: 140px; border: 1px solid #e2e8f0; border-radius: 4px; margin: 0; }
.cw-diff .cw-file figcaption { max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: #64748b; }
.cw-diff .cw-file-name { padding: 2px 0; }
`;
