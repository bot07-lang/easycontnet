import { useState } from 'react';
import type { Editor } from '@tiptap/react';

/**
 * Edit › Find and replace. Scans the document's text nodes for the search
 * term and can jump to the next match, replace the current one, or replace
 * every occurrence. Matches within a single text node (good enough for
 * field-sized content); replace-all applies back-to-front so positions stay
 * valid as the document shrinks/grows.
 */
export function FindReplaceDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const collect = () => {
    const term = find;
    const matches: { from: number; to: number }[] = [];
    if (!term) return matches;
    const needle = matchCase ? term : term.toLowerCase();
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text) {
        const hay = matchCase ? node.text : node.text.toLowerCase();
        let i = hay.indexOf(needle);
        while (i !== -1) {
          matches.push({ from: pos + i, to: pos + i + term.length });
          i = hay.indexOf(needle, i + 1);
        }
      }
      return true;
    });
    return matches;
  };

  const findNext = () => {
    const matches = collect();
    if (!matches.length) { setStatus(find ? 'No matches' : null); return; }
    const cursor = editor.state.selection.to;
    const next = matches.find((m) => m.from >= cursor) ?? matches[0]!;
    editor.chain().focus().setTextSelection({ from: next.from, to: next.to }).scrollIntoView().run();
    setStatus(`${matches.length} match${matches.length > 1 ? 'es' : ''}`);
  };

  const replaceOne = () => {
    const { from, to } = editor.state.selection;
    const sel = editor.state.doc.textBetween(from, to);
    const hit = matchCase ? sel === find : sel.toLowerCase() === find.toLowerCase();
    if (find && hit && sel.length) {
      editor.view.dispatch(editor.state.tr.insertText(replace, from, to));
    }
    findNext();
  };

  const replaceAll = () => {
    const matches = collect();
    if (!matches.length) { setStatus('No matches'); return; }
    const tr = editor.state.tr;
    for (let k = matches.length - 1; k >= 0; k--) {
      tr.insertText(replace, matches[k]!.from, matches[k]!.to);
    }
    editor.view.dispatch(tr);
    setStatus(`Replaced ${matches.length}`);
  };

  const field = 'h-10 w-full rounded-md border border-slate-300 px-3 text-[15px] text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-900/40 p-6" onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} className="w-[460px] max-w-full rounded-lg bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-3.5">
          <h2 className="text-[20px] font-semibold text-slate-900">Find and replace</h2>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded text-slate-500 hover:bg-slate-100">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>

        <div className="space-y-3 px-6 py-5">
          <label className="block">
            <span className="mb-1.5 block text-[14px] text-slate-500">Find</span>
            <input autoFocus value={find} onChange={(e) => setFind(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter') findNext(); }} className={field} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[14px] text-slate-500">Replace with</span>
            <input value={replace} onChange={(e) => setReplace(e.target.value)} className={field} />
          </label>
          <label className="flex items-center gap-2 text-[14px] text-slate-600">
            <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)}
                   className="h-4 w-4 rounded border-slate-300" />
            Match case
          </label>
          {status && <p className="text-[13px] text-slate-500">{status}</p>}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <button type="button" onClick={replaceAll} disabled={!find}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40">Replace all</button>
          <button type="button" onClick={replaceOne} disabled={!find}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40">Replace</button>
          <button type="button" onClick={findNext} disabled={!find}
                  className="rounded-md bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40">Find</button>
        </footer>
      </div>
    </div>
  );
}
