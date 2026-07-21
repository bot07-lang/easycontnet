import type { ContentField } from '../mock/article';
import { countText, formatNumber } from '../lib/counts';

/**
 * The Words / Characters readout in a field header.
 *
 * Shows "Words: 2,635" when no limit is set, and "Characters: 46 / 50" when
 * one is. Only the unit the limit applies to gets the "/ limit" suffix.
 * Over the limit turns red and adds an error icon — advisory, never blocking.
 */
export function FieldCounter({ field, value }: { field: ContentField; value: unknown }) {
  const { words, characters } = countText(value);
  const limit = field.recommendedLength;
  const unit = field.recommendedLengthUnits;

  const wordsOver = limit !== undefined && unit === 'words' && words > limit;
  const charsOver = limit !== undefined && unit === 'characters' && characters > limit;
  const over = wordsOver || charsOver;

  const wordsLabel =
    limit !== undefined && unit === 'words'
      ? `Words: ${formatNumber(words)} / ${formatNumber(limit)}`
      : `Words: ${formatNumber(words)}`;

  const charsLabel =
    limit !== undefined && unit === 'characters'
      ? `Characters: ${formatNumber(characters)} / ${formatNumber(limit)}`
      : `Characters: ${formatNumber(characters)}`;

  return (
    <div className="flex items-center gap-2">
      {over && (
        <span className="text-red-600" title="Over the recommended length" aria-hidden>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2 1 21h22L12 2zm1 14h-2v2h2v-2zm0-6h-2v4h2v-4z" />
          </svg>
        </span>
      )}
      <div className={`text-right text-[11px] leading-tight ${over ? 'text-red-600' : 'text-slate-500'}`}>
        <div className={wordsOver ? 'text-red-600' : ''}>{wordsLabel}</div>
        <div className={charsOver ? 'text-red-600' : ''}>{charsLabel}</div>
      </div>
    </div>
  );
}
