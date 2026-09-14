import { useState } from 'react';
import { Modal, inputClass } from './Modal';
import { ColorPickerDialog } from './ColorPickerDialog';
import type { CellProps } from './editor-table-props';

/** Cell Properties dialog: vertical alignment and background colour. Applies
 *  to every cell in the current selection (a single cell, or a selected
 *  block of cells). */
export function CellPropsDialog({
  initial, onSave, onClose,
}: {
  initial: CellProps;
  onSave: (v: CellProps) => void;
  onClose: () => void;
}) {
  const [v, setV] = useState<CellProps>(initial);
  const [picking, setPicking] = useState(false);

  return (
    <Modal
      title="Cell Properties"
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
          <span className="mb-1.5 block text-[15px] text-slate-600">Vertical align</span>
          <select className={inputClass} value={v.cellVAlign} onChange={(e) => setV((c) => ({ ...c, cellVAlign: e.target.value }))}>
            <option value="">None</option>
            <option value="top">Top</option>
            <option value="middle">Middle</option>
            <option value="bottom">Bottom</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[15px] text-slate-600">Background color</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setPicking(true)} title="Pick colour"
                    className="h-9 w-10 shrink-0 cursor-pointer rounded border border-slate-300" style={{ background: v.cellBg || '#cbd5e1' }} />
            <input className={inputClass} value={v.cellBg} onChange={(e) => setV((c) => ({ ...c, cellBg: e.target.value }))} placeholder="#000000" />
          </div>
          {picking && (
            <ColorPickerDialog initial={v.cellBg || '#cbd5e1'} onClose={() => setPicking(false)}
                               onSave={(c) => { setV((cur) => ({ ...cur, cellBg: c })); setPicking(false); }} />
          )}
        </label>
      </div>
    </Modal>
  );
}
