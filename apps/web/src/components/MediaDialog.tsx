import { useState } from 'react';

/**
 * Insert/Edit Media dialog, matching the reference: a General tab with a
 * single Source field (a video URL — YouTube/Vimeo) and an Embed tab with a
 * raw embed-code textarea.
 */
export function MediaDialog({
  onSave, onClose,
}: {
  onSave: (v: { source: string; embed: string }) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'general' | 'embed'>('general');
  const [source, setSource] = useState('');
  const [embed, setEmbed] = useState('');

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-900/40 p-6" onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} className="w-[620px] max-w-full rounded-lg bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-3.5">
          <h2 className="text-[20px] font-semibold text-slate-900">Insert/Edit Media</h2>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded text-slate-500 hover:bg-slate-100">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>

        <div className="flex gap-6 px-6 py-5">
          <div className="flex w-28 shrink-0 flex-col gap-1 text-[15px]">
            <button type="button" onClick={() => setTab('general')}
                    className={tab === 'general' ? 'text-left font-medium text-blue-600 underline underline-offset-4' : 'text-left text-slate-600 hover:text-slate-900'}>
              General
            </button>
            <button type="button" onClick={() => setTab('embed')}
                    className={tab === 'embed' ? 'text-left font-medium text-blue-600 underline underline-offset-4' : 'text-left text-slate-600 hover:text-slate-900'}>
              Embed
            </button>
          </div>

          <div className="flex-1">
            {tab === 'general' ? (
              <label className="block">
                <span className="mb-1.5 block text-[14px] text-slate-500">Source</span>
                <input
                  autoFocus
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=…"
                  className="h-11 w-full rounded-md border border-slate-300 px-3 text-[15px] text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </label>
            ) : (
              <label className="block">
                <span className="mb-1.5 block text-[14px] text-slate-500">Paste your embed code below:</span>
                <textarea
                  autoFocus
                  value={embed}
                  onChange={(e) => setEmbed(e.target.value)}
                  spellCheck={false}
                  className="h-40 w-full resize-none rounded-md border border-slate-300 p-3 font-mono text-[13px] text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </label>
            )}
          </div>
        </div>

        <footer className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={() => onSave({ source: source.trim(), embed: embed.trim() })}
                  className="rounded-md bg-blue-600 px-6 py-2 text-sm font-semibold text-white hover:bg-blue-700">Save</button>
        </footer>
      </div>
    </div>
  );
}
