import { Node } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { buildImageFrame } from './editor-image-resize';

/**
 * An image with an editable caption, rendered exactly like the reference:
 *   <figure class="image"><img …><figcaption>caption</figcaption></figure>
 *
 * The figure itself isn't directly editable — only the figcaption (the node's
 * inline content) is. The image lives as node attributes (src/alt/size + the
 * data-full-name reference), so rotate/edit/insert reuse the same handlers.
 */
export const Figure = Node.create({
  name: 'figure',
  group: 'block',
  content: 'inline*',
  draggable: true,
  isolating: true,

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      width: { default: null },
      height: { default: null },
      dataFullName: { default: null },
      // Not TextAlign's textAlign: that extension only targets text-container
      // nodes (paragraph/heading) and writes `text-align`, which does
      // nothing for a figure — figure is `display: table` (a block box, not
      // inline content) and isn't wrapped in a paragraph to inherit
      // alignment from anyway. This is figure's own attribute; the CSS in
      // styles.css turns it into real horizontal margins.
      align: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-align'),
        renderHTML: (a) => (a.align ? { 'data-align': a.align } : {}),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'figure',
        contentElement: 'figcaption',
        getAttrs: (el) => {
          const img = (el as HTMLElement).querySelector('img');
          if (!img) return false;
          return {
            src: img.getAttribute('src'),
            alt: img.getAttribute('alt'),
            width: img.getAttribute('width'),
            height: img.getAttribute('height'),
            dataFullName: img.getAttribute('data-full-name'),
            align: (el as HTMLElement).getAttribute('data-align'),
          };
        },
      },
    ];
  },

  renderHTML({ node }) {
    const { src, alt, width, height, dataFullName, align } = node.attrs as Record<string, string | null>;
    const img: Record<string, string> = { src: src ?? '', alt: alt ?? '' };
    if (width) img.width = String(width);
    if (height) img.height = String(height);
    if (dataFullName) img['data-full-name'] = String(dataFullName);
    const figureAttrs: Record<string, string> = { class: 'image' };
    if (align) figureAttrs['data-align'] = align;
    return ['figure', figureAttrs, ['img', img], ['figcaption', 0]];
  },

  // Render the figure as non-editable with only the figcaption editable (like the
  // reference). This makes clicking the image select the whole figure (so the
  // caption border can show only when selected) and keeps the caption editable.
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const figure = document.createElement('figure');
      figure.className = 'image';
      figure.contentEditable = 'false';
      // A custom node view's DOM doesn't automatically pick up the node
      // spec's `draggable: true` (set above) — same gotcha already fixed for
      // plain images (editor-image-resize.ts) and embeds
      // (editor-extensions.ts). Without this, dragging a captioned image
      // does nothing: it snaps back to its original spot on drop.
      figure.draggable = true;
      const paintAlign = (n: typeof node) => {
        const align = (n.attrs as Record<string, string | null>).align;
        if (align) figure.setAttribute('data-align', align); else figure.removeAttribute('data-align');
      };
      paintAlign(node);

      const img = document.createElement('img');
      // Clicking the image selects the whole figure (so the selection border shows),
      // rather than doing nothing — the img sits in a non-editable figure.
      img.addEventListener('mousedown', (event) => {
        event.preventDefault();
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos == null) return;
        const { state, dispatch } = editor.view;
        dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)));
      });
      const paintImg = (n: typeof node) => {
        const a = n.attrs as Record<string, string | null>;
        img.src = a.src ?? '';
        img.alt = a.alt ?? '';
        for (const [k, v] of [['width', a.width], ['height', a.height], ['data-full-name', a.dataFullName]] as const) {
          if (v) img.setAttribute(k, String(v)); else img.removeAttribute(k);
        }
      };
      paintImg(node);

      const figcaption = document.createElement('figcaption');
      figcaption.contentEditable = 'true';

      // Wrap the image in a resize frame (four draggable corner handles, shown
      // only when the figure is selected). The caption stays a direct child.
      const frame = buildImageFrame(img, () => (typeof getPos === 'function' ? getPos() : undefined), editor);
      figure.append(frame.dom, figcaption);
      return {
        dom: figure,
        contentDOM: figcaption,
        update: (updated) => {
          if (updated.type.name !== 'figure') return false;
          paintImg(updated); // src/size changed (rotate/edit) without recreating the caption
          paintAlign(updated);
          return true;
        },
        destroy: () => frame.destroy(),
      };
    };
  },
});
