import { Node, type CommandProps } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';

export interface TocItem {
  level: number;
  text: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableOfContents: {
      insertTableOfContents: () => ReturnType;
    };
  }
}

/** Every heading currently in the doc, in document order. */
function collectHeadings(doc: PMNode): TocItem[] {
  const items: TocItem[] = [];
  doc.descendants((node) => {
    if (node.type.name === 'heading') items.push({ level: node.attrs.level as number, text: node.textContent });
  });
  return items;
}

function sameItems(a: TocItem[], b: TocItem[]): boolean {
  return a.length === b.length && a.every((x, i) => x.level === b[i]!.level && x.text === b[i]!.text);
}

/**
 * A "Table of contents" block (Insert ▸ Table of contents): an always-live
 * snapshot of every heading in the document, indented by level, each row
 * jumping the editor to that heading on click. It's an atom (no editable
 * content of its own) so nothing can be typed inside it by accident.
 *
 * Its `items` attribute is kept in sync with the live heading list (see the
 * node view's `sync`) purely so the HTML this field *saves* — and therefore
 * the standalone HTML/.docx export — carries a real, current table of
 * contents rather than an empty placeholder.
 */
export const TableOfContents = Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  selectable: true,
  isolating: true,

  addAttributes() {
    return {
      // Not read back from HTML on load — the node view recomputes it from
      // the live document (and self-heals the persisted value) as soon as it
      // mounts, so a stale saved snapshot never lingers.
      items: { default: [] as TocItem[], parseHTML: () => null, renderHTML: () => ({}) },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="table-of-contents"]' }];
  },

  renderHTML({ node }) {
    const items = (node.attrs.items ?? []) as TocItem[];
    const rows = items.length
      ? items.map((it) => ['p', { class: 'toc-row' }, it.text || '(untitled heading)'])
      : [['p', { class: 'toc-empty-msg' }, 'Add headings to populate this list.']];
    return [
      'div',
      { 'data-type': 'table-of-contents', class: 'toc-block' },
      ['p', { class: 'toc-title' }, 'Table of contents'],
      ['p', { class: 'toc-hint' }, 'Auto-generated from this document’s headings.'],
      ...rows,
    ];
  },

  addCommands() {
    return {
      insertTableOfContents:
        () =>
        ({ commands, editor }: CommandProps) =>
          commands.insertContent({ type: this.name, attrs: { items: collectHeadings(editor.state.doc) } }),
    };
  },

  addNodeView() {
    return ({ editor, getPos, node }) => {
      const dom = document.createElement('div');
      dom.className = 'toc-block';
      dom.contentEditable = 'false';

      const title = document.createElement('div');
      title.className = 'toc-title';
      title.textContent = 'Table of contents';
      dom.appendChild(title);

      const hint = document.createElement('div');
      hint.className = 'toc-hint';
      hint.textContent = 'Auto-generated from your headings — click one to jump to it.';
      dom.appendChild(hint);

      const list = document.createElement('div');
      list.className = 'toc-list';
      dom.appendChild(list);

      const emptyMsg = document.createElement('div');
      emptyMsg.className = 'toc-empty-msg';
      emptyMsg.textContent = 'Add headings to your document to populate this list.';
      dom.appendChild(emptyMsg);

      let current: TocItem[] = (node.attrs.items ?? []) as TocItem[];

      // Jump to the Nth heading in document order, using its CURRENT position
      // (never a stored one — positions shift as the doc is edited above it).
      const jumpTo = (index: number) => {
        let found = -1;
        let seen = 0;
        editor.state.doc.descendants((n, pos) => {
          if (found !== -1 || n.type.name !== 'heading') return;
          if (seen === index) found = pos;
          seen++;
        });
        if (found === -1) return;
        editor.chain().focus().setTextSelection(found + 1).run();
        const el = editor.view.nodeDOM(found) as HTMLElement | null;
        if (el?.scrollIntoView) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('toc-flash');
          setTimeout(() => el.classList.remove('toc-flash'), 900);
        }
      };

      const paint = (items: TocItem[]) => {
        list.innerHTML = '';
        emptyMsg.style.display = items.length ? 'none' : '';
        items.forEach((it, i) => {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'toc-row';
          row.textContent = it.text || '(untitled heading)';
          row.addEventListener('mousedown', (e) => e.preventDefault());
          row.addEventListener('click', (e) => { e.preventDefault(); jumpTo(i); });
          list.appendChild(row);
        });
      };

      const sync = () => {
        const items = collectHeadings(editor.state.doc);
        if (sameItems(items, current)) return;
        current = items;
        paint(items);
        // Deferred: writing this node's own attrs from inside an 'update'
        // handler fired BY a transaction must not dispatch synchronously.
        queueMicrotask(() => {
          if (editor.isDestroyed) return;
          const pos = getPos();
          if (typeof pos !== 'number') return;
          const live = editor.state.doc.nodeAt(pos);
          if (!live || live.type.name !== 'tableOfContents' || sameItems((live.attrs.items ?? []) as TocItem[], items)) return;
          editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { items }));
        });
      };

      paint(current);
      editor.on('update', sync);
      sync(); // catch headings already present when the block is first inserted

      return { dom, ignoreMutation: () => true, destroy: () => editor.off('update', sync) };
    };
  },
});
