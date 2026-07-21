/**
 * Word and character counting for field headers.
 *
 * Limits are ADVISORY. Passing one turns the counter red and shows an error
 * icon, but never blocks typing, saving or submission — confirmed against
 * EasyContent's compiled length indicator, which only toggles a CSS class.
 * Only `isRequired` blocks anything.
 */

export interface Counts {
  words: number;
  characters: number;
}

/** Strips HTML so rich-text fields count their text, not their markup. */
export function toPlainText(value: unknown): string {
  if (typeof value !== 'string') return '';
  if (!value.includes('<')) return value;
  const el = document.createElement('div');
  el.innerHTML = value;
  return el.textContent ?? '';
}

export function countText(value: unknown): Counts {
  const plain = toPlainText(value);
  const trimmed = plain.trim();
  return {
    words: trimmed ? trimmed.split(/\s+/).length : 0,
    characters: plain.length,
  };
}

export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}
