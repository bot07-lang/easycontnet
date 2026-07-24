import { useState } from 'react';
// Default-exported here so RichTextField can lazy-load this file — that keeps
// filerobot (a large dependency) out of the main bundle; it only loads when the
// Edit Image modal is opened.
import FilerobotImageEditor, { TABS, TOOLS } from 'react-filerobot-image-editor';
import { uploadDerivedImage, type DerivedImage } from '../lib/upload';
import { urlToBlob } from '../lib/image-edit';

/**
 * The "Edit Image" editor (crop, resize, rotate, flip, brightness, contrast,
 * filters incl. invert). On Save the edited image is uploaded as a NEW library
 * file and handed back so the caller can repoint the inline <img> at it — the
 * original file is never modified.
 *
 * Gamma, per-channel RGB levels and sharpen aren't offered by this library and
 * are therefore not available (a deliberate, agreed trade for using it).
 */
export default function EditImageModal({
  src,
  projectId,
  name,
  onApplied,
  onClose,
}: {
  src: string;
  projectId: string;
  name: string;
  onApplied: (img: DerivedImage) => void;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-[70] bg-white">
      <FilerobotImageEditor
        source={src}
        // Skip filerobot's built-in download dialog — go straight to our onSave.
        onBeforeSave={() => false}
        onSave={async (edited) => {
          const dataUrl = edited.imageBase64;
          if (!dataUrl) return;
          setSaving(true);
          setError(null);
          try {
            const blob = await urlToBlob(dataUrl);
            const img = await uploadDerivedImage(projectId, blob, edited.fullName || edited.name || name);
            onApplied(img);
            onClose();
          } catch (e) {
            setSaving(false);
            setError(e instanceof Error ? e.message : 'Could not save the edited image.');
          }
        }}
        onClose={onClose}
        tabsIds={[TABS.ADJUST, TABS.FINETUNE, TABS.FILTERS]}
        defaultTabId={TABS.ADJUST}
        defaultToolId={TOOLS.CROP}
        savingPixelRatio={4}
        previewPixelRatio={typeof window !== 'undefined' ? window.devicePixelRatio : 1}
      />

      {saving && (
        <div className="absolute inset-0 z-[71] grid place-items-center bg-white/70 text-sm font-medium text-slate-700">
          Saving edited image…
        </div>
      )}
      {error && (
        <div className="absolute inset-x-0 bottom-0 z-[71] bg-red-600 px-4 py-2 text-center text-sm text-white">
          {error}
        </div>
      )}
    </div>
  );
}
