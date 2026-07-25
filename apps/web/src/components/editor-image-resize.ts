import type { Editor } from '@tiptap/core';

type Corner = 'nw' | 'ne' | 'sw' | 'se';
const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se'];

/**
 * Wrap an image in a frame that shows four draggable corner handles (like the
 * reference). Dragging a corner resizes the image proportionally and commits the
 * new width/height to the node's attributes; the handles only appear when the
 * node is selected (CSS keys off `.ProseMirror-selectednode` / figure focus).
 *
 * Returns the wrapper element — append it to the node view and put the img inside.
 * `getPos`/`editor`/`typeName` let a drag write back to the right node.
 */
export function buildImageFrame(
  img: HTMLImageElement,
  getPos: () => number | undefined,
  editor: Editor,
): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'cw-img-wrap';
  wrap.contentEditable = 'false';
  wrap.appendChild(img);

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
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
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
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    wrap.appendChild(handle);
  }

  return wrap;
}
