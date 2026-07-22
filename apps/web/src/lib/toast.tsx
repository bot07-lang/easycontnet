import { useEffect, useReducer } from 'react';

/**
 * Tiny toast store. Toasts must outlive the component that fires them (e.g. the
 * Add-files dialog closes, then its success toasts show), so state lives in a
 * module-level store and <Toaster/> renders at the app root.
 */
type ToastItem = { id: number; message: string };

let items: ToastItem[] = [];
let counter = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function toast(message: string) {
  const id = ++counter;
  items = [...items, { id, message }];
  notify();
  setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    notify();
  }, 3500);
}

/** Renders active toasts. Mount once, at the app root. */
export function Toaster() {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    listeners.add(rerender);
    return () => {
      listeners.delete(rerender);
    };
  }, []);

  if (!items.length) return null;
  return (
    <div className="pointer-events-none fixed left-0 top-0 z-[100] flex w-[440px] max-w-[92vw] flex-col gap-2 p-4">
      {items.map((t) => (
        <div
          key={t.id}
          className="rounded bg-green-500 px-5 py-4 text-[15px] font-medium text-white shadow-lg"
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
