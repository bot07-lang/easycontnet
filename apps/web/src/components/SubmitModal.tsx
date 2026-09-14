import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type ApprovalInfo } from '../lib/api';
import { toast } from '../lib/toast';

/**
 * "Submit for review" modal (EasyContent parity). An optional note, plus a
 * "Send item forward to <status>" checkbox — pre-checked when the caller is the
 * last assignee to complete this status (so completing advances the item).
 */
export function SubmitModal({
  itemId, projectId, approval, onClose, onDone,
}: {
  itemId: string;
  projectId?: string;
  approval: ApprovalInfo;
  onClose: () => void;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [sendForward, setSendForward] = useState(approval.isLastToComplete);
  // Whether the user manually touched the checkbox — see the re-check below.
  const [sendForwardTouched, setSendForwardTouched] = useState(false);
  const forwardOptions = approval.statuses.filter((s) => s.id !== approval.currentStatus?.id);
  const [target, setTarget] = useState(approval.nextStatusId ?? forwardOptions[0]?.id ?? '');

  const submit = useMutation({
    mutationFn: async () => {
      // The checkbox's default (isLastToComplete) was computed when this dialog
      // opened. If another assignee also completes this status while this stays
      // open — completely normal with 2+ reviewers, not a tight race — that
      // snapshot goes stale: this submit could be the true last one without the
      // default ever reflecting it, so the item would silently never advance.
      // Re-check right before sending, UNLESS the user manually set the
      // checkbox themselves — their explicit choice always wins as-is.
      const forward = sendForwardTouched ? sendForward : (await api.getApprovalInfo(itemId)).isLastToComplete;
      return api.submitItem(itemId, {
        note: note.trim() || null,
        nextStatusId: forward ? (target || null) : null,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['approval', itemId] });
      void qc.invalidateQueries({ queryKey: ['assignment', itemId] });
      void qc.invalidateQueries({ queryKey: ['item', itemId] });
      if (projectId) void qc.invalidateQueries({ queryKey: ['items', projectId] });
      toast('Submitted for review.');
      onDone();
    },
    onError: () => toast('Could not submit — you may not be assigned to this status.'),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-slate-900">Submit for review</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Close">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} placeholder="Your optional note"
                  className="w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-[14px] text-slate-800 outline-none focus:border-blue-500" />

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[15px] text-slate-800">
            <input type="checkbox" checked={sendForward}
                   onChange={(e) => { setSendForward(e.target.checked); setSendForwardTouched(true); }}
                   className="h-5 w-5 rounded accent-slate-800" />
            Send item forward to
          </label>
          <select value={target} onChange={(e) => setTarget(e.target.value)} disabled={!sendForward}
                  className="rounded-md border border-slate-300 py-2 pl-3 pr-8 text-[14px] font-semibold text-slate-800 disabled:opacity-40">
            {forwardOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose}
                    className="rounded-md border border-slate-300 bg-slate-100 px-5 py-2 text-[13px] font-semibold uppercase tracking-wide text-slate-700 hover:bg-slate-200">
              Cancel
            </button>
            <button type="button" onClick={() => submit.mutate()} disabled={submit.isPending || (sendForward && !target)}
                    className="rounded-md bg-green-600 px-6 py-2 text-[13px] font-semibold uppercase tracking-wide text-white hover:bg-green-700 disabled:opacity-50">
              {submit.isPending ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
