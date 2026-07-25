import { useState } from 'react';
import { Modal, inputClass } from './Modal';
import { ColorPickerDialog } from './ColorPickerDialog';
import type { TableProps } from './editor-table-props';

/**
 * Table Properties dialog (matching the reference): General (width, height, cell
 * spacing/padding, border width, caption, alignment) and Advanced (border/background
 * colour). Values are applied to the table node's attributes by the caller.
 */
export function TablePropsDialog({
  initial, onSave, onClose,
}: {
  initial: TableProps;
  onSave: (v: TableProps) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'general' | 'advanced'>('general');
  const [v, setV] = useState<TableProps>(initial);
  const set = (patch: Partial<TableProps>) => setV((cur) => ({ ...cur, ...patch }));

  return (
    <Modal
      title="Table Properties"
      onClose={onClose}
      width={640}
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
      <div className="flex gap-8">
        {/* Tabs */}
        <nav className="flex w-24 shrink-0 flex-col gap-1 text-[15px]">
          {(['general', 'advanced'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)}
                    className={`rounded px-1 py-1 text-left capitalize ${tab === t ? 'font-semibold text-blue-600 underline' : 'text-slate-600'}`}>
              {t}
            </button>
          ))}
        </nav>

        <div className="flex-1">
          {tab === 'general' ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-5">
                <Labeled label="Width">
                  <input className={inputClass} value={v.tblWidth} onChange={(e) => set({ tblWidth: e.target.value })} placeholder="e.g. 100%" />
                </Labeled>
                <Labeled label="Height">
                  <input className={inputClass} value={v.tblHeight} onChange={(e) => set({ tblHeight: e.target.value })} />
                </Labeled>
                <Labeled label="Cell spacing">
                  <input className={inputClass} value={v.tblCellSpace} inputMode="numeric" onChange={(e) => set({ tblCellSpace: e.target.value.replace(/\D/g, '') })} />
                </Labeled>
                <Labeled label="Cell padding">
                  <input className={inputClass} value={v.tblCellPad} inputMode="numeric" onChange={(e) => set({ tblCellPad: e.target.value.replace(/\D/g, '') })} />
                </Labeled>
                <Labeled label="Border width">
                  <input className={inputClass} value={v.tblBorder} inputMode="numeric" onChange={(e) => set({ tblBorder: e.target.value.replace(/\D/g, '') })} />
                </Labeled>
                <Labeled label="Alignment">
                  <select className={inputClass} value={v.tblAlign} onChange={(e) => set({ tblAlign: e.target.value })}>
                    <option value="">None</option>
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select>
                </Labeled>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <Labeled label="Border style">
                <select className={inputClass} value={v.tblBorderStyle} onChange={(e) => set({ tblBorderStyle: e.target.value })}>
                  <option value="">Select…</option>
                  {['solid', 'dotted', 'dashed', 'double', 'groove', 'ridge', 'inset', 'outset', 'none', 'hidden'].map((s) => (
                    <option key={s} value={s} className="capitalize">{s[0]!.toUpperCase() + s.slice(1)}</option>
                  ))}
                </select>
              </Labeled>
              <div className="grid grid-cols-2 gap-5">
                <Labeled label="Border color">
                  <ColorField value={v.tblBorderColor} onChange={(c) => set({ tblBorderColor: c })} />
                </Labeled>
                <Labeled label="Background color">
                  <ColorField value={v.tblBg} onChange={(c) => set({ tblBg: c })} />
                </Labeled>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[15px] text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function ColorField({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const [picking, setPicking] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => setPicking(true)} title="Pick colour"
              className="h-9 w-10 shrink-0 cursor-pointer rounded border border-slate-300" style={{ background: value || '#cbd5e1' }} />
      <input className={inputClass} value={value} onChange={(e) => onChange(e.target.value)} placeholder="#000000" />
      {picking && (
        <ColorPickerDialog initial={value || '#cbd5e1'} onClose={() => setPicking(false)}
                           onSave={(c) => { onChange(c); setPicking(false); }} />
      )}
    </div>
  );
}
