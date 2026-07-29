import { Extension, Node, type CommandProps } from '@tiptap/core';
import { Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';

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
    softLineBlocks: {
      /** Isolate the current soft-line(s) into their own paragraph so a block
       *  format applied next hits only that line, not the whole <br> paragraph. */
      splitSoftLine: () => ReturnType;
    };
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

/**
 * Soft-line awareness for block formats. Text lines joined by <br> live in ONE
 * paragraph, so a block command (blockquote, heading, list, code block) applied
 * to a cursor on one line wraps the WHOLE paragraph. `splitSoftLine` first
 * isolates the selected line(s) into their own paragraph — leaving the lines
 * before/after grouped as they were — so the format applied next hits only that
 * line. A selection spanning the whole paragraph isolates all of it (so the
 * format still applies to everything). It no-ops (leaving the doc untouched) for
 * paragraphs with no breaks, multi-paragraph selections, non-paragraph blocks,
 * or list/table/blockquote contexts — so it is always safe to call before any
 * block command, including when toggling a format back off.
 */
export const SoftLineBlocks = Extension.create({
  name: 'softLineBlocks',

  addCommands() {
    return {
      splitSoftLine:
        () =>
        ({ state, dispatch }: CommandProps) => {
          const { schema, selection } = state;
          const paragraph = schema.nodes.paragraph;
          const hardBreak = schema.nodes.hardBreak;
          const { $from, $to } = selection;

          // Nearest ancestor paragraph shared by both ends, hosted where a new
          // sibling block is legal (top level or inside a <div>).
          let depth = $from.depth;
          while (depth > 0 && $from.node(depth).type.name !== 'paragraph') depth--;
          const para = depth > 0 ? $from.node(depth) : null;
          const parentType = depth > 0 ? $from.node(depth - 1).type.name : '';
          const canHost = parentType === 'doc' || parentType === 'div';
          if (!paragraph || !hardBreak || !para || para.type !== paragraph
              || $to.node(depth) !== para || !canHost) {
            return true; // nothing to isolate — leave the doc as-is
          }

          // Split the paragraph content into <br>-delimited lines.
          type Line = { start: number; end: number; nodes: PMNode[] };
          const lines: Line[] = [];
          let acc: PMNode[] = [];
          let offset = 0;
          let lineStart = 0;
          para.content.forEach((node) => {
            if (node.type === hardBreak) {
              lines.push({ start: lineStart, end: offset, nodes: acc });
              acc = [];
              offset += node.nodeSize;
              lineStart = offset;
            } else {
              acc.push(node);
              offset += node.nodeSize;
            }
          });
          lines.push({ start: lineStart, end: offset, nodes: acc });

          if (lines.length <= 1) return true; // no soft breaks

          const contentStart = $from.before(depth) + 1;
          const selFrom = $from.pos - contentStart;
          const selTo = $to.pos - contentStart;

          let firstIdx = lines.findIndex((l) => selFrom <= l.end);
          if (firstIdx === -1) firstIdx = lines.length - 1;
          let lastIdx = firstIdx;
          for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i]!.start <= selTo) { lastIdx = i; break; }
          }
          if (lastIdx < firstIdx) lastIdx = firstIdx;

          // Whole paragraph already selected → nothing to isolate.
          if (firstIdx === 0 && lastIdx === lines.length - 1) return true;

          const joined = (group: Line[]): PMNode[] => {
            const out: PMNode[] = [];
            group.forEach((l, i) => {
              if (i > 0) out.push(hardBreak.create());
              out.push(...l.nodes);
            });
            return out;
          };
          const mkPara = (group: Line[]) => paragraph.create(para.attrs, Fragment.fromArray(joined(group)));

          const before = firstIdx > 0 ? [mkPara(lines.slice(0, firstIdx))] : [];
          const middle = mkPara(lines.slice(firstIdx, lastIdx + 1));
          const after = lastIdx < lines.length - 1 ? [mkPara(lines.slice(lastIdx + 1))] : [];

          const paraPos = $from.before(depth);
          const replacement = [...before, middle, ...after];
          const tr = state.tr.replaceWith(paraPos, paraPos + para.nodeSize, Fragment.fromArray(replacement));

          // Keep the cursor on the now-isolated middle paragraph.
          const beforeSize = before.reduce((n, p) => n + p.nodeSize, 0);
          const cursor = paraPos + beforeSize + 1;
          tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(cursor, tr.doc.content.size))));

          if (dispatch) dispatch(tr.scrollIntoView());
          return true;
        },
    };
  },
});

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

  addOptions() {
    return { types: ['paragraph', 'heading'], minLevel: 0, maxLevel: MAX_INDENT };
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
