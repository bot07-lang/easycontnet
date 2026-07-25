import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * Highlights keyword occurrences in the document (green wash), driven by a list
 * pushed in from the CONTROLS panel's "Highlight in text". Matching is LITERAL
 * and CASE-SENSITIVE — trailing spaces are part of the keyword — matching the
 * reference's keyword-count behaviour exactly.
 *
 * Set the active keywords by dispatching a transaction with this plugin key:
 *   editor.view.dispatch(editor.state.tr.setMeta(keywordHighlightKey, { keywords }))
 */
export const keywordHighlightKey = new PluginKey('keywordHighlight');

function buildDecorations(doc: PMNode, keywords: string[]): DecorationSet {
  const active = keywords.filter((k) => k.length > 0);
  if (!active.length) return DecorationSet.empty;
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text;
    for (const kw of active) {
      let idx = text.indexOf(kw);
      while (idx !== -1) {
        const from = pos + idx;
        decos.push(Decoration.inline(from, from + kw.length, { class: 'cw-kw-hl' }));
        idx = text.indexOf(kw, idx + kw.length);
      }
    }
  });
  return DecorationSet.create(doc, decos);
}

interface KWState {
  keywords: string[];
  deco: DecorationSet;
}

export const KeywordHighlight = Extension.create({
  name: 'keywordHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin<KWState>({
        key: keywordHighlightKey,
        state: {
          init: () => ({ keywords: [], deco: DecorationSet.empty }),
          apply(tr, value, _old, newState) {
            const meta = tr.getMeta(keywordHighlightKey) as { keywords: string[] } | undefined;
            if (meta) return { keywords: meta.keywords, deco: buildDecorations(newState.doc, meta.keywords) };
            if (tr.docChanged && value.keywords.length) {
              return { keywords: value.keywords, deco: buildDecorations(newState.doc, value.keywords) };
            }
            return value;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state)?.deco ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
