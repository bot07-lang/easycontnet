import { useEffect } from 'react';

/**
 * Centred modal dialog. Closes on backdrop click and Escape.
 * Replaces the browser's native prompt()/alert() for editor dialogs, which
 * cannot be styled and look out of place.
 */
export function Modal({
  title, onClose, children, footer, width = 520,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width }}
        className="max-h-[90vh] overflow-auto rounded-lg bg-white shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-[19px] font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded text-slate-500 hover:bg-slate-100"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="px-6 py-5">{children}</div>

        {footer && (
          <footer className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-4 block">
      <span className="mb-1.5 block text-[14px] font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  'w-full rounded border border-slate-300 px-3 py-2 text-[15px] text-slate-800 ' +
  'focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
