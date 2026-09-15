import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';

// The default Image node only carries src/alt/title. Extend it so the
// Insert/Edit Image dialog can set width and height, and so a library image
// dragged into content keeps a `data-full-name` reference to its full-size
// original. `src` is ALSO the full-size original — an inline image in the
// article body is the actual content, not a picker thumbnail, so it must not
// be capped at the library's 250px preview size (that cap is only correct for
// small UI like the Files grid/file cards). `data-full-name` is redundant with
// `src` today but stays: the image-edit tool (rotate/crop) reads it as the
// authoritative source to fetch, and older content saved before this fix may
// still have a real thumbnail in `src` with the original only in this attribute.
const SizedImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: null },
      height: { default: null },
      dataFullName: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-full-name'),
        renderHTML: (attrs) => (attrs.dataFullName ? { 'data-full-name': attrs.dataFullName } : {}),
      },
    };
  },

  // Render the image inside a resize frame (four draggable corner handles, shown
  // only when the image is selected) — matching the reference. Serialization still
  // goes through renderHTML (a bare <img>), so this only affects editing.
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const img = document.createElement('img');
      const paint = (n: typeof node) => {
        const a = n.attrs as Record<string, string | null>;
        img.src = a.src ?? '';
        img.alt = a.alt ?? '';
        if (a.title) img.title = String(a.title); else img.removeAttribute('title');
        for (const [k, v] of [['width', a.width], ['height', a.height], ['data-full-name', a.dataFullName]] as const) {
          if (v) img.setAttribute(k, String(v)); else img.removeAttribute(k);
        }
      };
      paint(node);
      const frame = buildImageFrame(img, () => (typeof getPos === 'function' ? getPos() : undefined), editor);
      return {
        dom: frame.dom,
        update: (updated) => {
          if (updated.type.name !== 'image') return false;
          paint(updated);
          return true;
        },
        destroy: () => frame.destroy(),
      };
    };
  },
});

// The Link mark carries href/target/rel by default; add `title` so the
// Insert/Edit Link dialog's Title field round-trips. `href` itself is
// overridden to refuse to render an unsafe scheme (javascript:, data:, …) —
// this is the guaranteed backstop regardless of how the href got set
// (LinkDialog, a pasted <a>, or the Source Code modal): a mark that somehow
// holds a bad href still can't reach the stored/rendered HTML.
const TitledLink = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      title: { default: null },
      href: {
        ...(this.parent?.() as Record<string, unknown> | undefined)?.href as object | undefined,
        renderHTML: (attributes: Record<string, unknown>) => {
          const href = attributes.href;
          return typeof href === 'string' && isSafeUrl(href) ? { href } : {};
        },
      },
    };
  },
});
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import { TableRowWithProps, TableCellWithProps, TableHeaderWithProps, type RowProps, type CellProps } from './editor-table-props';
import Youtube from '@tiptap/extension-youtube';
import { Placeholder } from '@tiptap/extensions';
import Superscript from '@tiptap/extension-superscript';
import Subscript from '@tiptap/extension-subscript';
import FontFamily from '@tiptap/extension-font-family';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { FontSize, LineHeight, Div, Indent, GenericEmbed, embedNodeView, isSafeUrl } from './editor-extensions';
import { TableOfContents } from './editor-toc';
import { Figure } from './editor-figure';
import { TableWithProps, type TableProps } from './editor-table-props';
// Table/Row/Cell Properties are opened rarely — lazy, like EditImageModal.
const TablePropsDialog = lazy(() => import('./TablePropsDialog').then((m) => ({ default: m.TablePropsDialog })));
const RowPropsDialog = lazy(() => import('./RowPropsDialog').then((m) => ({ default: m.RowPropsDialog })));
const CellPropsDialog = lazy(() => import('./CellPropsDialog').then((m) => ({ default: m.CellPropsDialog })));
import { KeywordHighlight, keywordHighlightKey } from './editor-keyword-highlight';
import { buildImageFrame } from './editor-image-resize';
import { EditorToolbar } from './EditorToolbar';
import { ImageDialog, type ImageValue } from './ImageDialog';
import { uploadDerivedImage, uploadLibraryFile, type DerivedImage } from '../lib/upload';
import { rotateImageToBlob } from '../lib/image-edit';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type StoredFile } from '../lib/api';
import { useItemId } from '../lib/item-context';

// filerobot is heavy — lazy-load the Edit Image modal so it (and filerobot) stay
// out of the main bundle and only load when the editor is opened.
const EditImageModal = lazy(() => import('./EditImageModal'));

/**
 * A rich-text field. Every extension here is MIT-licensed — the paid Tiptap
 * features (comments, version history, track changes, collaboration) are
 * Phase 2 and will be built on prosemirror-changeset and our own tables
 * rather than bought.
 */
export function RichTextField({
  value,
  onChange,
  placeholder,
  active,
  onActivate,
  docTitle,
  projectId,
  onAttachFile,
  highlightKeywords,
  editable = true,
  fieldId,
  scrollable = false,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /** The field's id — so the selection "comment" action can anchor a text comment. */
  fieldId?: string;
  /** Whether this field owns the toolbar right now. */
  active: boolean;
  /** Called when the field gains focus, to claim the toolbar. */
  onActivate: () => void;
  /** When false, the field is locked (item in a read-only status): no toolbar,
   *  the content is displayed but not editable. */
  editable?: boolean;
  /** Item name — printed/previewed as the document title. */
  docTitle?: string;
  /** Project the item belongs to — needed to upload rotated/edited/pasted images. */
  projectId?: string;
  /** Attach a pasted image (now a library file) to the item's Files field. */
  onAttachFile?: (file: StoredFile) => void;
  /** Keywords to highlight in the body (CONTROLS › "Highlight in text"). */
  highlightKeywords?: string[];
  /** Give the editor body a fixed height with its own scrollbar (main content). */
  scrollable?: boolean;
}) {
  // Fullscreen is an editor-only overlay (the field fills the viewport), not
  // the browser's native fullscreen — matching the reference's behaviour.
  const [fullscreen, setFullscreen] = useState(false);
  const bubbleKey = useId(); // unique BubbleMenu plugin key per field instance
  // handlePaste lives inside the editor (created once); read the latest
  // projectId/onAttachFile through a ref so it isn't stale.
  const pasteCtx = useRef({ projectId, onAttachFile });
  pasteCtx.current = { projectId, onAttachFile };
  // Inline image editing state.
  const [busy, setBusy] = useState(false); // an upload (rotate/edit) is in flight
  const [editSrc, setEditSrc] = useState<string | null>(null); // Edit Image modal source
  const [imgDialog, setImgDialog] = useState<ImageValue | null>(null); // Insert/Edit Image
  const [tableProps, setTableProps] = useState<TableProps | null>(null); // Table Properties
  const [rowProps, setRowProps] = useState<RowProps | null>(null); // Row Properties
  const [cellProps, setCellProps] = useState<CellProps | null>(null); // Cell Properties
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null); // image right-click menu

  const editor = useEditor({
    extensions: [
      // v3's StarterKit now bundles Underline and Link by default (both named
      // the same as our own explicit extensions below — TitledLink customizes
      // Link's href/title handling) — disabled here so ours are the only ones
      // registered, not silently overridden by array order.
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] }, underline: false, link: false }),
      Div,
      Underline,
      TitledLink.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener' } }),
      // inline:true so an image lives inside a paragraph and serialises as
      // <p><img></p> — matching the reference (their image is an inline node).
      SizedImage.configure({ inline: true }),
      Figure,
      // showOnlyCurrent:false so empty fields show the placeholder even when
      // not focused — otherwise an untouched field looks blank.
      Placeholder.configure({
        placeholder: placeholder ?? 'Start writing…',
        showOnlyCurrent: false,
      }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TextStyle,
      Color,
      FontFamily.configure({ types: ['textStyle'] }),
      FontSize,
      LineHeight,
      Indent,
      Superscript,
      Subscript,
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight.configure({ multicolor: true }),
      TableWithProps.configure({ resizable: true }),
      TableRowWithProps,
      TableHeaderWithProps,
      TableCellWithProps,
      // A YouTube iframe is a separate document, so clicking it almost never
      // reaches ProseMirror to select the node — Backspace/Delete then has
      // nothing to act on. addNodeView layers a real "delete" button above
      // the iframe (see embedNodeView's doc comment) so it's always removable.
      Youtube.extend({ addNodeView: () => embedNodeView }).configure({ controls: true, nocookie: true }),
      GenericEmbed,
      TableOfContents,
      KeywordHighlight,
    ],
    // v3 defaults this to false (a perf opt-in elsewhere). The toolbar reads
    // editor.isActive(...)/editor.can()... directly during render (bold/italic/
    // alignment button highlighting, disabled states) rather than through
    // useEditorState, so it needs a re-render on every transaction — not just
    // ones that change content — to stay in sync with the cursor/selection.
    // This restores v2's actual default behavior; no functional change.
    shouldRerenderOnTransaction: true,
    content: value,
    editable,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        // Height is controlled by the wrapper below (short when idle, taller
        // when editing), so no fixed min-height here.
        class:
          'prose-editor px-6 py-4 focus:outline-none text-[17px] leading-relaxed text-slate-800',
      },
      // Insert an image dropped from the Files field at the drop point. The card
      // carries its URL under our own MIME type; a normal internal node move
      // (moved=true) is left to ProseMirror.
      handleDrop: (view, event, _slice, moved) => {
        if (!view.editable || moved) return false;
        const raw = event.dataTransfer?.getData('application/x-cw-image');
        if (!raw) return false;
        let data: { url?: string; name?: string; fullName?: string };
        try {
          data = JSON.parse(raw);
        } catch {
          return false;
        }
        if (!data.url) return false;
        const imageType = view.state.schema.nodes.image;
        const paraType = view.state.schema.nodes.paragraph;
        if (!imageType || !paraType) return false;
        event.preventDefault();
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from;
        // src = the full-size original (fullName), so the embedded image isn't
        // capped at the library's 250px preview; data-full-name mirrors it for
        // the edit tool. The image is inline, so drop it inside its own
        // paragraph → its own line.
        const src = data.fullName || data.url || '';
        const img = imageType.create({ src, alt: data.name ?? '', dataFullName: data.fullName ?? null });
        view.dispatch(view.state.tr.insert(at, paraType.create(null, img)));
        return true;
      },
      // Paste an image from the clipboard (e.g. a screenshot): upload it as a
      // library file, attach it to the item's Files field, and insert it inline —
      // instead of embedding a huge base64 blob in the content.
      handlePaste: (view, event) => {
        if (!view.editable) return false;
        const { projectId: pid, onAttachFile: attach } = pasteCtx.current;
        const items = event.clipboardData?.items;
        if (!items || !pid) return false;
        const imageItem = Array.from(items).find((it) => it.kind === 'file' && it.type.startsWith('image/'));
        const file = imageItem?.getAsFile();
        if (!file) return false; // not an image paste — let the default handle it
        event.preventDefault();
        void (async () => {
          try {
            const lib = await uploadLibraryFile(pid, file, file.name || 'pasted-image.png');
            attach?.({ id: lib.id, name: lib.name, mime: lib.mime, sizeBytes: lib.sizeBytes });
            const imageType = view.state.schema.nodes.image;
            const paraType = view.state.schema.nodes.paragraph;
            if (imageType && paraType) {
              const img = imageType.create({ src: lib.fullUrl ?? lib.url ?? '', alt: '', dataFullName: lib.fullUrl });
              // Inline image in its own paragraph → its own line, not inline with text.
              view.dispatch(view.state.tr.replaceSelectionWith(paraType.create(null, img)));
            }
          } catch {
            /* nothing inserted on failure */
          }
        })();
        return true;
      },
      // Right-click an image → a small "Image… / Edit image" menu (the reference's
      // context menu). Selects the image first so both actions target it.
      handleDOMEvents: {
        contextmenu: (view, event) => {
          if (!view.editable) return false;
          const target = event.target as HTMLElement | null;
          if (!target || target.tagName !== 'IMG' || !view.dom.contains(target)) return false;
          event.preventDefault();
          try {
            const pos = view.posAtDOM(target, 0);
            view.dispatch(view.state.tr.setSelection(NodeSelection.near(view.state.doc.resolve(pos))));
          } catch {
            /* leave selection as-is */
          }
          setCtxMenu({ x: event.clientX, y: event.clientY });
          return true;
        },
      },
    },
  });

  // Esc leaves fullscreen.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  // Reflect the read-only lock: TipTap keeps its own editable flag, so update it
  // when the prop changes (e.g. the item moves into/out of a read-only status, or
  // a collaboration soft-lock). Pass emitUpdate=false — the default emits a phantom
  // 'update' event, which fires onChange → a spurious autosave AND (with the soft-
  // lock) a fake "I'm editing" broadcast, which ping-ponged and locked BOTH windows.
  useEffect(() => {
    editor?.setEditable(editable, false);
  }, [editor, editable]);

  // Push the active highlight keywords into the editor's decoration plugin.
  // Joined into a stable string so the effect only fires when they actually change.
  const kwSig = (highlightKeywords ?? []).join(' ');
  useEffect(() => {
    if (!editor) return;
    editor.view.dispatch(editor.state.tr.setMeta(keywordHighlightKey, { keywords: highlightKeywords ?? [] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, kwSig]);

  if (!editor) return <div className="h-64 animate-pulse bg-slate-50" />;

  // The image-bearing node under the cursor — a plain image or a captioned figure
  // — and its attributes, so rotate/edit/insert work on either.
  const activeImage = (): { type: 'image' | 'figure'; attrs: Record<string, unknown> } | null => {
    if (editor.isActive('figure')) return { type: 'figure', attrs: editor.getAttributes('figure') };
    if (editor.isActive('image')) return { type: 'image', attrs: editor.getAttributes('image') };
    return null;
  };

  // Point the selected image/figure at the freshly-uploaded (rotated/edited)
  // derived image: src → the full-size result (not the 250px preview), data-
  // full-name mirrors it. Derived images aren't added to the Files library
  // (only originals show there).
  const applyNewFile = (img: DerivedImage) => {
    const newSrc = img.fullUrl || img.url || '';
    const type = editor.isActive('figure') ? 'figure' : 'image';
    const swap = () => {
      editor.chain().focus().updateAttributes(type, { src: newSrc, dataFullName: img.fullUrl || null, width: null, height: null }).run();
    };
    if (!newSrc) return swap();
    // Preload the new image, THEN swap — so the src change is instant and the image
    // never blanks out mid-rotate (updates in place, like the reference).
    // (document.createElement, not `new Image()` — Image is the TipTap node here.)
    const pre = document.createElement('img');
    pre.onload = swap;
    pre.onerror = swap;
    pre.src = newSrc;
  };

  // The best source to edit is the full-size original (data-full-name); fall back
  // to the displayed src for images that carry no reference.
  const imageSource = () => {
    const a = activeImage()?.attrs ?? {};
    return (a.dataFullName as string) || (a.src as string) || '';
  };

  const rotate = async (degrees: 90 | -90) => {
    if (!projectId || busy) return;
    const source = imageSource();
    if (!source) return;
    setBusy(true);
    try {
      const blob = await rotateImageToBlob(source, degrees);
      const alt = (activeImage()?.attrs.alt as string) || 'image.png';
      applyNewFile(await uploadDerivedImage(projectId, blob, alt.endsWith('.png') ? alt : `${alt}.png`));
    } catch {
      /* leave the image as-is on failure */
    } finally {
      setBusy(false);
    }
  };

  const openImgDialog = () => {
    const active = activeImage();
    const a = active?.attrs ?? {};
    setImgDialog({
      src: (a.src as string) || '',
      alt: (a.alt as string) || '',
      width: a.width != null ? String(a.width) : '',
      height: a.height != null ? String(a.height) : '',
      showCaption: active?.type === 'figure',
      fullSrc: (a.dataFullName as string) || '',
    });
  };

  // Upload for the Insert/Edit dialog's Upload tab (derived — not added to Files).
  // An explicit upload from the Insert Image dialog is a real library file, so
  // it also shows up in the project's Files section (unlike rotated/edited
  // images, which stay derived-only). Refresh the files cache so it appears
  // right away in the Files section and the "select an image" picker.
  const qc = useQueryClient();
  const uploadForDialog = projectId
    ? async (file: File) => {
        const f = await uploadLibraryFile(projectId, file, file.name || 'image.png');
        void qc.invalidateQueries({ queryKey: ['files', projectId] });
        return { url: f.url ?? f.fullUrl ?? '', fullUrl: f.fullUrl ?? '' };
      }
    : undefined;

  // Images LINKED to the current content item — offered in the image dialog's
  // "Please select an image" picker (the file section itself lists all project
  // images; the picker is scoped to this item, per EC).
  const itemId = useItemId();
  const filesQuery = useQuery({
    queryKey: ['files', projectId],
    queryFn: () => api.listFiles(projectId!),
    enabled: !!projectId,
  });
  const linkedImages = (filesQuery.data ?? [])
    .filter((f) => (f.mime ?? '').startsWith('image/') && f.fullUrl
      && !!itemId && f.linkedItems.some((li) => li.id === itemId))
    .map((f) => ({ url: f.url ?? f.fullUrl!, fullUrl: f.fullUrl!, name: f.name, uploadedAt: f.createdAt, sizeBytes: f.sizeBytes }));

  // Files LINKED to the current content item — offered in the Insert/Edit Link
  // dialog's "Browse files" picker (any type, not just images: a link can point
  // at a PDF, a doc, anything attached here), same scoping as linkedImages above.
  const linkedFiles = (filesQuery.data ?? [])
    .filter((f) => f.fullUrl && !!itemId && f.linkedItems.some((li) => li.id === itemId))
    .map((f) => ({
      url: f.fullUrl!, name: f.name, mime: f.mime,
      thumbUrl: (f.mime ?? '').startsWith('image/') ? (f.url ?? f.fullUrl!) : null,
      uploadedAt: f.createdAt, sizeBytes: f.sizeBytes,
    }));

  // The wrapping <figure> node (if the cursor is inside one) and its position.
  const findFigure = () => {
    const { $from } = editor.state.selection;
    for (let d = $from.depth; d >= 0; d--) {
      if ($from.node(d).type.name === 'figure') return { node: $from.node(d), pos: $from.before(d) };
    }
    return null;
  };

  // Apply the Insert/Edit dialog. Toggling "Show caption" converts a plain image
  // into a captioned <figure> (or back), preserving the image attributes.
  const applyImgDialog = (v: ImageValue) => {
    const active = activeImage();
    const attrs = { src: v.src, alt: v.alt, width: v.width || null, height: v.height || null, dataFullName: v.fullSrc || null };
    const { state } = editor;
    const figureType = editor.schema.nodes.figure;
    const imageType = editor.schema.nodes.image;
    if (v.showCaption && active?.type !== 'figure' && figureType) {
      const fig = figureType.create(attrs, editor.schema.text('Caption'));
      editor.view.dispatch(state.tr.replaceWith(state.selection.from, state.selection.to, fig).scrollIntoView());
    } else if (!v.showCaption && active?.type === 'figure' && imageType) {
      const wrap = findFigure();
      if (wrap) {
        editor.view.dispatch(state.tr.replaceWith(wrap.pos, wrap.pos + wrap.node.nodeSize, imageType.create(attrs)).scrollIntoView());
      }
    } else {
      editor.chain().focus().updateAttributes(active?.type ?? 'image', attrs).run();
    }
    setImgDialog(null);
  };

  // Table properties: read the active table's attributes into the dialog, and
  // apply the edited values back onto the table node.
  const openTableProps = () => {
    const a = editor.getAttributes('table');
    setTableProps({
      tblWidth: (a.tblWidth as string) ?? '100%',
      tblHeight: (a.tblHeight as string) ?? '',
      tblCellSpace: (a.tblCellSpace as string) ?? '',
      tblCellPad: (a.tblCellPad as string) ?? '',
      tblBorder: (a.tblBorder as string) ?? '1',
      tblAlign: (a.tblAlign as string) ?? '',
      tblBorderColor: (a.tblBorderColor as string) ?? '',
      tblBorderStyle: (a.tblBorderStyle as string) ?? '',
      tblBg: (a.tblBg as string) ?? '',
    });
  };
  const applyTableProps = (v: TableProps) => {
    editor.chain().focus().updateAttributes('table', {
      tblWidth: v.tblWidth.trim() || null,
      tblHeight: v.tblHeight.trim() || null,
      tblCellSpace: v.tblCellSpace.trim() || null,
      tblCellPad: v.tblCellPad.trim() || null,
      tblBorder: v.tblBorder.trim() || null,
      tblAlign: v.tblAlign || null,
      tblBorderColor: v.tblBorderColor.trim() || null,
      tblBorderStyle: v.tblBorderStyle || null,
      tblBg: v.tblBg.trim() || null,
    }).run();
    setTableProps(null);
  };

  // Row properties: the enclosing <tr>'s attributes.
  const openRowProps = () => {
    const a = editor.getAttributes('tableRow');
    setRowProps({ rowBg: (a.rowBg as string) ?? '', rowHeight: (a.rowHeight as string) ?? '' });
  };
  const applyRowProps = (v: RowProps) => {
    editor.chain().focus().updateAttributes('tableRow', {
      rowBg: v.rowBg.trim() || null,
      rowHeight: v.rowHeight.trim() || null,
    }).run();
    setRowProps(null);
  };

  // Cell properties: applies to whichever of tableCell/tableHeader the
  // selection is actually in (and to every cell in a multi-cell selection).
  const openCellProps = () => {
    const a = { ...editor.getAttributes('tableHeader'), ...editor.getAttributes('tableCell') };
    setCellProps({ cellBg: (a.cellBg as string) ?? '', cellVAlign: (a.cellVAlign as string) ?? '' });
  };
  const applyCellProps = (v: CellProps) => {
    const attrs = { cellBg: v.cellBg.trim() || null, cellVAlign: v.cellVAlign || null };
    editor.chain().focus().updateAttributes('tableCell', attrs).updateAttributes('tableHeader', attrs).run();
    setCellProps(null);
  };

  // Which alignment mechanism applies to the currently-selected image — see
  // the long comment at the Align buttons below for why these differ.
  const isFigure = editor.isActive('figure');
  const figureAlign = editor.getAttributes('figure').align as string | null;
  const setImageAlign = (value: 'left' | 'center' | 'right') => {
    if (editor.isActive('figure')) {
      editor.chain().focus().updateAttributes('figure', { align: value === 'left' ? null : value }).run();
    } else {
      editor.chain().focus().setTextAlign(value).run();
    }
  };

  // Toolbar is always visible on rich fields. Focus-based show/hide proved
  // fragile under React StrictMode (the editor is torn down and rebuilt, so
  // focus listeners land on stale instances); a persistent toolbar is the
  // reliable choice. `active`/`onActivate` remain in the props for a future
  // collapse-on-blur pass but are not gating the toolbar today.
  void active;
  void onActivate;
  return (
    <div className={fullscreen ? 'fixed inset-0 z-[60] flex flex-col bg-white' : ''}>
      {/* The two BubbleMenus below get their DOM element appendChild'd elsewhere
          by Tiptap's bubble-menu plugin (the editor view's parent element, by
          default — see @tiptap/extension-bubble-menu), so any CONDITIONAL
          sibling rendered BEFORE them (e.g. the toolbar, which only mounts when
          editable) makes React insertBefore against a node that is no longer a
          child of this div → "Failed to execute 'insertBefore'". The toolbar is
          therefore rendered AFTER the BubbleMenus (its insertion reference
          becomes the stable .rt-body div). The plugin relocates the menus itself,
          so this reorder does not change what the user sees. */}

      {/* Floating toolbar over a selected image: rotate ×2 · Edit Image ·
          Insert/Edit · Delete. Low z-index (40) so any dialog/editor (z-50+)
          covers it instead of it floating on top; kept mounted so the buttons
          stay reliably clickable. Deleting is also just Backspace/Delete on
          the keyboard once the image is selected, but that's not discoverable —
          this button is the only visible way to remove an image, matching the
          table bubble menu's own "Delete table" button below. */}
      <BubbleMenu
        editor={editor}
        pluginKey={`image-bubble-${bubbleKey}`}
        shouldShow={({ editor }: { editor: Editor }) => editable && (editor.isActive('image') || editor.isActive('figure'))}
        options={{ placement: 'top' }}
        style={{ zIndex: 40 }}
      >
        <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          {/* Positions the selected image within its line. A plain image is
              inline inside a paragraph, so this is the paragraph's own
              text-align (setTextAlign — same command the toolbar's Alignment
              dropdown uses). A captioned image (figure) is its own top-level
              block with no paragraph to inherit alignment from — and
              text-align wouldn't move it even if it had one, since figure is
              `display: table`, not inline — so it gets its own `align`
              attribute instead (editor-figure.ts), applied as real margins
              in CSS. Lives here, not just in that far-off dropdown, since
              this is where people actually look right after selecting an
              image. */}
          <ImgBtn title="Align left" active={isFigure ? !figureAlign || figureAlign === 'left' : editor.isActive({ textAlign: 'left' })}
                  onClick={() => setImageAlign('left')}>
            <path d="M3 6h18M3 12h12M3 18h16" />
          </ImgBtn>
          <ImgBtn title="Align center" active={isFigure ? figureAlign === 'center' : editor.isActive({ textAlign: 'center' })}
                  onClick={() => setImageAlign('center')}>
            <path d="M3 6h18M6 12h12M4 18h16" />
          </ImgBtn>
          <ImgBtn title="Align right" active={isFigure ? figureAlign === 'right' : editor.isActive({ textAlign: 'right' })}
                  onClick={() => setImageAlign('right')}>
            <path d="M3 6h18M9 12h12M5 18h16" />
          </ImgBtn>
          <span className="mx-1 h-6 w-px bg-slate-200" />
          <ImgBtn title="Rotate left" onClick={() => void rotate(-90)} disabled={busy || !projectId}>
            <path d="M3 8a9 9 0 1 0 3-6.7L3 4" /><path d="M3 1v3h3" />
          </ImgBtn>
          <ImgBtn title="Rotate right" onClick={() => void rotate(90)} disabled={busy || !projectId}>
            <path d="M21 8A9 9 0 1 1 18 1.3L21 4" /><path d="M21 1v3h-3" />
          </ImgBtn>
          <span className="mx-1 h-6 w-px bg-slate-200" />
          <ImgBtn title="Edit image" onClick={() => setEditSrc(imageSource())} disabled={busy || !projectId}>
            <rect x="3" y="3" width="18" height="18" rx="2" /><path d="m8 13 2.5-3 3 4 2-2.5L21 17" /><circle cx="8.5" cy="8.5" r="1.5" />
          </ImgBtn>
          <ImgBtn title="Insert/edit image" onClick={openImgDialog}>
            <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" />
          </ImgBtn>
          <span className="mx-1 h-6 w-px bg-slate-200" />
          <ImgBtn title="Delete image" onClick={() => editor.chain().focus().deleteSelection().run()}>
            <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
          </ImgBtn>
        </div>
      </BubbleMenu>

      {/* Floating table toolbar (shown while the cursor is in a table): table
          properties · delete table · insert/delete row · insert/delete column —
          matching the reference. Every action is a built-in Tiptap command. */}
      <BubbleMenu
        editor={editor}
        pluginKey={`table-bubble-${bubbleKey}`}
        shouldShow={({ editor }: { editor: Editor }) => editable && editor.isActive('table')}
        options={{ placement: 'top' }}
        style={{ zIndex: 40 }}
      >
        <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          <ImgBtn title="Table properties" onClick={openTableProps}>
            <rect x="3" y="3" width="18" height="18" rx="1.5" /><path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
          </ImgBtn>
          <ImgBtn title="Delete table" onClick={() => editor.chain().focus().deleteTable().run()}>
            <rect x="3" y="3" width="18" height="18" rx="1.5" /><path d="m8.5 8.5 7 7m0-7-7 7" />
          </ImgBtn>
          <span className="mx-1 h-6 w-px bg-slate-200" />
          <ImgBtn title="Insert row above" onClick={() => editor.chain().focus().addRowBefore().run()}>
            <rect x="4" y="13" width="16" height="8" rx="1.5" /><path d="M12 10V3m-3 3 3-3 3 3" />
          </ImgBtn>
          <ImgBtn title="Insert row below" onClick={() => editor.chain().focus().addRowAfter().run()}>
            <rect x="4" y="3" width="16" height="8" rx="1.5" /><path d="M12 14v7m-3-3 3 3 3-3" />
          </ImgBtn>
          <ImgBtn title="Delete row" onClick={() => editor.chain().focus().deleteRow().run()}>
            <rect x="4" y="8" width="16" height="8" rx="1.5" /><path d="m10 10 4 4m0-4-4 4" />
          </ImgBtn>
          <span className="mx-1 h-6 w-px bg-slate-200" />
          <ImgBtn title="Insert column left" onClick={() => editor.chain().focus().addColumnBefore().run()}>
            <rect x="13" y="4" width="8" height="16" rx="1.5" /><path d="M10 12H3m3-3-3 3 3 3" />
          </ImgBtn>
          <ImgBtn title="Insert column right" onClick={() => editor.chain().focus().addColumnAfter().run()}>
            <rect x="3" y="4" width="8" height="16" rx="1.5" /><path d="M14 12h7m-3-3 3 3-3 3" />
          </ImgBtn>
          <ImgBtn title="Delete column" onClick={() => editor.chain().focus().deleteColumn().run()}>
            <rect x="8" y="4" width="8" height="16" rx="1.5" /><path d="m10 10 4 4m0-4-4 4" />
          </ImgBtn>
        </div>
      </BubbleMenu>

      {/* Toolbar stays MOUNTED even in a read-only status — it just greys out and
          stops responding (disabled). Unmounting it would churn the DOM next to
          the portaled BubbleMenus above and can crash React reconciliation
          (the "insertBefore" error), so we toggle disabled instead. */}
      <EditorToolbar
        editor={editor}
        docTitle={docTitle}
        fullscreen={fullscreen}
        onToggleFullscreen={() => setFullscreen((v) => !v)}
        onUpload={uploadForDialog}
        linkedImages={linkedImages}
        linkedFiles={linkedFiles}
        disabled={!editable}
        fieldId={fieldId}
        onOpenTableProps={openTableProps}
        onOpenCellProps={openCellProps}
        onOpenRowProps={openRowProps}
      />

      <div className={`rt-body ${fullscreen ? 'flex-1 overflow-y-auto' : scrollable ? 'max-h-[460px] overflow-y-auto' : ''}`}>
        <EditorContent editor={editor} />
      </div>

      {/* Insert/Edit Image — editing the selected image's src/alt/size. */}
      {imgDialog && (
        <ImageDialog initial={imgDialog} onClose={() => setImgDialog(null)} onSave={applyImgDialog} onUpload={uploadForDialog} linkedImages={linkedImages} />
      )}

      {/* Table/Row/Cell Properties — width/height/border/padding/spacing/
          alignment/colours. Lazy, so the fallback only ever shows for the
          brief moment before the chunk loads. */}
      {(tableProps || rowProps || cellProps) && (
        <Suspense fallback={<div className="fixed inset-0 z-[70] grid place-items-center bg-white/60 text-sm text-slate-500">Loading…</div>}>
          {tableProps && (
            <TablePropsDialog initial={tableProps} onClose={() => setTableProps(null)} onSave={applyTableProps} />
          )}
          {rowProps && (
            <RowPropsDialog initial={rowProps} onClose={() => setRowProps(null)} onSave={applyRowProps} />
          )}
          {cellProps && (
            <CellPropsDialog initial={cellProps} onClose={() => setCellProps(null)} onSave={applyCellProps} />
          )}
        </Suspense>
      )}

      {/* Image right-click menu: Image… (Insert/Edit dialog) · Edit image (editor). */}
      {ctxMenu && (
        <>
          <div className="fixed inset-0 z-[55]" onClick={() => setCtxMenu(null)}
               onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }} />
          <div className="fixed z-[56] w-44 rounded-lg border border-slate-200 bg-white py-1.5 shadow-xl"
               style={{ left: ctxMenu.x, top: ctxMenu.y }}>
            <button type="button" onClick={() => { setCtxMenu(null); openImgDialog(); }}
                    className="flex w-full items-center gap-3 px-4 py-2 text-left text-[14px] text-slate-700 hover:bg-slate-50">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></svg>
              Image…
            </button>
            <button type="button" disabled={!projectId}
                    onClick={() => { setCtxMenu(null); setEditSrc(imageSource()); }}
                    className="flex w-full items-center gap-3 px-4 py-2 text-left text-[14px] text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="m8 13 2.5-3 3 4 2-2.5L21 17" /><circle cx="8.5" cy="8.5" r="1.5" /></svg>
              Edit image
            </button>
          </div>
        </>
      )}

      {/* Edit Image (filerobot) — lazy; on save uploads a new file and repoints. */}
      {editSrc && projectId && (
        <Suspense fallback={<div className="fixed inset-0 z-[70] grid place-items-center bg-white text-sm text-slate-500">Loading editor…</div>}>
          <EditImageModal
            src={editSrc}
            projectId={projectId}
            name={(editor.getAttributes('image').alt as string) || 'image.png'}
            onApplied={applyNewFile}
            onClose={() => setEditSrc(null)}
          />
        </Suspense>
      )}
    </div>
  );
}

/** A small square button used in the image bubble toolbar. */
function ImgBtn({
  title, onClick, disabled, active, children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  // Real hover state, not CSS `group-hover` — these buttons sit only ~8px
  // apart, so a pure-CSS tooltip on each one fades in/out independently as
  // the cursor sweeps across the row, and several overlap mid-transition
  // (the bug this replaces: a garbled stack of every button's label at
  // once). State means exactly one tooltip is ever mounted.
  const [hovered, setHovered] = useState(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        aria-label={title}
        // Keep the image selected — stop the editor blurring on button mousedown, so
        // the handlers still see the selected image (src/attrs).
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        disabled={disabled}
        aria-pressed={active}
        className={`grid h-8 w-8 place-items-center rounded text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 ${active ? 'bg-slate-200' : ''}`}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          {children}
        </svg>
      </button>
      {/* Instant hover tooltip — the native `title` attribute this replaces
          has a ~1s browser delay before it appears. */}
      {hovered && !disabled && (
        <span role="tooltip"
              className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-800 px-2.5 py-1.5 text-[12px] font-medium text-white shadow-lg">
          {title}
          <span className="absolute bottom-full left-1/2 h-0 w-0 -translate-x-1/2 border-x-4 border-b-4 border-x-transparent border-b-slate-800" />
        </span>
      )}
    </span>
  );
}
