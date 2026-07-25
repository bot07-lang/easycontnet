import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';

/**
 * Toolbar pieces that need real popovers rather than native controls.
 *
 * The colour palette is TinyMCE's default `color_map` — Tiptap ships no
 * palette of its own (its Color extension applies any hex you give it), so
 * these values are a deliberate choice, picked to match what writers coming
 * from the reference product already know.
 */

export const COLOR_MAP: { hex: string; name: string }[] = [
  { hex: '#bfedd2', name: 'Light green' },
  { hex: '#fbeeb8', name: 'Light yellow' },
  { hex: '#f8cac6', name: 'Light red' },
  { hex: '#eccafa', name: 'Light purple' },
  { hex: '#c2e0f4', name: 'Light blue' },

  { hex: '#2dc26b', name: 'Green' },
  { hex: '#f1c40f', name: 'Yellow' },
  { hex: '#e03e2d', name: 'Red' },
  { hex: '#b96ad9', name: 'Purple' },
  { hex: '#3598db', name: 'Blue' },

  { hex: '#169179', name: 'Dark turquoise' },
  { hex: '#e67e23', name: 'Orange' },
  { hex: '#ba372a', name: 'Dark red' },
  { hex: '#843fa1', name: 'Dark purple' },
  { hex: '#236fa1', name: 'Dark blue' },

  { hex: '#ecf0f1', name: 'Light grey' },
  { hex: '#ced4d9', name: 'Medium grey' },
  { hex: '#95a5a6', name: 'Grey' },
  { hex: '#7e8c8d', name: 'Dark grey' },
  { hex: '#34495e', name: 'Navy' },
];

function useClickAway(onAway: () => void) {
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

export function ColorPalette({
  current, onPick, onClear, onCustom, title, swatch,
}: {
  current?: string;
  onPick: (hex: string) => void;
  onClear: () => void;
  onCustom?: () => void;
  title: string;
  swatch: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useClickAway(() => setOpen(false));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        title={title}
        aria-label={title}
        className="flex h-8 items-center gap-0.5 rounded px-1.5 text-slate-700 hover:bg-slate-200"
      >
        {swatch}
        <span className="text-[9px] leading-none text-slate-500">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 top-9 z-30 rounded-md border border-slate-300 bg-white p-1 shadow-xl">
          <div className="grid grid-cols-5 gap-0">
            {COLOR_MAP.map((c) => (
              <button
                key={c.hex}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onPick(c.hex); setOpen(false); }}
                title={c.name}
                aria-label={c.name}
                className={`h-9 w-9 transition hover:z-10 hover:scale-110 hover:shadow-md ${
                  current?.toLowerCase() === c.hex ? 'ring-2 ring-inset ring-slate-900' : ''
                }`}
                style={{ background: c.hex }}
              />
            ))}
          </div>

          <div className="mt-1 flex items-center gap-1 border-t border-slate-200 pt-1">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onPick('#000000'); setOpen(false); }}
              title="Black"
              className="h-9 w-9 bg-black transition hover:scale-110"
            />

            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onClear(); setOpen(false); }}
              title="Remove colour"
              aria-label="Remove colour"
              className="grid h-9 w-9 place-items-center border border-slate-200 hover:bg-slate-50"
            >
              <svg width="22" height="22" viewBox="0 0 24 24">
                <line x1="5" y1="19" x2="19" y2="5" stroke="#e03e2d" strokeWidth="1.5" />
              </svg>
            </button>

            <button
              type="button"
              title="Custom colour"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setOpen(false); onCustom?.(); }}
              className="grid h-9 w-9 cursor-pointer place-items-center hover:bg-slate-50"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 22a1 1 0 0 1 0-2 1.5 1.5 0 0 0 0-3H9.5a5.5 5.5 0 0 1 0-11H12a10 10 0 0 1 0 20zM7.5 12a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm3-4a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm5 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm2.5 4a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Block types, rendered in their own style as in the reference. */
const BLOCKS = [
  { id: 'p',  label: 'Paragraph',    className: 'text-[15px]' },
  { id: 'h1', label: 'Heading 1',    className: 'text-[30px] font-semibold leading-tight' },
  { id: 'h2', label: 'Heading 2',    className: 'text-[25px] font-semibold leading-tight' },
  { id: 'h3', label: 'Heading 3',    className: 'text-[21px] font-semibold leading-tight' },
  { id: 'h4', label: 'Heading 4',    className: 'text-[17px] font-semibold leading-tight' },
  { id: 'pre',  label: 'Preformatted', className: 'font-mono text-[14px] bg-slate-100 border border-slate-200 px-2 py-1 rounded' },
  { id: 'code', label: 'Code',         className: 'font-mono text-[14px] text-red-600 bg-red-50 px-1.5 py-0.5 rounded' },
] as const;

export function BlockTypeMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const ref = useClickAway(() => setOpen(false));

  const activeId =
    editor.isActive('codeBlock') ? 'pre'
    : editor.isActive('code') ? 'code'
    : ([1, 2, 3, 4] as const).map((l) =>
        editor.isActive('heading', { level: l }) ? `h${l}` : null,
      ).find(Boolean) ?? 'p';

  const active = BLOCKS.find((b) => b.id === activeId) ?? BLOCKS[0];

  const apply = (id: string) => {
    const chain = editor.chain().focus();
    if (id === 'p') chain.setParagraph().run();
    else if (id === 'pre') chain.toggleCodeBlock().run();
    else if (id === 'code') chain.toggleCode().run();
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
