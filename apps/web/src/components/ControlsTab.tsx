import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ApiItem, type AssignmentStatus } from '../lib/api';

/**
 * The CONTROLS tab of the item editor's right rail — ITEM DETAILS + WORKFLOW,
 * matching the reference. Wired to real data:
 *   - Template / Keywords / Description come from the item; Brief Title is the
 *     item name; Categories has no data model yet, so it shows the empty state.
 *   - The workflow ladder and status dropdown use the assignment API
 *     (getAssignmentInfo) and changeItemStatus.
 *
 * "Assignees and deadlines" editing and the brief-edit / category actions are
 * later work — rendered as the reference shows them but inert for now.
 */
/** Split the Keywords field the reference way: comma-separated, leading space
 *  trimmed, trailing space KEPT (a trailing space makes a distinct keyword),
 *  case preserved, duplicates preserved, empty tokens dropped. */
export function parseKeywords(raw: string): string[] {
  return raw.split(',').map((t) => t.replace(/^\s+/, '')).filter((t) => t.length > 0);
}

/** Case-sensitive, literal, non-overlapping occurrence count. */
function countOccurrences(text: string, kw: string): number {
  if (!kw) return 0;
  let count = 0;
  let idx = text.indexOf(kw);
  while (idx !== -1) { count++; idx = text.indexOf(kw, idx + kw.length); }
  return count;
}

export function ControlsTab({
  item, onReload, onOpenTemplate, highlightKeywords, onSetHighlight, mainContentText,
}: {
  item: ApiItem;
  onReload: () => void;
  onOpenTemplate?: (templateId: string) => void;
  highlightKeywords: string[];
  onSetHighlight: (keywords: string[]) => void;
  mainContentText: string;
}) {
  const qc = useQueryClient();
  const assignment = useQuery({ queryKey: ['assignment', item.id], queryFn: () => api.getAssignmentInfo(item.id) });
  const changeStatus = useMutation({
    mutationFn: (statusId: string) => api.changeItemStatus(item.id, statusId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['assignment', item.id] });
      void qc.invalidateQueries({ queryKey: ['versions', item.id] });
      onReload();
    },
  });

  const statuses = assignment.data?.statuses ?? [];
  const currentId = assignment.data?.currentStatusId ?? null;
  const currentPos = statuses.find((s) => s.id === currentId)?.position ?? -1;

  const [detailsOpen, setDetailsOpen] = useState(true);
  const [briefOpen, setBriefOpen] = useState(false);

  // Brief edit mode (name / keywords / description) with Save/Cancel.
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(item.name);
  const [draftKeywords, setDraftKeywords] = useState(item.keywords.join(', '));
  const [draftDesc, setDraftDesc] = useState(item.description ?? '');
  const startEdit = () => {
    setDraftTitle(item.name);
    setDraftKeywords(item.keywords.join(', '));
    setDraftDesc(item.description ?? '');
    setEditing(true);
    setBriefOpen(true);
  };
  const saveBrief = useMutation({
    mutationFn: () => api.updateItemBrief(item.id, {
      name: draftTitle.trim() || item.name,
      keywords: parseKeywords(draftKeywords),
      description: draftDesc,
    }),
    onSuccess: () => { setEditing(false); void qc.invalidateQueries({ queryKey: ['item', item.id] }); onReload(); },
  });

  // Highlight-in-text toggle. `item.keywords` are the tokens (each may carry a
  // trailing space). The link is always active (like the reference); toggling it
  // pushes the keywords into the body editor and shows the pink tags + count table.
  const highlightOn = highlightKeywords.length > 0;
  const toggleHighlight = () => onSetHighlight(highlightOn ? [] : item.keywords);

  // Categories — FRONTEND ONLY for now (local state, not yet persisted). Type a
  // name + Enter/comma to add a chip; backend wiring comes later.
  const [categories, setCategories] = useState<string[]>([]);
  const [catEditing, setCatEditing] = useState(false);
  const [catDraft, setCatDraft] = useState<string[]>([]);
  const [catInput, setCatInput] = useState('');
  const startCatEdit = () => { setCatDraft(categories); setCatInput(''); setCatEditing(true); };
  const addCat = (raw: string) => {
    const v = raw.trim();
    if (v && !catDraft.includes(v)) setCatDraft((c) => [...c, v]);
    setCatInput('');
  };
  const removeCat = (c: string) => setCatDraft((d) => d.filter((x) => x !== c));

  return (
    <div className="text-[14px]">
      {/* ITEM DETAILS */}
      <section>
        <button
          type="button"
          onClick={() => setDetailsOpen((v) => !v)}
          className="flex w-full items-center gap-2 bg-slate-100 px-4 py-3 text-[13px] font-bold tracking-wide text-slate-800"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="3" y="4" width="18" height="13" rx="1.5" /><path d="M8 21h8M12 17v4" />
          </svg>
          <span className="flex-1 text-left">ITEM DETAILS</span>
          <Chev open={detailsOpen} />
        </button>

        {detailsOpen && (
          <div className="space-y-4 px-4 py-4">
            <p className="flex items-center gap-1.5">
              <span className="font-semibold text-slate-800">Template:</span>
              <button
                type="button"
                disabled={!item.templateId || !onOpenTemplate}
                onClick={() => item.templateId && onOpenTemplate?.(item.templateId)}
                className="text-blue-600 hover:underline disabled:text-slate-400 disabled:no-underline"
              >
                {item.templateName ?? 'None'}
              </button>
              <button
                type="button"
                disabled={!item.templateId || !onOpenTemplate}
                onClick={() => item.templateId && onOpenTemplate?.(item.templateId)}
                title="Open template"
                className="text-slate-400 hover:text-slate-600 disabled:opacity-40"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15H4.5a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 6 8.6l-.06-.06A2 2 0 1 1 8.77 5.7l.06.06A1.65 1.65 0 0 0 12 4.6V4.5a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 19.4 8.6l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 21.4 15" />
                </svg>
              </button>
            </p>

            <div>
              <p className="mb-2 flex items-center gap-2 font-semibold text-slate-800">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-slate-500">
                  <path d="M20.6 13.4 12 22l-9-9V4a1 1 0 0 1 1-1h8.6l8 8a1 1 0 0 1 0 2.4z" /><circle cx="7.5" cy="7.5" r="1" />
                </svg>
                Categories
                {!catEditing && (
                  <button type="button" onClick={startCatEdit} className="text-blue-600 hover:text-blue-700" title="Edit categories">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                  </button>
                )}
              </p>

              {catEditing ? (
                <div>
                  <div className="min-h-[150px] rounded-lg border border-slate-300 p-2">
                    <div className="flex flex-wrap gap-1.5">
                      {catDraft.map((c) => (
                        <span key={c} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-[13px] text-blue-700">
                          {c}
                          <button type="button" onClick={() => removeCat(c)} className="text-blue-400 hover:text-blue-600" aria-label={`Remove ${c}`}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12" /></svg>
                          </button>
                        </span>
                      ))}
                      <input
                        value={catInput}
                        onChange={(e) => setCatInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addCat(catInput); }
                          else if (e.key === 'Backspace' && !catInput && catDraft.length) removeCat(catDraft[catDraft.length - 1]!);
                        }}
                        placeholder={catDraft.length ? '' : 'Select category'}
                        className="min-w-[120px] flex-1 bg-transparent px-1 py-1 text-[14px] text-slate-800 placeholder:text-slate-400 focus:outline-none"
                      />
                    </div>
                  </div>
                  <div className="mt-3 flex justify-end gap-3">
                    <button type="button" onClick={() => setCatEditing(false)}
                            className="rounded border border-slate-300 px-5 py-2 text-[13px] font-semibold uppercase tracking-wide text-slate-700 hover:bg-slate-50">
                      Cancel
                    </button>
                    <button type="button" onClick={() => { setCategories(catDraft); setCatEditing(false); }}
                            className="rounded bg-green-600 px-6 py-2 text-[13px] font-semibold uppercase tracking-wide text-white hover:bg-green-700">
                      Save
                    </button>
                  </div>
                </div>
              ) : categories.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {categories.map((c) => (
                    <span key={c} className="rounded-full border border-slate-300 px-3 py-1 text-[13px] text-slate-700">{c}</span>
                  ))}
                </div>
              ) : (
                <p className="text-[13px] text-slate-400">No categories assigned</p>
              )}
            </div>

            <button
              type="button"
              onClick={() => setBriefOpen((v) => !v)}
              className="flex items-center gap-1.5 text-[14px] font-medium text-blue-600 hover:underline"
            >
              <Chev open={briefOpen} blue />
              {briefOpen ? 'Hide' : 'Show'} brief information
            </button>

            {briefOpen && (editing ? (
              /* EDIT MODE — Brief Title / Keywords / Description with Save/Cancel */
              <div className="space-y-4">
                <div>
                  <p className="mb-1.5 font-semibold text-slate-800">Brief Title</p>
                  <input
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    className="w-full rounded border-2 border-slate-400 px-3 py-2 text-[13px] text-slate-800 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <p className="mb-1.5 font-semibold text-slate-800">Keywords</p>
                  <textarea
                    value={draftKeywords}
                    onChange={(e) => setDraftKeywords(e.target.value)}
                    rows={3}
                    className="w-full resize-y rounded border-2 border-slate-400 px-3 py-2 text-[13px] text-slate-800 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <p className="mb-1.5 font-semibold text-slate-800">Description</p>
                  <textarea
                    value={draftDesc}
                    onChange={(e) => setDraftDesc(e.target.value)}
                    rows={3}
                    className="w-full resize-y rounded border-2 border-slate-400 px-3 py-2 text-[13px] text-slate-800 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                {saveBrief.isError && <p className="text-[12px] text-red-600">Couldn’t save. Please try again.</p>}
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    disabled={saveBrief.isPending}
                    className="rounded border border-slate-300 px-5 py-2 text-[13px] font-semibold uppercase tracking-wide text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => saveBrief.mutate()}
                    disabled={saveBrief.isPending}
                    className="rounded bg-green-600 px-6 py-2 text-[13px] font-semibold uppercase tracking-wide text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {saveBrief.isPending ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            ) : (
              /* READ MODE — with Highlight-in-text + Keyword|Count table */
              <div className="space-y-4">
                <BriefField label="Brief Title" value={item.name} />
                <div>
                  <p className="mb-1.5 font-semibold text-slate-800">Keywords</p>
                  {highlightOn ? (
                    <div className="min-h-[38px] rounded border border-slate-200 px-3 py-2 text-[13px] leading-relaxed text-slate-700">
                      {item.keywords.map((k, i) => (
                        <span key={i}>
                          <span className="cw-kw-tag">{k}</span>{i < item.keywords.length - 1 ? ', ' : ''}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="min-h-[38px] rounded border border-slate-200 px-3 py-2 text-[13px] text-slate-700">{item.keywords.join(', ')}</p>
                  )}
                  <button
                    type="button"
                    onClick={toggleHighlight}
                    className="mt-2 block w-full text-right text-[15px] font-medium text-blue-600 hover:underline"
                  >
                    {highlightOn ? 'Remove highlight' : 'Highlight in text'}
                  </button>
                </div>

                {highlightOn && item.keywords.length > 0 && (
                  <table className="w-full border-collapse text-[14px]">
                    <thead>
                      <tr>
                        <th className="border border-slate-200 px-3 py-2 text-center font-normal text-slate-700">Keyword</th>
                        <th className="border border-slate-200 px-3 py-2 text-center font-normal text-slate-700">Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {item.keywords.map((k, i) => (
                        <tr key={i}>
                          <td className="border border-slate-200 px-3 py-2 text-slate-800">{k}</td>
                          <td className="border border-slate-200 px-3 py-2 text-center text-slate-800">{countOccurrences(mainContentText, k)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                <BriefField label="Description" value={item.description ?? ''} />
                <button
                  type="button"
                  onClick={startEdit}
                  className="flex w-full items-center justify-end gap-1.5 text-[14px] font-medium text-blue-600 hover:underline"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                  Edit brief details
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* WORKFLOW */}
      <section className="border-t border-slate-200">
        <div className="flex items-center gap-2 bg-slate-100 px-4 py-3 text-[13px] font-bold tracking-wide text-slate-800">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 6h10M4 12h7M4 18h13" /><circle cx="18" cy="6" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="21" cy="18" r="2" />
          </svg>
          <span className="flex-1">WORKFLOW</span>
          <a href="https://help.easycontent.io" target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[12px] font-medium text-blue-600 hover:underline">
            Learn more
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></svg>
          </a>
        </div>

        <div className="px-4 py-4">
          <button
            type="button"
            className="mb-5 flex items-center gap-2 text-[14px] font-semibold text-blue-600 hover:underline"
            title="Assignees and deadlines"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11" />
            </svg>
            Assignees and deadlines
          </button>

          {assignment.isLoading ? (
            <p className="text-[13px] text-slate-400">Loading workflow…</p>
          ) : (
            <ol>
              {statuses.map((s, i) => (
                <StatusRow
                  key={s.id}
                  status={s}
                  isCurrent={s.id === currentId}
                  isComplete={currentPos >= 0 && s.position < currentPos}
                  isLast={i === statuses.length - 1}
                />
              ))}
            </ol>
          )}
        </div>

        {statuses.length > 0 && currentId && (
          <StatusChanger
            statuses={statuses}
            currentId={currentId}
            busy={changeStatus.isPending}
            onChange={(id) => changeStatus.mutate(id)}
          />
        )}
      </section>
    </div>
  );
}

/** A read-only brief field rendered as a bordered box, like the reference. */
function BriefField({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 font-semibold text-slate-800">{label}</p>
      <p className="min-h-[38px] rounded border border-slate-200 px-3 py-2 text-[13px] text-slate-700">{value}</p>
      {children}
    </div>
  );
}

function Chev({ open, blue }: { open: boolean; blue?: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
         strokeLinecap="round" strokeLinejoin="round" className={`transition ${open ? 'rotate-180' : ''} ${blue ? 'text-blue-600' : ''}`}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** Initials for an avatar chip from a person's name. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')).toUpperCase();
}

/** Stable avatar colour from a name, so the same person is always the same hue. */
function stringToColor(s: string): string {
  const palette = ['#e11d48', '#7c3aed', '#0891b2', '#ea580c', '#059669', '#4f46e5'];
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length]!;
}

function StatusRow({ status, isCurrent, isComplete, isLast }: {
  status: AssignmentStatus;
  isCurrent: boolean;
  isComplete: boolean;
  isLast: boolean;
}) {
  return (
    <li className="relative pb-6 pl-8 last:pb-0">
      {!isLast && <span className="absolute left-[9px] top-5 h-full w-px bg-slate-200" />}

      {/* Marker: current = hollow ring in the status colour; otherwise a filled
          circle in the status colour, with a tick once the status is complete. */}
      <span
        className="absolute left-0 top-0.5 grid h-[19px] w-[19px] place-items-center rounded-full"
        style={isCurrent ? { border: `3px solid ${status.color}`, background: 'white' } : { background: status.color }}
      >
        {isComplete && !isCurrent && (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4"><path d="M20 6 9 17l-5-5" /></svg>
        )}
      </span>

      <div className="flex items-center gap-1.5">
        <span className={isCurrent ? 'text-[15px] font-semibold text-slate-900' : 'text-[15px] text-slate-800'}>
          {status.name}
        </span>
        {status.read_only && (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400" aria-label="Read-only">
            <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        )}
      </div>

      {status.assignees.length > 0 && (
        <ul className="mt-2.5 space-y-2">
          {status.assignees.map((a) => (
            <li key={a.id} className="flex items-center gap-2">
              <span
                className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white"
                style={{ background: stringToColor(a.name) }}
              >
                {initials(a.name)}
              </span>
              <span className={`truncate text-[13px] ${isCurrent ? 'text-slate-700' : 'text-slate-400'}`}>{a.name}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** The manual any-to-any status jump at the foot of the workflow. */
function StatusChanger({ statuses, currentId, busy, onChange }: {
  statuses: AssignmentStatus[];
  currentId: string;
  busy: boolean;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = statuses.find((s) => s.id === currentId) ?? statuses[0]!;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={ref} className="relative border-t border-slate-200 px-4 py-3">
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-md border border-slate-300 bg-white px-3 py-2.5 text-left transition hover:bg-slate-50 disabled:opacity-50"
      >
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: current.color }} />
        <span className="flex-1 text-[15px] font-semibold text-slate-800">{busy ? 'Changing…' : current.name}</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`text-slate-500 transition ${open ? 'rotate-180' : ''}`}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        // Opens upward — the changer sits at the foot of the rail.
        <div className="absolute inset-x-4 bottom-full z-30 mb-1 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-xl">
          {statuses.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => { if (s.id !== currentId) onChange(s.id); setOpen(false); }}
              className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition hover:bg-slate-100 ${s.id === currentId ? 'bg-slate-100' : ''}`}
            >
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: s.color }} />
              <span className={`flex-1 text-[15px] ${s.id === currentId ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>{s.name}</span>
              {s.read_only && (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400" aria-label="Read-only">
                  <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
