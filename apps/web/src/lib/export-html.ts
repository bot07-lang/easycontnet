import { fieldValueToHtml } from './diff-fields';
import type { ApiItem } from './api';

/**
 * Standalone-HTML export for a content item, mirroring the reference export: a
 * details header + a tabbed layout, each field an `.ec-field` block with its
 * [type] tag, guideline and value. Kept in a plain lib (no editor/TipTap deps)
 * so both the item editor and the content-items row menu can trigger it without
 * pulling the heavy editor bundle.
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => esc(s).replace(/"/g, '&quot;');

/** Human field-type tag shown before each field name, matching the reference. */
function fieldTypeTag(type: string, isPlainText: boolean): string {
  switch (type) {
    case 'single_line_text': return '[text field]';
    case 'paragraph_text': return isPlainText ? '[text area – plain text]' : '[text area - rich text]';
    case 'file_image_upload': return '[asset]';
    case 'featured_image': return '[asset]';
    case 'single_image': return '[image]';
    case 'checkboxes': return '[checkboxes]';
    case 'radio_buttons': return '[radio buttons]';
    case 'dropdown_select': return '[dropdown]';
    case 'date': return '[date]';
    case 'heading': return '[heading]';
    case 'guidelines': return '[guidelines]';
    // Friendly fallback — never leak a raw snake_case type key.
    default: return `[${type.replace(/_/g, ' ')}]`;
  }
}

/** Render one field to an `.ec-field` block: [type] label + guideline + value. */
function renderExportField(
  f: { id: string; type: string; label: string; isPlainText: boolean; guidelines?: string; choices: string[] },
  value: unknown,
  fileUrls: Map<string, string>,
): string {
  const tag = fieldTypeTag(f.type, f.isPlainText);
  const guideline = f.guidelines ? `<p class="field-guideline">${esc(f.guidelines)}</p>` : '';
  const name = (label: string) => `<p class="field-name">${tag} ${esc(label)}</p>`;

  if (f.type === 'heading') return `<div class="ec-field">${name('')}<p>${esc(f.label)}</p></div>`;
  if (f.type === 'guidelines') return `<div class="ec-field">${name('')}<p>${esc(String(value ?? f.label ?? ''))}</p></div>`;

  let body: string;
  if (f.type === 'checkboxes' || f.type === 'radio_buttons') {
    const sel = Array.isArray(value) ? (value as string[]) : [];
    const inputType = f.type === 'radio_buttons' ? 'radio' : 'checkbox';
    body = (f.choices ?? [])
      .map((c, i) => {
        const cid = `${f.id}-${i}`;
        const checked = sel.includes(c) ? ' checked' : '';
        return `<input type="${inputType}" id="${escAttr(cid)}" name="${escAttr(f.id)}"${checked} disabled><label for="${escAttr(cid)}">${esc(c)}</label><br>`;
      })
      .join('');
  } else if (f.type === 'file_image_upload') {
    const files = Array.isArray(value) ? (value as { id: string; name: string; mime: string | null }[]) : [];
    if (!files.length) {
      body = '<p class="empty">—</p>';
    } else {
      const rows = files
        .map((sf) => {
          const url = fileUrls.get(sf.id);
          const link = url ? `<a href="${escAttr(url)}">Link</a>` : '—';
          const preview = url && (sf.mime ?? '').startsWith('image/') ? `<img src="${escAttr(url)}">` : '';
          return `<tr><td>${esc(sf.name)}</td><td>${link}</td><td>${preview}</td></tr>`;
        })
        .join('');
      body = `<table><tbody><tr><th>File name</th><th>File URL</th><th>Preview</th></tr>${rows}</tbody></table>`;
    }
  } else {
    body = fieldValueToHtml({ id: f.id, type: f.type, label: f.label, isPlainText: f.isPlainText, choices: f.choices }, value) || '<p class="empty">—</p>';
  }
  return `<div class="ec-field">${name(f.label)}${guideline}${body}</div>`;
}

const EXPORT_STYLE = `
body { background:#eee; min-height:100vh; box-sizing:border-box; font-family:"Helvetica Neue",Helvetica,Arial,sans-serif; font-weight:300; max-width:60rem; margin:0 auto; }
.item-details { padding:1rem; }
.main-content { display:flex; flex-wrap:wrap; }
.main-content label { order:1; display:block; padding:1rem 2rem; margin:0 0.2rem 0.2rem 0; cursor:pointer; background:#90CAF9; font-weight:bold; transition:background ease 0.2s; }
.main-content .tab { order:99; flex-grow:1; width:100%; display:none; padding:1rem; background:#fff; }
.main-content input[type="radio"] { display:none; }
.main-content input[type="radio"]:checked + label { background:#fff; }
.main-content input[type="radio"]:checked + label + .tab { display:block; }
.ec-field { border:2px solid; padding:8px; margin:8px; }
.ec-field img { max-width:100%; height:auto; }
.ec-field table img { max-width:150px; display:block; margin:auto; }
h3 { margin-left:8px; }
.ec-field input, .ec-field label { all: revert !important; }
.field-name { text-decoration:underline; font-weight:bold; }
.field-guideline { color:#878787; font-style:italic; }
.empty { color:#878787; font-style:italic; }
table { border-collapse:collapse; width:100%; }
td, th { border:1px solid #ddd; text-align:left; padding:8px; }
tr:nth-child(even) { background:#ddd; }
@media (max-width:45em) { .main-content .tab, .main-content label { order:initial; } .main-content label { width:100%; margin-right:0; margin-top:0.2rem; } }
`;

export function buildItemHtml(
  item: ApiItem,
  values: Record<string, unknown>,
  fileUrls: Map<string, string>,
  exportDate: string,
): string {
  const tabs = item.tabs
    .map((t, ti) => {
      const fields = t.fields.map((f) => renderExportField(f, values[f.id], fileUrls)).join('');
      const id = `ec-tab-${ti}`;
      return `<input type="radio" id="${id}" name="ec-tabs"${ti === 0 ? ' checked' : ''}><label for="${id}">${esc(t.name)}</label><div class="tab">${fields}</div>`;
    })
    .join('');
  const authorField = item.tabs.flatMap((t) => t.fields).find((f) => /author/i.test(f.label));
  const author = authorField ? String(values[authorField.id] ?? '').replace(/<[^>]*>/g, '').trim() : '';
  const authorMeta = author ? `\n<meta name="author" content="${escAttr(author)}"/>` : '';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="generator" content="Content Workflow"/>${authorMeta}
<title>${esc(item.name)}</title>
<style>${EXPORT_STYLE}</style></head>
<body>
<div class="item-details">
  <p><span style="font-weight:bold;">Brief Title: </span>${esc(item.name)}</p>
  <p><span style="font-weight:bold;">Status: </span>${esc(item.status?.name ?? '')}</p>
  <p><span style="font-weight:bold;">Export Date: </span>${esc(exportDate)}</p>
</div>
<div class="main-content">${tabs}</div>
</body></html>`;
}

/** Trigger a client-side file download of a text blob. */
export function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Current date as "Jul-27, 2026" (matching the reference export header). */
export function exportDateLabel(): string {
  const d = new Date();
  return `${d.toLocaleDateString('en-US', { month: 'short' })}-${d.getDate()}, ${d.getFullYear()}`;
}

/** Build + download an item's HTML, deriving values from its loaded field values. */
export function downloadItemHtml(item: ApiItem, fileUrls: Map<string, string>) {
  const values = Object.fromEntries(item.tabs.flatMap((t) => t.fields).map((f) => [f.id, f.value]));
  downloadText(`${item.name || 'content'}.html`, buildItemHtml(item, values, fileUrls, exportDateLabel()), 'text/html');
}
