import { useState } from 'react';
import { Modal, inputClass } from './Modal';
import { ColorPickerDialog } from './ColorPickerDialog';
import type { RowProps } from './editor-table-props';

/** Row Properties dialog: background colour and a fixed row height. */
export function RowPropsDialog({
  initial, onSave, onClose,
}: {
  initial: RowProps;
  onSave: (v: RowProps) => void;
  onClose: () => void;
}) {
  const [v, setV] = useState<RowProps>(initial);
  const [picking, setPicking] = useState(false);

  return (
    <Modal
      title="Row Properties"
      onClose={onClose}
      width={420}
      footer={
        <>
          <button type="button" onClick={onClose}
                  className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button type="button" onClick={() => onSave(v)}
                  className="rounded bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            Save
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-[15px] text-slate-600">Height</span>
          <input className={inputClass} value={v.rowHeight} onChange={(e) => setV((c) => ({ ...c, rowHeight: e.target.value }))} placeholder="e.g. 40px" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[15px] text-slate-600">Background color</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setPicking(true)} title="Pick colour"
                    className="h-9 w-10 shrink-0 cursor-pointer rounded border border-slate-300" style={{ background: v.rowBg || '#cbd5e1' }} />
            <input className={inputClass} value={v.rowBg} onChange={(e) => setV((c) => ({ ...c, rowBg: e.target.value }))} placeholder="#000000" />
          </div>
          {picking && (
            <ColorPickerDialog initial={v.rowBg || '#cbd5e1'} onClose={() => setPicking(false)}
                               onSave={(c) => { setV((cur) => ({ ...cur, rowBg: c })); setPicking(false); }} />
          )}
        </label>
      </div>
    </Modal>
  );
}
