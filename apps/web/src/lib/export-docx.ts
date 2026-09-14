import {
  Document, Packer, Paragraph, TextRun, PageBreak, Table, TableRow, TableCell,
  WidthType, BorderStyle, ExternalHyperlink, ImageRun, LevelFormat, AlignmentType,
  TableLayoutType,
} from 'docx';
import { fieldValueToHtml } from './diff-fields';
import { fieldTypeTag } from './export-html';
import { exportDateLabel } from './export-html';
import type { ApiItem, ApiField } from './api';

/**
 * Standalone-DOCX export for a content item, mirroring the reference export
 * (demo_item_2.docx): a details header + page break, then each tab's title and
 * its fields — every field an `[type] Label` name (bold + underlined), a grey
 * italic guideline, and the value. Rich-text values are parsed from their stored
 * HTML into styled Word runs (bold/italic/colour/highlight/lists/images). Built
 * from the item data with the `docx` library (no HTML→DOCX conversion); this
 * whole module is lazy-loaded so the library stays out of the initial bundle.
 */

// Colours from the reference document.xml.
const BLACK = '000000';
const TAB_TITLE = '4A6AA4';
const GUIDELINE = 'C9C9C9';
const LINK = '4D8FD3';
const NAME_SIZE = 36; // half-points → 18pt (field names)
const TITLE_SIZE = 44; // → 22pt (tab titles)

type LoadedImage = { data: Uint8Array; width: number; height: number; type: 'jpg' | 'png' | 'gif' | 'bmp' };
type Values = Record<string, unknown>;

const stripHtml = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

/** Normalise a CSS colour (#hex, #abc, rgb(), a few names) to 6-hex, or null. */
function normColor(css: string | null | undefined): string | undefined {
  if (!css) return undefined;
  const c = css.trim().toLowerCase();
  const names: Record<string, string> = { red: 'FF0000', black: '000000', white: 'FFFFFF', blue: '0000FF', green: '008000' };
  if (names[c]) return names[c];
  let m = /^#([0-9a-f]{6})$/.exec(c);
  if (m) return m[1]!.toUpperCase();
  m = /^#([0-9a-f]{3})$/.exec(c);
  if (m) return m[1]!.split('').map((h) => h + h).join('').toUpperCase();
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(c);
  if (m) return [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
  return undefined;
}

function imgType(mime: string, url: string): LoadedImage['type'] | null {
  const s = `${mime} ${url}`.toLowerCase();
  if (s.includes('png')) return 'png';
  if (s.includes('gif')) return 'gif';
  if (s.includes('bmp')) return 'bmp';
  if (s.includes('jpg') || s.includes('jpeg')) return 'jpg';
  return null;
}

/** Fetch + decode one image so it can be embedded; null on any failure. */
async function loadImage(url: string): Promise<LoadedImage | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    let type = imgType(blob.type, url);
    let data = new Uint8Array(await blob.arrayBuffer());
    let width = 300;
    let height = 200;
    try {
      const bmp = await createImageBitmap(blob);
      width = bmp.width; height = bmp.height;
      if (!type) {
        // Not one of the four formats `docx`'s ImageRun natively accepts (e.g.
        // webp, which browsers decode fine but Word embedding does not support)
        // — the browser CAN still decode it (createImageBitmap succeeded), so
        // re-encode to PNG via canvas instead of silently dropping the image.
        const canvas = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(bmp, 0, 0);
          const pngBlob = await canvas.convertToBlob({ type: 'image/png' });
          data = new Uint8Array(await pngBlob.arrayBuffer());
          type = 'png';
        }
      }
      bmp.close?.();
    } catch { /* keep defaults; bail below if we still have no usable type */ }
    if (!type) return null;
    return { data, width, height, type };
  } catch {
    return null;
  }
}

/** An ImageRun scaled to fit maxW (px), preserving aspect ratio. */
function imageRun(img: LoadedImage, maxW: number): ImageRun {
  const scale = Math.min(1, maxW / img.width);
  return new ImageRun({
    data: img.data,
    type: img.type,
    transformation: { width: Math.round(img.width * scale), height: Math.round(img.height * scale) },
  });
}

/** Collect every image URL the document will try to embed, so they can be
 *  pre-fetched before the (synchronous) build. */
function collectImageUrls(item: ApiItem, values: Values, fileUrls: Map<string, string>): string[] {
  const urls = new Set<string>();
  for (const f of item.tabs.flatMap((t) => t.fields)) {
    const v = values[f.id];
    if (f.type === 'file_image_upload' && Array.isArray(v)) {
      for (const sf of v as { id: string; mime: string | null }[]) {
        if ((sf.mime ?? '').startsWith('image/')) {
          const u = fileUrls.get(sf.id);
          if (u) urls.add(u);
        }
      }
    }
    if (f.type === 'paragraph_text' && !f.isPlainText && typeof v === 'string') {
      const doc = new DOMParser().parseFromString(v, 'text/html');
      doc.querySelectorAll('img').forEach((el) => {
        const src = el.getAttribute('src');
        if (src && /^https?:/i.test(src)) urls.add(src);
      });
    }
    if (f.type === 'single_image' && v && typeof v === 'object') {
      const url = (v as { url?: string }).url;
      if (url) urls.add(url);
    }
  }
  return [...urls];
}

// ---- run/paragraph helpers matching the reference styling ----

const spacer = () => new Paragraph({});

/** `[type] Label` — bold, underlined, 18pt, black. A single run like the reference. */
function nameParagraph(tag: string, label: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: `${tag} ${label}`.trimEnd() + (label ? '' : ' '), bold: true, underline: {}, color: BLACK, size: NAME_SIZE })],
  });
}

function guidelineParagraph(text: string): Paragraph {
  return new Paragraph({ children: [new TextRun({ text, italics: true, color: GUIDELINE })] });
}

function plainParagraph(text: string): Paragraph {
  return new Paragraph({ children: [new TextRun({ text, color: BLACK })] });
}

/** A genuinely-plain-text value (never HTML) split into Word paragraphs the
 *  same way diff-fields.ts's plainToHtml does: a blank line starts a new
 *  Word paragraph, a single newline becomes a soft line break within one —
 *  otherwise multi-line plain text collapses onto a single visual line. */
function plainParagraphs(text: string): Paragraph[] {
  return text.split(/\n{2,}/).map((block) => {
    const lines = block.split('\n');
    const children: TextRun[] = [];
    lines.forEach((line, i) => {
      if (i > 0) children.push(new TextRun({ break: 1 }));
      children.push(new TextRun({ text: line, color: BLACK }));
    });
    return new Paragraph({ children });
  });
}

// ---- rich text (stored HTML) → Word paragraphs ----

type Fmt = { bold?: boolean; italics?: boolean; underline?: boolean; strike?: boolean; color?: string; shading?: string; link?: string };

/** Inline children of a block element → runs (text / images / hyperlinks). */
function inlineRuns(node: Node, fmt: Fmt, images: Map<string, LoadedImage>): (TextRun | ImageRun | ExternalHyperlink)[] {
  const out: (TextRun | ImageRun | ExternalHyperlink)[] = [];
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? '';
      if (text) out.push(new TextRun({
        text, bold: fmt.bold, italics: fmt.italics, strike: fmt.strike,
        underline: fmt.underline ? {} : undefined, color: fmt.color,
        shading: fmt.shading ? { type: 'clear', fill: fmt.shading } : undefined,
      }));
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const el = child as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === 'br') { out.push(new TextRun({ text: '', break: 1 })); return; }
    if (tag === 'img') {
      const src = el.getAttribute('src') ?? '';
      const img = images.get(src);
      if (img) out.push(imageRun(img, 450));
      return;
    }
    const nf: Fmt = { ...fmt };
    if (tag === 'strong' || tag === 'b') nf.bold = true;
    if (tag === 'em' || tag === 'i') nf.italics = true;
    if (tag === 'u') nf.underline = true;
    if (tag === 's' || tag === 'strike' || tag === 'del') nf.strike = true;
    if (tag === 'a') nf.link = el.getAttribute('href') ?? undefined;
    const style = el.getAttribute('style') ?? '';
    const col = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(style);
    if (col) nf.color = normColor(col[1]) ?? nf.color;
    const bg = /background(?:-color)?\s*:\s*([^;]+)/i.exec(style);
    if (bg) nf.shading = normColor(bg[1]) ?? nf.shading;
    const kids = inlineRuns(el, nf, images);
    if (tag === 'a' && nf.link) {
      out.push(new ExternalHyperlink({ link: nf.link, children: kids }));
    } else {
      out.push(...kids);
    }
  });
  return out;
}

/** A stored rich-text HTML fragment → an array of Word paragraphs. */
function richParagraphs(html: string, images: Map<string, LoadedImage>): Paragraph[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: Paragraph[] = [];
  const blocks = Array.from(doc.body.childNodes);

  const pushList = (listEl: HTMLElement, ordered: boolean) => {
    listEl.querySelectorAll(':scope > li').forEach((li) => {
      out.push(new Paragraph({
        children: inlineRuns(li, {}, images),
        numbering: { reference: ordered ? 'ec-ol' : 'ec-ul', level: 0 },
      }));
    });
  };

  for (const node of blocks) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent ?? '';
      if (t.trim()) out.push(new Paragraph({ children: [new TextRun({ text: t })] }));
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === 'ul') { pushList(el, false); continue; }
    if (tag === 'ol') { pushList(el, true); continue; }
    if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4') {
      out.push(new Paragraph({ children: inlineRuns(el, { bold: true }, images), spacing: { before: 120, after: 60 } }));
      continue;
    }
    if (tag === 'blockquote') {
      out.push(new Paragraph({ children: inlineRuns(el, { italics: true, color: '878787' }, images), indent: { left: 360 } }));
      continue;
    }
    // p and anything else → one paragraph.
    out.push(new Paragraph({ children: inlineRuns(el, {}, images) }));
  }
  return out.length ? out : [plainParagraph('')];
}

// ---- one field → its paragraphs (name + guideline + value) ----

function fieldParagraphs(f: ApiField, value: unknown, fileUrls: Map<string, string>, images: Map<string, LoadedImage>): (Paragraph | Table)[] {
  const tag = fieldTypeTag(f.type, f.isPlainText);
  const out: (Paragraph | Table)[] = [];

  if (f.type === 'heading') {
    out.push(nameParagraph(tag, ''));
    out.push(plainParagraph(f.label));
    return out;
  }
  if (f.type === 'guidelines') {
    out.push(nameParagraph(tag, ''));
    out.push(plainParagraph(String(value ?? f.label ?? '')));
    return out;
  }

  out.push(nameParagraph(tag, f.label));
  if (f.guidelines) out.push(guidelineParagraph(f.guidelines));

  if (f.type === 'checkboxes' || f.type === 'radio_buttons') {
    const sel = Array.isArray(value) ? (value as string[]) : [];
    for (const c of f.choices ?? []) out.push(plainParagraph(`[${sel.includes(c) ? 'x' : ' '}] ${c}`));
    return out;
  }

  if (f.type === 'file_image_upload') {
    const files = Array.isArray(value) ? (value as { id: string; name: string; mime: string | null }[]) : [];
    out.push(fileTable(files, fileUrls, images));
    return out;
  }

  // single_image stores {url, alt} — embed the image itself (via the
  // pre-fetched `images` map, same as file_image_upload) instead of falling
  // to the generic stripHtml(fieldValueToHtml(...)) path below, which strips
  // the <img> tag down to nothing since it has no text content.
  if (f.type === 'single_image') {
    const v = (value ?? {}) as { url?: string; alt?: string };
    const img = v.url ? images.get(v.url) : undefined;
    if (img) {
      out.push(new Paragraph({ children: [imageRun(img, 300)] }));
    } else if (v.url) {
      // Image URL set but couldn't be fetched/decoded — still surface the URL
      // rather than silently rendering nothing.
      out.push(new Paragraph({ children: [new ExternalHyperlink({ link: v.url, children: [new TextRun({ text: v.url, color: LINK, underline: {} })] })] }));
    } else {
      out.push(plainParagraph('—'));
    }
    return out;
  }

  if (f.type === 'paragraph_text' && !f.isPlainText && typeof value === 'string') {
    out.push(...richParagraphs(value, images));
    return out;
  }

  // A plain-text area (isPlainText — the !isPlainText / HTML case already
  // returned above) is never HTML, so it's split into paragraphs/line breaks
  // as-is rather than run through stripHtml, which would delete any literal
  // "<"/">" the user typed and had no tags to strip in the first place.
  if (f.type === 'paragraph_text' && typeof value === 'string') {
    out.push(...plainParagraphs(value));
    return out;
  }

  // Single line, date, dropdown, and any other simple value → one plain
  // paragraph. Non-string values here (e.g. a stale/unknown shape) still go
  // through fieldValueToHtml + stripHtml as a best-effort text fallback.
  const text = typeof value === 'string'
    ? value
    : stripHtml(fieldValueToHtml({ id: f.id, type: f.type, label: f.label, isPlainText: f.isPlainText, choices: f.choices }, value) || '');
  out.push(plainParagraph(text));
  return out;
}

// ---- the asset/files 3-column table ----

const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: BLACK };
const CELL_BORDERS = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };
// Fixed column widths in twips, matching the reference exactly (3333-dxa columns
// + autofit layout). Percentage widths made Word collapse columns to ~1 char wide.
const COL_W = 3333;

function headerCell(text: string): TableCell {
  return new TableCell({
    width: { size: COL_W, type: WidthType.DXA }, borders: CELL_BORDERS,
    children: [new Paragraph({ children: [new TextRun({ text, bold: true })] })],
  });
}
function bodyCell(children: Paragraph[]): TableCell {
  return new TableCell({ width: { size: COL_W, type: WidthType.DXA }, borders: CELL_BORDERS, children });
}

function fileTable(files: { id: string; name: string; mime: string | null }[], fileUrls: Map<string, string>, images: Map<string, LoadedImage>): Table {
  const rows: TableRow[] = [
    new TableRow({ tableHeader: true, children: [headerCell('File name'), headerCell('File URL'), headerCell('Preview')] }),
  ];
  for (const sf of files) {
    const url = fileUrls.get(sf.id);
    const linkCell = url
      ? bodyCell([new Paragraph({ children: [new ExternalHyperlink({ link: url, children: [new TextRun({ text: 'Link', color: LINK, underline: {} })] })] })])
      : bodyCell([plainParagraph('—')]);
    const img = url && (sf.mime ?? '').startsWith('image/') ? images.get(url) : undefined;
    const previewCell = img
      ? bodyCell([new Paragraph({ children: [imageRun(img, 150)], alignment: AlignmentType.CENTER })])
      : bodyCell([plainParagraph('N/A')]);
    rows.push(new TableRow({ children: [bodyCell([plainParagraph(sf.name)]), linkCell, previewCell] }));
  }
  return new Table({
    width: { size: 0, type: WidthType.AUTO },
    columnWidths: [COL_W, COL_W, COL_W],
    layout: TableLayoutType.AUTOFIT,
    rows,
  });
}

// ---- the whole document ----

function buildDoc(item: ApiItem, values: Values, fileUrls: Map<string, string>, images: Map<string, LoadedImage>, exportDate: string): Document {
  const body: (Paragraph | Table)[] = [];

  const detail = (label: string, value: string) => new Paragraph({
    children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun({ text: value, color: BLACK })],
  });
  body.push(detail('Brief Title', item.name));
  body.push(detail('Status', item.status?.name ?? ''));
  body.push(detail('Export Date', exportDate));
  body.push(new Paragraph({ children: [new PageBreak()] }));

  for (const tab of item.tabs) {
    body.push(new Paragraph({ children: [new TextRun({ text: tab.name, bold: true, color: TAB_TITLE, size: TITLE_SIZE })] }));
    body.push(spacer());
    for (const f of tab.fields) {
      body.push(...fieldParagraphs(f, values[f.id], fileUrls, images));
      body.push(spacer());
    }
  }

  return new Document({
    numbering: {
      config: [
        { reference: 'ec-ol', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT }] },
        { reference: 'ec-ul', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT }] },
      ],
    },
    sections: [{ children: body }],
  });
}

/** Build the item's .docx as a Blob (pre-fetches embeddable images first). */
export async function buildItemDocx(item: ApiItem, values: Values, fileUrls: Map<string, string>, exportDate: string): Promise<Blob> {
  const images = new Map<string, LoadedImage>();
  await Promise.all(collectImageUrls(item, values, fileUrls).map(async (url) => {
    const img = await loadImage(url);
    if (img) images.set(url, img);
  }));
  return Packer.toBlob(buildDoc(item, values, fileUrls, images, exportDate));
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Build + download an item's .docx, deriving values from its loaded fields. */
export async function downloadItemDocx(item: ApiItem, fileUrls: Map<string, string>) {
  const values = Object.fromEntries(item.tabs.flatMap((t) => t.fields).map((f) => [f.id, f.value]));
  const blob = await buildItemDocx(item, values, fileUrls, exportDateLabel());
  downloadBlob(`${item.name || 'content'}.docx`, blob);
}
