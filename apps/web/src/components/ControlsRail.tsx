import { useEffect, useRef, useState } from 'react';
import type { ContentItem, WorkflowStatus } from '../mock/article';

/**
 * The right rail: CONTROLS / COMMENTS / VERSIONS.
 *
 * The workflow ladder encodes four states at once, and getting them right
 * matters more than it looks:
 *
 *   complete  → filled circle in the status colour, with a tick
 *   current   → hollow ring, bold label
 *   upcoming  → filled grey
 *   readOnly  → padlock beside the name
 *
 * Assignees hang beneath their status, each with a hollow ring showing whether
 * that person has recorded their review yet. An item carries assignees for
 * EVERY status, not just the current one, which is why the whole ladder
 * renders rather than a single row.
 */

function Tick() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function Lock() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" className="text-slate-400" aria-label="Read-only">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function StatusRow({ status, isCurrent, isLast }: {
  status: WorkflowStatus;
  isCurrent: boolean;
  isLast: boolean;
}) {
  return (
    <li className="relative pb-6 pl-8 last:pb-0">
      {/* Connector */}
      {!isLast && <span className="absolute left-[9px] top-5 h-full w-px bg-slate-200" />}

      {/* State marker */}
      <span
        className="absolute left-0 top-0.5 grid h-[19px] w-[19px] place-items-center rounded-full"
        style={
          isCurrent
            ? { border: `3px solid ${status.color}`, background: 'white' }
            : { background: status.isComplete ? status.color : '#cbd5e1' }
        }
      >
        {status.isComplete && !isCurrent && <Tick />}
      </span>

      <div className="flex items-center gap-1.5">
        <span
          className={
            isCurrent
              ? 'text-[15px] font-semibold text-slate-900'
              : 'text-[15px] text-slate-400'
          }
        >
          {status.name}
        </span>
        {status.readOnly && <Lock />}
      </div>

      {status.assignees.length > 0 && (
        <ul className="mt-2.5 space-y-2">
          {status.assignees.map((a) => (
            <li key={a.name} className="flex items-center gap-2">
              {/* The per-person review ring is Phase 2 and its exact meaning is
                  unconfirmed, so it is omitted rather than guessed. */}
              <span
                className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full
                           text-[10px] font-semibold text-white"
                style={{ background: stringToColor(a.name) }}
              >
                {a.initials}
              </span>
              <span className={`truncate text-[13px] ${isCurrent ? 'text-slate-700' : 'text-slate-400'}`}>
                {a.name} <span className="text-slate-400">({a.role})</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Stable avatar colour from a name, so the same person is always the same hue. */
function stringToColor(s: string): string {
  const palette = ['#e11d48', '#7c3aed', '#0891b2', '#ea580c', '#059669', '#4f46e5'];
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length]!;
}

/**
 * The manual status-change control at the foot of the workflow.
 *
 * This is NOT submit/approve/reject — it is the direct any-to-any jump. In the
 * real product it requires manage_content_items and clears all recorded
 * reviews, which is why it is a distinct, slightly dangerous control rather
 * than the normal way an item advances.
 */
function StatusChanger({
  statuses, currentId, onChange,
}: {
  statuses: WorkflowStatus[];
  currentId: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = statuses.find((s) => s.id === currentId) ?? statuses[0]!;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={ref} className="relative border-t border-slate-200 px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-md border border-slate-300
                   bg-white px-3 py-2.5 text-left transition hover:bg-slate-50"
      >
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: current.color }} />
        <span className="flex-1 text-[15px] font-semibold text-slate-800">{current.name}</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" className={`text-slate-500 transition ${open ? 'rotate-180' : ''}`}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        // Opens upward: the changer sits at the foot of the rail, and the rail
        // card clips overflow for its rounded corners, so a downward menu would
        // be cut off.
        <div className="absolute inset-x-4 bottom-full z-30 mb-1 overflow-hidden rounded-md
                        border border-slate-200 bg-white py-1 shadow-xl">
          {statuses.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => { onChange(s.id); setOpen(false); }}
              className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition
                          hover:bg-slate-100 ${s.id === currentId ? 'bg-slate-100' : ''}`}
            >
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: s.color }} />
              <span className={`flex-1 text-[15px] ${
                s.id === currentId ? 'font-semibold text-slate-900' : 'text-slate-700'
              }`}>
                {s.name}
              </span>
              {s.readOnly && (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="2" className="text-slate-400" aria-label="Read-only">
                  <rect x="4" y="11" width="16" height="10" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ControlsRail({
  item, onStatusChange,
}: {
  item: ContentItem;
  onStatusChange: (statusId: string) => void;
}) {
  const [tab, setTab] = useState<'controls' | 'comments' | 'versions'>('controls');
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [briefOpen, setBriefOpen] = useState(false);

  // Comments are Phase 2, so the badge count stays hidden until then —
  // no point advertising a number for a panel that cannot open yet.
  const commentTotal = 0;

  const tabs = [
    { id: 'controls' as const, label: 'CONTROLS', badge: 0, enabled: true },
    { id: 'comments' as const, label: 'COMMENTS', badge: commentTotal, enabled: false },
    { id: 'versions' as const, label: 'VERSIONS', badge: 0, enabled: false },
  ];

  return (
    <aside className="w-[330px] shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="grid grid-cols-3 border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={!t.enabled}
            onClick={() => t.enabled && setTab(t.id)}
            title={t.enabled ? undefined : `${t.label} — coming in Phase 2`}
            className={[
              'relative py-3 text-[11px] font-semibold tracking-wide transition',
              tab === t.id ? 'bg-white text-slate-900' : 'bg-slate-50 text-slate-500',
              t.enabled ? 'hover:text-slate-900' : 'cursor-not-allowed opacity-50',
            ].join(' ')}
          >
            {t.label}
            {t.badge > 0 && (
              <span className="absolute right-3 top-2 grid h-[17px] min-w-[17px] place-items-center
                               rounded-full bg-orange-500 px-1 text-[10px] text-white">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ITEM DETAILS */}
      <section>
        <button
          type="button"
          onClick={() => setDetailsOpen((v) => !v)}
          className="flex w-full items-center justify-between bg-slate-100 px-4 py-3
                     text-[13px] font-bold tracking-wide text-slate-800"
        >
          ITEM DETAILS
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
               className={`transition ${detailsOpen ? 'rotate-180' : ''}`}>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        {detailsOpen && (
          <div className="space-y-4 px-4 py-4 text-[14px]">
            <p>
              <span className="font-semibold text-slate-800">Template: </span>
              <button type="button" className="text-blue-600 hover:underline">
                {item.templateName}
              </button>
            </p>

            <div>
              <p className="mb-2 font-semibold text-slate-800">Categories</p>
              <div className="flex flex-wrap gap-2">
                {item.categories.map((c) => (
                  <span key={c} className="rounded-full border border-slate-300 px-3 py-1 text-[13px] text-slate-700">
                    {c}
                  </span>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setBriefOpen((v) => !v)}
              className="flex items-center gap-1.5 text-[14px] text-blue-600 hover:underline"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                   className={`transition ${briefOpen ? 'rotate-180' : ''}`}>
                <path d="m6 9 6 6 6-6" />
              </svg>
              {briefOpen ? 'Hide' : 'Show'} brief information
            </button>

            {briefOpen && (
              <div className="space-y-4 border-t border-slate-100 pt-4">
                <div>
                  <p className="mb-1.5 font-semibold text-slate-800">Brief Title</p>
                  <p className="rounded border border-slate-200 px-3 py-2 text-[13px] text-slate-700">
                    {item.brief.title}
                  </p>
                </div>
                <div>
                  <p className="mb-1.5 font-semibold text-slate-800">Keywords</p>
                  <p className="rounded border border-slate-200 px-3 py-2 text-[13px] text-slate-700">
                    {item.brief.keywords.join(', ')}
                  </p>
                </div>
                <div>
                  <p className="mb-1.5 font-semibold text-slate-800">Description</p>
                  <p className="rounded border border-slate-200 px-3 py-2 text-[13px] text-slate-700">
                    {item.brief.description}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* WORKFLOW */}
      <section className="border-t border-slate-200">
        <div className="bg-slate-100 px-4 py-3 text-[13px] font-bold tracking-wide text-slate-800">
          WORKFLOW
        </div>

        <div className="px-4 py-4">
          <button
            type="button"
            disabled
            title="Assignees and deadlines — needs the API"
            className="mb-5 cursor-not-allowed text-[14px] font-semibold text-blue-600 opacity-50"
          >
            Assignees and deadlines
          </button>

          <ol>
            {item.workflow.map((s, i) => (
              <StatusRow
                key={s.id}
                status={s}
                isCurrent={s.id === item.currentStatusId}
                isLast={i === item.workflow.length - 1}
              />
            ))}
          </ol>
        </div>

        <StatusChanger
          statuses={item.workflow}
          currentId={item.currentStatusId}
          onChange={onStatusChange}
        />
      </section>
    </aside>
  );
}
