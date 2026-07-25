import { useRef, useState } from 'react';
import { Modal, Field, inputClass } from './Modal';

export interface ImageValue {
  src: string;
  alt: string;
  width: string;
  height: string;
  /** Whether the image shows an editable caption below it (a <figure>). */
  showCaption: boolean;
  /** Full-size original URL (data-full-name) for uploaded images; '' otherwise. */
  fullSrc: string;
}

/**
 * Insert/Edit Image dialog, matching the reference: Source, Alt description,
 * Width/Height with an aspect-ratio lock, a caption toggle, and an Upload tab
 * (drop / browse) that uploads via `onUpload` and fills the Source.
 */
export function ImageDialog({
  initial, onSave, onClose, onUpload,
}: {
  initial?: Partial<ImageValue>;
  onSave: (v: ImageValue) => void;
  onClose: () => void;
  /** Upload a file and return its display + full-size URLs. Enables the Upload tab. */
  onUpload?: (file: File) => Promise<{ url: string; fullUrl: string }>;
}) {
  const [src, setSrc] = useState(initial?.src ?? '');
  const [alt, setAlt] = useState(initial?.alt ?? '');
  const [width, setWidth] = useState(initial?.width ?? '');
  const [height, setHeight] = useState(initial?.height ?? '');
  const [locked, setLocked] = useState(true);
  const [ratio, setRatio] = useState<number | null>(null);
  const [tab, setTab] = useState<'general' | 'upload'>('general');
  const [showCaption, setShowCaption] = useState(initial?.showCaption ?? false);
  const [fullSrc, setFullSrc] = useState(initial?.fullSrc ?? '');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const doUpload = async (file: File | undefined) => {
    if (!onUpload || !file || !file.type.startsWith('image/')) return;
    setUploading(true);
    try {
      const { url, fullUrl } = await onUpload(file);
      setSrc(url);
      setFullSrc(fullUrl);
      probe(url);
      setTab('general');
    } finally {
      setUploading(false);
    }
  };

  // Derive the aspect ratio from the loaded image so the lock can keep it.
  const probe = (url: string) => {
    if (!url) { setRatio(null); return; }
    const img = new Image();
    img.onload = () => {
      setRatio(img.naturalWidth / img.naturalHeight);
      if (!width && !height) {
        setWidth(String(img.naturalWidth));
        setHeight(String(img.naturalHeight));
      }
    };
    img.src = url;
  };

  const changeWidth = (v: string) => {
    setWidth(v);
    if (locked && ratio && v) setHeight(String(Math.round(Number(v) / ratio)));
  };
  const changeHeight = (v: string) => {
    setHeight(v);
    if (locked && ratio && v) setWidth(String(Math.round(Number(v) * ratio)));
  };

  return (
    <Modal
      title="Insert/Edit Image"
      onClose={onClose}
      width={560}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold
                       text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!src.trim()}
            onClick={() => onSave({ src: src.trim(), alt: alt.trim(), width, height, showCaption, fullSrc })}
            className="rounded bg-blue-600 px-5 py-2 text-sm font-semibold text-white
                       hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save
          </button>
        </>
      }
    >
      <div className="flex gap-6">
        {/* Tabs */}
        <nav className="flex w-24 shrink-0 flex-col gap-1 text-[15px]">
          <button
            type="button"
            onClick={() => setTab('general')}
            className={`rounded px-2 py-1 text-left ${
              tab === 'general' ? 'font-semibold text-blue-600 underline' : 'text-slate-600'
            }`}
          >
            General
          </button>
          <button
            type="button"
            onClick={() => onUpload && setTab('upload')}
            disabled={!onUpload}
            title={onUpload ? undefined : 'Upload — not available here'}
            className={`rounded px-2 py-1 text-left ${
              tab === 'upload' ? 'font-semibold text-blue-600 underline' : onUpload ? 'text-slate-600' : 'cursor-not-allowed text-slate-400'
            }`}
          >
            Upload
          </button>
        </nav>

        {tab === 'general' && (
          <div className="flex-1">
            <Field label="Source">
              <div className="flex items-center gap-2">
                <input
                  className={inputClass}
                  value={src}
                  onChange={(e) => { setSrc(e.target.value); setFullSrc(''); }}
                  onBlur={(e) => probe(e.target.value)}
                  placeholder="https://…"
                />
                <button
                  type="button"
                  onClick={() => onUpload && setTab('upload')}
                  disabled={!onUpload}
                  title={onUpload ? 'Upload an image' : 'Upload — not available here'}
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded border border-slate-300 ${
                    onUpload ? 'text-slate-600 hover:bg-slate-50' : 'cursor-not-allowed text-slate-400'
                  }`}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M12 15V3m0 0L8 7m4-4 4 4" />
                    <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
                  </svg>
                </button>
              </div>
            </Field>

            <Field label="Alternative description">
              <input
                className={inputClass}
                value={alt}
                onChange={(e) => setAlt(e.target.value)}
                placeholder="Describe the image for screen readers"
              />
            </Field>

            <div className="flex items-end gap-3">
              <Field label="Width">
                <input
                  className={inputClass}
                  value={width}
                  inputMode="numeric"
                  onChange={(e) => changeWidth(e.target.value.replace(/\D/g, ''))}
                />
              </Field>
              <Field label="Height">
                <input
                  className={inputClass}
                  value={height}
                  inputMode="numeric"
                  onChange={(e) => changeHeight(e.target.value.replace(/\D/g, ''))}
                />
              </Field>
              <button
                type="button"
                onClick={() => setLocked((v) => !v)}
                title={locked ? 'Aspect ratio locked' : 'Aspect ratio unlocked'}
                className={`mb-4 grid h-9 w-9 shrink-0 place-items-center rounded ${
                  locked ? 'text-slate-800' : 'text-slate-400'
                } hover:bg-slate-100`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="5" y="11" width="14" height="9" rx="2" />
                  {locked
                    ? <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                    : <path d="M8 11V7a4 4 0 0 1 7.5-2" />}
                </svg>
              </button>
            </div>

            <Field label="Caption">
              <label className="flex cursor-pointer items-center gap-2 text-[15px] text-slate-800">
                <input
                  type="checkbox"
                  checked={showCaption}
                  onChange={(e) => setShowCaption(e.target.checked)}
                  className="h-[18px] w-[18px] accent-blue-600"
                />
                Show caption
              </label>
            </Field>
          </div>
        )}

        {tab === 'upload' && (
          <div className="flex-1">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); void doUpload(e.dataTransfer.files[0]); }}
              className={`grid min-h-[300px] place-items-center rounded-lg border-2 border-dashed p-6 text-center transition ${
                dragOver ? 'border-blue-400 bg-blue-50/50' : 'border-slate-300'
              }`}
            >
              {uploading ? (
                <span className="text-[15px] text-slate-500">Uploading…</span>
              ) : (
                <div>
                  <p className="text-[17px] text-slate-500">Drop an image here</p>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="mt-4 rounded-md bg-slate-100 px-5 py-2.5 text-[15px] font-semibold text-slate-800 hover:bg-slate-200"
                  >
                    Browse for an image
                  </button>
                </div>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => { void doUpload(e.target.files?.[0]); e.target.value = ''; }}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
