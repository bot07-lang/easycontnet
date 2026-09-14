import type { Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react';
import { getMarkRange } from '@tiptap/core';
import { useEffect, useId, useReducer, useRef, useState } from 'react';
import { BlockTypeMenu, useClickAway } from './toolbar-parts';
import { useOverflowsRight } from '../lib/overflow';
import { ImageDialog, type ImageValue, type LinkedImage } from './ImageDialog';
import { TextCommentButton, CommentPopoverTrigger } from './CommentPopover';
import { TextHighlightColorPicker } from './TextHighlightColorPicker';
import { TableMenu } from './TableMenu';
import { LinkDialog, type LinkValues, type LinkedFile } from './LinkDialog';
import { toast } from '../lib/toast';
import { MediaDialog } from './MediaDialog';
import { isSafeUrl } from './editor-extensions';
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

/** A small, instant hover tooltip — real state, not CSS `group-hover`. These
 *  buttons sit only a few pixels apart in dense toolbar rows, so a pure-CSS
 *  fade lets a fast mouse sweep leave several tooltips visible at once (the
 *  bug: a garbled stack of every button's label, all mid-transition
 *  simultaneously). State means exactly one is ever mounted, and dropping
 *  the native `title` attribute also drops its own ~1s hover delay. */
function HoverLabel({ label, hovered, align = 'center' }: { label: string; hovered: boolean; align?: 'center' | 'left' | 'right' }) {
  if (!hovered) return null;
  const pos = align === 'left' ? 'left-0' : align === 'right' ? 'right-0' : 'left-1/2 -translate-x-1/2';
  const arrowPos = align === 'left' ? 'left-2.5' : align === 'right' ? 'right-2.5' : 'left-1/2 -translate-x-1/2';
  return (
    <span role="tooltip"
          className={`pointer-events-none absolute top-full z-30 mt-2 ${pos} whitespace-nowrap rounded-md bg-slate-800 px-2.5 py-1.5 text-[12px] font-medium text-white shadow-lg`}>
      {label}
      <span className={`absolute bottom-full h-0 w-0 border-x-4 border-b-4 border-x-transparent border-b-slate-800 ${arrowPos}`} />
    </span>
  );
}

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
  const [hovered, setHovered] = useState(false);
  return (
    <span className="relative inline-flex" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()} // keep the editor selection
        onClick={onClick}
        disabled={disabled}
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
      <HoverLabel label={title} hovered={hovered && !disabled} />
    </span>
  );
}

function Divider() {
  return <div className="mx-1 h-6 w-px bg-slate-300" />;
}

/** A button in the floating selection bubble. `caret` appends a small dropdown
 *  arrow (for the table-size picker). */
function BubBtn({
  title, active, disabled, caret, onClick, children,
}: {
  title: string;
  active?: boolean;
  disabled?: boolean;
  caret?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <span className="relative inline-flex" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button
        type="button"
        aria-label={title}
        aria-pressed={active}
        onMouseDown={(e) => e.preventDefault()} // keep the editor selection
        onClick={onClick}
        disabled={disabled}
        className={[
          'flex h-8 min-w-8 items-center justify-center gap-0.5 rounded px-1.5 text-slate-700 transition',
          disabled ? 'cursor-not-allowed opacity-30' : 'hover:bg-slate-100',
          active ? 'bg-slate-200' : '',
        ].join(' ')}
      >
        {children}
        {caret && <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z" /></svg>}
      </button>
      <HoverLabel label={title} hovered={hovered && !disabled} />
    </span>
  );
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
  dots: <path d="M6 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />,
  taskList: <path d="M3.3 5.7 5 7.4 8.7 3.7l-1-1L5 5.4l-.7-.7-1 1zM10 5h11v2H10V5zM3.3 11.7 5 13.4l3.7-3.7-1-1L5 11.4l-.7-.7-1 1zM10 11h11v2H10v-2zM3 17h4v2H3v-2zM10 17h11v2H10v-2z" />,
  track: <path d="M4 6h9v2H4V6zm0 5h6v2H4v-2zm0 5h5v2H4v-2zM20.7 5.3a1 1 0 0 0-1.4 0l-1 1 2.4 2.4 1-1a1 1 0 0 0 0-1.4l-1-1zM19.6 9.4 17.2 7l-6.3 6.3-.7 2.9 2.9-.7 6.5-6.1z" />,
};

export function EditorToolbar({
  editor, docTitle, fullscreen, onToggleFullscreen, onUpload, linkedImages, linkedFiles, disabled = false, fieldId,
  onOpenTableProps, onOpenCellProps, onOpenRowProps,
}: {
  editor: Editor;
  docTitle?: string;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  /** Enables the Insert Image dialog's Upload tab. */
  onUpload?: (file: File) => Promise<{ url: string; fullUrl: string }>;
  /** Images attached to the current item — pickable in the image dialog. */
  linkedImages?: LinkedImage[];
  /** Files attached to the current item — pickable in the link dialog's Browse. */
  linkedFiles?: LinkedFile[];
  /** Read-only status: keep the toolbar mounted but greyed + non-interactive
   *  (rather than unmounting it, which churns the DOM next to the portaled
   *  BubbleMenus and can crash React reconciliation). */
  disabled?: boolean;
  /** The field's id — enables the selection-bubble "comment" action. */
  fieldId?: string;
  /** Opens the Table/Cell/Row Properties dialogs (owned by RichTextField, which
   *  holds their state — the table menu here just triggers them). */
  onOpenTableProps?: () => void;
  onOpenCellProps?: () => void;
  onOpenRowProps?: () => void;
}) {
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  const [imageOpen, setImageOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [specialOpen, setSpecialOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkInit, setLinkInit] = useState<LinkValues>({ url: '', text: '', title: '', target: '' });
  const bubbleKey = useId(); // unique BubbleMenu plugin key for the selection menu
  // View › Visual aids defaults on (table guides visible); Show blocks off.
  const [visualAids, setVisualAids] = useState(true);
  const [showBlocks, setShowBlocks] = useState(false);

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

  // Insert › Special character — drop the glyph at the cursor and close the
  // dialog (matching the reference: picking a character dismisses the popup).
  const insertChar = (ch: string) => {
    editor.chain().focus().insertContent(ch).run();
    setSpecialOpen(false);
  };

  // Clear formatting. With a real selection, strip everything in it (marks, block
  // type, alignment, line-height, font size). With just a cursor, clear ONLY the
  // formatted run under it (the mark range) — not the whole line.
  const clearFormat = () => {
    const sel = editor.state.selection;
    if (sel.empty) {
      const $pos = sel.$from;
      const marks = $pos.marks();
      if (!marks.length) return; // nothing formatted at the cursor
      let from = $pos.pos;
      let to = $pos.pos;
      for (const m of marks) {
        const range = getMarkRange($pos, m.type);
        if (range) { from = Math.min(from, range.from); to = Math.max(to, range.to); }
      }
      if (from === to) return;
      editor.chain().focus().setTextSelection({ from, to }).unsetAllMarks().unsetFontSize().run();
      return;
    }
    editor.chain().focus().unsetAllMarks().clearNodes().unsetTextAlign().unsetLineHeight().unsetFontSize().run();
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

  // Insert/Edit Media — a source URL goes through the YouTube embed. Raw embed
  // code has no matching node in the schema (ProseMirror would just silently
  // drop it, which was the bug), so pull the src out of its <iframe> — the
  // shape every oEmbed "copy this embed code" snippet (Vimeo, CodePen, etc)
  // actually uses — and insert THAT via the genericEmbed node. A script-tag
  // embed (Twitter/X, Instagram) has no iframe to extract and isn't supported
  // — running arbitrary third-party JS inside the editor would be a real
  // injection risk — so that case gets a clear message instead of the old
  // silent no-op.
  const applyMedia = ({ source, embed }: { source: string; embed: string }) => {
    setMediaOpen(false);
    if (source) {
      const inserted = editor.commands.setYoutubeVideo({ src: source, width: 640, height: 360 });
      if (!inserted) {
        toast("That link isn't supported — only YouTube video URLs work in the Source field.");
      }
      return;
    }
    if (!embed) return;
    const src = embed.match(/<iframe[^>]*\ssrc=["']([^"']+)["']/i)?.[1];
    if (src && isSafeUrl(src)) {
      const width = Number(embed.match(/\swidth=["']?(\d+)/i)?.[1]) || 640;
      const height = Number(embed.match(/\sheight=["']?(\d+)/i)?.[1]) || 360;
      editor.commands.setGenericEmbed({ src, width, height });
    } else {
      toast("That embed code isn't supported — paste one that includes an <iframe>, like Vimeo's or CodePen's embed snippet.");
    }
  };

  const insertImage = (v: ImageValue) => {
    const attrs = {
      src: v.src,
      alt: v.alt || null,
      width: v.width || null,
      height: v.height || null,
      dataFullName: v.fullSrc || null,
    };
    // The image is an inline node; wrap it in its own paragraph so it lands on a
    // new line below the current text (matching the reference), not inline with it.
    editor
      .chain()
      .focus()
      .insertContent(
        v.showCaption
          ? { type: 'figure', attrs, content: [{ type: 'text', text: 'Caption' }] }
          : { type: 'paragraph', content: [{ type: 'image', attrs }] },
      )
      .run();
    setImageOpen(false);
  };

  const textColor = (editor.getAttributes('textStyle').color as string) ?? undefined;
  const highlightColor = (editor.getAttributes('highlight').color as string) ?? undefined;

  return (
    <div className={`border-b border-slate-200 bg-slate-50 ${disabled ? 'pointer-events-none select-none opacity-50' : ''}`}
         aria-disabled={disabled || undefined}>
      {/* Selection bubble — appears over a non-empty text selection (matching the
          reference): bold / italic · link · H2 · H3 · quote · image · table ·
          comment. Not shown on an image/figure/table (those have their own
          floating toolbars). */}
      <BubbleMenu
        editor={editor}
        pluginKey={`text-bubble-${bubbleKey}`}
        shouldShow={({ editor, state }) => {
          if (state.selection.empty) return false;
          if (editor.isActive('image') || editor.isActive('figure') || editor.isActive('table')) return false;
          return editor.isEditable;
        }}
        tippyOptions={{ placement: 'top', zIndex: 45, maxWidth: 'none' }}
      >
        <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          <BubBtn title="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
            <span className="text-[15px] font-bold">B</span>
          </BubBtn>
          <BubBtn title="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
            <span className="font-serif text-[15px] italic">I</span>
          </BubBtn>
          <span className="mx-1 h-6 w-px bg-slate-200" />

          <BubBtn title="Insert/edit link" active={editor.isActive('link')} onClick={openLink}>
            <Icon>{I.link}</Icon>
          </BubBtn>
          <BubBtn title="Heading 2" active={editor.isActive('heading', { level: 2 })}
                  onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
            <span className="text-[13px] font-semibold">H2</span>
          </BubBtn>
          <BubBtn title="Heading 3" active={editor.isActive('heading', { level: 3 })}
                  onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
            <span className="text-[13px] font-semibold">H3</span>
          </BubBtn>
          <BubBtn title="Blockquote" active={editor.isActive('blockquote')}
                  onClick={() => editor.chain().focus().toggleBlockquote().run()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 17h3l2-4V7H5v6h3l-2 4zm8 0h3l2-4V7h-6v6h3l-2 4z" /></svg>
          </BubBtn>
          <BubBtn title="Insert/edit image" onClick={() => setImageOpen(true)}>
            <Icon>{I.image}</Icon>
          </BubBtn>
          {/* Full Table menu (Table size grid / Cell / Row / Column / properties /
              delete) — the same dropdown as the toolbar, matching the reference. */}
          <TableMenu editor={editor} onOpenTableProps={onOpenTableProps} onOpenCellProps={onOpenCellProps} onOpenRowProps={onOpenRowProps} />
          <span className="mx-1 h-6 w-px bg-slate-200" />

          {/* Comment on the highlighted text (a text-anchored comment). */}
          {fieldId ? (
            <TextCommentButton
              fieldId={fieldId}
              getQuote={() => {
                const { from, to } = editor.state.selection;
                if (from === to) return null;
                return editor.state.doc.textBetween(from, to, ' ').trim().slice(0, 300) || null;
              }}
              title="Comment on selection"
              buttonClass="flex h-8 min-w-8 items-center justify-center rounded px-1.5 text-slate-700 transition hover:bg-slate-100"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 4H4a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 4 17h3v3.2L11 17h9a1.5 1.5 0 0 0 1.5-1.5v-10A1.5 1.5 0 0 0 20 4z" />
                <line x1="12" y1="8" x2="12" y2="13" /><line x1="9.5" y1="10.5" x2="14.5" y2="10.5" />
              </svg>
            </TextCommentButton>
          ) : (
            <BubBtn title="Add a comment" disabled>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 4H4a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 4 17h3v3.2L11 17h9a1.5 1.5 0 0 0 1.5-1.5v-10A1.5 1.5 0 0 0 20 4z" />
                <line x1="12" y1="8" x2="12" y2="13" /><line x1="9.5" y1="10.5" x2="14.5" y2="10.5" />
              </svg>
            </BubBtn>
          )}
        </div>
      </BubbleMenu>

      {/* Single dense toolbar row — everything else lives behind grouped
          dropdowns/overflow menus below; only Source code and Fullscreen sit
          on the thin utility line under it. */}
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

        <Btn title="Find and replace (⌘F)" onClick={() => setFindOpen(true)}>
          <Icon>{I.search}</Icon>
        </Btn>
        <Divider />

        <BlockTypeMenu editor={editor} />
        <Divider />

        {/* Lists + indent, grouped — matches the reference's single list dropdown
            instead of four permanently-visible icons. */}
        <OverflowMenu title="Lists and indent" width="w-52" icon={<Icon>{I.bulletList}</Icon>}>
          {(close) => (
            <>
              <MenuItem icon={I.bulletList} label="Bullet List" active={editor.isActive('bulletList')}
                onClick={() => { close(); editor.chain().focus().toggleBulletList().run(); }} />
              <MenuItem icon={I.orderedList} label="Ordered List" active={editor.isActive('orderedList')}
                onClick={() => { close(); editor.chain().focus().toggleOrderedList().run(); }} />
              <MenuItem icon={I.taskList} label="Task List" active={editor.isActive('taskList')}
                onClick={() => { close(); editor.chain().focus().toggleTaskList().run(); }} />
              <MenuSep />
              <MenuItem icon={I.indent} label="Increase indentation"
                onClick={() => { close(); editor.chain().focus().indent().run(); }} />
              <MenuItem icon={I.outdent} label="Decrease indentation"
                onClick={() => { close(); editor.chain().focus().outdent().run(); }} />
            </>
          )}
        </OverflowMenu>
        <Divider />

        <Btn title="Bold (⌘B)" active={editor.isActive('bold')}
             onClick={() => editor.chain().focus().toggleBold().run()}>
          <span className="text-[15px] font-bold">B</span>
        </Btn>
        <Btn title="Italic (⌘I)" active={editor.isActive('italic')}
             onClick={() => editor.chain().focus().toggleItalic().run()}>
          <span className="font-serif text-[15px] italic">I</span>
        </Btn>

        <TextHighlightColorPicker
          textColor={textColor}
          highlightColor={highlightColor}
          onPickText={(c) => editor.chain().focus().setColor(c).run()}
          onClearText={() => editor.chain().focus().unsetColor().run()}
          onPickHighlight={(c) => editor.chain().focus().setHighlight({ color: c }).run()}
          onClearHighlight={() => editor.chain().focus().unsetHighlight().run()}
        />

        {/* Underline, strike, sup/sub, code, clear formatting — everything
            past Bold/Italic/colour collapses into one overflow, matching the
            reference's single "⋯". */}
        <OverflowMenu title="More formatting" width="w-56" icon={<Icon size={16}>{I.dots}</Icon>}>
          {(close) => (
            <>
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
              <MenuItem icon={I.eraser} label="Clear formatting"
                onClick={() => { close(); clearFormat(); }} />
            </>
          )}
        </OverflowMenu>
        <Divider />

        <Btn title="Insert or edit link (⌘K)" active={editor.isActive('link')} onClick={openLink}>
          <Icon>{I.link}</Icon>
        </Btn>
        <TableMenu editor={editor} onOpenTableProps={onOpenTableProps} onOpenCellProps={onOpenCellProps} onOpenRowProps={onOpenRowProps} />
        <Btn title="Insert or edit image" onClick={() => setImageOpen(true)}>
          <Icon>{I.image}</Icon>
        </Btn>

        {/* Less-frequent inserts, grouped behind one overflow menu. */}
        <OverflowMenu title="More insert options" width="w-56" icon={<Icon size={16}>{I.dots}</Icon>}>
          {(close) => (
            <>
              <MenuItem icon={I.media} label="Media…"
                onClick={() => { close(); setMediaOpen(true); }} />
              <MenuItem icon={I.omega} label="Special character…"
                onClick={() => { close(); setSpecialOpen(true); }} />
              <MenuItem icon={I.hr} label="Horizontal line"
                onClick={() => { close(); editor.chain().focus().setHorizontalRule().run(); }} />
              <MenuSep />
              <MenuItem icon={I.toc} label="Table of contents"
                onClick={() => { close(); editor.chain().focus().insertTableOfContents().run(); }} />
            </>
          )}
        </OverflowMenu>
        <Divider />

        {/* Alignment collapsed to one dropdown (was 3 separate always-on
            buttons); the trigger icon reflects the current alignment, and
            Justify — previously buried in Format — is now reachable here. */}
        <OverflowMenu
          title="Alignment"
          width="w-40"
          icon={<Icon>
            {editor.isActive({ textAlign: 'center' }) ? I.alignCenter
              : editor.isActive({ textAlign: 'right' }) ? I.alignRight
              : editor.isActive({ textAlign: 'justify' }) ? I.alignJustify
              : I.alignLeft}
          </Icon>}
        >
          {(close) => (
            <>
              <MenuItem icon={I.alignLeft} label="Left" active={editor.isActive({ textAlign: 'left' })} onClick={() => { close(); editor.chain().focus().setTextAlign('left').run(); }} />
              <MenuItem icon={I.alignCenter} label="Center" active={editor.isActive({ textAlign: 'center' })} onClick={() => { close(); editor.chain().focus().setTextAlign('center').run(); }} />
              <MenuItem icon={I.alignRight} label="Right" active={editor.isActive({ textAlign: 'right' })} onClick={() => { close(); editor.chain().focus().setTextAlign('right').run(); }} />
              <MenuItem icon={I.alignJustify} label="Justify" active={editor.isActive({ textAlign: 'justify' })} onClick={() => { close(); editor.chain().focus().setTextAlign('justify').run(); }} />
            </>
          )}
        </OverflowMenu>

        <div className="ml-auto">
          {/* Everything that used to live in File / Edit / View / Tools /
              Format's typography extras — consolidated into one overflow
              menu at the end of the toolbar instead of a permanent menu bar. */}
          <OverflowMenu title="More" width="w-60" align="right" icon={<Icon size={16}>{I.dots}</Icon>}>
            {(close) => (
              <>
                <MenuItem icon={I.newDoc} label="New document"
                  onClick={() => { close(); setConfirmNew(true); }} />
                <MenuItem icon={I.eye} label="Preview"
                  onClick={() => { close(); setPreview(true); }} />
                <MenuItem icon={I.print} label="Print…"
                  onClick={() => { close(); printContent(); }} />
                <MenuItem icon={I.track} label="Track changes (coming in Phase 2)" disabled />
                <MenuSep />
                <MenuItem icon={I.cut} label="Cut" shortcut="⌘X" onClick={() => { close(); cut(); }} />
                <MenuItem icon={I.copy} label="Copy" shortcut="⌘C" onClick={() => { close(); copy(); }} />
                <MenuItem icon={I.paste} label="Paste" shortcut="⌘V" onClick={() => { close(); paste(); }} />
                <MenuItem icon={I.paste} label="Paste as text" onClick={() => { close(); pasteAsText(); }} />
                <MenuItem icon={I.selectAll} label="Select all" shortcut="⌘A"
                  onClick={() => { close(); editor.chain().focus().selectAll().run(); }} />
                <MenuSep />
                {/* Toggles keep the menu open so the check visibly flips. */}
                <MenuItem label="Visual aids" check={visualAids}
                  onClick={() => setVisualAids((v) => !v)} />
                <MenuItem icon={I.pilcrow} label="Show blocks" check={showBlocks}
                  onClick={() => setShowBlocks((v) => !v)} />
                <MenuSep />
                <Sub label="Blocks" width="w-44">
                  <MenuItem label="Paragraph" check={editor.isActive('paragraph')} onClick={() => { close(); editor.chain().focus().setParagraph().run(); }} />
                  <MenuItem label={<span className="italic">Blockquote</span>} check={editor.isActive('blockquote')} onClick={() => { close(); editor.chain().focus().toggleBlockquote().run(); }} />
                  <MenuItem label="Div" check={editor.isActive('div')} onClick={() => { close(); editor.chain().focus().wrapIn('div').run(); }} />
                  <MenuItem label={<span className="rounded border border-slate-200 bg-slate-50 px-1.5 font-mono text-[13px]">Pre</span>} check={editor.isActive('codeBlock')} onClick={() => { close(); editor.chain().focus().toggleCodeBlock().run(); }} />
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
                <Sub label="Line height" width="w-28">
                  {LINE_HEIGHTS.map((h) => (
                    <MenuItem key={h} label={h} onClick={() => { close(); editor.chain().focus().setLineHeight(h).run(); }} />
                  ))}
                </Sub>
              </>
            )}
          </OverflowMenu>
        </div>
      </div>

      {/* Thin utility line — just the rarely-touched icons, right-aligned,
          matching the reference's near-empty second line. */}
      <div className="flex items-center justify-end gap-0.5 px-2 py-1">
        {/* Comment on the whole field — the same anchor/thread the field's
            own header and gutter comment icons use (see Field.tsx), so all
            three affordances share one comment count and thread per field. */}
        {fieldId ? (
          <CommentPopoverTrigger
            match={(c) => (c.anchor === 'field' || c.anchor === 'text') && c.field_id === fieldId}
            newAnchor={{ anchor: 'field', fieldId }}
            title="Comment on this field"
            badgePlacement="tr"
            buttonClass="flex h-8 w-8 items-center justify-center rounded text-slate-700 transition hover:bg-slate-200"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 4H4a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 4 17h3v3.2L11 17h9a1.5 1.5 0 0 0 1.5-1.5v-10A1.5 1.5 0 0 0 20 4z" />
              <line x1="12" y1="8" x2="12" y2="13" />
              <line x1="9.5" y1="10.5" x2="14.5" y2="10.5" />
            </svg>
          </CommentPopoverTrigger>
        ) : (
          <Btn title="Add a comment" disabled>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 4H4a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 4 17h3v3.2L11 17h9a1.5 1.5 0 0 0 1.5-1.5v-10A1.5 1.5 0 0 0 20 4z" />
              <line x1="12" y1="8" x2="12" y2="13" />
              <line x1="9.5" y1="10.5" x2="14.5" y2="10.5" />
            </svg>
          </Btn>
        )}
        <Btn title="Source code" onClick={() => setSourceOpen(true)}>
          <Icon>{I.code}</Icon>
        </Btn>
        <Btn title="Fullscreen (⇧⌘F)" active={fullscreen} onClick={toggleFullscreen}>
          <Icon>{I.fullscreen}</Icon>
        </Btn>
      </div>

      {preview && <PreviewModal html={editor.getHTML()} onClose={() => setPreview(false)} />}
      {confirmNew && <ConfirmNew onCancel={() => setConfirmNew(false)} onConfirm={newDocument} />}
      {sourceOpen && <SourceCodeModal initial={editor.getHTML()} onApply={applySource} onClose={() => setSourceOpen(false)} />}
      {specialOpen && <SpecialCharDialog onPick={insertChar} onClose={() => setSpecialOpen(false)} />}
      {linkOpen && <LinkDialog initial={linkInit} onSave={applyLink} onClose={() => setLinkOpen(false)} linkedFiles={linkedFiles} />}
      {mediaOpen && <MediaDialog onSave={applyMedia} onClose={() => setMediaOpen(false)} />}
      {findOpen && <FindReplaceDialog editor={editor} onClose={() => setFindOpen(false)} />}

      {/* Insert Image dialog — rendered LAST, AFTER the BubbleMenu. A
          conditional sibling placed BEFORE the tippy-relocated BubbleMenu
          element crashes React reconciliation (insertBefore / NotFoundError);
          appending at the end avoids that. */}
      {imageOpen && (
        <ImageDialog onClose={() => setImageOpen(false)} onSave={insertImage} onUpload={onUpload} linkedImages={linkedImages} />
      )}
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

/** Shared dropdown container for the toolbar's grouped menus. `align="right"`
 *  hangs the panel off the trigger's right edge instead of its left — needed
 *  for triggers that sit at (or near) the toolbar's right edge, so the panel
 *  opens back over the toolbar instead of running off the viewport. */
function Dropdown({ width, align = 'left', children }: { width: string; align?: 'left' | 'right'; children: React.ReactNode }) {
  return (
    <div className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-full z-30 mt-1 ${width} rounded-md border border-slate-200 bg-white py-1 shadow-xl`}>
      {children}
    </div>
  );
}

/** A toolbar icon button that opens a Dropdown of MenuItems — the building
 *  block for every grouped/overflow control (lists, alignment, "more…").
 *  `children` is a render-prop so callers can close the menu after acting. */
function OverflowMenu({
  title, icon, width = 'w-56', align = 'left', children,
}: {
  title: string;
  icon: React.ReactNode;
  width?: string;
  align?: 'left' | 'right';
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const ref = useClickAway(() => setOpen(false));
  return (
    <div ref={ref} className="relative" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        aria-label={title}
        className={`flex h-8 items-center gap-0.5 rounded px-1.5 text-slate-700 transition hover:bg-slate-200 ${open ? 'bg-slate-200' : ''}`}
      >
        {icon}
        <span className="text-[9px] leading-none text-slate-500">▾</span>
      </button>
      <HoverLabel label={title} hovered={hovered && !open} />
      {open && <Dropdown width={width} align={align}>{children(() => setOpen(false))}</Dropdown>}
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
 *  any depth (Format › Formats › Headings). Flips to open leftward instead
 *  when it would otherwise be clipped — measured against its own real
 *  rendered position (window edge, or a nearer `overflow-hidden` ancestor
 *  such as the field's card), not a guess. */
function Sub({
  label, icon, glyph, width = 'w-48', scroll = true, children,
}: {
  label: string;
  icon?: React.ReactNode;
  glyph?: React.ReactNode;
  width?: string;
  // Scroll long leaf lists; MUST be false when the panel holds nested submenus,
  // since overflow-y:auto also clips overflow-x, cutting off the pop-out children.
  scroll?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const flip = useOverflowsRight(panelRef, open);
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
        <div ref={panelRef} className={`absolute ${flip ? 'right-full top-0 -mr-1' : 'left-full top-0 -ml-1'} z-40 ${scroll ? 'max-h-[70vh] overflow-y-auto' : ''} ${width} rounded-md border border-slate-200 bg-white py-1 shadow-xl`}>
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

/** View › Source code — edit the field's raw HTML and apply it back. */
function SourceCodeModal({ initial, onApply, onClose }: { initial: string; onApply: (html: string) => void; onClose: () => void }) {
  const [html, setHtml] = useState(initial);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(html);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked — user can still select-all + ⌘C */ }
  };
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-900/40 p-6" onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} className="flex max-h-[85vh] w-[820px] max-w-full flex-col rounded-lg bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-3">
          <h2 className="text-[19px] font-semibold text-slate-900">Source code</h2>
          <div className="flex items-center gap-2">
            <button type="button" onClick={copy}
                    className="flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="9" y="9" width="11" height="11" rx="1.5" />
                <path d="M5 15V5a1.5 1.5 0 0 1 1.5-1.5H15" />
              </svg>
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded text-slate-500 hover:bg-slate-100">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
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
