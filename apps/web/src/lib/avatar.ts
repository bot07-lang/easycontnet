/**
 * Deterministic avatar colour + initial for a person's name. Shared so the SAME
 * person is always the same colour everywhere they appear (people column,
 * timeline, assign dialog, workflow ladder) — a per-component palette would hash
 * the name to a different colour in each place.
 */
const PALETTE = ['#e11d48', '#7c3aed', '#0891b2', '#ea580c', '#059669', '#4f46e5', '#db2777', '#0ea5e9'];

export function avatarColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

/** Single leading letter, uppercased (assigned-avatar convention). */
export function avatarInitial(name: string): string {
  return (name.trim()[0] ?? '').toUpperCase();
}
