# Editor — completion status

Snapshot of what's built vs. left in the content-item editor (`ItemEditor.tsx`,
`EditorToolbar.tsx`, `RichTextField.tsx`, `TableMenu.tsx`, `editor-extensions.ts`,
`toolbar-parts.tsx`). Local reference — not committed.

## Built and working
- Rich text: bold / italic / underline, headings & paragraph, text color,
  highlight, bullet & numbered lists, indent/outdent, alignment, links, images,
  YouTube video, inline code / code block, fullscreen.
- Full menu bar: File / Edit / View / Insert / Format / Tools / Table.
- Table editing: insert/delete rows & columns, merge/split cells, cell/row/
  table properties (background, alignment, height, borders), row/column
  cut/copy/paste, and a live table-of-contents block — see §2 below.
- Per-field autosave (debounced) with save-state indicator.
- Plain-vs-rich fields (driven by `template_fields.is_plain_text`).
- Version history: list, **+ Save version**, restore, rename; All / Named
  sub-tabs, grouped by date, kind badge, author+role, status dot, ⋮ menu.
- **Version compare / diff** — `CompareDialog.tsx` (453 lines) + `diff-fields.ts`:
  side-by-side or split view, red/green HTML diff across all field types
  (text, images, tables), Restore from the compare view. The "Compare
  versions" button only disables when there are no saved versions yet to
  compare against, not because the feature is unbuilt.
- **Comments** — fully built, not a stub: `CommentPanel.tsx` (432 lines),
  `CommentsTab.tsx`, `CommentPopover.tsx`. Text-anchored comments (select text →
  comment on the selection) and field-level comments both work. The
  toolbar's disabled "Add a comment" button only appears as a fallback when
  no `fieldId` is passed to the toolbar — not a feature gate.
- **In-editor workflow controls** — `ControlsTab.tsx`: status changes,
  assignees, brief editing (name/keywords/description) all wired to the API.
- Status shown in the editor header as a read-only badge.

## Left to complete

### 1. Track Changes — Phase 2
- Toolbar **Track Changes** button — disabled stub (`EditorToolbar.tsx`,
  `MenuItem` labeled "Track changes (coming in Phase 2)").

### 2. Advanced table operations — built, UI not verified against EasyContent
All previously-disabled table menu stubs are now wired up:
- **Table of contents** (Insert menu) — live, self-updating list of the
  document's headings; click a row to jump to it.
- **Cell properties** — vertical align + background color, own dialog.
- **Row properties** — height + background color, own dialog.
- **Table properties** — was already built (triggered from the selection
  bubble menu) but the Table menu's own entry pointed nowhere; now wired to
  the same dialog.
- **Cut/Copy/Paste row / column** — in-memory clipboard (`editor-table-ops.ts`,
  built on prosemirror-tables' `TableMap`). Content-only: a copied cell's
  colspan/rowspan isn't preserved on paste, since paste always lands in the
  single-width cells a fresh insert creates.

Row/column clipboard logic is verified against a real Tiptap editor (jsdom
test, not committed). The Cell/Row/Table Properties **dialogs' fields, labels,
and layout are this session's own design** — not checked against EasyContent's
actual reference UI, per project convention (`.claude/skills/ec-feature-parity`).
User confirmed keeping it as-is rather than gathering the reference and
rebuilding to match.

### 3. Top-bar features EasyContent has, ours doesn't
- **Share** — not built.
- **Edit with AI** — not built (AI module, Phase 4).
- Minor: "Save version" lives in the sidebar here, not the top bar.

## Suggested priority
Track Changes (#1) → advanced-table-ops UI verification against EasyContent
(#2) → Share / AI (#3, later phases).
