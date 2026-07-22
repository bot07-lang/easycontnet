import type { Editor } from '@tiptap/react';
import { useEffect, useReducer, useRef, useState } from 'react';
import { BlockTypeMenu, ColorPalette } from './toolbar-parts';
import { ImageDialog } from './ImageDialog';
import { TableMenu } from './TableMenu';
import { LinkDialog, type LinkValues } from './LinkDialog';
import { MediaDialog } from './MediaDialog';
import { SpecialCharDialog } from './SpecialCharDialog';
import { FindReplaceDialog } from './FindReplaceDialog';

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
  eye: <path d="M12 5C6.5 5 2.7 8.6 1 12c1.7 3.4 5.5 7 11 7s9.3-3.6 11-7c-1.7-3.4-5.5-7-11-7zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" />,
  pilcrow: <path d="M13 4v16h2V6h2v14h2V6h1V4h-8a5 5 0 0 0 0 10h1V4h-3z" />,
  media: <path d="M4 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H4zm6 4.5 6 3.5-6 3.5v-7z" />,
  omega: <path d="M6 19v-2.1a6.5 6.5 0 1 1 12 0V19h-4.6v-1.9a4 4 0 1 0-2.8 0V19H6z" />,
  hr: <path d="M4 11h16v2H4z" />,
  toc: <path d="M4 6h2v2H4V6zm4 0h12v2H8V6zM4 11h2v2H4v-2zm4 0h12v2H8v-2zM4 16h2v2H4v-2zm4 0h12v2H8v-2z" />,
  check: <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" />,
  newDoc: <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM14 3.5 18.5 8H14V3.5z" />,
  print: <path d="M19 8H5a3 3 0 0 0-3 3v6h4v4h12v-4h4v-6a3 3 0 0 0-3-3zM8 19v-5h8v5H8zm11-7a1 1 0 1 1 0-2 1 1 0 0 1 0 2zM18 3H6v4h12V3z" />,
  cut: <path d="M9.64 7.64c.23-.5.36-1.05.36-1.64a4 4 0 1 0-4 4c.59 0 1.14-.13 1.64-.36L10 12l-2.36 2.36A3.99 3.99 0 0 0 6 14a4 4 0 1 0 4 4c0-.59-.13-1.14-.36-1.64L12 14l7 7h3v-1L9.64 7.64zM6 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 12a2 2 0 1 1 0-4 2 2 0 0 1 0 4zM19 3l-6 6 2 2 7-7V3h-3z" />,
  copy: <path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z" />,
  paste: <path d="M19 2h-4.18A3 3 0 0 0 12 0a3 3 0 0 0-2.82 2H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-7 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm7 18H5V4h2v3h10V4h2v16z" />,
  selectAll: <path d="M4 4h4V2H4a2 2 0 0 0-2 2v4h2V4zm12-2v2h4v4h2V4a2 2 0 0 0-2-2h-4zm4 18h-4v2h4a2 2 0 0 0 2-2v-4h-2v4zM4 16H2v4a2 2 0 0 0 2 2h4v-2H4v-4zm4-4h8v-2H8v2z" />,
  search: <path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z" />,
  alignJustify: <path d="M3 5h18v2H3zm0 4h18v2H3zm0 4h18v2H3zm0 4h18v2H3z" />,
  colorA: <path d="M11 3 5.5 17h2.25l1.12-3h6.25l1.13 3h2.25L13 3h-2zm-1.38 9L12 5.67 14.38 12H9.62z" />,
  highlighter: <path d="M15.6 3.4 8.5 10.5l-1.4 4.2 4.2-1.4 7.1-7.1-2.8-2.8z" />,
  deleteTable: <path d="M3 3h18v18H3V3zm2 2v14h14V5H5zm3.9 2.5L12 10.6l3.1-3.1 1.4 1.4L13.4 12l3.1 3.1-1.4 1.4L12 13.4l-3.1 3.1-1.4-1.4L10.6 12 7.5 8.9l1.4-1.4z" />,
};

export function EditorToolbar({
  editor, docTitle, fullscreen, onToggleFullscreen,
}: {
  editor: Editor;
  docTitle?: string;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
}) {
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [imageOpen, setImageOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [specialOpen, setSpecialOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkInit, setLinkInit] = useState<LinkValues>({ url: '', text: '', title: '', target: '' });
  const [insertSub, setInsertSub] = useState<'table' | null>(null);
  const [insertHover, setInsertHover] = useState({ r: 0, c: 0 });
  // View › Visual aids defaults on (table guides visible); Show blocks off.
  const [visualAids, setVisualAids] = useState(true);
  const [showBlocks, setShowBlocks] = useState(false);
  const menuBarRef = useRef<HTMLDivElement>(null);

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

  // Close an open menu on an outside click. Also drop any open Insert submenu.
  useEffect(() => {
    if (!openMenu) return;
    const close = (e: MouseEvent) => {
      if (menuBarRef.current && !menuBarRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
        setInsertSub(null);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [openMenu]);

  // View › Visual aids / Show blocks are CSS overlays — reflect their state as
  // classes on the editor's DOM node (which carries the .prose-editor class).
  useEffect(() => {
    const dom = editor.view.dom;
    dom.classList.toggle('va-off', !visualAids);
    dom.classList.toggle('show-blocks', showBlocks);
  }, [editor, visualAids, showBlocks]);

  // Keyboard shortcuts shown in the Insert/View menus: ⌘K opens the link
  // dialog, ⌘⇧F toggles fullscreen. Bound on the editor DOM so they fire
  // while typing.
  useEffect(() => {
    const dom = editor.view.dom;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openLink();
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        toggleFullscreen();
      }
    };
    dom.addEventListener('keydown', onKey);
    return () => dom.removeEventListener('keydown', onKey);
    // openLink/toggleFullscreen are stable closures over `editor`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const close = () => { setOpenMenu(null); setInsertSub(null); };

  // File > New document — clears the field (confirmed, since it's destructive).
  const newDocument = () => { editor.commands.clearContent(true); setConfirmNew(false); };

  // File > Print — render just the content into a hidden iframe and print it,
  // which avoids popup blockers that window.open would hit. The browser stamps
  // the document <title> into the print header, so we use the item's name there
  // (e.g. "demo item — Content Workflow") rather than a generic "Print".
  const printContent = () => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('style', 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;');
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (!doc) return;
    const name = (docTitle ?? '').trim();
    const title = name ? `${escapeHtml(name)} — Content Workflow` : 'Content Workflow';
    doc.open();
    doc.write(
      `<!doctype html><html><head><title>${title}</title>
       <style>body{font-family:system-ui,sans-serif;color:#1e293b;padding:32px;line-height:1.6}
       img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #cbd5e1;padding:6px}</style>
       </head><body>${editor.getHTML()}</body></html>`,
    );
    doc.close();
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => document.body.removeChild(iframe), 1000);
  };

  // Editor-only fullscreen, owned by RichTextField (fills the viewport rather
  // than triggering the browser's native fullscreen).
  const toggleFullscreen = () => onToggleFullscreen?.();

  // View › Source code — replace the field's HTML with the edited markup.
  const applySource = (html: string) => {
    editor.commands.setContent(html, true);
    setSourceOpen(false);
  };

  // Insert › Special character — drop the glyph at the cursor (dialog stays
  // open so several can be inserted before closing).
  const insertChar = (ch: string) => {
    editor.chain().focus().insertContent(ch).run();
  };

  // Edit menu clipboard actions. Cut/Copy work off the current DOM selection;
  // Paste reads the clipboard (a user gesture, so the browser allows it).
  const cut = () => { document.execCommand('cut'); };
  const copy = () => { document.execCommand('copy'); };
  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      editor.chain().focus().insertContent(text).run();
    } catch { /* clipboard blocked — user can use ⌘V */ }
  };
  const pasteAsText = async () => {
    try {
      const text = await navigator.clipboard.readText();
      editor.chain().focus().command(({ tr, dispatch }) => {
        if (dispatch) tr.insertText(text);
        return true;
      }).run();
    } catch { /* clipboard blocked */ }
  };

  // Insert/Edit Link — prefill from the current link mark and selection.
  const openLink = () => {
    const attrs = editor.getAttributes('link');
    const { from, to, empty } = editor.state.selection;
    const selected = empty ? '' : editor.state.doc.textBetween(from, to);
    setLinkInit({
      url: (attrs.href as string) ?? '',
      text: selected,
      title: (attrs.title as string) ?? '',
      target: (attrs.target as string) ?? '',
    });
    setLinkOpen(true);
  };

  const applyLink = ({ url, text, title, target }: LinkValues) => {
    setLinkOpen(false);
    const chain = editor.chain().focus();
    if (!url) { chain.extendMarkRange('link').unsetLink().run(); return; }
    const attrs = { href: url, title: title || null, target: target || null, rel: target ? 'noopener' : null };
    const { from, to, empty } = editor.state.selection;
    const current = empty ? '' : editor.state.doc.textBetween(from, to);
    if (empty || (text && text !== current)) {
      chain.insertContent({ type: 'text', text: text || url, marks: [{ type: 'link', attrs }] }).run();
    } else {
      chain.extendMarkRange('link').setLink(attrs).run();
    }
  };

  // Insert/Edit Media — a source URL goes through the YouTube embed; raw embed
  // code is inserted as-is.
  const applyMedia = ({ source, embed }: { source: string; embed: string }) => {
    setMediaOpen(false);
    if (source) editor.commands.setYoutubeVideo({ src: source, width: 640, height: 360 });
    else if (embed) editor.chain().focus().insertContent(embed).run();
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

  const textColor = (editor.getAttributes('textStyle').color as string) ?? undefined;
  const highlight = (editor.getAttributes('highlight').color as string) ?? undefined;
  const inTable = editor.isActive('table');

  return (
    <div className="border-b border-slate-200 bg-slate-50">
      {imageOpen && (
        <ImageDialog onClose={() => setImageOpen(false)} onSave={insertImage} />
      )}
      {/* Menu bar */}
      <div ref={menuBarRef} className="flex items-center gap-1 border-b border-slate-200 px-2 py-1.5">
        {MENUS.map((m) => (
          <div key={m} className="relative">
            <button
              type="button"
              onClick={() => setOpenMenu(openMenu === m ? null : m)}
              className={`rounded px-2.5 py-1 text-sm text-slate-700 transition hover:bg-slate-200 ${
                openMenu === m ? 'bg-slate-200' : ''
              }`}
            >
              {m}
            </button>
            {m === 'File' && openMenu === 'File' && (
              <Dropdown width="w-52">
                <MenuItem icon={I.newDoc} label="New document"
                  onClick={() => { setOpenMenu(null); setConfirmNew(true); }} />
                <MenuItem icon={I.eye} label="Preview"
                  onClick={() => { setOpenMenu(null); setPreview(true); }} />
                <MenuItem icon={I.print} label="Print…"
                  onClick={() => { setOpenMenu(null); printContent(); }} />
              </Dropdown>
            )}
            {m === 'Edit' && openMenu === 'Edit' && (
              <Dropdown width="w-60">
                <MenuItem icon={I.undo} label="Undo" shortcut="⌘Z" disabled={!editor.can().undo()}
                  onClick={() => { close(); editor.chain().focus().undo().run(); }} />
                <MenuItem icon={I.redo} label="Redo" shortcut="⌘Y" disabled={!editor.can().redo()}
                  onClick={() => { close(); editor.chain().focus().redo().run(); }} />
                <MenuSep />
                <MenuItem icon={I.cut} label="Cut" shortcut="⌘X" onClick={() => { close(); cut(); }} />
                <MenuItem icon={I.copy} label="Copy" shortcut="⌘C" onClick={() => { close(); copy(); }} />
                <MenuItem icon={I.paste} label="Paste" shortcut="⌘V" onClick={() => { close(); paste(); }} />
                <MenuItem icon={I.paste} label="Paste as text" onClick={() => { close(); pasteAsText(); }} />
                <MenuSep />
                <MenuItem icon={I.selectAll} label="Select all" shortcut="⌘A"
                  onClick={() => { close(); editor.chain().focus().selectAll().run(); }} />
                <MenuSep />
                <MenuItem icon={I.search} label="Find and replace…" shortcut="⌘F"
                  onClick={() => { close(); setFindOpen(true); }} />
              </Dropdown>
            )}
            {m === 'View' && openMenu === 'View' && (
              <Dropdown width="w-56">
                <MenuItem icon={I.code} label="Source code"
                  onClick={() => { setOpenMenu(null); setSourceOpen(true); }} />
                <MenuSep />
                {/* Toggles keep the menu open so the check visibly flips. */}
                <MenuItem label="Visual aids" check={visualAids}
                  onClick={() => setVisualAids((v) => !v)} />
                <MenuItem icon={I.pilcrow} label="Show blocks" check={showBlocks}
                  onClick={() => setShowBlocks((v) => !v)} />
                <MenuSep />
                <MenuItem icon={I.eye} label="Preview"
                  onClick={() => { setOpenMenu(null); setPreview(true); }} />
                <MenuItem icon={I.fullscreen} label="Fullscreen" shortcut="⌘⇧F"
                  onClick={() => { setOpenMenu(null); toggleFullscreen(); }} />
              </Dropdown>
            )}
            {m === 'Insert' && openMenu === 'Insert' && (
              <Dropdown width="w-60">
                <MenuItem icon={I.image} label="Image…" onMouseEnter={() => setInsertSub(null)}
                  onClick={() => { setOpenMenu(null); setImageOpen(true); }} />
                <MenuItem icon={I.link} label="Link…" shortcut="⌘K" onMouseEnter={() => setInsertSub(null)}
                  onClick={() => { setOpenMenu(null); openLink(); }} />
                <MenuItem icon={I.media} label="Media…" onMouseEnter={() => setInsertSub(null)}
                  onClick={() => { setOpenMenu(null); setMediaOpen(true); }} />
                <MenuItem icon={I.table} label="Table" chevron onMouseEnter={() => setInsertSub('table')}>
                  {insertSub === 'table' && (
                    <div className="absolute left-full top-0 z-40 -ml-1 rounded-md border border-slate-200 bg-white p-2 shadow-xl">
                      <div className="inline-grid grid-cols-6 gap-1">
                        {Array.from({ length: 36 }, (_, i) => {
                          const r = Math.floor(i / 6) + 1;
                          const c = (i % 6) + 1;
                          const on = r <= insertHover.r && c <= insertHover.c;
                          return (
                            <button key={i} type="button" onMouseDown={(e) => e.preventDefault()}
                              onMouseEnter={() => setInsertHover({ r, c })}
                              onClick={() => {
                                editor.chain().focus().insertTable({ rows: r, cols: c, withHeaderRow: true }).run();
                                setOpenMenu(null); setInsertSub(null);
                              }}
                              className={`h-5 w-5 rounded-[3px] border ${
                                on ? 'border-blue-500 bg-blue-200' : 'border-slate-300 bg-white'
                              }`} />
                          );
                        })}
                      </div>
                      <div className="mt-1.5 text-[12px] text-slate-500">
                        {insertHover.r > 0 ? `${insertHover.r} × ${insertHover.c}` : 'Pick a size'}
                      </div>
                    </div>
                  )}
                </MenuItem>
                <MenuSep />
                <MenuItem icon={I.omega} label="Special character…" onMouseEnter={() => setInsertSub(null)}
                  onClick={() => { setOpenMenu(null); setSpecialOpen(true); }} />
                <MenuItem icon={I.hr} label="Horizontal line" onMouseEnter={() => setInsertSub(null)}
                  onClick={() => { setOpenMenu(null); editor.chain().focus().setHorizontalRule().run(); }} />
                <MenuSep />
                <MenuItem icon={I.toc} label="Table of contents" disabled />
              </Dropdown>
            )}
            {m === 'Format' && openMenu === 'Format' && (
              <Dropdown width="w-60">
                <MenuItem glyph={<b className="text-[15px]">B</b>} label="Bold" shortcut="⌘B" active={editor.isActive('bold')}
                  onClick={() => { close(); editor.chain().focus().toggleBold().run(); }} />
                <MenuItem glyph={<i className="font-serif text-[15px]">I</i>} label="Italic" shortcut="⌘I" active={editor.isActive('italic')}
                  onClick={() => { close(); editor.chain().focus().toggleItalic().run(); }} />
                <MenuItem glyph={<span className="text-[15px] underline">U</span>} label="Underline" shortcut="⌘U" active={editor.isActive('underline')}
                  onClick={() => { close(); editor.chain().focus().toggleUnderline().run(); }} />
                <MenuItem glyph={<span className="text-[15px] line-through">S</span>} label="Strikethrough" active={editor.isActive('strike')}
                  onClick={() => { close(); editor.chain().focus().toggleStrike().run(); }} />
                <MenuItem glyph={<span className="text-[13px] font-semibold">x²</span>} label="Superscript" active={editor.isActive('superscript')}
                  onClick={() => { close(); editor.chain().focus().toggleSuperscript().run(); }} />
                <MenuItem glyph={<span className="text-[13px] font-semibold">x₂</span>} label="Subscript" active={editor.isActive('subscript')}
                  onClick={() => { close(); editor.chain().focus().toggleSubscript().run(); }} />
                <MenuItem icon={I.code} label="Code" active={editor.isActive('code')}
                  onClick={() => { close(); editor.chain().focus().toggleCode().run(); }} />
                <MenuSep />

                <Sub label="Formats" width="w-44">
                  <Sub label="Headings" width="w-44">
                    {([1, 2, 3, 4, 5, 6] as const).map((lvl) => (
                      <MenuItem key={lvl}
                        label={<span style={{ fontSize: `${1.6 - (lvl - 1) * 0.12}em`, fontWeight: 600 }}>{`Heading ${lvl}`}</span>}
                        active={editor.isActive('heading', { level: lvl })}
                        onClick={() => { close(); editor.chain().focus().toggleHeading({ level: lvl }).run(); }} />
                    ))}
                  </Sub>
                  <Sub label="Inline" width="w-44">
                    <MenuItem label={<span className="font-bold">Bold</span>} active={editor.isActive('bold')} onClick={() => { close(); editor.chain().focus().toggleBold().run(); }} />
                    <MenuItem label={<span className="italic">Italic</span>} active={editor.isActive('italic')} onClick={() => { close(); editor.chain().focus().toggleItalic().run(); }} />
                    <MenuItem label={<span className="underline">Underline</span>} active={editor.isActive('underline')} onClick={() => { close(); editor.chain().focus().toggleUnderline().run(); }} />
                    <MenuItem label={<span className="line-through">Strikethrough</span>} active={editor.isActive('strike')} onClick={() => { close(); editor.chain().focus().toggleStrike().run(); }} />
                    <MenuItem label="Superscript" active={editor.isActive('superscript')} onClick={() => { close(); editor.chain().focus().toggleSuperscript().run(); }} />
                    <MenuItem label="Subscript" active={editor.isActive('subscript')} onClick={() => { close(); editor.chain().focus().toggleSubscript().run(); }} />
                    <MenuItem label={<span className="rounded bg-red-50 px-1.5 font-mono text-red-600">Code</span>} active={editor.isActive('code')} onClick={() => { close(); editor.chain().focus().toggleCode().run(); }} />
                  </Sub>
                  <Sub label="Blocks" width="w-44">
                    <MenuItem label="Paragraph" check={editor.isActive('paragraph')} onClick={() => { close(); editor.chain().focus().setParagraph().run(); }} />
                    <MenuItem label={<span className="italic">Blockquote</span>} check={editor.isActive('blockquote')} onClick={() => { close(); editor.chain().focus().toggleBlockquote().run(); }} />
                    <MenuItem label="Div" check={editor.isActive('div')} onClick={() => { close(); editor.chain().focus().wrapIn('div').run(); }} />
                    <MenuItem label={<span className="rounded border border-slate-200 bg-slate-50 px-1.5 font-mono text-[13px]">Pre</span>} check={editor.isActive('codeBlock')} onClick={() => { close(); editor.chain().focus().toggleCodeBlock().run(); }} />
                  </Sub>
                  <Sub label="Align" width="w-40">
                    <MenuItem icon={I.alignLeft} label="Left" active={editor.isActive({ textAlign: 'left' })} onClick={() => { close(); editor.chain().focus().setTextAlign('left').run(); }} />
                    <MenuItem icon={I.alignCenter} label="Center" active={editor.isActive({ textAlign: 'center' })} onClick={() => { close(); editor.chain().focus().setTextAlign('center').run(); }} />
                    <MenuItem icon={I.alignRight} label="Right" active={editor.isActive({ textAlign: 'right' })} onClick={() => { close(); editor.chain().focus().setTextAlign('right').run(); }} />
                    <MenuItem icon={I.alignJustify} label="Justify" active={editor.isActive({ textAlign: 'justify' })} onClick={() => { close(); editor.chain().focus().setTextAlign('justify').run(); }} />
                  </Sub>
                </Sub>

                <Sub label="Blocks" width="w-52">
                  <MenuItem label="Paragraph" check={editor.isActive('paragraph')} onClick={() => { close(); editor.chain().focus().setParagraph().run(); }} />
                  {[1, 2, 3, 4].map((lvl) => (
                    <MenuItem key={lvl} label={`Heading ${lvl}`} check={editor.isActive('heading', { level: lvl })}
                      onClick={() => { close(); editor.chain().focus().toggleHeading({ level: lvl as 1 | 2 | 3 | 4 }).run(); }} />
                  ))}
                  <MenuItem label="Preformatted" check={editor.isActive('codeBlock')} onClick={() => { close(); editor.chain().focus().toggleCodeBlock().run(); }} />
                  <MenuItem label="Code" check={editor.isActive('code')} onClick={() => { close(); editor.chain().focus().toggleCode().run(); }} />
                </Sub>

                <Sub label="Fonts" width="w-56">
                  {FONTS.map((f) => (
                    <MenuItem key={f} label={<span style={{ fontFamily: f }}>{f}</span>}
                      active={editor.isActive('textStyle', { fontFamily: f })}
                      onClick={() => { close(); editor.chain().focus().setFontFamily(f).run(); }} />
                  ))}
                </Sub>

                <Sub label="Font sizes" width="w-32">
                  {FONT_SIZES.map((s) => (
                    <MenuItem key={s} label={s} check={editor.isActive('textStyle', { fontSize: s })}
                      onClick={() => { close(); editor.chain().focus().setFontSize(s).run(); }} />
                  ))}
                </Sub>

                <Sub label="Align" width="w-40">
                  <MenuItem icon={I.alignLeft} label="Left" active={editor.isActive({ textAlign: 'left' })} onClick={() => { close(); editor.chain().focus().setTextAlign('left').run(); }} />
                  <MenuItem icon={I.alignCenter} label="Center" active={editor.isActive({ textAlign: 'center' })} onClick={() => { close(); editor.chain().focus().setTextAlign('center').run(); }} />
                  <MenuItem icon={I.alignRight} label="Right" active={editor.isActive({ textAlign: 'right' })} onClick={() => { close(); editor.chain().focus().setTextAlign('right').run(); }} />
                  <MenuItem icon={I.alignJustify} label="Justify" active={editor.isActive({ textAlign: 'justify' })} onClick={() => { close(); editor.chain().focus().setTextAlign('justify').run(); }} />
                </Sub>

                <Sub label="Line height" width="w-28">
                  {LINE_HEIGHTS.map((h) => (
                    <MenuItem key={h} label={h} onClick={() => { close(); editor.chain().focus().setLineHeight(h).run(); }} />
                  ))}
                </Sub>

                <MenuSep />
                <Sub label="Text color" icon={I.colorA} width="w-[248px]">
                  <ColorGrid onPick={(c) => { close(); editor.chain().focus().setColor(c).run(); }}
                             onClear={() => { close(); editor.chain().focus().unsetColor().run(); }} />
                </Sub>
                <Sub label="Background color" icon={I.highlighter} width="w-[248px]">
                  <ColorGrid onPick={(c) => { close(); editor.chain().focus().setHighlight({ color: c }).run(); }}
                             onClear={() => { close(); editor.chain().focus().unsetHighlight().run(); }} />
                </Sub>
                <MenuSep />
                <MenuItem icon={I.eraser} label="Clear formatting"
                  onClick={() => { close(); editor.chain().focus().unsetAllMarks().clearNodes().run(); }} />
              </Dropdown>
            )}
            {m === 'Tools' && openMenu === 'Tools' && (
              <Dropdown width="w-48">
                <MenuItem icon={I.code} label="Source code"
                  onClick={() => { close(); setSourceOpen(true); }} />
              </Dropdown>
            )}
            {m === 'Table' && openMenu === 'Table' && (
              <Dropdown width="w-48">
                <Sub label="Table" icon={I.table} width="w-auto">
                  <div className="p-2">
                    <div className="inline-grid grid-cols-8 gap-1">
                      {Array.from({ length: 64 }, (_, i) => {
                        const r = Math.floor(i / 8) + 1;
                        const c = (i % 8) + 1;
                        const on = r <= insertHover.r && c <= insertHover.c;
                        return (
                          <button key={i} type="button" onMouseDown={(e) => e.preventDefault()}
                            onMouseEnter={() => setInsertHover({ r, c })}
                            onClick={() => { editor.chain().focus().insertTable({ rows: r, cols: c, withHeaderRow: true }).run(); close(); }}
                            className={`h-4 w-4 rounded-[2px] border ${on ? 'border-blue-500 bg-blue-200' : 'border-slate-300 bg-white'}`} />
                        );
                      })}
                    </div>
                    <div className="mt-1.5 text-center text-[12px] text-slate-500">
                      {insertHover.r > 0 ? `${insertHover.c}x${insertHover.r}` : '0x0'}
                    </div>
                  </div>
                </Sub>
                <Sub label="Cell" width="w-52">
                  <MenuItem label="Cell properties" disabled />
                  <MenuItem label="Merge cells" disabled={!inTable} onClick={() => { close(); editor.chain().focus().mergeCells().run(); }} />
                  <MenuItem label="Split cell" disabled={!inTable} onClick={() => { close(); editor.chain().focus().splitCell().run(); }} />
                </Sub>
                <Sub label="Row" width="w-56">
                  <MenuItem label="Insert row before" disabled={!inTable} onClick={() => { close(); editor.chain().focus().addRowBefore().run(); }} />
                  <MenuItem label="Insert row after" disabled={!inTable} onClick={() => { close(); editor.chain().focus().addRowAfter().run(); }} />
                  <MenuItem label="Delete row" disabled={!inTable} onClick={() => { close(); editor.chain().focus().deleteRow().run(); }} />
                  <MenuItem label="Row properties" disabled />
                  <MenuSep />
                  <MenuItem label="Cut row" disabled />
                  <MenuItem label="Copy row" disabled />
                  <MenuItem label="Paste row before" disabled />
                  <MenuItem label="Paste row after" disabled />
                </Sub>
                <Sub label="Column" width="w-56">
                  <MenuItem label="Insert column before" disabled={!inTable} onClick={() => { close(); editor.chain().focus().addColumnBefore().run(); }} />
                  <MenuItem label="Insert column after" disabled={!inTable} onClick={() => { close(); editor.chain().focus().addColumnAfter().run(); }} />
                  <MenuItem label="Delete column" disabled={!inTable} onClick={() => { close(); editor.chain().focus().deleteColumn().run(); }} />
                  <MenuSep />
                  <MenuItem label="Cut column" disabled />
                  <MenuItem label="Copy column" disabled />
                  <MenuItem label="Paste column before" disabled />
                  <MenuItem label="Paste column after" disabled />
                </Sub>
                <MenuSep />
                <MenuItem label="Table properties" disabled />
                <MenuItem icon={I.deleteTable} label="Delete table" disabled={!inTable}
                  onClick={() => { close(); editor.chain().focus().deleteTable().run(); }} />
              </Dropdown>
            )}
          </div>
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
             onClick={() => editor.chain().focus().outdent().run()}>
          <Icon>{I.outdent}</Icon>
        </Btn>
        <Btn title="Increase indent"
             onClick={() => editor.chain().focus().indent().run()}>
          <Icon>{I.indent}</Icon>
        </Btn>
      </div>

      {/* Row 2 */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1">
        <Btn title="Insert or edit link" active={editor.isActive('link')} onClick={openLink}>
          <Icon>{I.link}</Icon>
        </Btn>
        <Btn title="Remove link" disabled={!editor.isActive('link')}
             onClick={() => editor.chain().focus().unsetLink().run()}>
          <Icon>{I.unlink}</Icon>
        </Btn>
        <Btn title="Insert or edit image" onClick={() => setImageOpen(true)}>
          <Icon>{I.image}</Icon>
        </Btn>
        <Btn title="Insert or edit media" onClick={() => setMediaOpen(true)} wide>
          <span className="text-red-600"><Icon>{I.youtube}</Icon></span>
          <span className="text-[13px] text-slate-700">Video</span>
        </Btn>
        <TableMenu editor={editor} />
        <Divider />
        <Btn title="Source code" onClick={() => setSourceOpen(true)}>
          <Icon>{I.code}</Icon>
        </Btn>
        <Btn title="Fullscreen" active={fullscreen} onClick={toggleFullscreen}>
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

      {preview && <PreviewModal html={editor.getHTML()} onClose={() => setPreview(false)} />}
      {confirmNew && <ConfirmNew onCancel={() => setConfirmNew(false)} onConfirm={newDocument} />}
      {sourceOpen && <SourceCodeModal initial={editor.getHTML()} onApply={applySource} onClose={() => setSourceOpen(false)} />}
      {specialOpen && <SpecialCharDialog onPick={insertChar} onClose={() => setSpecialOpen(false)} />}
      {linkOpen && <LinkDialog initial={linkInit} onSave={applyLink} onClose={() => setLinkOpen(false)} />}
      {mediaOpen && <MediaDialog onSave={applyMedia} onClose={() => setMediaOpen(false)} />}
      {findOpen && <FindReplaceDialog editor={editor} onClose={() => setFindOpen(false)} />}
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

/** Shared dropdown container for the menu-bar menus. */
function Dropdown({ width, children }: { width: string; children: React.ReactNode }) {
  return (
    <div className={`absolute left-0 top-full z-30 mt-1 ${width} rounded-md border border-slate-200 bg-white py-1 shadow-xl`}>
      {children}
    </div>
  );
}

/** One row in a menu-bar dropdown: an icon (svg path) or glyph on the left, a
 *  label, and an optional check / shortcut / chevron on the right. `active`
 *  tints the row (for on/off marks); `children` renders a flyout submenu. */
function MenuItem({
  label, icon, glyph, shortcut, check, active, disabled, chevron, onClick, onMouseEnter, children,
}: {
  label: React.ReactNode;
  icon?: React.ReactNode;
  glyph?: React.ReactNode;
  shortcut?: string;
  check?: boolean;
  active?: boolean;
  disabled?: boolean;
  chevron?: boolean;
  onClick?: () => void;
  onMouseEnter?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="relative" onMouseEnter={onMouseEnter}>
      <button
        type="button"
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        className={`flex w-full items-center gap-3 px-3 py-2 text-left text-[14px] ${
          disabled ? 'cursor-not-allowed text-slate-300' : 'text-slate-700 hover:bg-slate-50'
        } ${active ? 'bg-slate-100' : ''}`}
      >
        <span className="grid h-[18px] w-[18px] shrink-0 place-items-center text-slate-500">
          {icon ? <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">{icon}</svg> : glyph ?? null}
        </span>
        <span className="flex-1">{label}</span>
        {check && (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" className="text-slate-700">{I.check}</svg>
        )}
        {shortcut && <span className="text-[12px] tracking-wide text-slate-400">{shortcut}</span>}
        {chevron && <span className="text-slate-400">›</span>}
      </button>
      {children}
    </div>
  );
}

/** A menu row that reveals a flyout submenu to the right on hover. Composes to
 *  any depth (Format › Formats › Headings). */
function Sub({
  label, icon, glyph, width = 'w-48', children,
}: {
  label: string;
  icon?: React.ReactNode;
  glyph?: React.ReactNode;
  width?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <div className="flex cursor-default items-center gap-3 px-3 py-2 text-[14px] text-slate-700 hover:bg-slate-50">
        <span className="grid h-[18px] w-[18px] shrink-0 place-items-center text-slate-500">
          {icon ? <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">{icon}</svg> : glyph ?? null}
        </span>
        <span className="flex-1">{label}</span>
        <span className="text-slate-400">›</span>
      </div>
      {open && (
        <div className={`absolute left-full top-0 z-40 -ml-1 max-h-[70vh] overflow-y-auto ${width} rounded-md border border-slate-200 bg-white py-1 shadow-xl`}>
          {children}
        </div>
      )}
    </div>
  );
}

function MenuSep() {
  return <div className="my-1 border-t border-slate-200" />;
}

const FONTS = [
  'Andale Mono', 'Arial', 'Arial Black', 'Book Antiqua', 'Comic Sans MS', 'Courier New',
  'Georgia', 'Helvetica', 'Impact', 'Symbol', 'Tahoma', 'Terminal', 'Times New Roman',
  'Trebuchet MS', 'Verdana', 'Webdings', 'Wingdings',
];
const FONT_SIZES = ['8pt', '10pt', '12pt', '14pt', '18pt', '24pt', '36pt'];
const LINE_HEIGHTS = ['1', '1.1', '1.2', '1.3', '1.4', '1.5', '2'];

const PALETTE = [
  '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff',
  '#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff',
  '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc',
];

/** A compact swatch grid used by Format › Text color / Background color. */
function ColorGrid({ onPick, onClear }: { onPick: (c: string) => void; onClear: () => void }) {
  return (
    <div className="p-2">
      <div className="grid grid-cols-10 gap-1">
        {PALETTE.map((c) => (
          <button key={c} type="button" title={c} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(c)}
                  className="h-5 w-5 rounded-[3px] border border-slate-300" style={{ background: c }} />
        ))}
      </div>
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClear}
              className="mt-2 flex w-full items-center gap-2 rounded px-2 py-1.5 text-[13px] text-slate-600 hover:bg-slate-100">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
        Remove color
      </button>
    </div>
  );
}

/** View › Source code — edit the field's raw HTML and apply it back. */
function SourceCodeModal({ initial, onApply, onClose }: { initial: string; onApply: (html: string) => void; onClose: () => void }) {
  const [html, setHtml] = useState(initial);
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-900/40 p-6" onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} className="flex max-h-[85vh] w-[820px] max-w-full flex-col rounded-lg bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-3">
          <h2 className="text-[19px] font-semibold text-slate-900">Source code</h2>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded text-slate-500 hover:bg-slate-100">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>
        <textarea
          value={html}
          onChange={(e) => setHtml(e.target.value)}
          spellCheck={false}
          className="m-6 h-[50vh] resize-none rounded-md border border-slate-300 bg-slate-50 p-4 font-mono text-[13px] leading-relaxed text-slate-800 focus:border-blue-500 focus:outline-none"
        />
        <footer className="flex justify-end gap-2 border-t border-slate-200 px-6 py-3">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={() => onApply(html)} className="rounded-md bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700">Save</button>
        </footer>
      </div>
    </div>
  );
}

/** Read-only rendered view of the field's content. */
function PreviewModal({ html, onClose }: { html: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-900/40 p-6" onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} className="flex max-h-[85vh] w-[900px] max-w-full flex-col rounded-lg bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-3">
          <h2 className="text-[19px] font-semibold text-slate-900">Preview</h2>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded text-slate-500 hover:bg-slate-100">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>
        <div className="prose-editor min-h-[200px] flex-1 overflow-y-auto px-8 py-6 text-[16px] leading-relaxed text-slate-800"
             dangerouslySetInnerHTML={{ __html: html || '<p class="text-slate-400">Nothing to preview yet.</p>' }} />
        <footer className="flex justify-end border-t border-slate-200 px-6 py-3">
          <button type="button" onClick={onClose} className="rounded-md bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700">Close</button>
        </footer>
      </div>
    </div>
  );
}

function ConfirmNew({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-900/40 p-4" onMouseDown={onCancel}>
      <div onMouseDown={(e) => e.stopPropagation()} className="w-[420px] max-w-full rounded-lg bg-white shadow-2xl">
        <div className="px-6 py-5">
          <h2 className="text-[18px] font-semibold text-slate-900">Start a new document?</h2>
          <p className="mt-1.5 text-[15px] text-slate-600">This clears everything in this field. It can’t be undone.</p>
        </div>
        <footer className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <button type="button" onClick={onCancel} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={onConfirm} className="rounded-md bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700">Clear field</button>
        </footer>
      </div>
    </div>
  );
}
