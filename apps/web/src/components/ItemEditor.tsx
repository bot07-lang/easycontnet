import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type ApiItem } from '../lib/api';
import type { ContentField } from '../mock/article';
import { Field } from './Field';
import { toPlainText } from '../lib/counts';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Loads a real content item from the API, renders its fields, and autosaves
 * each field a short beat after you stop typing. A failed save (e.g. RLS says
 * you can't edit) surfaces rather than silently dropping the change.
 */
export function ItemEditor({ itemId }: { itemId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['item', itemId],
    queryFn: () => api.getItem(itemId),
  });

  if (isLoading) return <div className="p-8 text-slate-400">Loading…</div>;
  if (error) return <div className="p-8 text-red-600">{String(error)}</div>;
  if (!data) return null;
  return <Loaded item={data} />;
}

function Loaded({ item }: { item: ApiItem }) {
  const [activeTab, setActiveTab] = useState(item.tabs[0]?.id ?? '');
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(item.tabs.flatMap((t) => t.fields).map((f) => [f.id, f.value])),
  );
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>('idle');
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const tab = item.tabs.find((t) => t.id === activeTab) ?? item.tabs[0];

  const onChange = (fieldId: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
    setSave('saving');
    clearTimeout(timers.current[fieldId]);
    timers.current[fieldId] = setTimeout(async () => {
      try {
        await api.saveField(item.id, fieldId, value);
        setSave('saved');
      } catch {
        setSave('error');
      }
    }, 700);
  };

  useEffect(() => {
    const t = timers.current;
    return () => Object.values(t).forEach(clearTimeout);
  }, []);

  const totalWords = useMemo(
    () =>
      Object.values(values).reduce<number>((n, v) => {
        const s = toPlainText(v).trim();
        return n + (s ? s.split(/\s+/).length : 0);
      }, 0),
    [values],
  );

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 bg-slate-50 px-3 pt-2">
        {item.tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id)}
            className={`rounded-t px-4 py-2.5 text-sm font-semibold transition ${
              t.id === activeTab
                ? 'border-x border-t border-slate-200 bg-white text-slate-900'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.name}
          </button>
        ))}
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-5 py-3">
        {item.status && (
          <span className="inline-flex items-center gap-2 rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-800">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.status.color }} />
            {item.status.name}
          </span>
        )}
        <span className="text-xs text-slate-400">Item #{item.itemNumber} · {totalWords} words</span>
        <span className="ml-auto text-xs">
          {save === 'saving' && <span className="text-slate-400">Saving…</span>}
          {save === 'saved' && <span className="text-green-600">Saved</span>}
          {save === 'error' && <span className="text-red-600">Couldn’t save — you may not have edit access</span>}
        </span>
      </div>

      {/* Fields */}
      <div className="space-y-5 px-5 py-6">
        {tab?.fields.map((f) => {
          // ApiField → the shape Field renders. field_type strings already match.
          const field: ContentField = {
            id: f.id,
            type: f.type as ContentField['type'],
            label: f.label,
            guidelines: f.guidelines,
            isRequired: f.isRequired,
            isSystem: f.isSystem,
            isPlainText: f.isPlainText,
            recommendedLength: f.recommendedLength,
            recommendedLengthUnits: f.recommendedLengthUnits,
            choices: f.choices,
            value: values[f.id],
          };
          return (
            <Field
              key={f.id}
              field={field}
              files={[]}
              onChange={onChange}
              activeFieldId={activeFieldId}
              onActivate={setActiveFieldId}
            />
          );
        })}
      </div>
    </div>
  );
}
