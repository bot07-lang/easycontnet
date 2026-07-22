import type { ContentField, UploadedFile } from '../mock/article';
import { FieldCounter } from './FieldCounter';
import { RichTextField } from './RichTextField';

/** Flip on when Phase 2 delivers comments. */
const SHOW_COMMENT_BADGES = false;

/**
 * Renders one field.
 *
 * Two shapes exist. INPUT fields get the full chrome — header with label,
 * comment badge and counter; the input; guidelines beneath. SECTION fields
 * (heading, guidelines) hold no value and render as bare text.
 */

function CommentBadge({ count }: { count: number }) {
  return (
    <span className="relative inline-flex items-center" title={`${count} comment${count === 1 ? '' : 's'}`}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="1.8" className="text-slate-600">
        <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z" />
      </svg>
      <span className="absolute -right-2 -top-1.5 grid h-[17px] min-w-[17px] place-items-center
                       rounded-full bg-orange-500 px-1 text-[10px] font-semibold text-white">
        {count}
      </span>
    </span>
  );
}

function FieldShell({
  field, value, children,
}: {
  field: ContentField;
  value: unknown;
  children: React.ReactNode;
}) {
  return (
    <section className="group relative rounded border border-slate-200 bg-white">
      <header className="flex items-center justify-between gap-4 border-b border-slate-200
                         bg-slate-50/70 px-5 py-3">
        <h3 className="flex items-center gap-2.5 text-[15px] font-semibold text-slate-900">
          {field.label}
          {/* Comment badges are hidden until Phase 2 ships comments — showing a
              count for a feature that does not exist yet reads as a bug. */}
          {SHOW_COMMENT_BADGES && field.commentCount ? (
            <CommentBadge count={field.commentCount} />
          ) : null}
        </h3>
        {/* Word/character counts only make sense for text fields. */}
        {(field.type === 'single_line_text' || field.type === 'paragraph_text') && (
          <FieldCounter field={field} value={value} />
        )}
      </header>

      {children}

      {field.guidelines && (
        <p className="border-t border-slate-100 bg-slate-50/50 px-5 py-3 text-[13px] text-slate-500">
          {field.guidelines}
        </p>
      )}

      {/* Round comment affordance floating in the right gutter, vertically
          centred, appearing on hover — matching the reference. Phase 2, so
          disabled. */}
      <button
        type="button"
        disabled
        title="Comment on this field — coming in Phase 2"
        className="absolute right-3 top-1/2 hidden h-9 w-9 -translate-y-1/2 cursor-not-allowed
                   place-items-center rounded-full border border-slate-300 bg-white text-slate-400
                   shadow-sm group-hover:grid"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 4H4a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 4 17h3v3.2L11 17h9a1.5 1.5 0 0 0 1.5-1.5v-10A1.5 1.5 0 0 0 20 4z" />
          <line x1="12" y1="8" x2="12" y2="13" />
          <line x1="9.5" y1="10.5" x2="14.5" y2="10.5" />
        </svg>
      </button>
    </section>
  );
}

function FilesField({ files }: { files: UploadedFile[] }) {
  /**
   * Downloads every attached file. The mock has no real URLs, so it writes a
   * manifest instead — enough to prove the button works end to end. Once
   * uploads exist this fetches the files and zips them.
   */
  const downloadAll = () => {
    const manifest = [
      'Attached files',
      '='.repeat(40),
      '',
      ...files.map(
        (f) => `${f.name}\n  ${f.format} · ${f.sizeKb}Kb\n  Uploaded ${f.uploadedAt} by ${f.uploadedBy} (${f.uploaderRole})\n`,
      ),
      `${files.length} file${files.length === 1 ? '' : 's'}, ${files.reduce((n, f) => n + f.sizeKb, 0)}Kb total`,
    ].join('\n');

    const url = URL.createObjectURL(new Blob([manifest], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'attached-files.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="px-5 py-5">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4">
        <button
          type="button"
          className="grid min-h-[190px] place-items-center rounded border-2 border-dashed
                     border-slate-300 text-slate-500 transition hover:border-slate-400 hover:text-slate-700"
        >
          <span className="text-center">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="mx-auto block">
              <circle cx="12" cy="12" r="10" /><path d="M12 8v8M8 12h8" />
            </svg>
            <span className="mt-2 block text-sm">Add files</span>
          </span>
        </button>

        {files.map((f) => (
          <figure key={f.id} className="overflow-hidden rounded border border-slate-200">
            <div className="grid h-[130px] place-items-center bg-slate-100 text-xs text-slate-400">
              {f.format}
            </div>
            <figcaption className="p-3">
              <p className="truncate text-[13px] font-medium text-slate-800" title={f.name}>
                {f.name}
              </p>
              <p className="mt-1 text-[12px] text-slate-500">Uploaded {f.uploadedAt}</p>
              <p className="text-[12px] text-slate-500">
                by <span className="font-medium text-slate-600">{f.uploadedBy}</span> ({f.uploaderRole})
              </p>
              <p className="mt-2 flex items-center gap-2">
                <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {f.format}
                </span>
                <span className="text-[12px] text-slate-500">{f.sizeKb}Kb</span>
              </p>
            </figcaption>
          </figure>
        ))}
      </div>

      {/* Download-all only appears once there are files, matching the reference. */}
      {files.length > 0 && (
        <div className="mt-5 flex justify-center">
          <button
            type="button"
            onClick={downloadAll}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white
                       px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition
                       hover:border-slate-400 hover:bg-slate-50 active:bg-slate-100"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <path d="M7 10l5 5 5-5" />
              <path d="M12 15V3" />
            </svg>
            Download all files
          </button>
        </div>
      )}
    </div>
  );
}

export function Field({
  field, files, onChange, activeFieldId, onActivate, docTitle,
}: {
  field: ContentField;
  files: UploadedFile[];
  onChange: (id: string, value: unknown) => void;
  activeFieldId: string | null;
  onActivate: (id: string) => void;
  /** Item name — used as the print/preview document title in the editor. */
  docTitle?: string;
}) {
  // Section fields hold no value and get no chrome.
  if (field.type === 'heading') {
    return (
      <h2 className="pt-4 text-center text-xl font-semibold tracking-wide text-slate-700">
        {field.label}
      </h2>
    );
  }

  if (field.type === 'guidelines') {
    return (
      <p className="text-[15px] leading-relaxed text-slate-700">{String(field.value ?? '')}</p>
    );
  }

  const set = (v: unknown) => onChange(field.id, v);

  if (field.type === 'file_image_upload') {
    return (
      <FieldShell field={field} value={null}>
        <FilesField files={files} />
      </FieldShell>
    );
  }

  if (field.type === 'checkboxes' || field.type === 'radio_buttons') {
    const selected = Array.isArray(field.value) ? (field.value as string[]) : [];
    const isRadio = field.type === 'radio_buttons';
    return (
      <FieldShell field={field} value={null}>
        <div className="space-y-3 px-5 py-5">
          {field.choices?.map((choice) => (
            <label key={choice} className="flex cursor-pointer items-center gap-3 text-[15px] text-slate-800">
              <input
                type={isRadio ? 'radio' : 'checkbox'}
                name={field.id}
                checked={selected.includes(choice)}
                onChange={(e) =>
                  set(
                    isRadio
                      ? [choice]
                      : e.target.checked
                        ? [...selected, choice]
                        : selected.filter((c) => c !== choice),
                  )
                }
                className="h-[18px] w-[18px] accent-blue-600"
              />
              {choice}
            </label>
          ))}
        </div>
      </FieldShell>
    );
  }

  if (field.type === 'dropdown_select') {
    const selected = Array.isArray(field.value) ? (field.value as string[])[0] ?? '' : '';
    return (
      <FieldShell field={field} value={null}>
        <div className="px-5 py-5">
          <select
            value={selected}
            onChange={(e) => set([e.target.value])}
            className="w-full rounded border border-slate-300 px-3 py-2.5 text-[15px] text-slate-800"
          >
            <option value="">Select…</option>
            {field.choices?.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </FieldShell>
    );
  }

  if (field.type === 'date') {
    return (
      <FieldShell field={field} value={null}>
        <div className="px-5 py-5">
          <input
            type="date"
            value={String(field.value ?? '')}
            onChange={(e) => set(e.target.value)}
            className="rounded border border-slate-300 px-3 py-2.5 text-[15px] text-slate-800"
          />
        </div>
      </FieldShell>
    );
  }

  if (field.type === 'featured_image') {
    const v = (field.value ?? {}) as { url?: string; alt?: string };
    return (
      <FieldShell field={field} value={null}>
        <div className="space-y-3 px-5 py-5">
          <div className="flex items-start gap-3">
            <div className="flex-1 space-y-2">
              <input
                type="url"
                value={v.url ?? ''}
                onChange={(e) => set({ ...v, url: e.target.value })}
                placeholder="Image URL"
                className="w-full rounded border border-slate-300 px-3 py-2 text-[14px] text-slate-800"
              />
              <input
                type="text"
                value={v.alt ?? ''}
                onChange={(e) => set({ ...v, alt: e.target.value })}
                placeholder="Alt text — describe the image for accessibility"
                className="w-full rounded border border-slate-300 px-3 py-2 text-[14px] text-slate-800"
              />
            </div>
            <label
              title="Upload an image"
              className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded
                         border border-slate-300 text-slate-500 hover:bg-slate-50"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              <input type="file" accept="image/*" className="sr-only" disabled />
            </label>
          </div>

          {v.url ? (
            <img
              src={v.url}
              alt={v.alt ?? ''}
              className="max-h-64 w-full rounded border border-slate-200 object-cover"
            />
          ) : (
            <div className="grid h-40 place-items-center rounded border-2 border-dashed
                            border-slate-200 text-sm text-slate-400">
              No image yet
            </div>
          )}
        </div>
      </FieldShell>
    );
  }

  if (field.type === 'paragraph_text') {
    // The "Plain text" toggle: a plain field is a textarea, not the rich
    // editor. Meta descriptions, excerpts and the like are plain.
    if (field.isPlainText) {
      return (
        <FieldShell field={field} value={field.value}>
          <textarea
            value={String(field.value ?? '')}
            onChange={(e) => set(e.target.value)}
            rows={3}
            className="w-full resize-y border-0 px-5 py-4 text-[15px] text-slate-800
                       focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
          />
        </FieldShell>
      );
    }
    return (
      <FieldShell field={field} value={field.value}>
        {/* Short prompt only — the full guideline already shows below the
            field, so repeating it as placeholder would duplicate and overlap. */}
        <RichTextField
          value={String(field.value ?? '')}
          onChange={set}
          placeholder="Start writing…"
          active={activeFieldId === field.id}
          onActivate={() => onActivate(field.id)}
          docTitle={docTitle}
        />
      </FieldShell>
    );
  }

  // single_line_text
  return (
    <FieldShell field={field} value={field.value}>
      <input
        type="text"
        value={String(field.value ?? '')}
        onChange={(e) => set(e.target.value)}
        className="w-full border-0 px-5 py-4 text-[17px] text-slate-800 focus:outline-none
                   focus:ring-2 focus:ring-inset focus:ring-blue-500"
      />
    </FieldShell>
  );
}
