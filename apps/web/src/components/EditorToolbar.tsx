import type { Editor } from '@tiptap/react';
import { useEffect, useReducer, useState } from 'react';
import { BlockTypeMenu, ColorPalette } from './toolbar-parts';
import { ImageDialog } from './ImageDialog';
import { TableMenu } from './TableMenu';

/**
 * Two-row toolbar plus menu bar.
 *
 * The toolbar must re-render on every editor transaction, otherwise button
 * states freeze at their initial values — undo stays disabled forever and
 * active marks never highlight. Tiptap's editor is mutable, so React sees no
 * prop change; we subscribe to transactions and force the update ourselves.
 */

const MENUS = ['File', 'Edit', 'View', 'Insert', 'Format', 'Tools', 'Table'];

function Btn({
  onClick, active, disabled, title, children, wide,
}: {
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()} // keep the editor selection
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={[
        'flex h-8 items-center justify-center rounded text-slate-700 transition',
        wide ? 'gap-1.5 px-2' : 'w-8',
        disabled ? 'cursor-not-allowed opacity-30' : 'hover:bg-slate-200',
        active ? 'bg-slate-300' : '',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="mx-1 h-6 w-px bg-slate-300" />;
}

function Icon({ children, size = 18 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      {children}
    </svg>
  );
}

const I = {
  undo: <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62A8.9 8.9 0 0 1 12.5 11c3.04 0 5.64 1.98 6.55 4.72l2.37-.78A9.99 9.99 0 0 0 12.5 8z" />,
  redo: <path d="M18.4 10.6A9.95 9.95 0 0 0 11.5 8a9.99 9.99 0 0 0-9.48 6.94l2.37.78A7.5 7.5 0 0 1 11.5 11c2.04 0 3.9.76 5.32 2L13 16h9V7l-3.6 3.6z" />,
  alignLeft: <path d="M15 15H3v2h12v-2zm0-8H3v2h12V7zM3 13h18v-2H3v2zm0 8h18v-2H3v2zM3 3v2h18V3H3z" />,
  alignCenter: <path d="M7 15v2h10v-2H7zm-4 6h18v-2H3v2zm0-8h18v-2H3v2zm4-6v2h10V7H7zM3 3v2h18V3H3z" />,
  alignRight: <path d="M3 21h18v-2H3v2zm6-4h12v-2H9v2zm-6-4h18v-2H3v2zm6-4h12V7H9v2zM3 3v2h18V3H3z" />,
  bulletList: <path d="M4 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm0-6a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm0 12a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM7 19h14v-2H7v2zm0-6h14v-2H7v2zm0-8v2h14V5H7z" />,
  orderedList: <path d="M2 17h2v.5H3v1h1v.5H2v1h3v-4H2v1zm1-9h1V4H2v1h1v3zm-1 3h1.8L2 13.1v.9h3v-1H3.2L5 10.9V10H2v1zm5-6v2h14V5H7zm0 14h14v-2H7v2zm0-6h14v-2H7v2z" />,
  outdent: <path d="M11 17h10v-2H11v2zm-8-5 4 4V8l-4 4zm0 9h18v-2H3v2zM3 3v2h18V3H3zm8 6h10V7H11v2zm0 4h10v-2H11v2z" />,
  indent: <path d="M3 21h18v-2H3v2zM3 8v8l4-4-4-4zm8 9h10v-2H11v2zM3 3v2h18V3H3zm8 6h10V7H11v2zm0 4h10v-2H11v2z" />,
  link: <path d="M3.9 12a3.1 3.1 0 0 1 3.1-3.1h4V7H7a5 5 0 0 0 0 10h4v-1.9H7A3.1 3.1 0 0 1 3.9 12zM8 13h8v-2H8v2zm9-6h-4v1.9h4a3.1 3.1 0 1 1 0 6.2h-4V17h4a5 5 0 0 0 0-10z" />,
  unlink: <path d="M17 7h-4v1.9h4a3.1 3.1 0 0 1 .87 6.08l1.44 1.44A5 5 0 0 0 17 7zM2 4.27l3.11 3.11A4.99 4.99 0 0 0 7 17h4v-1.9H7a3.1 3.1 0 0 1-.13-6.2L8.73 11H8v2h2.73L19.73 22 21 20.73 3.27 3 2 4.27z" />,
  image: <path d="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5l3.5-4.5z" />,
  youtube: <path d="M21.6 7.2s-.2-1.4-.8-2c-.75-.8-1.6-.8-2-.85C16 4.2 12 4.2 12 4.2h-.02s-4 0-6.8.2c-.4.05-1.25.05-2 .85-.6.6-.8 2-.8 2S2.2 8.8 2.2 10.4v1.5c0 1.6.18 3.2.18 3.2s.2 1.4.8 2c.75.8 1.75.78 2.2.87 1.6.15 6.8.2 6.8.2s4 0 6.8-.22c.4-.05 1.25-.05 2-.85.6-.6.8-2 .8-2s.2-1.6.2-3.2v-1.5c0-1.6-.2-3.2-.2-3.2zM9.9 13.9V8.6l5.2 2.66-5.2 2.64z" />,
  table: <path d="M20 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1zM8 19H5v-4h3v4zm0-6H5V9h3v4zm6 6h-4v-4h4v4zm0-6h-4V9h4v4zm5 6h-3v-4h3v4zm0-6h-3V9h3v4zm0-6H5V5h14v2z" />,
  code: <path d="M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0 4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z" />,
  fullscreen: <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />,
  eraser: <path d="M15.14 3a1.9 1.9 0 0 1 1.35.56l4.95 4.95a1.9 1.9 0 0 1 0 2.7L13.4 19.2H21v2h-9.6l-2.83-2.83-3.9-3.9a1.9 1.9 0 0 1 0-2.7l9.12-9.2A1.9 1.9 0 0 1 15.14 3zM6.08 13.12l3.9 3.9 1.4-1.42-3.9-3.9-1.4 1.42z" />,
  comment: <path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-7 9h-2V9H9V7h2V5h2v2h2v2h-2v2z" />,
};

export function EditorToolbar({ editor }: { editor: Editor }) {
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [imageOpen, setImageOpen] = useState(false);

  // Without this the toolbar never updates: the editor mutates in place, so
  // React sees no changed prop and button states stay frozen.
  useEffect(() => {
    const update = () => forceRender();
    editor.on('transaction', update);
    editor.on('selectionUpdate', update);
    return () => {
      editor.off('transaction', update);
      editor.off('selectionUpdate', update);
    };
  }, [editor]);

  const addLink = () => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL', prev ?? 'https://');
    if (url === null) return;
    if (url === '') editor.chain().focus().unsetLink().run();
    else editor.chain().focus().setLink({ href: url }).run();
  };

  const insertImage = (v: { src: string; alt: string; width: string; height: string }) => {
    editor
      .chain()
      .focus()
      .insertContent({
        type: 'image',
        attrs: {
          src: v.src,
          alt: v.alt || null,
          width: v.width || null,
          height: v.height || null,
        },
      })
      .run();
    setImageOpen(false);
  };

  const addVideo = () => {
    const url = window.prompt(
      'Paste a YouTube video link\n\nExample: https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    );
    if (url) editor.commands.setYoutubeVideo({ src: url, width: 640, height: 360 });
  };

  const textColor = (editor.getAttributes('textStyle').color as string) ?? undefined;
  const highlight = (editor.getAttributes('highlight').color as string) ?? undefined;

  return (
    <div className="border-b border-slate-200 bg-slate-50">
      {imageOpen && (
        <ImageDialog onClose={() => setImageOpen(false)} onSave={insertImage} />
      )}
      {/* Menu bar */}
      <div className="flex items-center gap-1 border-b border-slate-200 px-2 py-1.5">
        {MENUS.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setOpenMenu(openMenu === m ? null : m)}
            className={`rounded px-2.5 py-1 text-sm text-slate-700 transition hover:bg-slate-200 ${
              openMenu === m ? 'bg-slate-200' : ''
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Row 1 */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 px-2 py-1">
        <Btn title="Undo (⌘Z)" onClick={() => editor.chain().focus().undo().run()}
             disabled={!editor.can().chain().focus().undo().run()}>
          <Icon>{I.undo}</Icon>
        </Btn>
        <Btn title="Redo (⇧⌘Z)" onClick={() => editor.chain().focus().redo().run()}
             disabled={!editor.can().chain().focus().redo().run()}>
          <Icon>{I.redo}</Icon>
        </Btn>
        <Divider />

        <BlockTypeMenu editor={editor} />
        <Divider />

        <Btn title="Align left" active={editor.isActive({ textAlign: 'left' })}
             onClick={() => editor.chain().focus().setTextAlign('left').run()}>
          <Icon>{I.alignLeft}</Icon>
        </Btn>
        <Btn title="Align centre" active={editor.isActive({ textAlign: 'center' })}
             onClick={() => editor.chain().focus().setTextAlign('center').run()}>
          <Icon>{I.alignCenter}</Icon>
        </Btn>
        <Btn title="Align right" active={editor.isActive({ textAlign: 'right' })}
             onClick={() => editor.chain().focus().setTextAlign('right').run()}>
          <Icon>{I.alignRight}</Icon>
        </Btn>
        <Divider />

        <Btn title="Bold (⌘B)" active={editor.isActive('bold')}
             onClick={() => editor.chain().focus().toggleBold().run()}>
          <span className="text-[15px] font-bold">B</span>
        </Btn>
        <Btn title="Italic (⌘I)" active={editor.isActive('italic')}
             onClick={() => editor.chain().focus().toggleItalic().run()}>
          <span className="font-serif text-[15px] italic">I</span>
        </Btn>
        <Btn title="Underline (⌘U)" active={editor.isActive('underline')}
             onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <span className="text-[15px] underline">U</span>
        </Btn>

        <ColorPalette
          title="Text colour"
          current={textColor}
          onPick={(c) => editor.chain().focus().setColor(c).run()}
          onClear={() => editor.chain().focus().unsetColor().run()}
          swatch={
            <span className="grid place-items-center leading-none">
              <span className="text-[14px] font-semibold">A</span>
              <span className="mt-0.5 block h-[3px] w-[15px] rounded-sm"
                    style={{ background: textColor ?? '#0f172a' }} />
            </span>
          }
        />

        <ColorPalette
          title="Highlight colour"
          current={highlight}
          onPick={(c) => editor.chain().focus().setHighlight({ color: c }).run()}
          onClear={() => editor.chain().focus().unsetHighlight().run()}
          swatch={
            <span className="grid place-items-center leading-none">
              {/* Highlighter pen only — no built-in bar, since the coloured
                  swatch below already shows the current colour. */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M15.6 3.4 8.5 10.5l-1.4 4.2 4.2-1.4 7.1-7.1-2.8-2.8z" />
              </svg>
              <span className="mt-0.5 block h-[3px] w-[15px] rounded-sm"
                    style={{ background: highlight ?? '#fbeeb8' }} />
            </span>
          }
        />

        <Btn title="Clear formatting — removes bold, italic, colour and headings"
             onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>
          <Icon>{I.eraser}</Icon>
        </Btn>
        <Divider />

        <Btn title="Bullet list" active={editor.isActive('bulletList')}
             onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <Icon>{I.bulletList}</Icon>
        </Btn>
        <Btn title="Numbered list" active={editor.isActive('orderedList')}
             onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <Icon>{I.orderedList}</Icon>
        </Btn>
        <Btn title="Decrease indent"
             disabled={!editor.can().liftListItem('listItem')}
             onClick={() => editor.chain().focus().liftListItem('listItem').run()}>
          <Icon>{I.outdent}</Icon>
        </Btn>
        <Btn title="Increase indent"
             disabled={!editor.can().sinkListItem('listItem')}
             onClick={() => editor.chain().focus().sinkListItem('listItem').run()}>
          <Icon>{I.indent}</Icon>
        </Btn>
      </div>

      {/* Row 2 */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1">
        <Btn title="Insert or edit link" active={editor.isActive('link')} onClick={addLink}>
          <Icon>{I.link}</Icon>
        </Btn>
        <Btn title="Remove link" disabled={!editor.isActive('link')}
             onClick={() => editor.chain().focus().unsetLink().run()}>
          <Icon>{I.unlink}</Icon>
        </Btn>
        <Btn title="Insert or edit image" onClick={() => setImageOpen(true)}>
          <Icon>{I.image}</Icon>
        </Btn>
        <Btn title="Embed a YouTube video" onClick={addVideo} wide>
          <span className="text-red-600"><Icon>{I.youtube}</Icon></span>
          <span className="text-[13px] text-slate-700">Video</span>
        </Btn>
        <TableMenu editor={editor} />
        <Divider />
        <Btn title="View HTML source" onClick={() => window.alert(editor.getHTML())}>
          <Icon>{I.code}</Icon>
        </Btn>
        <Btn title="Fullscreen"
             onClick={() =>
               document.fullscreenElement
                 ? document.exitFullscreen()
                 : document.documentElement.requestFullscreen?.()
             }>
          <Icon>{I.fullscreen}</Icon>
        </Btn>
        <Divider />

        {/* Phase 2 — icon-only and disabled, like the rest of the row.
            Drawn to match the reference: a speech bubble with a plus, and a
            pen writing over text lines. */}
        <Btn title="Add a comment — coming in Phase 2" disabled>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 4H4a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 4 17h3v3.2L11 17h9a1.5 1.5 0 0 0 1.5-1.5v-10A1.5 1.5 0 0 0 20 4z" />
            <line x1="12" y1="8" x2="12" y2="13" />
            <line x1="9.5" y1="10.5" x2="14.5" y2="10.5" />
          </svg>
        </Btn>
        <Btn title="Track Changes — coming in Phase 2" disabled wide>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="7" x2="13" y2="7" />
            <line x1="3" y1="12" x2="9" y2="12" />
            <line x1="3" y1="17" x2="8" y2="17" />
            <path d="M19.5 6.5a1.6 1.6 0 0 1 2.3 2.3l-6.3 6.3-3 .7.7-3 6.3-6.3z" />
          </svg>
          <span className="text-[13px]">Track Changes</span>
        </Btn>
      </div>
    </div>
  );
}
