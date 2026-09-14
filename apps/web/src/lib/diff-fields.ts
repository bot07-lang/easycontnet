import HtmlDiffImport from 'htmldiff-js';
import type { StoredFile } from './api';

/**
 * Version compare — the diff engine.
 *
 * Every field's value is first rendered to HTML (`fieldValueToHtml`), then two
 * versions of that HTML are compared with an HTML-aware diff (`diffFieldHtml`).
 * Working at the HTML level means one uniform path handles *every* field — rich
 * body, plain title, checkboxes, images — and all formatting (bold, tables,
 * images…) survives the diff; only the changed runs get wrapped in `<ins>`/`<del>`.
 *
 * Why HTML-diff and not prosemirror-changeset: changeset needs the edit *steps*
 * between two docs, which we never record (we store finished snapshots). It also
 * only understands the rich fields. HTML-diff compares the docs directly and
 * covers all field types. See docs/editor-status.md.
 */

// htmldiff-js is a CJS (commonjs2) bundle whose ESM source does `export default`.
// Depending on the bundler's interop the imported value may be the class directly
// or nested one/two `.default` levels deep — walk down until we find `execute`.
type HtmlDiffExec = { execute(oldHtml: string, newHtml: string): string };
function resolveHtmlDiff(mod: unknown): HtmlDiffExec | null {
  let cur = mod as { execute?: unknown; default?: unknown } | undefined;
  for (let i = 0; i < 4 && cur && typeof cur.execute !== 'function'; i++) {
    cur = cur.default as typeof cur;
  }
  return cur && typeof cur.execute === 'function' ? (cur as HtmlDiffExec) : null;
}
const HtmlDiff = resolveHtmlDiff(HtmlDiffImport);

/** The field metadata the diff needs — a subset of ApiField/TemplateField. */
export interface DiffFieldMeta {
  id: string;
  type: string;
  label: string;
  isPlainText: boolean;
  choices?: string[];
}

/** Structural fields hold no per-item value, so they aren't compared. */
export function isDiffableField(type: string): boolean {
  return type !== 'heading' && type !== 'guidelines';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

/** Plain text → minimal block HTML (paragraphs + line breaks), so the diff has
 *  structure to align on. Empty/whitespace collapses to nothing. */
function plainToHtml(s: string): string {
  if (!s.trim()) return '';
  return s
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * Render one field's stored value to the HTML we diff on. Rich text is already
 * HTML; everything else is wrapped so a change is visible (a checkbox toggled,
 * a file added, an image swapped).
 *
 * `fileUrls` (id → thumbnail URL) lets the file/asset field render actual image
 * thumbnails in the diff instead of just names; without it (URLs not resolved) it
 * falls back to the file name.
 */
export function fieldValueToHtml(
  field: DiffFieldMeta,
  value: unknown,
  fileUrls?: Map<string, string>,
): string {
  switch (field.type) {
    case 'paragraph_text':
      // Rich body is stored as HTML already; a plain paragraph is text.
      return field.isPlainText ? plainToHtml(String(value ?? '')) : String(value ?? '');

    case 'single_line_text':
    case 'date':
      return plainToHtml(String(value ?? ''));

    case 'dropdown_select': {
      const sel = Array.isArray(value) ? String((value as string[])[0] ?? '') : '';
      return plainToHtml(sel);
    }

    case 'checkboxes':
    case 'radio_buttons': {
      const sel = Array.isArray(value) ? (value as string[]) : [];
      if (!sel.length) return '';
      return `<ul>${sel.map((c) => `<li>${escapeHtml(String(c))}</li>`).join('')}</ul>`;
    }

    // Both store the same {url, alt} shape (Field.tsx) — single_image was
    // missing here, so it always fell through to the default's '' (never
    // diffed, always exported as empty) even though export-html.ts's
    // fieldTypeTag already had a case for it.
    case 'featured_image':
    case 'single_image': {
      const v = (value ?? {}) as { url?: string; alt?: string };
      if (!v.url) return '';
      return `<img src="${escapeAttr(v.url)}" alt="${escapeAttr(v.alt ?? '')}">`;
    }

    case 'file_image_upload': {
      const files = Array.isArray(value) ? (value as StoredFile[]) : [];
      if (!files.length) return '';
      // Show an image thumbnail when a URL is resolved (added/removed files then
      // diff visually); fall back to the file name otherwise.
      return files
        .map((f) => {
          const url = fileUrls?.get(f.id);
          if (url && (f.mime ?? '').startsWith('image/')) {
            return `<figure class="cw-file"><img src="${escapeAttr(url)}" alt="${escapeAttr(f.name)}"><figcaption>${escapeHtml(f.name)}</figcaption></figure>`;
          }
          return `<div class="cw-file cw-file-name">${escapeHtml(f.name)}</div>`;
        })
        .join('');
    }

    default:
      return typeof value === 'string' ? plainToHtml(value) : '';
  }
}

/** True when the two rendered values differ (drives the "changed" markers). */
export function fieldChanged(oldHtml: string, newHtml: string): boolean {
  return oldHtml !== newHtml;
}

/**
 * HTML-aware diff of two field renderings. Returns HTML with changes wrapped in
 * `<ins class="diffins|diffmod">` / `<del class="diffdel|diffmod">`, leaving the
 * surrounding tags (images, tables, formatting) intact. Identical input is
 * returned unchanged (no wasted work, no spurious markup).
 */
export function diffFieldHtml(oldHtml: string, newHtml: string): string {
  if (oldHtml === newHtml) return newHtml;
  // Block-level replacement wrappers (cw-block) so the red/green background paints
  // the whole old/new block, not a collapsed inline box.
  const replace = `<del class="cw-block">${oldHtml}</del><ins class="cw-block">${newHtml}</ins>`;
  if (!HtmlDiff) return replace; // engine failed to resolve — degrade gracefully
  try {
    const out = HtmlDiff.execute(oldHtml, newHtml);
    // When only formatting/structure changed with identical text (a colour span,
    // a bullet↔numbered list, etc.), htmldiff emits NO <ins>/<del> and silently
    // returns the new version — so the change wouldn't show. Fall back to an
    // explicit old→new replacement (old struck red, new green), matching the
    // reference's block-replace behaviour.
    return /<(?:ins|del)\b/i.test(out) ? out : replace;
  } catch {
    // Never let a diff edge-case break the compare view.
    return replace;
  }
}
