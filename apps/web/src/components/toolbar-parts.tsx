import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';

/**
 * Toolbar pieces that need real popovers rather than native controls.
 */

export function useClickAway(onAway: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onAway();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onAway]);
  return ref;
}

/** Block types, rendered in their own style as in the reference. */
const BLOCKS = [
  { id: 'p',  label: 'Paragraph',    className: 'text-[15px]' },
  { id: 'h1', label: 'Heading 1',    className: 'text-[30px] font-semibold leading-tight' },
  { id: 'h2', label: 'Heading 2',    className: 'text-[25px] font-semibold leading-tight' },
  { id: 'h3', label: 'Heading 3',    className: 'text-[21px] font-semibold leading-tight' },
  { id: 'h4', label: 'Heading 4',    className: 'text-[17px] font-semibold leading-tight' },
  { id: 'blockquote', label: 'Blockquote', className: 'border-l-2 border-slate-300 pl-2 italic text-[15px] text-slate-600' },
  { id: 'pre',  label: 'Preformatted', className: 'font-mono text-[14px] bg-slate-100 border border-slate-200 px-2 py-1 rounded' },
  { id: 'code', label: 'Code',         className: 'font-mono text-[14px] text-red-600 bg-red-50 px-1.5 py-0.5 rounded' },
] as const;

export function BlockTypeMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const ref = useClickAway(() => setOpen(false));

  const activeId =
    editor.isActive('codeBlock') ? 'pre'
    : editor.isActive('code') ? 'code'
    : editor.isActive('blockquote') ? 'blockquote'
    : ([1, 2, 3, 4] as const).map((l) =>
        editor.isActive('heading', { level: l }) ? `h${l}` : null,
      ).find(Boolean) ?? 'p';

  const active = BLOCKS.find((b) => b.id === activeId) ?? BLOCKS[0];

  const apply = (id: string) => {
    const chain = editor.chain().focus();
    if (id === 'p') chain.setParagraph().run();
    else if (id === 'pre') chain.toggleCodeBlock().run();
    else if (id === 'code') chain.toggleCode().run();
    else if (id === 'blockquote') chain.toggleBlockquote().run();
    else chain.toggleHeading({ level: Number(id.slice(1)) as 1 | 2 | 3 | 4 }).run();
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        aria-label="Text style"
        className="flex h-8 min-w-[140px] items-center justify-between rounded border
                   border-slate-300 bg-white px-2.5 text-sm text-slate-700 hover:bg-slate-50"
      >
        {active.label}
        <span className="text-[9px] text-slate-500">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 top-9 z-30 min-w-[230px] rounded-md border
                        border-slate-300 bg-white py-1 shadow-xl">
          {BLOCKS.map((b) => (
            <button
              key={b.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => apply(b.id)}
              className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left
                          transition hover:bg-slate-100 ${
                            b.id === activeId ? 'bg-slate-100' : ''
                          }`}
            >
              <span className={b.className}>{b.label}</span>
              {b.id === activeId && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2.5" className="shrink-0 text-slate-700">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
