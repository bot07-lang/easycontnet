import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';

/**
 * Table menu, matching the reference layout: a compact top-level list where
 * every entry is a submenu — Table / Cell / Row / Column — plus Table
 * properties and Delete table. The size grid lives inside the "Table" submenu,
 * not inline.
 *
 * Every action is a Tiptap command; this component is only the menu around
 * them.
 */
export function TableMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<null | 'table' | 'cell' | 'row' | 'column'>(null);
  const [hover, setHover] = useState({ r: 0, c: 0 });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) { setOpen(false); setSub(null); }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const inTable = editor.isActive('table');
  const done = () => { setOpen(false); setSub(null); };
  const run = (fn: () => void) => { fn(); done(); };

  /** A top-level row that reveals a submenu on hover. */
  const Row = ({
    label, disabled, onHover, children,
  }: {
    label: string;
    disabled?: boolean;
    onHover: () => void;
    children?: React.ReactNode;
  }) => (
    <div className="relative" onMouseEnter={disabled ? undefined : onHover}>
      <div
        className={`flex items-center justify-between gap-8 px-3 py-2 text-[14px] ${
          disabled ? 'cursor-not-allowed text-slate-300' : 'text-slate-700 hover:bg-slate-100'
        }`}
      >
        {label}
        <span className={disabled ? 'text-slate-300' : 'text-slate-400'}>›</span>
      </div>
      {!disabled && children}
    </div>
  );

  /** A leaf action inside a submenu. Disabled entries mirror the reference's
   *  greyed items (properties dialogs, row/column clipboard) that Tiptap's
   *  table extension doesn't provide commands for. */
  const Action = ({ label, onClick, disabled }: { label: string; onClick?: () => void; disabled?: boolean }) => (
    <button
      type="button"
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`block w-full px-3 py-2 text-left text-[14px] ${
        disabled ? 'cursor-not-allowed text-slate-300' : 'text-slate-700 hover:bg-slate-100'
      }`}
    >
      {label}
    </button>
  );

  const SubPanel = ({ children }: { children: React.ReactNode }) => (
    <div className="absolute left-full top-0 z-40 -ml-1 min-w-[190px] rounded-md border
                    border-slate-200 bg-white py-1 shadow-xl">
      {children}
    </div>
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        title="Table"
        aria-label="Table"
        className="flex h-8 items-center gap-0.5 rounded px-1.5 text-slate-700 hover:bg-slate-200"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1zM8 19H5v-4h3v4zm0-6H5V9h3v4zm6 6h-4v-4h4v4zm0-6h-4V9h4v4zm5 6h-3v-4h3v4zm0-6h-3V9h3v4zm0-6H5V5h14v2z" />
        </svg>
        <span className="text-[9px] leading-none text-slate-500">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 top-9 z-30 min-w-[180px] rounded-md border
                        border-slate-200 bg-white py-1 shadow-xl">
          {/* Table › — grid picker */}
          <Row label="Table" onHover={() => setSub('table')}>
            {sub === 'table' && (
              <SubPanel>
                <div className="p-2">
                  <div className="inline-grid grid-cols-6 gap-1">
                    {Array.from({ length: 36 }, (_, i) => {
                      const r = Math.floor(i / 6) + 1;
                      const c = (i % 6) + 1;
                      const on = r <= hover.r && c <= hover.c;
                      return (
                        <button
                          key={i}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onMouseEnter={() => setHover({ r, c })}
                          onClick={() =>
                            run(() =>
                              editor.chain().focus()
                                .insertTable({ rows: r, cols: c, withHeaderRow: true }).run(),
                            )
                          }
                          className={`h-5 w-5 rounded-[3px] border ${
                            on ? 'border-blue-500 bg-blue-200' : 'border-slate-300 bg-white'
                          }`}
                        />
                      );
                    })}
                  </div>
                  <div className="mt-1.5 text-[12px] text-slate-500">
                    {hover.r > 0 ? `${hover.r} × ${hover.c}` : 'Pick a size'}
                  </div>
                </div>
              </SubPanel>
            )}
          </Row>

          {/* Cell › */}
          <Row label="Cell" disabled={!inTable} onHover={() => setSub('cell')}>
            {sub === 'cell' && (
              <SubPanel>
                <Action label="Cell properties" disabled />
                <Action label="Merge cells" onClick={() => run(() => editor.chain().focus().mergeCells().run())} />
                <Action label="Split cell" onClick={() => run(() => editor.chain().focus().splitCell().run())} />
              </SubPanel>
            )}
          </Row>

          {/* Row › */}
          <Row label="Row" disabled={!inTable} onHover={() => setSub('row')}>
            {sub === 'row' && (
              <SubPanel>
                <Action label="Insert row before" onClick={() => run(() => editor.chain().focus().addRowBefore().run())} />
                <Action label="Insert row after" onClick={() => run(() => editor.chain().focus().addRowAfter().run())} />
                <Action label="Delete row" onClick={() => run(() => editor.chain().focus().deleteRow().run())} />
                <Action label="Row properties" disabled />
                <div className="my-1 border-t border-slate-200" />
                <Action label="Cut row" disabled />
                <Action label="Copy row" disabled />
                <Action label="Paste row before" disabled />
                <Action label="Paste row after" disabled />
              </SubPanel>
            )}
          </Row>

          {/* Column › */}
          <Row label="Column" disabled={!inTable} onHover={() => setSub('column')}>
            {sub === 'column' && (
              <SubPanel>
                <Action label="Insert column before" onClick={() => run(() => editor.chain().focus().addColumnBefore().run())} />
                <Action label="Insert column after" onClick={() => run(() => editor.chain().focus().addColumnAfter().run())} />
                <Action label="Delete column" onClick={() => run(() => editor.chain().focus().deleteColumn().run())} />
                <div className="my-1 border-t border-slate-200" />
                <Action label="Cut column" disabled />
                <Action label="Copy column" disabled />
                <Action label="Paste column before" disabled />
                <Action label="Paste column after" disabled />
              </SubPanel>
            )}
          </Row>

          <div className="my-1 border-t border-slate-200" />

          {/* Table properties — not built yet, shown disabled like the reference. */}
          <div
            className="cursor-not-allowed px-3 py-2 text-[14px] text-slate-300"
            title="Table properties — coming later"
            onMouseEnter={() => setSub(null)}
          >
            Table properties
          </div>

          <button
            type="button"
            disabled={!inTable}
            onMouseEnter={() => setSub(null)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => run(() => editor.chain().focus().deleteTable().run())}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[14px] ${
              inTable ? 'text-slate-700 hover:bg-slate-100' : 'cursor-not-allowed text-slate-300'
            }`}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="4" y="4" width="16" height="16" rx="1" />
              <path d="m9 9 6 6m0-6-6 6" />
            </svg>
            Delete table
          </button>
        </div>
      )}
    </div>
  );
}
