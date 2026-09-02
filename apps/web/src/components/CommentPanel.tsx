import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ItemComment, type NewComment } from '../lib/api';
import { avatarColor, avatarInitial } from '../lib/avatar';
import { toast } from '../lib/toast';

/**
 * Reusable comment surface, shared by all anchors (item sidebar, field popover,
 * file popover, text-selection popover). `match` selects which comments belong
 * here; `newAnchor` is stamped on comments/replies created here. Threads render
 * as one card (replies divider-separated); the resolve/unresolve control sits on
 * the TOP comment only; resolved threads hide behind a "Show resolved" toggle.
 */
const GRACE_SECS = 5;

export type CommentAnchor = {
  anchor: 'item' | 'field' | 'text' | 'file';
  fieldId?: string | null;
  fileId?: string | null;
  textAnchor?: unknown;
};

/** Live count of matching top-level threads (for badges). */
export function useCommentCount(itemId: string, match: (c: ItemComment) => boolean) {
  const q = useQuery({ queryKey: ['comments', itemId], queryFn: () => api.listComments(itemId) });
  return (q.data ?? []).filter((c) => !c.parent_id && !c.resolved && match(c)).length;
}

export function CommentPanel({
  itemId, match, newAnchor, quote, autoFocusComposer, anchorLabel,
}: {
  itemId: string;
  match: (c: ItemComment) => boolean;
  newAnchor: CommentAnchor;
  /** For text comments: the highlighted snippet, shown above the composer. */
  quote?: string;
  autoFocusComposer?: boolean;
  /** Optional "where is this anchored" label (used by the sidebar to show
   *  field/file comments with their location, e.g. "Author Name [Main Content]"). */
  anchorLabel?: (c: ItemComment) => string | null;
}) {
  const qc = useQueryClient();
  const comments = useQuery({
    queryKey: ['comments', itemId],
    queryFn: () => api.listComments(itemId),
    refetchOnMount: 'always',
  });
  const info = useQuery({ queryKey: ['assignment', itemId], queryFn: () => api.getAssignmentInfo(itemId) });
  const members = useMemo(() => (info.data?.members ?? []).map((m) => m.name), [info.data]);

  const [showResolved, setShowResolved] = useState(false);
  const [graced, setGraced] = useState<Record<string, number>>({});
  useEffect(() => {
    if (Object.keys(graced).length === 0) return;
    const t = setInterval(() => {
      setGraced((prev) => {
        const next: Record<string, number> = {};
        for (const k of Object.keys(prev)) if (prev[k]! - 1 > 0) next[k] = prev[k]! - 1;
        return next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [graced]);

  const resolve = useMutation({
    mutationFn: (v: { id: string; resolved: boolean }) => api.resolveComment(v.id, v.resolved),
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({ queryKey: ['comments', itemId] });
      setGraced((g) => { const n = { ...g }; if (v.resolved) n[v.id] = GRACE_SECS; else delete n[v.id]; return n; });
    },
    onError: () => toast('Could not update the comment.'),
  });

  const mine = (comments.data ?? []).filter(match);
  const repliesOf = (id: string) => mine.filter((c) => c.parent_id === id);
  const topAll = mine.filter((c) => !c.parent_id);
  const resolvedCount = topAll.filter((c) => c.resolved).length;
  const visible = topAll.filter((c) => !c.resolved || showResolved || graced[c.id] != null);

  return (
    <div className="flex max-h-[70vh] flex-col">
      <div className="border-b border-slate-200 p-3">
        {resolvedCount > 0 && (
          <div className="mb-2 flex justify-end">
            <button type="button" onClick={() => setShowResolved((v) => !v)} className="text-[13px] font-semibold text-blue-600 hover:underline">
              {showResolved ? 'Hide resolved' : `Show resolved (${resolvedCount})`}
            </button>
          </div>
        )}
        {quote && (
          <p className="mb-2 border-l-2 border-slate-300 pl-2 text-[12px] italic text-slate-500">“{quote}”</p>
        )}
        <AddComment itemId={itemId} members={members} newAnchor={newAnchor} startOpen={autoFocusComposer} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {comments.isLoading ? (
          <p className="py-6 text-center text-[13px] text-slate-400">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-slate-400">No comments yet.</p>
        ) : (
          <ul className="space-y-3">
            {visible.map((c) => (
              <li key={c.id}>
                <Thread comment={c} replies={repliesOf(c.id)} itemId={itemId} members={members}
                        undoSecs={graced[c.id] ?? 0} newAnchor={newAnchor}
                        anchorLabel={anchorLabel}
                        onResolve={(r) => resolve.mutate({ id: c.id, resolved: r })} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Thread({
  comment, replies, itemId, members, undoSecs, newAnchor, onResolve, anchorLabel,
}: {
  comment: ItemComment;
  replies: ItemComment[];
  itemId: string;
  members: string[];
  undoSecs: number;
  newAnchor: CommentAnchor;
  onResolve: (resolved: boolean) => void;
  anchorLabel?: (c: ItemComment) => string | null;
}) {
  const [replying, setReplying] = useState(false);
  const resolved = comment.resolved;

  // Resolve / unresolve is only offered to those who may edit this comment
  // (its author or a manage_comments holder) — mirrors the comments RLS.
  const topAction = !comment.can_manage ? undefined : resolved ? (
    <div className="flex items-center gap-3 text-[13px]">
      {undoSecs > 0 && (
        <button type="button" onClick={() => onResolve(false)} className="font-semibold text-blue-600 hover:underline">Undo ({undoSecs})</button>
      )}
      <button type="button" onClick={() => onResolve(false)} title="Unresolve" className="grid h-7 w-7 place-items-center rounded text-blue-600 hover:bg-blue-50">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /></svg>
      </button>
    </div>
  ) : (
    <button type="button" onClick={() => onResolve(true)} title="Resolve" className="grid h-7 w-7 place-items-center rounded text-blue-600 hover:bg-blue-50">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M20 6 9 17l-5-5" /></svg>
    </button>
  );

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      {resolved && <div className="border-b border-slate-200 bg-slate-100 py-2 text-center text-[13px] font-semibold text-slate-700">Resolved</div>}
      <div className={`p-3.5 ${resolved ? 'opacity-80' : ''}`}>
        <CommentBody comment={comment} itemId={itemId} members={members} headerAction={topAction} label={anchorLabel?.(comment) ?? null} />
      </div>
      {replies.map((r) => (
        <div key={r.id} className={`border-t border-slate-100 p-3.5 ${resolved ? 'opacity-80' : ''}`}>
          <CommentBody comment={r} itemId={itemId} members={members} />
        </div>
      ))}
      <div className="flex justify-end border-t border-slate-100 px-3.5 py-2.5">
        <button type="button" onClick={() => setReplying((v) => !v)} className="inline-flex items-center gap-1 text-[13px] font-semibold text-blue-600 hover:underline">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 17l-5-5 5-5" /><path d="M4 12h11a5 5 0 0 1 5 5v1" /></svg>
          Reply
        </button>
      </div>
      {replying && (
        <div className="border-t border-slate-100 p-3">
          <Composer itemId={itemId} members={members} newAnchor={newAnchor} parentId={comment.id} placeholder="Reply…" autoFocus onDone={() => setReplying(false)} />
        </div>
      )}
    </div>
  );
}

function CommentBody({
  comment, itemId, members, headerAction, label,
}: {
  comment: ItemComment;
  itemId: string;
  members: string[];
  headerAction?: React.ReactNode;
  /** "Author Name [Main Content]" — where this comment is anchored (sidebar). */
  label?: string | null;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['comments', itemId] });

  const save = useMutation({
    mutationFn: () => api.editComment(comment.id, draft),
    onSuccess: () => { setEditing(false); invalidate(); },
    onError: () => toast('Could not save the comment.'),
  });
  const del = useMutation({
    mutationFn: () => api.deleteComment(comment.id),
    onSuccess: invalidate,
    onError: () => toast('Could not delete the comment.'),
  });

  return (
    <div className="flex items-start gap-2.5">
      <Avatar name={comment.author_name} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <NameLine c={comment} />
          {!editing && (
            <div className="flex shrink-0 items-center gap-1">
              {headerAction}
              {comment.can_manage && <RowMenu onEdit={() => setEditing(true)} onDelete={() => del.mutate()} />}
            </div>
          )}
        </div>
        {label && (
          <div className="mt-1 flex items-center gap-1.5 text-[13px] text-slate-500">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#60a5fa"><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /></svg>
            <span className="truncate">{label}</span>
          </div>
        )}
        {editing ? (
          <div className="mt-1.5">
            <MentionArea value={draft} onChange={setDraft} members={members} />
            <div className="mt-1.5 flex gap-2">
              <button type="button" disabled={!draft.trim() || save.isPending} onClick={() => save.mutate()}
                      className="rounded-md bg-blue-600 px-3 py-1 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-40">Save</button>
              <button type="button" onClick={() => { setDraft(comment.body); setEditing(false); }}
                      className="rounded-md px-3 py-1 text-[12px] font-medium text-slate-500 hover:bg-slate-100">Cancel</button>
            </div>
          </div>
        ) : (
          <p className="mt-1 whitespace-pre-wrap break-words text-[14px] leading-snug text-slate-700">{renderBody(comment.body, members)}</p>
        )}
      </div>
    </div>
  );
}

function NameLine({ c }: { c: ItemComment }) {
  return (
    <div className="min-w-0">
      <span className="text-[14px] font-bold text-slate-800">{c.author_name}</span>
      {c.author_role && <span className="text-[13px] text-slate-400"> · {c.author_role}</span>}
      <div className="text-[12px] text-slate-400">{timeAgo(c.created_at)}</div>
    </div>
  );
}

function RowMenu({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setConfirming(false); } };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} title="More" className="grid h-7 w-7 place-items-center rounded text-slate-400 hover:bg-slate-100">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-44 rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
          {confirming ? (
            <div className="px-3 py-2">
              <p className="text-[12px] text-slate-600">Delete this comment?</p>
              <div className="mt-2 flex justify-end gap-2">
                <button type="button" onClick={() => { setConfirming(false); setOpen(false); }} className="rounded px-2 py-1 text-[12px] text-slate-500 hover:bg-slate-100">Cancel</button>
                <button type="button" onClick={() => { onDelete(); setOpen(false); setConfirming(false); }} className="rounded bg-red-600 px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-red-700">Delete</button>
              </div>
            </div>
          ) : (
            <>
              <button type="button" onClick={() => { onEdit(); setOpen(false); }} className="block w-full px-3 py-1.5 text-left text-[13px] text-slate-700 hover:bg-slate-50">Edit</button>
              <button type="button" onClick={() => setConfirming(true)} className="block w-full px-3 py-1.5 text-left text-[13px] text-red-600 hover:bg-red-50">Delete</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Avatar({ name, size }: { name: string; size: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full font-semibold text-white"
          style={{ width: size, height: size, background: avatarColor(name), fontSize: size * 0.38 }}>
      {avatarInitial(name)}
    </span>
  );
}

function AddComment({ itemId, members, newAnchor, startOpen }: { itemId: string; members: string[]; newAnchor: CommentAnchor; startOpen?: boolean }) {
  const [open, setOpen] = useState(!!startOpen);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 py-2.5 text-[13px] font-semibold text-blue-600 hover:bg-blue-50">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 4H4a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 4 17h3v3.2L11 17h9a1.5 1.5 0 0 0 1.5-1.5v-10A1.5 1.5 0 0 0 20 4z" /><path d="M12 8v5M9.5 10.5h5" /></svg>
        Add a comment
      </button>
    );
  }
  return <Composer itemId={itemId} members={members} newAnchor={newAnchor} placeholder="Add a comment…" autoFocus onDone={() => setOpen(false)} keepOpen />;
}

function Composer({
  itemId, members, newAnchor, parentId, placeholder, onDone, autoFocus, keepOpen,
}: {
  itemId: string;
  members: string[];
  newAnchor: CommentAnchor;
  parentId?: string;
  placeholder?: string;
  onDone?: () => void;
  autoFocus?: boolean;
  keepOpen?: boolean;
}) {
  const qc = useQueryClient();
  const [value, setValue] = useState('');
  const add = useMutation({
    mutationFn: () => {
      const payload: NewComment = { body: value.trim(), anchor: newAnchor.anchor, parentId: parentId ?? null };
      if (newAnchor.fieldId) payload.fieldId = newAnchor.fieldId;
      if (newAnchor.fileId) payload.fileId = newAnchor.fileId;
      if (newAnchor.textAnchor) payload.textAnchor = newAnchor.textAnchor;
      return api.addComment(itemId, payload);
    },
    onSuccess: () => {
      setValue('');
      void qc.invalidateQueries({ queryKey: ['comments', itemId] });
      if (!keepOpen) onDone?.();
    },
    onError: () => toast('Could not post the comment.'),
  });
  return (
    <div>
      <MentionArea value={value} onChange={setValue} members={members} placeholder={placeholder} autoFocus={autoFocus} />
      <div className="mt-1.5 flex justify-end gap-2">
        {onDone && (
          <button type="button" onClick={onDone} className="rounded-md px-3 py-1 text-[12px] font-medium text-slate-500 hover:bg-slate-100">Cancel</button>
        )}
        <button type="button" disabled={!value.trim() || add.isPending} onClick={() => add.mutate()}
                className="rounded-md bg-blue-600 px-3.5 py-1 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-40">
          {add.isPending ? 'Posting…' : parentId ? 'Reply' : 'Comment'}
        </button>
      </div>
    </div>
  );
}

function MentionArea({
  value, onChange, members, placeholder, autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  members: string[];
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [menu, setMenu] = useState<{ query: string; start: number } | null>(null);
  const onInput = (v: string) => {
    onChange(v);
    const caret = ref.current?.selectionStart ?? v.length;
    const m = /(?:^|\s)@([\p{L}]*)$/u.exec(v.slice(0, caret));
    if (m) setMenu({ query: m[1]!.toLowerCase(), start: caret - m[1]!.length - 1 });
    else setMenu(null);
  };
  const pick = (name: string) => {
    if (!menu) return;
    const before = value.slice(0, menu.start);
    const after = value.slice(ref.current?.selectionStart ?? value.length);
    onChange(`${before}@${name} ${after}`);
    setMenu(null);
    requestAnimationFrame(() => ref.current?.focus());
  };
  const matches = menu ? members.filter((n) => n.toLowerCase().includes(menu.query)).slice(0, 6) : [];
  return (
    <div className="relative">
      <textarea ref={ref} value={value} autoFocus={autoFocus} onChange={(e) => onInput(e.target.value)} placeholder={placeholder} rows={2}
                className="w-full resize-y rounded-md border border-slate-300 px-2.5 py-2 text-[13px] text-slate-800 focus:border-blue-500 focus:outline-none" />
      {menu && matches.length > 0 && (
        <div className="absolute left-2 top-full z-40 mt-1 w-56 overflow-hidden rounded-md border border-slate-200 bg-white shadow-xl">
          {matches.map((n) => (
            <button key={n} type="button" onMouseDown={(e) => { e.preventDefault(); pick(n); }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-slate-50">
              <Avatar name={n} size={24} />
              <span className="truncate text-slate-700">{n}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function renderBody(body: string, members: string[]) {
  if (members.length === 0) return body;
  const names = [...members].sort((a, b) => b.length - a.length).map(escapeRe);
  const re = new RegExp(`@(${names.join('|')})`, 'g');
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (m.index > last) out.push(body.slice(last, m.index));
    out.push(<span key={m.index} className="font-semibold text-blue-600">@{m[1]}</span>);
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push(body.slice(last));
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function timeAgo(iso: string): string {
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs} second${secs === 1 ? '' : 's'} ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
