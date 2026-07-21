import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';

// The default Image node only carries src/alt/title. Extend it so the
// Insert/Edit Image dialog can set width and height too.
const SizedImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: null },
      height: { default: null },
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
import { EditorToolbar } from './EditorToolbar';

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
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /** Whether this field owns the toolbar right now. */
  active: boolean;
  /** Called when the field gains focus, to claim the toolbar. */
  onActivate: () => void;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
      Underline,
      Link.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener' } }),
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
    },
  });

  if (!editor) return <div className="h-64 animate-pulse bg-slate-50" />;

  // Toolbar is always visible on rich fields. Focus-based show/hide proved
  // fragile under React StrictMode (the editor is torn down and rebuilt, so
  // focus listeners land on stale instances); a persistent toolbar is the
  // reliable choice. `active`/`onActivate` remain in the props for a future
  // collapse-on-blur pass but are not gating the toolbar today.
  void active;
  void onActivate;
  return (
    <div>
      <EditorToolbar editor={editor} />
      <div className="rt-body">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
