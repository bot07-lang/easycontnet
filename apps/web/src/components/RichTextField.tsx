import { lazy, Suspense, useEffect, useId, useState } from 'react';
import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';

// The default Image node only carries src/alt/title. Extend it so the
// Insert/Edit Image dialog can set width and height, and so a library image
// dragged into content keeps a `data-full-name` reference to its full-size
// original (src holds the lightweight thumbnail) — matching the reference.
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
});

// The Link mark carries href/target/rel by default; add `title` so the
// Insert/Edit Link dialog's Title field round-trips.
const TitledLink = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      title: { default: null },
    };
  },
});
import TextAlign from '@tiptap/extension-text-align';
import TextStyle from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Youtube from '@tiptap/extension-youtube';
import Placeholder from '@tiptap/extension-placeholder';
import Superscript from '@tiptap/extension-superscript';
import Subscript from '@tiptap/extension-subscript';
import FontFamily from '@tiptap/extension-font-family';
import { FontSize, LineHeight, Div, Indent } from './editor-extensions';
import { EditorToolbar } from './EditorToolbar';
import { ImageDialog, type ImageValue } from './ImageDialog';
import { uploadDerivedImage, type DerivedImage } from '../lib/upload';
import { rotateImageToBlob } from '../lib/image-edit';

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
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /** Whether this field owns the toolbar right now. */
  active: boolean;
  /** Called when the field gains focus, to claim the toolbar. */
  onActivate: () => void;
  /** Item name — printed/previewed as the document title. */
  docTitle?: string;
  /** Project the item belongs to — needed to upload rotated/edited images. */
  projectId?: string;
}) {
  // Fullscreen is an editor-only overlay (the field fills the viewport), not
  // the browser's native fullscreen — matching the reference's behaviour.
  const [fullscreen, setFullscreen] = useState(false);
  const bubbleKey = useId(); // unique BubbleMenu plugin key per field instance
  // Inline image editing state.
  const [busy, setBusy] = useState(false); // an upload (rotate/edit) is in flight
  const [editSrc, setEditSrc] = useState<string | null>(null); // Edit Image modal source
  const [imgDialog, setImgDialog] = useState<ImageValue | null>(null); // Insert/Edit Image

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] } }),
      Div,
      Underline,
      TitledLink.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener' } }),
      SizedImage,
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
      Highlight.configure({ multicolor: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Youtube.configure({ controls: true, nocookie: true }),
    ],
    content: value,
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
        if (moved) return false;
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
        if (!imageType) return false;
        event.preventDefault();
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from;
        // src = lightweight thumbnail; data-full-name = the original (full-size).
        const node = imageType.create({ src: data.url, alt: data.name ?? '', dataFullName: data.fullName ?? null });
        view.dispatch(view.state.tr.insert(at, node));
        return true;
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

  if (!editor) return <div className="h-64 animate-pulse bg-slate-50" />;

  // Point the selected image at the freshly-uploaded (rotated/edited) derived
  // image: src → its thumbnail, data-full-name → the full-size. The derived image
  // is NOT added to the Files library (matching the reference — only originals show
  // there), so there's nothing to refresh.
  const applyNewFile = (img: DerivedImage) => {
    const newSrc = img.url || img.fullUrl || '';
    const swap = () => {
      editor
        .chain()
        .focus()
        .updateAttributes('image', { src: newSrc, dataFullName: img.fullUrl || null, width: null, height: null })
        .run();
    };
    if (!newSrc) return swap();
    // Preload the new image, THEN swap — so the src change is instant and the image
    // never blanks out mid-rotate (it updates in place, like the reference).
    // (document.createElement, not `new Image()` — Image is the TipTap node here.)
    const pre = document.createElement('img');
    pre.onload = swap;
    pre.onerror = swap;
    pre.src = newSrc;
  };

  // The best source to edit is the full-size original (data-full-name); fall back
  // to the displayed src for images that carry no reference.
  const imageSource = () => {
    const a = editor.getAttributes('image');
    return (a.dataFullName as string) || (a.src as string) || '';
  };

  const rotate = async (degrees: 90 | -90) => {
    if (!projectId || busy) return;
    const source = imageSource();
    if (!source) return;
    setBusy(true);
    try {
      const blob = await rotateImageToBlob(source, degrees);
      const alt = (editor.getAttributes('image').alt as string) || 'image.png';
      applyNewFile(await uploadDerivedImage(projectId, blob, alt.endsWith('.png') ? alt : `${alt}.png`));
    } catch {
      /* leave the image as-is on failure */
    } finally {
      setBusy(false);
    }
  };

  const openImgDialog = () => {
    const a = editor.getAttributes('image');
    setImgDialog({
      src: (a.src as string) || '',
      alt: (a.alt as string) || '',
      width: a.width != null ? String(a.width) : '',
      height: a.height != null ? String(a.height) : '',
    });
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
      <EditorToolbar
        editor={editor}
        docTitle={docTitle}
        fullscreen={fullscreen}
        onToggleFullscreen={() => setFullscreen((v) => !v)}
      />

      {/* Floating toolbar over a selected image: rotate ×2 · Edit Image · Insert/Edit.
          Low z-index (40) so any dialog/editor (z-50+) covers it instead of it
          floating on top; kept mounted so the buttons stay reliably clickable. */}
      <BubbleMenu
        editor={editor}
        pluginKey={`image-bubble-${bubbleKey}`}
        shouldShow={({ editor }) => editor.isActive('image')}
        tippyOptions={{ placement: 'top', zIndex: 40 }}
      >
        <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
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
        </div>
      </BubbleMenu>

      <div className={`rt-body ${fullscreen ? 'flex-1 overflow-y-auto' : ''}`}>
        <EditorContent editor={editor} />
      </div>

      {/* Insert/Edit Image — editing the selected image's src/alt/size. */}
      {imgDialog && (
        <ImageDialog
          initial={imgDialog}
          onClose={() => setImgDialog(null)}
          onSave={(v) => {
            editor.chain().focus().updateAttributes('image', {
              src: v.src, alt: v.alt, width: v.width || null, height: v.height || null,
            }).run();
            setImgDialog(null);
          }}
        />
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
  title, onClick, disabled, children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      // Keep the image selected — stop the editor blurring on button mousedown, so
      // the handlers still see the selected image (src/attrs).
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      className="grid h-8 w-8 place-items-center rounded text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  );
}
