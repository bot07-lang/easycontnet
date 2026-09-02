# Editor — completion status

Snapshot of what's built vs. left in the content-item editor (`ItemEditor.tsx`,
`EditorToolbar.tsx`, `RichTextField.tsx`, `TableMenu.tsx`, `editor-extensions.ts`,
`toolbar-parts.tsx`). Local reference — not committed.

## Built and working
- Rich text: bold / italic / underline, headings & paragraph, text color,
  highlight, bullet & numbered lists, indent/outdent, alignment, links, images,
  YouTube video, inline code / code block, fullscreen.
- Full menu bar: File / Edit / View / Insert / Format / Tools / Table.
- Basic table editing: insert/delete rows & columns, merge/split cells.
- Per-field autosave (debounced) with save-state indicator.
- Plain-vs-rich fields (driven by `template_fields.is_plain_text`).
- Version history: list, **+ Save version**, restore, rename; All / Named
  sub-tabs, grouped by date, kind badge, author+role, status dot, ⋮ menu.
- Status shown in the editor header as a read-only badge.

## Left to complete

### 1. Comments — Phase 2 (biggest gap; module 8 `collaboration`)
- Toolbar **"Add a comment"** button — disabled stub
  (`EditorToolbar.tsx` ~L707).
- Right-sidebar **Comments** tab — "Comments are coming in a later phase"
  (`ItemEditor.tsx` L165).
- Most existing UI hooks are already stubbed in; needs a `comments` table + RLS,
  API, and the anchor mark (`<mark data-comment>`), per `docs/file-library.md`
  discussion and the free-Tiptap approach (no Tiptap Pro).

### 2. Track Changes — Phase 2
- Toolbar **Track Changes** button — disabled stub (`EditorToolbar.tsx` ~L715).

### 3. Version compare / diff — **being built (HTML-diff approach)**
- **"Compare versions"** button disabled — "Compare view coming next"
  (`ItemEditor.tsx` L210). Save/restore/rename work; diffing two versions does not.

**What it is (simple words):** a Compare view that shows two versions of an item
side by side and highlights what changed — text you removed in **red strikethrough**,
text you added in **green** — while keeping *all* formatting intact: bold, headings,
colors, lists, tables, and **images**. You can compare any two versions, including
the **current (live) values** against an older saved snapshot. From it you can
**Restore** an older version.

**How it works (simple words):**
1. Every field's value can be expressed as **HTML** (rich body already is; the title
   and other plain fields are trivially HTML; the file field renders its files as
   `<img>`). This is the same reason EasyContent's "export as HTML" turns the whole
   item — title included — into HTML.
2. To compare version A with version B, for **each field** we take A's HTML and B's
   HTML and run an **HTML diff**. The diff walks both HTML strings and wraps the
   changes in `<ins>` (added) / `<del>` (removed) tags **without disturbing the
   surrounding tags** — so an image, a table cell, or a bold run survives and only
   the changed part is marked.
3. We render that diffed HTML per field and style `ins`/`del` green/red. Because it
   works on the HTML itself, it compares **everything** (images, tables, superscript,
   font sizes, alignment…) in one uniform pass — no special-casing per format.

**Why HTML-diff and not `changeset`:** `changeset` (ProseMirror) can't compare two
documents — it only consumes the *edit-steps* between them, which we never recorded
(we save finished snapshots). Reconstructing fake steps needs
`prosemirror-recreate-transform`, an unmaintained/forked dependency that *also* only
covers the rich fields (not title/files/etc.). HTML-diff compares the docs directly,
covers **all** fields uniformly, and is framework-agnostic (a TipTap upgrade can't
break it).

**Library:** [`htmldiff-js`](https://github.com/dfoverdx/htmldiff-js) — ISC license,
**zero dependencies**, ~131k weekly downloads. A JS port of the long-established
HtmlDiff (C#/Ruby lineage). Verified locally to diff images, table cells, bold runs,
and plain text cleanly; emits `diffins`/`diffdel`/`diffmod` classes we style
ourselves.

**Plan:** `apps/web/src/lib/diff-fields.ts` (`fieldToHtml` + `diffFieldHtml`) →
`CompareDialog.tsx` (two version pickers incl. Current, per-tab per-field diff,
red/green, "Switch to split view" toggle, Restore) → wire the disabled button.

### 4. In-editor workflow
- Right-sidebar **Controls** tab (submit / approve / reject) — stubbed
  ("Workflow controls … are coming next", `ItemEditor.tsx` L165).
- Editor header **status is read-only** — no status transition from inside the
  editor (status changes currently happen from the content-items table).

### 5. Advanced table operations (Table menu stubs)
Basic table editing works; these are hard-disabled:
- Table of contents (Insert menu).
- Cell properties, Row properties, Table properties.
- Cut/Copy/Paste **row**, Cut/Copy/Paste **column**.

### 6. Top-bar features EasyContent has, ours doesn't
- **Share** — not built.
- **Edit with AI** — not built (AI module, Phase 4).
- Minor: "Save version" lives in the sidebar here, not the top bar.

## Suggested priority
Comments (#1) → in-editor workflow controls / status transitions (#4) →
version compare (#3) & track changes (#2) → advanced table ops (#5) →
Share / AI (#6, later phases).

Comments is both the largest gap and the one most wired-up for already; it's the
same collaboration module flagged as the next feature.
