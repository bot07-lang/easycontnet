import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * The real boundary a floating panel can get clipped against isn't always the
 * browser window — a `overflow-hidden`/`auto`/`scroll` ancestor (a card, a
 * scrollable pane) clips it first, often well inside the viewport. Walk up
 * from `el` to find the nearest such ancestor and return its right edge;
 * fall back to the window when there isn't one.
 */
function clippingRight(el: HTMLElement): number {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const { overflowX, overflow } = getComputedStyle(node);
    if (/(hidden|auto|scroll|clip)/.test(overflowX) || /(hidden|auto|scroll|clip)/.test(overflow)) {
      return node.getBoundingClientRect().right;
    }
    node = node.parentElement;
  }
  return window.innerWidth;
}

/**
 * True once `ref`'s element has actually rendered past the nearest clipping
 * boundary (ancestor overflow, else the viewport) — measured against real
 * layout, not a guessed panel width, so it stays correct regardless of
 * content or which container the panel happens to be reused inside.
 */
export function useOverflowsRight(ref: RefObject<HTMLElement | null>, active: boolean) {
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    if (!active) { setOverflows(false); return; }
    const el = ref.current;
    if (!el) return;
    setOverflows(el.getBoundingClientRect().right > clippingRight(el));
    // One measurement per open is enough — content is static while it's open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  return overflows;
}
