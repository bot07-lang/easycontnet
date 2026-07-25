import { Table } from '@tiptap/extension-table';
import { TableView } from '@tiptap/pm/tables';
import { NodeSelection, Plugin } from '@tiptap/pm/state';
import type { EditorView, NodeView } from '@tiptap/pm/view';
import type { Editor } from '@tiptap/core';

type Corner = 'nw' | 'ne' | 'sw' | 'se';
const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se'];

/**
 * TableView (from prosemirror-tables, which powers column resizing) plus a
 * selection frame: four draggable corner handles around the whole table, shown
 * only when the table is active. Dragging a corner scales every column width
 * proportionally — resizing the entire table, matching the reference.
 *
 * The per-column drag handles keep coming from prosemirror-tables; this only
 * adds the outer whole-table frame on top.
 */
class FramedTableView extends TableView {
  // Ignore DOM mutations inside our frame so ProseMirror doesn't redraw the
  // node view (which would drop the handles) while we tweak handle/col styles.
  // The frame overlay, the wrapper's own class (cw-table-wrap / cw-table-active),
  // and the handles are decorations — NONE of them are document content, so none
  // may trigger a redraw. Missing any of these makes ProseMirror recreate the node
  // view on the mutation we just caused, which re-adds the frame → infinite loop
  // (a full page freeze).
  override ignoreMutation(record: MutationRecord): boolean {
    const target = record.target as HTMLElement | null;
    // Attribute changes on the wrapper itself (e.g. the active-class toggle).
    if (record.type === 'attributes' && target === this.dom) return true;
    // Anything inside the frame overlay.
    if (target && typeof target.closest === 'function' && target.closest('.cw-table-frame')) return true;
    // The frame being added to / removed from the wrapper.
    if (record.type === 'childList') {
      const isFrame = (n: Node) =>
        n instanceof HTMLElement && (n.classList?.contains('cw-table-frame') || !!n.closest?.('.cw-table-frame'));
      if (Array.from(record.addedNodes).some(isFrame) || Array.from(record.removedNodes).some(isFrame)) return true;
    }
    return super.ignoreMutation(record);
  }
}

/** Column pixel widths from the first row's cells (simple tables: one cell = one column). */
function columnWidths(table: HTMLTableElement): number[] {
  const firstRow = table.rows[0];
  if (!firstRow) return [];
  return Array.from(firstRow.cells).map((c) => c.getBoundingClientRect().width);
}

/** Write scaled colwidths back to every cell so the resize persists in the doc. */
function commitWidths(editor: Editor, getPos: () => number | undefined, widths: number[], cellMinWidth: number) {
  const pos = getPos();
  if (pos == null) return;
  const { state } = editor.view;
  const table = state.doc.nodeAt(pos);
  if (!table || table.type.name !== 'table') return;
  let tr = state.tr;
  table.forEach((row, rowOffset) => {
    const rowStart = pos + 1 + rowOffset;
    let col = 0;
    row.forEach((cell, cellOffset) => {
      const cellPos = rowStart + 1 + cellOffset;
      const span = (cell.attrs.colspan as number) || 1;
      const colwidth: number[] = [];
      for (let s = 0; s < span; s++) colwidth.push(Math.max(cellMinWidth, Math.round(widths[col + s] ?? cellMinWidth)));
      tr = tr.setNodeMarkup(cellPos, undefined, { ...cell.attrs, colwidth });
      col += span;
    });
  });
  editor.view.dispatch(tr);
}

function attachFrame(view: FramedTableView, getPos: () => number | undefined, editor: Editor, cellMinWidth: number) {
  const wrapper = view.dom as HTMLElement;
  wrapper.classList.add('cw-table-wrap');
  const frame = document.createElement('div');
  frame.className = 'cw-table-frame';
  frame.contentEditable = 'false';

  for (const corner of CORNERS) {
    const handle = document.createElement('span');
    handle.className = `cw-table-handle cw-table-${corner}`;
    handle.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const table = view.table as HTMLTableElement;
      const cols = Array.from((view.colgroup ?? table.querySelector('colgroup'))?.children ?? []) as HTMLElement[];
      const startWidths = columnWidths(table);
      const startTotal = startWidths.reduce((a, b) => a + b, 0);
      const minTotal = startWidths.length * cellMinWidth;
      const startX = event.clientX;
      const east = corner === 'ne' || corner === 'se';

      const onMove = (move: MouseEvent) => {
        const delta = east ? move.clientX - startX : startX - move.clientX;
        const newTotal = Math.max(minTotal, startTotal + delta);
        const scale = startTotal > 0 ? newTotal / startTotal : 1;
        cols.forEach((c, i) => { if (startWidths[i]) c.style.width = `${startWidths[i] * scale}px`; });
        table.style.width = `${newTotal}px`;
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const finalWidths = cols.map((c) => parseFloat(c.style.width) || 0);
        table.style.width = '';
        commitWidths(editor, getPos, finalWidths.length ? finalWidths : startWidths, cellMinWidth);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    frame.appendChild(handle);
  }

  wrapper.appendChild(frame);
}

/** Toggle `cw-table-active` on the table wrapper the selection currently sits in. */
function tableFramePlugin() {
  return new Plugin({
    view() {
      const update = (v: EditorView) => {
        let tablePos: number | null = null;
        const sel = v.state.selection;
        if (sel instanceof NodeSelection && sel.node.type.name === 'table') {
          tablePos = sel.from;
        } else {
          const $from = sel.$from;
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === 'table') { tablePos = $from.before(d); break; }
          }
        }
        v.dom.querySelectorAll('.cw-table-wrap.cw-table-active').forEach((el) => el.classList.remove('cw-table-active'));
        if (tablePos != null) {
          const dom = v.nodeDOM(tablePos);
          if (dom instanceof HTMLElement) dom.classList.add('cw-table-active');
        }
      };
      return { update };
    },
  });
}

/** Table with the whole-table selection frame + proportional corner resize. */
export const FramedTable = Table.extend({
  addNodeView() {
    const cellMinWidth = (this.options.cellMinWidth as number) ?? 25;
    return ({ node, getPos, editor }) => {
      const view = new FramedTableView(node, cellMinWidth);
      attachFrame(view, () => (typeof getPos === 'function' ? getPos() : undefined), editor, cellMinWidth);
      return view as unknown as NodeView;
    };
  },

  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), tableFramePlugin()];
  },
});
