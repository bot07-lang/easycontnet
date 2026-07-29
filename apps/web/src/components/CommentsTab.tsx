import { useMemo } from 'react';
import type { ApiItem, ItemComment } from '../lib/api';
import { CommentPanel } from './CommentPanel';

/**
 * The sidebar "Comments" tab. Unlike the per-field/file popovers, it shows ALL
 * of the item's comments — item, field, file and text — each labeled with where
 * it's anchored ("Author Name [Main Content]"). New comments added here are
 * item-level ("general").
 */
export function CommentsTab({ item }: { item: ApiItem }) {
  const anchorLabel = useMemo(() => {
    // field id → "Label [Tab]", and file id → the field that holds it.
    const fieldById = new Map<string, string>();
    const fileToField = new Map<string, string>();
    for (const t of item.tabs) {
      for (const f of t.fields) {
        fieldById.set(f.id, `${f.label} [${t.name}]`);
        if (f.type === 'file_image_upload' && Array.isArray(f.value)) {
          for (const sf of f.value as { id: string }[]) fileToField.set(sf.id, `${f.label} [${t.name}]`);
        }
      }
    }
    return (c: ItemComment): string | null => {
      if (c.anchor === 'item') return null;
      if ((c.anchor === 'field' || c.anchor === 'text') && c.field_id) return fieldById.get(c.field_id) ?? null;
      if (c.anchor === 'file' && c.file_id) return fileToField.get(c.file_id) ?? 'File';
      return null;
    };
  }, [item]);

  return <CommentPanel itemId={item.id} match={() => true} newAnchor={{ anchor: 'item' }} anchorLabel={anchorLabel} />;
}
