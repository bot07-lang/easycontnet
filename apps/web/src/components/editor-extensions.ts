import { Extension, Node, type CommandProps } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';

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
