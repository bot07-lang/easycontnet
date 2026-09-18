import DOMPurify from 'dompurify';

/**
 * Sanitize stored rich-text HTML before it reaches dangerouslySetInnerHTML.
 *
 * content_field_values.value is written raw by the API (saveFieldValue does
 * no server-side sanitization — see content.service.ts) and RLS gates WHO can
 * write, not WHAT. The live editor is incidentally safe: loading HTML into
 * Tiptap round-trips it through the ProseMirror schema parser, which drops
 * anything outside the schema (script tags, event-handler attributes, etc.).
 * But two read-only views render the raw stored value directly — the version
 * "Preview" (ItemEditor's ReadOnlyField) and the version Compare dialog
 * (split and unified diff) — bypassing that schema entirely. Without this, a
 * project member with ordinary field-write access could PUT a script payload
 * straight to the API and have it execute in any teammate's browser the next
 * time they open that item's history.
 *
 * DOMPurify's default config already covers everything the editor's own
 * extensions produce (tables, data-* attributes, inline style, images, task
 * list checkboxes) while stripping script tags, event-handler attributes, and
 * javascript:/data: URLs. The one addition: `target` is in DOMPurify's
 * default *strip* list (a defense against target="_blank" without rel=
 * "noopener", i.e. reverse tabnabbing) — but this editor's own Link dialog
 * ("open in new window") already always pairs target with rel="noopener"
 * (EditorToolbar.tsx's applyLink), so allowing it here doesn't reopen that
 * risk, and without it every "open in new window" link would silently start
 * opening in the same tab in these read-only views.
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
}
