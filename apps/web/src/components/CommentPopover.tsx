import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ItemComment } from '../lib/api';
import { useItemId } from '../lib/item-context';
import { CommentPanel, useCommentCount, type CommentAnchor } from './CommentPanel';

/**
 * A trigger button that opens a floating comment panel for a given anchor
 * (field / file / text). Shows an unresolved-count badge. Reused by the
 * field-edge comment icon, the file-card comment icon, and the text-selection
 * "comment" action.
 */
export function CommentPopoverTrigger({
  match, newAnchor, quote, buttonClass, title, children, badgePlacement = 'br', revealOnHover, hideWhenEmpty, hideBadge,
}: {
  match: (c: ItemComment) => boolean;
  newAnchor: CommentAnchor;
  quote?: string;
  buttonClass: string;
  title?: string;
  children: React.ReactNode; // the icon
  badgePlacement?: 'br' | 'tr';
  /** When true and there are no comments yet, the button only shows on the
   *  parent's :hover (the field/file card is a `group`). */
  revealOnHover?: boolean;
  /** When true, render nothing at all until the field has comments (header badge). */
  hideWhenEmpty?: boolean;
  /** When true, never draw the count badge on this button (count lives elsewhere). */
  hideBadge?: boolean;
}) {
  const itemId = useItemId();
  const count = useCommentCount(itemId ?? '', match);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);

  if (!itemId) return null;
  if (hideWhenEmpty && count === 0) return null;
  const reveal = revealOnHover ? 'opacity-0 transition group-hover:opacity-100' : '';

  const open = () => {
    const r = ref.current!.getBoundingClientRect();
    const x = Math.max(8, Math.min(r.left, window.innerWidth - 356));
    setPos({ x, y: Math.min(r.bottom + 6, window.innerHeight - 60) });
  };

  return (
    <>
      <button ref={ref} type="button" title={title} onClick={open} className={`relative ${reveal} ${buttonClass}`}>
        {children}
        {count > 0 && !hideBadge && (
          <span className={`absolute grid h-4 min-w-4 place-items-center rounded-full bg-orange-500 px-1 text-[10px] font-bold text-white ${badgePlacement === 'tr' ? '-right-1.5 -top-1.5' : '-bottom-1 -right-1'}`}>
            {count}
          </span>
        )}
      </button>
      {pos && createPortal(
        <>
          {/* z-62/63 — above the editor's own fullscreen overlay (z-[60] in
              RichTextField), which this trigger can be opened from (the
              toolbar and field-gutter comment icons). At z-40/50 the popover
              opened but was rendered invisibly behind the fullscreen view. */}
          <div className="fixed inset-0 z-[62]" onMouseDown={() => setPos(null)} />
          <div style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 63 }}
               className="w-[340px] max-w-[92vw] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl"
               onMouseDown={(e) => e.stopPropagation()}>
            <CommentPanel itemId={itemId} match={match} newAnchor={newAnchor} quote={quote} autoFocusComposer={count === 0} />
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

/**
 * "Comment on the selected text" — used by the editor's selection bubble. Grabs
 * the highlighted text on click and opens a composer for a text-anchored comment
 * (stored against the field; shown in that field's comment popover). Persistent
 * in-editor highlighting of the commented range is a later enhancement.
 */
export function TextCommentButton({
  fieldId, getQuote, buttonClass, title, children,
}: {
  fieldId: string;
  getQuote: () => string | null; // the highlighted text, or null if empty
  buttonClass: string;
  title?: string;
  children: React.ReactNode;
}) {
  const itemId = useItemId();
  const [pop, setPop] = useState<{ quote: string; x: number; y: number } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  if (!itemId) return null;

  const open = () => {
    const quote = getQuote();
    if (!quote) return;
    const r = ref.current!.getBoundingClientRect();
    setPop({ quote, x: Math.max(8, Math.min(r.left, window.innerWidth - 356)), y: Math.min(r.bottom + 6, window.innerHeight - 60) });
  };

  return (
    <>
      {/* preventDefault on mousedown so clicking keeps the editor's text selection. */}
      <button ref={ref} type="button" title={title} onMouseDown={(e) => e.preventDefault()} onClick={open} className={buttonClass}>{children}</button>
      {pop && createPortal(
        <>
          {/* Same z-62/63 fix as CommentPopoverTrigger — this button lives in
              the selection bubble menu, which is reachable in fullscreen too. */}
          <div className="fixed inset-0 z-[62]" onMouseDown={() => setPop(null)} />
          <div style={{ position: 'fixed', left: pop.x, top: pop.y, zIndex: 63 }}
               className="w-[340px] max-w-[92vw] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl"
               onMouseDown={(e) => e.stopPropagation()}>
            <CommentPanel itemId={itemId} match={() => false}
                          newAnchor={{ anchor: 'text', fieldId, textAnchor: { quote: pop.quote } }}
                          quote={pop.quote} autoFocusComposer />
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
