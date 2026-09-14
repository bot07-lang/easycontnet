import { useState } from 'react';

/**
 * A small, instant hover tooltip — real hover state, not CSS `group-hover`.
 * Reach for this instead of the native `title` attribute anywhere triggers
 * sit close together (avatar stacks, swatch grids, icon toolbars): a
 * pure-CSS fade lets a fast mouse sweep leave several tooltips visible at
 * once (a garbled stack of every label, all mid-transition simultaneously —
 * a real bug this project hit), and native `title` has its own ~1s delay
 * before it shows at all. State means exactly one tooltip is ever mounted,
 * and it appears the instant the pointer enters.
 */
export function HoverTip({
  label, children, side = 'top', align = 'center', wrapperClassName = 'relative inline-flex',
}: {
  label: string;
  children: React.ReactNode;
  /** Which side of the trigger the tooltip opens on. */
  side?: 'top' | 'bottom';
  /** Horizontal anchor — 'center' for an isolated trigger, 'left'/'right'
   *  when centering would run the tooltip off the edge of its container. */
  align?: 'left' | 'center' | 'right';
  wrapperClassName?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const sidePos = side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2';
  const alignPos = align === 'left' ? 'left-0' : align === 'right' ? 'right-0' : 'left-1/2 -translate-x-1/2';
  const arrowSide = side === 'top'
    ? 'top-full border-t-4 border-b-0 border-t-slate-800'
    : 'bottom-full border-b-4 border-t-0 border-b-slate-800';
  const arrowAlign = align === 'left' ? 'left-2.5' : align === 'right' ? 'right-2.5' : 'left-1/2 -translate-x-1/2';
  return (
    <span className={wrapperClassName} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {children}
      {hovered && (
        <span role="tooltip"
              className={`pointer-events-none absolute z-30 ${sidePos} ${alignPos} whitespace-nowrap rounded-md bg-slate-800 px-2.5 py-1.5 text-[12px] font-medium text-white shadow-lg`}>
          {label}
          <span className={`absolute h-0 w-0 border-x-4 border-x-transparent ${arrowSide} ${arrowAlign}`} />
        </span>
      )}
    </span>
  );
}
