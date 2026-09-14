import type { Editor } from '@tiptap/react';
import { TableMap, selectedRect } from '@tiptap/pm/tables';
import type { Node as PMNode } from '@tiptap/pm/model';
import { toast } from '../lib/toast';

/**
 * Row/column cut, copy and paste for the table menu. Tiptap's table extension
 * (prosemirror-tables underneath) has no clipboard concept for a whole row or
 * column, so this reimplements the minimum needed for it — content only, not
 * a perfect structural clone: a copied cell's colspan/rowspan isn't preserved
 * on paste, since paste always lands in the single-width cells a fresh
 * addRowBefore/After or addColumnBefore/After creates. For the common case
 * (no merged cells) this is a faithful copy; a merged source table degrades
 * gracefully to copying each covered cell's content once, left-to-right /
 * top-to-bottom.
 */

let rowClipboard: PMNode[] | null = null;
let columnClipboard: PMNode[] | null = null;

/** The row/column index (in the table's grid) that the cursor is in, plus its
 *  table context. Returns null outside a table. */
function tableContext(editor: Editor) {
  const { state } = editor;
  let rect;
  try {
    rect = selectedRect(state);
  } catch {
    return null;
  }
  return rect;
}

/** Every distinct cell in row `row`, left to right (a spanning cell is only
 *  included once, at the column its span starts). */
function cellsInRow(map: TableMap, table: PMNode, row: number): PMNode[] {
  const cells: PMNode[] = [];
  let lastPos = -1;
  for (let col = 0; col < map.width; col++) {
    const pos = map.positionAt(row, col, table);
    if (pos === lastPos) continue;
    lastPos = pos;
    const node = table.nodeAt(pos);
    if (node) cells.push(node);
  }
  return cells;
}

/** Every distinct cell in column `col`, top to bottom. */
function cellsInColumn(map: TableMap, table: PMNode, col: number): PMNode[] {
  const cells: PMNode[] = [];
  let lastPos = -1;
  for (let row = 0; row < map.height; row++) {
    const pos = map.positionAt(row, col, table);
    if (pos === lastPos) continue;
    lastPos = pos;
    const node = table.nodeAt(pos);
    if (node) cells.push(node);
  }
  return cells;
}

/** Overwrite the CONTENT (not attrs — a freshly-inserted cell keeps its own
 *  span/attrs) of the distinct cells in row `row` from `clipboard`, matched by
 *  left-to-right order. Run against fresh state, right after a structural
 *  insert. */
function fillRow(editor: Editor, row: number, clipboard: PMNode[]) {
  // Positions shift as each cell's content is replaced, so the table context
  // is re-read from fresh state after every write rather than computed once.
  let ctx = tableContext(editor);
  if (!ctx || row < 0 || row >= ctx.map.height) return;
  let lastPos = -1;
  let colIndex = 0;
  for (let col = 0; col < ctx.map.width; col++) {
    const relPos = ctx.map.positionAt(row, col, ctx.table);
    if (relPos === lastPos) continue;
    lastPos = relPos;
    const src = clipboard[colIndex];
    colIndex++;
    if (!src) continue;
    const absPos = ctx.tableStart + relPos;
    const cellNode = editor.state.doc.nodeAt(absPos);
    if (!cellNode) continue;
    editor.view.dispatch(editor.state.tr.replaceWith(absPos + 1, absPos + cellNode.nodeSize - 1, src.content));
    ctx = tableContext(editor);
    if (!ctx) return;
  }
}

/** Same as fillRow, but down a column. */
function fillColumn(editor: Editor, col: number, clipboard: PMNode[]) {
  let ctx = tableContext(editor);
  if (!ctx) return;
  let lastPos = -1;
  let rowIndex = 0;
  for (let row = 0; row < ctx.map.height; row++) {
    const relPos = ctx.map.positionAt(row, col, ctx.table);
    if (relPos === lastPos) continue;
    lastPos = relPos;
    const src = clipboard[rowIndex];
    rowIndex++;
    if (!src) continue;
    const absPos = ctx.tableStart + relPos;
    const cellNode = editor.state.doc.nodeAt(absPos);
    if (!cellNode) continue;
    editor.view.dispatch(editor.state.tr.replaceWith(absPos + 1, absPos + cellNode.nodeSize - 1, src.content));
    ctx = tableContext(editor);
    if (!ctx) return;
  }
}

export function copyRow(editor: Editor) {
  const rect = tableContext(editor);
  if (!rect) return;
  rowClipboard = cellsInRow(rect.map, rect.table, rect.top);
  toast(`Copied row (${rowClipboard.length} cell${rowClipboard.length === 1 ? '' : 's'}).`);
}

export function cutRow(editor: Editor) {
  copyRow(editor);
  editor.chain().focus().deleteRow().run();
}

export function pasteRowBefore(editor: Editor) {
  if (!rowClipboard) { toast('Copy or cut a row first.'); return; }
  const before = tableContext(editor);
  if (!before) return;
  const targetRow = before.top;
  editor.chain().focus().addRowBefore().run();
  fillRow(editor, targetRow, rowClipboard);
}

export function pasteRowAfter(editor: Editor) {
  if (!rowClipboard) { toast('Copy or cut a row first.'); return; }
  const before = tableContext(editor);
  if (!before) return;
  const targetRow = before.bottom; // addRowAfter inserts at index `bottom`, pushing what followed further down
  editor.chain().focus().addRowAfter().run();
  fillRow(editor, targetRow, rowClipboard);
}

export function copyColumn(editor: Editor) {
  const rect = tableContext(editor);
  if (!rect) return;
  columnClipboard = cellsInColumn(rect.map, rect.table, rect.left);
  toast(`Copied column (${columnClipboard.length} cell${columnClipboard.length === 1 ? '' : 's'}).`);
}

export function cutColumn(editor: Editor) {
  copyColumn(editor);
  editor.chain().focus().deleteColumn().run();
}

export function pasteColumnBefore(editor: Editor) {
  if (!columnClipboard) { toast('Copy or cut a column first.'); return; }
  const before = tableContext(editor);
  if (!before) return;
  const targetCol = before.left;
  editor.chain().focus().addColumnBefore().run();
  fillColumn(editor, targetCol, columnClipboard);
}

export function pasteColumnAfter(editor: Editor) {
  if (!columnClipboard) { toast('Copy or cut a column first.'); return; }
  const before = tableContext(editor);
  if (!before) return;
  const targetCol = before.right;
  editor.chain().focus().addColumnAfter().run();
  fillColumn(editor, targetCol, columnClipboard);
}

export function hasRowClipboard() { return rowClipboard != null; }
export function hasColumnClipboard() { return columnClipboard != null; }
