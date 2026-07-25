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
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path d="M12 3 2 20h20L12 3z" fill="currentColor" strokeLinejoin="round" />
            <path d="M12 10v4.2" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
            <circle cx="12" cy="17.2" r="1.15" fill="#fff" />
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
