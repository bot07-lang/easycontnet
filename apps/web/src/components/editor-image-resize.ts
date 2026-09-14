import type { Editor } from '@tiptap/core';

type Corner = 'nw' | 'ne' | 'sw' | 'se';
const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se'];

/**
 * Wrap an image in a frame that shows four draggable corner handles (like the
 * reference). Dragging a corner resizes the image proportionally and commits the
 * new width/height to the node's attributes; the handles only appear when the
 * node is selected (CSS keys off `.ProseMirror-selectednode` / figure focus).
 *
 * Returns the wrapper element plus a `destroy` hook — call it from the node
 * view's own `destroy()` so a drag left in progress when the node is removed
 * (image deleted mid-drag, undo, or the editor unmounting) doesn't leave its
 * document-level mousemove/mouseup listeners dangling to later fire against a
 * stale position or a torn-down editor view.
 */
export function buildImageFrame(
  img: HTMLImageElement,
  getPos: () => number | undefined,
  editor: Editor,
): { dom: HTMLElement; destroy: () => void } {
  const wrap = document.createElement('span');
  wrap.className = 'cw-img-wrap';
  wrap.contentEditable = 'false';
  // A custom node view's DOM doesn't automatically pick up the node spec's
  // `draggable: true` (default for Image), unlike default, non-nodeView
  // rendering — same gotcha already fixed for embeds (editor-extensions.ts).
  // Without this, dragging the image to reposition it does nothing: the
  // browser's native image-drag takes over instead of ProseMirror's own
  // node-move handling, so nothing in the document model actually changes
  // and the image snaps back to its original spot on drop.
  wrap.draggable = true;
  // <img> is natively draggable in every browser regardless of any attribute
  // — without turning that off, its own default drag can win over the
  // wrapper's, dragging out the raw image file/URL instead of moving the
  // node within the document.
  img.draggable = false;
  wrap.appendChild(img);

  // At most one drag is ever in progress for this frame; tracked so `destroy`
  // can tear it down if the node view goes away mid-drag.
  let activeCleanup: (() => void) | null = null;

  for (const corner of CORNERS) {
    const handle = document.createElement('span');
    handle.className = `cw-resize-handle cw-resize-${corner}`;
    handle.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation(); // don't let the image's select-figure handler fire
      const startX = event.clientX;
      const rect = img.getBoundingClientRect();
      const startW = rect.width;
      const ratio = rect.height > 0 ? rect.width / rect.height : 1;
      const east = corner === 'ne' || corner === 'se';

      const onMove = (move: MouseEvent) => {
        const dx = move.clientX - startX;
        const w = Math.max(40, Math.round(startW + (east ? dx : -dx)));
        img.style.width = `${w}px`;
        img.style.height = 'auto';
      };
      const cleanup = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        activeCleanup = null;
      };
      const onUp = () => {
        cleanup();
        const w = Math.round(img.getBoundingClientRect().width);
        const h = Math.round(w / (ratio || 1));
        img.style.width = '';
        img.style.height = '';
        const pos = getPos();
        if (pos == null) return;
        const { state, dispatch } = editor.view;
        const node = state.doc.nodeAt(pos);
        if (!node) return;
        dispatch(state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, width: String(w), height: String(h) }));
      };
      activeCleanup = cleanup;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    wrap.appendChild(handle);
  }

  return { dom: wrap, destroy: () => activeCleanup?.() };
}
