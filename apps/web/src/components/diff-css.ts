/** Diff styling + the split-view filter (one diff, two filtered columns). Also
 *  reused (base typography only) by the read-only version preview. Kept in
 *  its own file, separate from CompareDialog.tsx, so ItemEditor can import
 *  just this small string statically while CompareDialog itself — the
 *  heavy, rarely-opened part — loads lazily. */
export const DIFF_CSS = `
.cw-diff { color: #1e293b; font-size: 15px; line-height: 1.6; word-break: break-word; }
.cw-diff p { margin: 0 0 0.6em; }
.cw-diff p:last-child { margin-bottom: 0; }
.cw-diff h1 { font-size: 1.6em; font-weight: 700; margin: 0.4em 0; }
.cw-diff h2 { font-size: 1.35em; font-weight: 700; margin: 0.4em 0; }
.cw-diff h3 { font-size: 1.15em; font-weight: 600; margin: 0.4em 0; }
.cw-diff ul { list-style: disc; padding-left: 1.4em; margin: 0.4em 0; }
.cw-diff ol { list-style: decimal; padding-left: 1.4em; margin: 0.4em 0; }
.cw-diff a { color: #2563eb; text-decoration: underline; }
.cw-diff img { max-width: 100%; height: auto; border-radius: 4px; margin: 0.3em 0; }
/* Videos/embeds and wide tables must stay inside their (split) column, not
   overflow into the other side. */
.cw-diff iframe, .cw-diff video { max-width: 100%; }
.cw-diff table { border-collapse: collapse; width: 100%; margin: 0.5em 0; display: block; overflow-x: auto; }
.cw-diff td, .cw-diff th { border: 1px solid #cbd5e1; padding: 6px 10px; }
.cw-diff pre { background: #f1f5f9; padding: 0.6em; border-radius: 6px; overflow-x: auto; }
.cw-diff code { background: #f1f5f9; padding: 0.1em 0.3em; border-radius: 4px; }

.cw-diff ins { background: #dcfce7; color: #14532d; text-decoration: none; border-radius: 2px; }
.cw-diff del { background: #fee2e2; color: #7f1d1d; text-decoration: line-through; border-radius: 2px; }
/* Block-replace fallback (formatting/structure-only change): the red/green
   highlight hugs each line's text — even lines broken inside one block — via an
   inline box-decoration-break, keeping the content's own colours. Each block is
   made inline and given a forced line break after it (::after "\A") so paragraph
   separation is preserved. */
.cw-diff del.cw-block, .cw-diff ins.cw-block { display: block; color: inherit; background: none; }
.cw-diff del.cw-block { text-decoration-color: #ef4444; }
.cw-diff del.cw-block :where(p, li, h1, h2, h3, h4, blockquote, pre),
.cw-diff ins.cw-block :where(p, li, h1, h2, h3, h4, blockquote, pre) {
  display: inline; -webkit-box-decoration-break: clone; box-decoration-break: clone;
  border-radius: 2px; padding: 0 2px;
}
.cw-diff del.cw-block :where(p, li, h1, h2, h3, h4, blockquote, pre) { background: #fee2e2; }
.cw-diff ins.cw-block :where(p, li, h1, h2, h3, h4, blockquote, pre) { background: #dcfce7; }
.cw-diff del.cw-block :where(p, li, h1, h2, h3, h4, blockquote, pre)::after,
.cw-diff ins.cw-block :where(p, li, h1, h2, h3, h4, blockquote, pre)::after { content: "\A"; white-space: pre; }
.cw-diff del.cw-block :where(ul, ol), .cw-diff ins.cw-block :where(ul, ol) { padding-left: 0; list-style: none; margin: 0; }
.cw-diff ins img { outline: 2px solid #22c55e; }
.cw-diff del img { outline: 2px solid #ef4444; opacity: 0.7; }
.cw-empty { color: #94a3b8; font-style: italic; }

/* File/asset field diff — thumbnails laid out in a row. */
.cw-diff .cw-file { display: inline-block; vertical-align: top; margin: 0 10px 10px 0; text-align: center; }
.cw-diff .cw-file img { max-width: 140px; max-height: 140px; border: 1px solid #e2e8f0; border-radius: 4px; margin: 0; }
.cw-diff .cw-file figcaption { max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: #64748b; }
.cw-diff .cw-file-name { padding: 2px 0; }
`;
