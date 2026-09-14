import { useRef, useState } from 'react';
import { clamp01, hexToRgb, hsvToRgb, rgbToHex, rgbToHsv } from '../lib/color';
import { useOverflowsRight } from '../lib/overflow';
import { useClickAway } from './toolbar-parts';

/**
 * Combined Text Color / Highlight Color picker — matches the reference's single
 * popover (Recently Used + Text Color + Highlight Color sections, circular
 * swatches, an inline gradient/hue custom picker with Apply) rather than two
 * separate flat-grid dropdowns. Colours below are close visual equivalents to
 * the reference, not extracted pixel-exact hex values.
 */

const TEXT_COLORS = [
  '#1F2937', '#6B7280', '#D97706', '#EA580C', '#16A34A',
  '#2563EB', '#9333EA', '#DB2777', '#DC2626',
];
const HIGHLIGHT_COLORS = [
  '#FFFFFF', '#E5E7EB', '#FED7AA', '#FEF08A', '#BBF7D0',
  '#BFDBFE', '#E9D5FF', '#FBCFE8', '#FECACA',
];

const RECENT_KEY = 'cw:recent-colors';
const MAX_RECENT = 5;
type Kind = 'text' | 'highlight';
type Recent = { hex: string; kind: Kind };

function loadRecent(): Recent[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r): r is Recent => !!r && typeof r.hex === 'string' && (r.kind === 'text' || r.kind === 'highlight'))
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}
function pushRecent(hex: string, kind: Kind): Recent[] {
  const cur = loadRecent().filter((r) => !(r.hex.toLowerCase() === hex.toLowerCase() && r.kind === kind));
  const next = [{ hex, kind }, ...cur].slice(0, MAX_RECENT);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* quota / private mode */ }
  return next;
}

export function TextHighlightColorPicker({
  textColor, highlightColor, onPickText, onClearText, onPickHighlight, onClearHighlight,
}: {
  textColor?: string;
  highlightColor?: string;
  onPickText: (hex: string) => void;
  onClearText: () => void;
  onPickHighlight: (hex: string) => void;
  onClearHighlight: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<Recent[]>(() => loadRecent());
  const [custom, setCustom] = useState<Kind | null>(null);
  const ref = useClickAway(() => { setOpen(false); setCustom(null); });
  // The custom-colour panel adds another ~230px to the right of the main
  // panel — easily clipped by the field card's own overflow-hidden well
  // before the browser edge. Measured against the real clipping boundary
  // (same helper as the toolbar's other flip-aware popovers) rather than
  // assumed, so it flips to the LEFT of the main panel instead of running
  // off whenever there isn't room.
  const rowRef = useRef<HTMLDivElement>(null);
  const flipCustom = useOverflowsRight(rowRef, !!custom);

  const pick = (kind: Kind, hex: string) => {
    if (kind === 'text') onPickText(hex); else onPickHighlight(hex);
    setRecent(pushRecent(hex, kind));
    setOpen(false);
    setCustom(null);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => { setOpen((v) => !v); setCustom(null); }}
        title="Text and highlight colour"
        aria-label="Text and highlight colour"
        className={`flex h-8 items-center gap-0.5 rounded px-1.5 text-slate-700 hover:bg-slate-200 ${open ? 'bg-slate-200' : ''}`}
      >
        <span className="grid place-items-center leading-none">
          <span className="text-[14px] font-semibold">A</span>
          <span className="mt-0.5 block h-[3px] w-[15px] rounded-sm" style={{ background: textColor ?? '#0f172a' }} />
        </span>
        <span className="text-[9px] leading-none text-slate-500">▾</span>
      </button>

      {open && (
        <div ref={rowRef} className={`absolute left-0 top-9 z-30 flex items-start gap-2 ${flipCustom ? 'flex-row-reverse' : ''}`}>
          <div className="w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-xl">
            {recent.length > 0 && (
              <Section label="Recently Used">
                {recent.map((r, i) => (
                  <Swatch key={`${r.kind}-${r.hex}-${i}`} hex={r.hex} letter onClick={() => pick(r.kind, r.hex)} />
                ))}
              </Section>
            )}

            <Section label="Text Color">
              {TEXT_COLORS.map((hex) => (
                <Swatch key={hex} hex={hex} letter active={textColor?.toLowerCase() === hex.toLowerCase()}
                        onClick={() => pick('text', hex)} />
              ))}
              <PlusSwatch onClick={() => setCustom(custom === 'text' ? null : 'text')} active={custom === 'text'} />
            </Section>
            {textColor && (
              <button type="button" onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { onClearText(); setOpen(false); }}
                      className="mb-3 text-[12px] text-slate-500 hover:text-slate-700 hover:underline">
                Remove text colour
              </button>
            )}

            <Section label="Highlight Color" last>
              {HIGHLIGHT_COLORS.map((hex) => (
                <Swatch key={hex} hex={hex} active={highlightColor?.toLowerCase() === hex.toLowerCase()}
                        onClick={() => pick('highlight', hex)} />
              ))}
              <PlusSwatch onClick={() => setCustom(custom === 'highlight' ? null : 'highlight')} active={custom === 'highlight'} />
            </Section>
            {highlightColor && (
              <button type="button" onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { onClearHighlight(); setOpen(false); }}
                      className="mt-2 text-[12px] text-slate-500 hover:text-slate-700 hover:underline">
                Remove highlight colour
              </button>
            )}
          </div>

          {custom && (
            <CustomColorPanel
              initial={(custom === 'text' ? textColor : highlightColor) ?? '#000000'}
              onApply={(hex) => pick(custom, hex)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function Section({ label, last, children }: { label: string; last?: boolean; children: React.ReactNode }) {
  return (
    <div className={last ? '' : 'mb-1'}>
      <p className="mb-1.5 text-[12px] font-semibold text-slate-700">{label}</p>
      <div className="grid grid-cols-5 gap-1.5">{children}</div>
    </div>
  );
}

/** `letter` renders the reference's Text Color style (white fill, coloured
 *  ring, coloured "A"); otherwise a solid-filled circle (Highlight Color). */
function Swatch({ hex, letter, active, onClick }: { hex: string; letter?: boolean; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={hex}
      aria-label={hex}
      className={`grid h-8 w-8 place-items-center rounded-full border-2 transition hover:scale-105 ${active ? 'ring-2 ring-offset-1 ring-slate-900' : ''}`}
      style={letter ? { borderColor: hex, background: '#fff' } : { borderColor: '#e2e8f0', background: hex }}
    >
      {letter && <span className="text-[13px] font-semibold" style={{ color: hex }}>A</span>}
    </button>
  );
}

function PlusSwatch({ onClick, active }: { onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title="Custom colour"
      aria-label="Custom colour"
      className={`grid h-8 w-8 place-items-center rounded-full border-2 transition hover:scale-105 ${active ? 'border-blue-600 text-blue-600' : 'border-slate-300 text-slate-500'}`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  );
}

/** Saturation/value square + horizontal hue slider + hex input + Apply —
 *  compact inline version of ColorPickerDialog's picker (which stays a modal
 *  for the table-properties use case), matching the reference's side popover. */
function CustomColorPanel({ initial, onApply }: { initial: string; onApply: (hex: string) => void }) {
  const s0 = hexToRgb(initial) ?? { r: 0, g: 0, b: 0 };
  const [hsv, setHsv] = useState(() => rgbToHsv(s0.r, s0.g, s0.b));
  const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
  const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
  const hueHex = (() => { const c = hsvToRgb(hsv.h, 1, 1); return rgbToHex(c.r, c.g, c.b); })();

  const squareRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);

  const onSquare = (e: { clientX: number; clientY: number }) => {
    const rect = squareRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHsv((cur) => ({ ...cur, s: clamp01((e.clientX - rect.left) / rect.width), v: 1 - clamp01((e.clientY - rect.top) / rect.height) }));
  };
  const onHue = (e: { clientX: number }) => {
    const rect = hueRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHsv((cur) => ({ ...cur, h: clamp01((e.clientX - rect.left) / rect.width) * 360 }));
  };
  const drag = (handler: (e: { clientX: number; clientY: number }) => void) => (e: React.PointerEvent) => {
    e.preventDefault();
    handler(e);
    const move = (ev: PointerEvent) => handler(ev);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const setHex = (h: string) => { const c = hexToRgb(h.startsWith('#') ? h : `#${h}`); if (c) setHsv(rgbToHsv(c.r, c.g, c.b)); };

  return (
    <div className="w-56 rounded-lg border border-slate-200 bg-white p-3 shadow-xl">
      <div ref={squareRef} onPointerDown={drag(onSquare)}
           className="relative h-36 w-full cursor-crosshair touch-none rounded-md"
           style={{ background: `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, ${hueHex})` }}>
        <span className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
              style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
      </div>

      <div ref={hueRef} onPointerDown={drag(onHue)}
           className="relative mt-3 h-3 w-full cursor-pointer touch-none rounded-full"
           style={{ background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}>
        <span className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
              style={{ left: `${(hsv.h / 360) * 100}%`, background: hueHex }} />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <div className="h-8 w-8 shrink-0 rounded border border-slate-200" style={{ background: hex }} />
        <div className="flex flex-1 items-center gap-1 rounded-md border border-slate-300 px-2">
          <span className="text-[13px] text-slate-400">#</span>
          <input value={hex.slice(1).toUpperCase()} maxLength={6}
                 onChange={(e) => setHex(e.target.value.replace(/[^0-9a-fA-F]/g, ''))}
                 className="w-full py-1.5 text-[13px] uppercase text-slate-800 focus:outline-none" />
        </div>
      </div>

      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onApply(hex)}
              className="mt-3 w-full rounded-md bg-blue-600 py-2 text-[13px] font-semibold text-white hover:bg-blue-700">
        Apply
      </button>
    </div>
  );
}
