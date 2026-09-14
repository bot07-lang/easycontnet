import { Extension, Node, mergeAttributes, type CommandProps, type NodeViewRendererProps } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { DOMSerializer } from '@tiptap/pm/model';

/**
 * A plain block container, so Format › Formats › Blocks › Div can wrap content
 * in a <div> (TinyMCE offers this; Tiptap has no div node by default).
 */
export const Div = Node.create({
  name: 'div',
  group: 'block',
  content: 'block+',
  defining: true,
  parseHTML() {
    return [{ tag: 'div' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', HTMLAttributes, 0];
  },
});

/**
 * Two small extensions the Format menu needs that Tiptap v2 doesn't ship
 * officially: font size (a textStyle attribute, mirroring the official v3
 * FontSize) and line height (a block attribute on paragraphs and headings).
 * Both follow Tiptap's own patterns so they parse/serialise round-trip.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
    lineHeight: {
      setLineHeight: (value: string) => ReturnType;
      unsetLineHeight: () => ReturnType;
    };
    indent: {
      indent: () => ReturnType;
      outdent: () => ReturnType;
    };
  }
}

export const FontSize = Extension.create({
  name: 'fontSize',

  addOptions() {
    return { types: ['textStyle'] };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element: HTMLElement) => element.style.fontSize || null,
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.fontSize ? { style: `font-size: ${attributes.fontSize}` } : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontSize:
        (size: string) =>
        ({ chain }: CommandProps) =>
          chain().setMark('textStyle', { fontSize: size }).run(),
      unsetFontSize:
        () =>
        ({ chain }: CommandProps) =>
          chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});

const INDENT_STEP = 40; // px per level — matches the reference's default.
const MAX_INDENT = 8;

/**
 * Indent / outdent that works on any block, not just list items — the toolbar
 * buttons were previously dead on plain paragraphs. Inside a list it sinks/
 * lifts list items; elsewhere it adjusts a left-margin level on the block.
 */
export const Indent = Extension.create({
  name: 'indent',
  // Run our Enter handler before the default split so a new line can drop its
  // inherited indent.
  priority: 1000,

  addOptions() {
    return { types: ['paragraph', 'heading'], minLevel: 0, maxLevel: MAX_INDENT };
  },

  addKeyboardShortcuts() {
    return {
      // A block's `indent` is a node attribute, so splitting it (Enter) copies
      // it onto the new paragraph — leaving the next line indented. Reset it so
      // a fresh line starts at the far left, then fall through for every other
      // case (no indent, code blocks, or a non-collapsed selection).
      //
      // Lists get their own explicit case: pressing Enter on an EMPTY list item
      // (bulleted/numbered, or a task item) should exit the list (lift it to a
      // plain paragraph) instead of adding another item forever. Tiptap's
      // ListItem/TaskItem only bind `splitListItem`, which — for a flat
      // (non-nested) list — deliberately bails on an empty item and expects a
      // lower-priority fallback to lift it out; that fallback doesn't reliably
      // fire in this schema, so we handle it ourselves rather than depend on it.
      Enter: () => {
        const editor = this.editor;
        if (!editor.state.selection.empty) return false;
        const listType = editor.isActive('listItem') ? 'listItem' : editor.isActive('taskItem') ? 'taskItem' : null;
        if (listType) {
          const { $from } = editor.state.selection;
          if ($from.parent.type.name === 'paragraph' && $from.parent.content.size === 0) {
            return editor.chain().focus().liftListItem(listType).run();
          }
          return false;
        }
        if (editor.isActive('codeBlock')) return false;
        const indent = Number(editor.getAttributes('paragraph').indent) || 0;
        if (indent <= 0) return false;
        return editor.chain().splitBlock().updateAttributes('paragraph', { indent: 0 }).run();
      },
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element: HTMLElement) => {
              const ml = parseInt(element.style.marginLeft || '0', 10);
              return ml ? Math.round(ml / INDENT_STEP) : 0;
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              const level = Number(attributes.indent) || 0;
              return level ? { style: `margin-left: ${level * INDENT_STEP}px` } : {};
            },
          },
        },
      },
    ];
  },

  addCommands() {
    const shift = (dir: number) =>
      ({ tr, state, dispatch, editor, commands }: CommandProps) => {
        // Inside a list, indenting nests the list item (native behaviour).
        if (editor.isActive('listItem')) {
          return dir > 0 ? commands.sinkListItem('listItem') : commands.liftListItem('listItem');
        }
        const { from, to } = state.selection;
        let changed = false;
        state.doc.nodesBetween(from, to, (node: PMNode, pos: number) => {
          if (!this.options.types.includes(node.type.name)) return;
          const cur = Number(node.attrs.indent) || 0;
          const next = Math.min(this.options.maxLevel, Math.max(this.options.minLevel, cur + dir));
          if (next !== cur) {
            if (dispatch) tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
            changed = true;
          }
        });
        return changed;
      };
    return {
      indent: () => shift(1),
      outdent: () => shift(-1),
    };
  },
});

export const LineHeight = Extension.create({
  name: 'lineHeight',

  addOptions() {
    return { types: ['paragraph', 'heading'] };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (element: HTMLElement) => element.style.lineHeight || null,
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.lineHeight ? { style: `line-height: ${attributes.lineHeight}` } : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setLineHeight:
        (value: string) =>
        ({ commands }: CommandProps) =>
          this.options.types.every((type: string) => commands.updateAttributes(type, { lineHeight: value })),
      unsetLineHeight:
        () =>
        ({ commands }: CommandProps) =>
          this.options.types.every((type: string) => commands.resetAttributes(type, 'lineHeight')),
    };
  },
});

/**
 * A hover-revealed "delete" button on top of an embedded iframe (YouTube,
 * generic oEmbed). Plain click-to-select-then-Backspace doesn't work here:
 * the iframe is a separate document, so almost every pixel of it swallows
 * the click before ProseMirror ever sees it, leaving no way to select —
 * and therefore no way to delete — the node. The button is a real sibling
 * DOM element layered above the iframe, so it always receives the click.
 * Reused by both `GenericEmbed` below and the `Youtube` extension (which is
 * extended with this node view in RichTextField.tsx). Builds the iframe via
 * the node's own compiled `toDOM` (i.e. its normal `renderHTML`), so nothing
 * about the embed's markup — YouTube's URL-building included — is duplicated
 * or can drift from the extension that owns it.
 */
export function embedNodeView({ node, editor, getPos }: NodeViewRendererProps) {
  const outputSpec = node.type.spec.toDOM!(node);
  const { dom: content } = DOMSerializer.renderSpec(document, outputSpec) as { dom: HTMLElement };

  const wrapper = document.createElement('div');
  wrapper.style.position = 'relative';
  wrapper.style.display = 'inline-block';
  wrapper.style.maxWidth = '100%';
  wrapper.contentEditable = 'false';
  // A custom node view's DOM doesn't automatically pick up the node spec's
  // `draggable`, unlike default (non-nodeView) rendering — set it explicitly
  // so drag-to-reposition keeps working (it did before this node view existed).
  wrapper.draggable = Boolean(node.type.spec.draggable);
  wrapper.appendChild(content);

  // The iframe covers the entire box, so a mousedown almost anywhere on the
  // video is swallowed by its own document before a native drag can start —
  // `wrapper.draggable` above has nowhere to actually grab. This handle is a
  // real DOM element stacked above the iframe (like the delete button) so
  // there's always a spot outside the iframe to press and drag from.
  const dragHandle = document.createElement('div');
  dragHandle.draggable = true;
  dragHandle.title = 'Drag to reposition';
  dragHandle.setAttribute('aria-label', 'Drag to reposition');
  dragHandle.style.cssText =
    'position:absolute;top:8px;left:8px;width:28px;height:28px;border-radius:6px;' +
    'border:1px solid #cbd5e1;background:#fff;color:#334155;cursor:grab;' +
    'display:none;align-items:center;justify-content:center;' +
    'box-shadow:0 1px 3px rgba(0,0,0,.15);z-index:1;';
  dragHandle.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 8h16M4 16h16"/></svg>';
  wrapper.appendChild(dragHandle);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.title = 'Delete video';
  deleteBtn.setAttribute('aria-label', 'Delete video');
  // Opt out of the wrapper's draggable:true so pressing this button starts a
  // click, not a whole-node drag.
  deleteBtn.draggable = false;
  deleteBtn.textContent = '×';
  deleteBtn.style.cssText =
    'position:absolute;top:8px;right:8px;width:28px;height:28px;border-radius:6px;' +
    'border:1px solid #cbd5e1;background:#fff;color:#334155;cursor:pointer;' +
    'font-size:18px;line-height:1;display:none;align-items:center;justify-content:center;' +
    'box-shadow:0 1px 3px rgba(0,0,0,.15);z-index:1;';
  deleteBtn.addEventListener('mousedown', (e) => e.preventDefault());
  deleteBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const pos = getPos();
    if (typeof pos !== 'number') return;
    editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
  });
  wrapper.appendChild(deleteBtn);

  // Four corner resize handles, matching the image resize frame
  // (editor-image-resize.ts) — same visuals (`.cw-resize-handle` CSS), same
  // drag-and-commit behaviour. That one shows handles via the
  // `.ProseMirror-selectednode` CSS selector, which relies on the node
  // actually being click-selected — not reliable here for the same
  // iframe-swallows-the-click reason the delete button exists, so visibility
  // is driven by the same hover toggle as the other controls instead.
  const iframeEl = (content.tagName === 'IFRAME' ? content : content.querySelector('iframe')) as HTMLIFrameElement | null;
  const resizeHandles: HTMLElement[] = [];
  if (iframeEl) {
    for (const corner of ['nw', 'ne', 'sw', 'se'] as const) {
      const handle = document.createElement('span');
      handle.className = `cw-resize-handle cw-resize-${corner}`;
      // Pointer capture (not plain mousemove/mouseup on `document`) because the
      // cursor drags back over the iframe while resizing — a mouseup released
      // there fires inside the iframe's own document and never reaches a
      // `document`-level listener, so the drag would never end (the "keeps
      // moving with the cursor" bug). Capturing the pointer on the handle
      // itself keeps every event routed to it no matter what's under the
      // cursor.
      handle.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        handle.setPointerCapture(event.pointerId);
        const startX = event.clientX;
        const rect = iframeEl.getBoundingClientRect();
        const startW = rect.width;
        const ratio = rect.height > 0 ? rect.width / rect.height : 16 / 9;
        const east = corner === 'ne' || corner === 'se';
        const onMove = (move: PointerEvent) => {
          const dx = move.clientX - startX;
          const w = Math.max(160, Math.round(startW + (east ? dx : -dx)));
          iframeEl.style.width = `${w}px`;
          iframeEl.style.height = `${Math.round(w / ratio)}px`;
        };
        const onUp = (up: PointerEvent) => {
          handle.releasePointerCapture(up.pointerId);
          handle.removeEventListener('pointermove', onMove);
          handle.removeEventListener('pointerup', onUp);
          handle.removeEventListener('pointercancel', onUp);
          const w = Math.round(iframeEl.getBoundingClientRect().width);
          const h = Math.round(w / ratio);
          const pos = getPos();
          if (typeof pos !== 'number') return;
          const { state, dispatch } = editor.view;
          const liveNode = state.doc.nodeAt(pos);
          if (!liveNode) return;
          dispatch(state.tr.setNodeMarkup(pos, undefined, { ...liveNode.attrs, width: w, height: h }));
        };
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
        handle.addEventListener('pointercancel', onUp);
      });
      wrapper.appendChild(handle);
      resizeHandles.push(handle);
    }
  }

  const showBtn = () => {
    if (!editor.isEditable) return;
    deleteBtn.style.display = 'flex';
    dragHandle.style.display = 'flex';
    resizeHandles.forEach((h) => { h.style.display = 'block'; });
  };
  const hideBtn = () => {
    deleteBtn.style.display = 'none';
    dragHandle.style.display = 'none';
    resizeHandles.forEach((h) => { h.style.display = 'none'; });
  };
  wrapper.addEventListener('mouseenter', showBtn);
  wrapper.addEventListener('mouseleave', hideBtn);

  return { dom: wrapper };
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    genericEmbed: {
      setGenericEmbed: (attrs: { src: string; width?: number; height?: number }) => ReturnType;
    };
  }
}

/**
 * A generic iframe embed (Vimeo, CodePen, and other oEmbed-style "copy this
 * iframe" snippets — anything the Insert Media dialog's Embed tab hands us
 * once its pasted HTML has been reduced to just a `src`). Deliberately only
 * ever renders an `<iframe src>` with no arbitrary markup or scripts: a
 * script-tag-based embed (Twitter/X, Instagram) would need to execute
 * untrusted third-party JS inside the editor to work, which is a real
 * injection risk, so those aren't supported here — the dialog tells the user
 * plainly rather than silently doing nothing (the bug this fixes).
 */
export const GenericEmbed = Node.create({
  name: 'genericEmbed',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      src: { default: null },
      width: { default: 640 },
      height: { default: 360 },
    };
  },

  parseHTML() {
    return [{ tag: 'iframe[data-generic-embed]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'iframe',
      mergeAttributes(HTMLAttributes, {
        'data-generic-embed': 'true',
        frameborder: '0',
        allowfullscreen: 'true',
      }),
    ];
  },

  addCommands() {
    return {
      setGenericEmbed:
        (attrs: { src: string; width?: number; height?: number }) =>
        ({ commands }: CommandProps) =>
          commands.insertContent({ type: this.name, attrs: { width: 640, height: 360, ...attrs } }),
    };
  },

  addNodeView() {
    return embedNodeView;
  },
});
