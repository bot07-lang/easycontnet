import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type ApprovalInfo } from '../lib/api';
import { toast } from '../lib/toast';

/**
 * "Approve and Complete review" — a reviewer grades the item against the current
 * status's criteria (1-5 stars each, required), leaves an optional note, and
 * optionally sends it forward to the next status. Matches the reference modal.
 *
 * Takes `approval` as an already-loaded prop (like SubmitModal) rather than
 * fetching it itself — the caller only mounts this once approval.data exists,
 * so `sendForward`'s initial value below can read isLastToComplete correctly.
 * A self-fetching version would still be loading when useState runs and could
 * never pick that value up afterward (initializers don't re-run on refetch).
 */
export function ApproveReviewModal({
  itemId, projectId, approval, onClose, onDone,
}: {
  itemId: string;
  projectId?: string;
  approval: ApprovalInfo;
  onClose: () => void;
  onDone: () => void;
}) {
  const qc = useQueryClient();

  const [stars, setStars] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const [sendForward, setSendForward] = useState(approval.isLastToComplete);
  // Whether the user manually touched the checkbox — see the re-check below.
  const [sendForwardTouched, setSendForwardTouched] = useState(false);
  const [nextStatusId, setNextStatusId] = useState<string | null>(null);

  const criteria = approval.criteria;
  // Default the forward target to the server-suggested next status once loaded.
  const chosenNext = nextStatusId ?? approval.nextStatusId ?? null;
  const allRated = criteria.every((c) => (stars[c.id] ?? 0) >= 1);

  const approve = useMutation({
    mutationFn: async () => {
      // The checkbox's default (isLastToComplete) was computed when this dialog
      // opened. If another assignee also completes this status while this stays
      // open — completely normal with 2+ reviewers, not a tight race — that
      // snapshot goes stale: this approval could be the true last one without
      // the default ever reflecting it, so the item would silently never
      // advance. Re-check right before sending, UNLESS the user manually set
      // the checkbox themselves — their explicit choice always wins as-is.
      const forward = sendForwardTouched ? sendForward : (await api.getApprovalInfo(itemId)).isLastToComplete;
      return api.approveItem(itemId, {
        ratings: criteria.map((c) => ({ ratingId: c.id, stars: stars[c.id] ?? 0 })).filter((r) => r.stars >= 1),
        note: note.trim() || null,
        nextStatusId: forward ? chosenNext : null,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['approval', itemId] });
      void qc.invalidateQueries({ queryKey: ['assignment', itemId] });
      void qc.invalidateQueries({ queryKey: ['versions', itemId] });
      void qc.invalidateQueries({ queryKey: ['item', itemId] });
      if (projectId) void qc.invalidateQueries({ queryKey: ['items', projectId] });
      toast('Review submitted.');
      onDone();
      onClose();
    },
    onError: () => toast('Could not approve — you may not be assigned to this status.'),
  });

  const nextStatus = approval.statuses.find((s) => s.id === chosenNext) ?? null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-6" onClick={() => !approve.isPending && onClose()}>
      <div className="w-full max-w-xl rounded-xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between">
          <h3 className="text-[19px] font-semibold text-slate-900">Approve and Complete review</h3>
          <button type="button" onClick={onClose} disabled={approve.isPending}
                  className="grid h-8 w-8 place-items-center rounded-full text-slate-400 hover:bg-slate-100">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <p className="mb-5 text-[14px] text-slate-500">
          Please grade the work. You can disable grades by deleting grading criteria in workflow settings.
        </p>

        {criteria.length > 0 ? (
          <div className="mb-5 space-y-3">
            {criteria.map((c) => (
              <div key={c.id} className="flex items-center gap-4">
                <span className="w-40 shrink-0 text-[16px] text-slate-800">{c.name}</span>
                <StarRow value={stars[c.id] ?? 0} onChange={(v) => setStars((s) => ({ ...s, [c.id]: v }))} />
              </div>
            ))}
          </div>
        ) : (
          <p className="mb-5 text-[13px] text-slate-400">No grading criteria for this status.</p>
        )}

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Your optional note"
          className="mb-4 w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-[14px] text-slate-800 focus:border-blue-500 focus:outline-none"
        />

        {approve.isError && <p className="mb-2 text-[13px] text-red-600">Couldn’t approve. Please try again.</p>}

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[14px] text-slate-700">
            <input type="checkbox" checked={sendForward}
                   onChange={(e) => { setSendForward(e.target.checked); setSendForwardTouched(true); }}
                   className="h-[18px] w-[18px] accent-blue-600" />
            Send item forward to
          </label>
          <div className="relative">
            <select
              value={chosenNext ?? ''}
              onChange={(e) => setNextStatusId(e.target.value || null)}
              disabled={!sendForward}
              className="appearance-none rounded-md border border-slate-300 py-2 pl-7 pr-8 text-[14px] font-medium text-slate-800 disabled:opacity-50"
            >
              {approval.statuses.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            {nextStatus && (
              <span className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full" style={{ background: nextStatus.color }} />
            )}
            <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-500" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
          </div>

          <div className="ml-auto flex gap-3">
            <button type="button" onClick={onClose} disabled={approve.isPending}
                    className="rounded border border-slate-300 px-5 py-2 text-[13px] font-semibold uppercase tracking-wide text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => approve.mutate()}
              disabled={approve.isPending || !allRated}
              title={allRated ? undefined : 'Rate every criterion first'}
              className="rounded bg-green-600 px-6 py-2 text-[13px] font-semibold uppercase tracking-wide text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {approve.isPending ? 'Approving…' : 'Approve'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A 1-5 star input, orange like the reference. */
function StarRow({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex items-center gap-1" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = (hover || value) >= n;
        return (
          <button key={n} type="button" onClick={() => onChange(n)} onMouseEnter={() => setHover(n)} className="p-0.5" aria-label={`${n} star${n > 1 ? 's' : ''}`}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill={filled ? '#f59e0b' : 'none'} stroke="#f59e0b" strokeWidth="1.5" strokeLinejoin="round">
              <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.91-1.01L12 2z" />
            </svg>
          </button>
        );
      })}
    </div>
  );
}
