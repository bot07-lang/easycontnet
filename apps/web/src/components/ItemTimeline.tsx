import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { avatarColor, avatarInitial } from '../lib/avatar';

/**
 * Hover card that shows an item's workflow timeline — every status with its
 * marker (passed ✓ / current ring / upcoming dot / read-only lock) and the
 * people assigned to each. Used on the content-items table's Status and People
 * columns. Rendered through a portal so the table's horizontal scroll can't clip
 * it. The assignment data is fetched lazily on first hover and cached.
 */
export function TimelineHover({ itemId, children }: { itemId: string; children: React.ReactNode }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const open = (e: React.MouseEvent) => {
    clearTimeout(closeTimer.current);
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPos({ x: r.left, y: r.bottom + 6 });
  };
  const scheduleClose = () => { closeTimer.current = setTimeout(() => setPos(null), 120); };

  return (
    <span className="inline-flex" onMouseEnter={open} onMouseLeave={scheduleClose}>
      {children}
      {pos && createPortal(
        <div
          style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 60 }}
          onMouseEnter={() => clearTimeout(closeTimer.current)}
          onMouseLeave={() => setPos(null)}
          className="w-[400px] max-w-[92vw] rounded-lg border border-slate-200 bg-white p-4 shadow-2xl"
        >
          <TimelineContent itemId={itemId} />
        </div>,
        document.body,
      )}
    </span>
  );
}

function TimelineContent({ itemId }: { itemId: string }) {
  const info = useQuery({ queryKey: ['assignment', itemId], queryFn: () => api.getAssignmentInfo(itemId) });
  const data = info.data;
  if (!data) return <p className="py-2 text-[13px] text-slate-400">Loading…</p>;

  const currentPos = data.statuses.find((s) => s.id === data.currentStatusId)?.position ?? -1;
  const roleOf = (id: string) => data.members.find((m) => m.id === id)?.role_name;

  return (
    <ol className="relative">
      {data.statuses.map((s, i) => {
        const isCurrent = s.id === data.currentStatusId;
        const isComplete = currentPos >= 0 && s.position < currentPos;
        const isLast = i === data.statuses.length - 1;
        return (
          <li key={s.id} className="relative pb-4 pl-7 last:pb-0">
            {!isLast && <span className="absolute left-[8px] top-5 h-full w-px bg-slate-200" />}
            <span className="absolute left-0 top-0.5 grid h-[18px] w-[18px] place-items-center rounded-full"
                  style={isComplete ? { background: s.color } : { border: `2.5px solid ${s.color}`, background: 'white' }}>
              {isComplete && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4"><path d="M20 6 9 17l-5-5" /></svg>}
            </span>

            <div className="flex items-center gap-1.5">
              <span className={isCurrent ? 'text-[15px] font-semibold text-slate-900' : 'text-[15px] text-slate-700'}>{s.name}</span>
              {s.read_only && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-500"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
              )}
              {s.due_at && (
                <span className="ml-1 inline-flex items-center gap-1 text-[12px] text-slate-400">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
                  {new Date(s.due_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              )}
            </div>

            {s.assignees.length > 0 && (
              <ul className="mt-1.5 space-y-1.5">
                {s.assignees.map((a) => (
                  <li key={a.id} className="flex items-center gap-2">
                    <Avatar name={a.name} />
                    <span className="truncate text-[13px] text-slate-500">
                      {a.name}{roleOf(a.id) ? ` (${roleOf(a.id)})` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white"
          style={{ background: avatarColor(name) }}>
      {avatarInitial(name)}
    </span>
  );
}
