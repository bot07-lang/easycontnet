import { useRef, useState } from 'react';
import { Modal } from './Modal';
import { clamp01, clamp255, hexToRgb, hsvToRgb, rgbToHex, rgbToHsv } from '../lib/color';

/**
 * Custom Color Picker dialog (matching the reference): a saturation/value square,
 * a hue slider, R/G/B and hex inputs, a preview, and Cancel/Save. Built entirely
 * in-app (no OS/native `<input type="color">`), so every user sees the SAME picker
 * regardless of platform or browser, and it can't be dismissed by a menu closing.
 */
export function ColorPickerDialog({
  initial, onSave, onClose,
}: {
  initial: string;
  onSave: (hex: string) => void;
  onClose: () => void;
}) {
  const s0 = hexToRgb(initial) ?? { r: 163, g: 74, b: 54 };
  const [hsv, setHsv] = useState(() => rgbToHsv(s0.r, s0.g, s0.b));

  const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
  const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
  const hueHex = (() => { const c = hsvToRgb(hsv.h, 1, 1); return rgbToHex(c.r, c.g, c.b); })();

  const fromRgb = (r: number, g: number, b: number) => setHsv(rgbToHsv(r, g, b));
  const setChannel = (k: 'r' | 'g' | 'b', v: number) => { const next = { ...rgb, [k]: clamp255(v) }; fromRgb(next.r, next.g, next.b); };
  const setHex = (h: string) => { const c = hexToRgb(h.startsWith('#') ? h : `#${h}`); if (c) fromRgb(c.r, c.g, c.b); };

  const squareRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);

  const onSquare = (e: { clientX: number; clientY: number }) => {
    const rect = squareRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHsv((cur) => ({ ...cur, s: clamp01((e.clientX - rect.left) / rect.width), v: 1 - clamp01((e.clientY - rect.top) / rect.height) }));
  };
  const onHue = (e: { clientY: number }) => {
    const rect = hueRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHsv((cur) => ({ ...cur, h: clamp01((e.clientY - rect.top) / rect.height) * 360 }));
  };
  const drag = (handler: (e: { clientX: number; clientY: number }) => void) => (e: React.PointerEvent) => {
    e.preventDefault();
    handler(e);
    const move = (ev: PointerEvent) => handler(ev);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <Modal
      title="Color Picker"
      onClose={onClose}
      width={560}
      footer={
        <>
          <button type="button" onClick={onClose}
                  className="rounded border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button type="button" onClick={() => onSave(hex)}
                  className="rounded bg-blue-600 px-6 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            Save
          </button>
        </>
      }
    >
      <div className="flex gap-4">
        {/* Saturation / value square */}
        <div ref={squareRef} onPointerDown={drag(onSquare)}
             className="relative h-56 w-64 shrink-0 cursor-crosshair touch-none rounded"
             style={{ background: `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, ${hueHex})` }}>
          <span className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
                style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
        </div>

        {/* Hue slider */}
        <div ref={hueRef} onPointerDown={drag(onHue)}
             className="relative h-56 w-4 shrink-0 cursor-pointer touch-none rounded"
             style={{ background: 'linear-gradient(to bottom, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}>
          <span className="pointer-events-none absolute left-1/2 h-1.5 w-6 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-slate-600 bg-white/70"
                style={{ top: `${(hsv.h / 360) * 100}%` }} />
        </div>

        {/* R/G/B + hex + preview */}
        <div className="flex-1 space-y-3">
          <Channel label="R" value={rgb.r} onChange={(v) => setChannel('r', v)} />
          <Channel label="G" value={rgb.g} onChange={(v) => setChannel('g', v)} />
          <Channel label="B" value={rgb.b} onChange={(v) => setChannel('b', v)} />
          <div className="flex items-center gap-3">
            <span className="w-4 text-right text-[15px] text-slate-600">#</span>
            <input value={hex.slice(1).toUpperCase()} maxLength={6}
                   onChange={(e) => setHex(e.target.value.replace(/[^0-9a-fA-F]/g, ''))}
                   className="w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] uppercase text-slate-800 focus:border-blue-500 focus:outline-none" />
          </div>
          <div className="h-16 w-full rounded-md border border-slate-200" style={{ background: hex }} />
        </div>
      </div>
    </Modal>
  );
}

function Channel({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-4 text-right text-[15px] text-slate-600">{label}</span>
      <input type="number" min={0} max={255} value={value} onChange={(e) => onChange(clamp255(Number(e.target.value)))}
             className="w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] text-slate-800 focus:border-blue-500 focus:outline-none" />
    </div>
  );
}

