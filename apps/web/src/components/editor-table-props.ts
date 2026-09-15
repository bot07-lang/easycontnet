import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

const tableStyleKey = new PluginKey('tableStyles');

/**
 * Copy the table's property attributes onto the live <table> element as inline
 * styles / CSS vars. The resizable table renders through a node view (TableView)
 * that ignores node attributes, so this is the only way to make properties apply
 * live. Setting styles on the table element is ignored by TableView's
 * ignoreMutation (target === this.table), so there is NO redraw loop.
 */
function applyTableStyles(table: HTMLTableElement, attrs: Record<string, unknown>) {
  const s = table.style;
  const set = (name: string, val: string) => (val ? s.setProperty(name, val) : s.removeProperty(name));
  const num = (v: unknown) => (v != null && v !== '' ? `${v}px` : '');
  set('width', (attrs.tblWidth as string) || '');
  set('height', (attrs.tblHeight as string) || '');
  set('margin', attrs.tblAlign === 'center' ? '0 auto' : attrs.tblAlign === 'left' ? '0 auto 0 0' : attrs.tblAlign === 'right' ? '0 0 0 auto' : '');
  set('--cw-tbl-border', num(attrs.tblBorder));
  set('--cw-tbl-border-style', (attrs.tblBorderStyle as string) || '');
  set('--cw-tbl-border-color', (attrs.tblBorderColor as string) || '');
  set('--cw-tbl-cellpad', num(attrs.tblCellPad));
  set('border-collapse', attrs.tblCellSpace ? 'separate' : '');
  set('border-spacing', attrs.tblCellSpace ? num(attrs.tblCellSpace) : '');
  set('background-color', (attrs.tblBg as string) || '');
}

/**
 * The standard Table extension plus editable "Table properties" — width, height,
 * cell spacing/padding, border width + colour, background and alignment.
 *
 * These are ATTRIBUTES ONLY (no custom node view / plugin), rendered as inline
 * styles + a data-attribute so they round-trip through the stored HTML. Cell
 * border/padding are applied via CSS custom properties that inherit to the cells
 * (see styles.css); the rest are plain table styles. Keeping this attribute-only
 * is deliberate — a custom table node view is what previously froze the editor.
 */
export const TableWithProps = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),

      tblWidth: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-tbl-width'),
        renderHTML: (a: Record<string, unknown>) => (a.tblWidth ? { 'data-tbl-width': a.tblWidth, style: `width: ${a.tblWidth}` } : {}),
      },
      tblHeight: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-tbl-height'),
        renderHTML: (a: Record<string, unknown>) => (a.tblHeight ? { 'data-tbl-height': a.tblHeight, style: `height: ${a.tblHeight}` } : {}),
      },
      tblAlign: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-tbl-align'),
        renderHTML: (a: Record<string, unknown>) => {
          const margin = a.tblAlign === 'center' ? '0 auto' : a.tblAlign === 'left' ? '0 auto 0 0' : a.tblAlign === 'right' ? '0 0 0 auto' : null;
          return margin ? { 'data-tbl-align': a.tblAlign, style: `margin: ${margin}` } : {};
        },
      },
      tblBorder: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-tbl-border'),
        renderHTML: (a: Record<string, unknown>) => (a.tblBorder != null && a.tblBorder !== '' ? { 'data-tbl-border': String(a.tblBorder), style: `--cw-tbl-border: ${a.tblBorder}px` } : {}),
      },
      tblBorderColor: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-tbl-border-color'),
        renderHTML: (a: Record<string, unknown>) => (a.tblBorderColor ? { 'data-tbl-border-color': a.tblBorderColor, style: `--cw-tbl-border-color: ${a.tblBorderColor}` } : {}),
      },
      tblBorderStyle: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-tbl-border-style'),
        renderHTML: (a: Record<string, unknown>) => (a.tblBorderStyle ? { 'data-tbl-border-style': a.tblBorderStyle, style: `--cw-tbl-border-style: ${a.tblBorderStyle}` } : {}),
      },
      tblCellPad: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-tbl-cellpad'),
        renderHTML: (a: Record<string, unknown>) => (a.tblCellPad != null && a.tblCellPad !== '' ? { 'data-tbl-cellpad': String(a.tblCellPad), style: `--cw-tbl-cellpad: ${a.tblCellPad}px` } : {}),
      },
      tblCellSpace: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-tbl-cellspace'),
        renderHTML: (a: Record<string, unknown>) => (a.tblCellSpace != null && a.tblCellSpace !== '' ? { 'data-tbl-cellspace': String(a.tblCellSpace), style: `border-collapse: separate; border-spacing: ${a.tblCellSpace}px` } : {}),
      },
      tblBg: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-tbl-bg'),
        renderHTML: (a: Record<string, unknown>) => (a.tblBg ? { 'data-tbl-bg': a.tblBg, style: `background-color: ${a.tblBg}` } : {}),
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        key: tableStyleKey,
        view(editorView) {
          const apply = (view: EditorView) => {
            view.state.doc.descendants((node, pos) => {
              if (node.type.name !== 'table') return;
              const dom = view.nodeDOM(pos);
              const table = dom instanceof HTMLElement ? (dom.tagName === 'TABLE' ? dom : dom.querySelector('table')) : null;
              if (table) applyTableStyles(table as HTMLTableElement, node.attrs);
            });
          };
          // Apply once after the initial render, then on every doc/attr change.
          void Promise.resolve().then(() => apply(editorView));
          return { update: (view) => apply(view) };
        },
      }),
    ];
  },
});

/** The shape the Table Properties dialog reads/writes. */
export interface TableProps {
  tblWidth: string;
  tblHeight: string;
  tblCellSpace: string;
  tblCellPad: string;
  tblBorder: string;
  tblAlign: string;
  tblBorderColor: string;
  tblBorderStyle: string;
  tblBg: string;
}

/**
 * Row and cell properties — background colour, plus a fixed height for rows
 * and vertical alignment for cells. Unlike the table itself, <tr>/<td>/<th>
 * render through the default schema (no custom node view), so plain
 * declarative attributes are enough — no reapply-on-transaction plugin needed.
 */
export const TableRowWithProps = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      rowBg: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-row-bg'),
        renderHTML: (a: Record<string, unknown>) => (a.rowBg ? { 'data-row-bg': a.rowBg, style: `background-color: ${a.rowBg}` } : {}),
      },
      rowHeight: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-row-height'),
        renderHTML: (a: Record<string, unknown>) => (a.rowHeight ? { 'data-row-height': a.rowHeight, style: `height: ${a.rowHeight}` } : {}),
      },
    };
  },
});

function cellPropAttributes() {
  return {
    cellBg: {
      default: null,
      parseHTML: (el: HTMLElement) => el.getAttribute('data-cell-bg'),
      renderHTML: (a: Record<string, unknown>) => (a.cellBg ? { 'data-cell-bg': a.cellBg, style: `background-color: ${a.cellBg}` } : {}),
    },
    cellVAlign: {
      default: null,
      parseHTML: (el: HTMLElement) => el.getAttribute('data-cell-valign'),
      renderHTML: (a: Record<string, unknown>) => (a.cellVAlign ? { 'data-cell-valign': a.cellVAlign, style: `vertical-align: ${a.cellVAlign}` } : {}),
    },
  };
}

export const TableCellWithProps = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellPropAttributes() };
  },
});

export const TableHeaderWithProps = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellPropAttributes() };
  },
});

/** The shape the Row/Cell Properties dialogs read/write. */
export interface RowProps {
  rowBg: string;
  rowHeight: string;
}

export interface CellProps {
  cellBg: string;
  cellVAlign: string;
}
