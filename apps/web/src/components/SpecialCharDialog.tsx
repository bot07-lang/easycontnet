import { useMemo, useState } from 'react';

/** A special character with a searchable name. */
interface Ch { c: string; n: string }

const CATEGORIES: Record<string, Ch[]> = {
  Currency: [
    { c: '$', n: 'dollar' }, { c: '¢', n: 'cent' }, { c: '€', n: 'euro' }, { c: '£', n: 'pound' },
    { c: '¥', n: 'yen' }, { c: '¤', n: 'currency sign' }, { c: '₹', n: 'indian rupee' },
    { c: '₽', n: 'ruble' }, { c: '₩', n: 'won' }, { c: '₪', n: 'shekel' }, { c: '₫', n: 'dong' },
    { c: '₴', n: 'hryvnia' }, { c: '₺', n: 'lira' }, { c: '฿', n: 'baht' }, { c: '₦', n: 'naira' },
    { c: '₡', n: 'colon' }, { c: '₲', n: 'guarani' }, { c: '₵', n: 'cedi' }, { c: '元', n: 'yuan' },
  ],
  Text: [
    { c: '©', n: 'copyright' }, { c: '®', n: 'registered' }, { c: '™', n: 'trademark' },
    { c: '‰', n: 'per mille' }, { c: 'µ', n: 'micro' }, { c: '·', n: 'middle dot' },
    { c: '…', n: 'ellipsis' }, { c: '′', n: 'prime' }, { c: '″', n: 'double prime' },
    { c: '§', n: 'section' }, { c: '¶', n: 'pilcrow paragraph' }, { c: 'ß', n: 'sharp s eszett' },
    { c: '†', n: 'dagger' }, { c: '‡', n: 'double dagger' }, { c: '•', n: 'bullet' },
    { c: '–', n: 'en dash' }, { c: '—', n: 'em dash' },
  ],
  Quotations: [
    { c: '‘', n: 'left single quote' }, { c: '’', n: 'right single quote apostrophe' },
    { c: '“', n: 'left double quote' }, { c: '”', n: 'right double quote' },
    { c: '‚', n: 'single low quote' }, { c: '„', n: 'double low quote' },
    { c: '‹', n: 'single left angle quote' }, { c: '›', n: 'single right angle quote' },
    { c: '«', n: 'left angle quote' }, { c: '»', n: 'right angle quote' },
  ],
  Mathematical: [
    { c: '±', n: 'plus minus' }, { c: '×', n: 'multiply times' }, { c: '÷', n: 'divide' },
    { c: '≈', n: 'approximately' }, { c: '≠', n: 'not equal' }, { c: '≤', n: 'less than or equal' },
    { c: '≥', n: 'greater than or equal' }, { c: '∞', n: 'infinity' }, { c: '∑', n: 'sum sigma' },
    { c: '∏', n: 'product pi' }, { c: '∂', n: 'partial derivative' }, { c: '∆', n: 'delta' },
    { c: '√', n: 'square root' }, { c: '∫', n: 'integral' }, { c: 'π', n: 'pi' },
    { c: '°', n: 'degree' }, { c: '¹', n: 'superscript one' }, { c: '²', n: 'superscript two squared' },
    { c: '³', n: 'superscript three cubed' }, { c: '½', n: 'one half' }, { c: '¼', n: 'one quarter' },
    { c: '¾', n: 'three quarters' },
  ],
  'Extended Latin': [
    { c: 'À', n: 'a grave' }, { c: 'Á', n: 'a acute' }, { c: 'Â', n: 'a circumflex' }, { c: 'Ã', n: 'a tilde' },
    { c: 'Ä', n: 'a umlaut' }, { c: 'Å', n: 'a ring' }, { c: 'Æ', n: 'ae' }, { c: 'Ç', n: 'c cedilla' },
    { c: 'È', n: 'e grave' }, { c: 'É', n: 'e acute' }, { c: 'Ê', n: 'e circumflex' }, { c: 'Ë', n: 'e umlaut' },
    { c: 'Ñ', n: 'n tilde' }, { c: 'Ò', n: 'o grave' }, { c: 'Ó', n: 'o acute' }, { c: 'Ô', n: 'o circumflex' },
    { c: 'Õ', n: 'o tilde' }, { c: 'Ö', n: 'o umlaut' }, { c: 'Ø', n: 'o slash' }, { c: 'Ù', n: 'u grave' },
    { c: 'Ú', n: 'u acute' }, { c: 'Û', n: 'u circumflex' }, { c: 'Ü', n: 'u umlaut' }, { c: 'Ý', n: 'y acute' },
    { c: 'à', n: 'a grave' }, { c: 'á', n: 'a acute' }, { c: 'â', n: 'a circumflex' }, { c: 'ã', n: 'a tilde' },
    { c: 'ä', n: 'a umlaut' }, { c: 'å', n: 'a ring' }, { c: 'æ', n: 'ae' }, { c: 'ç', n: 'c cedilla' },
    { c: 'è', n: 'e grave' }, { c: 'é', n: 'e acute' }, { c: 'ê', n: 'e circumflex' }, { c: 'ë', n: 'e umlaut' },
    { c: 'ñ', n: 'n tilde' }, { c: 'ó', n: 'o acute' }, { c: 'ö', n: 'o umlaut' }, { c: 'ø', n: 'o slash' },
    { c: 'ü', n: 'u umlaut' }, { c: 'ÿ', n: 'y umlaut' },
  ],
  Symbols: [
    { c: '★', n: 'star filled' }, { c: '☆', n: 'star outline' }, { c: '♠', n: 'spade' },
    { c: '♣', n: 'club' }, { c: '♥', n: 'heart' }, { c: '♦', n: 'diamond' }, { c: '✓', n: 'check tick' },
    { c: '✗', n: 'cross x' }, { c: '☑', n: 'checkbox' }, { c: '■', n: 'square filled' },
    { c: '□', n: 'square outline' }, { c: '●', n: 'circle filled' }, { c: '○', n: 'circle outline' },
    { c: '☺', n: 'smiley' }, { c: '♪', n: 'note' }, { c: '☀', n: 'sun' }, { c: '☂', n: 'umbrella' },
  ],
  Arrows: [
    { c: '←', n: 'left arrow' }, { c: '→', n: 'right arrow' }, { c: '↑', n: 'up arrow' },
    { c: '↓', n: 'down arrow' }, { c: '↔', n: 'left right arrow' }, { c: '↕', n: 'up down arrow' },
    { c: '⇐', n: 'left double arrow' }, { c: '⇒', n: 'right double arrow' }, { c: '⇑', n: 'up double arrow' },
    { c: '⇓', n: 'down double arrow' }, { c: '⇔', n: 'left right double arrow' }, { c: '↖', n: 'up left arrow' },
    { c: '↗', n: 'up right arrow' }, { c: '↘', n: 'down right arrow' }, { c: '↙', n: 'down left arrow' },
  ],
};

const CAT_NAMES = ['All', ...Object.keys(CATEGORIES)];
const ALL: Ch[] = Object.values(CATEGORIES).flat();

/**
 * Insert › Special character. A category sidebar plus a name search, matching
 * the reference. Clicking a glyph inserts it and leaves the dialog open so
 * several can be added in a row; Close dismisses it.
 */
export function SpecialCharDialog({ onPick, onClose }: { onPick: (ch: string) => void; onClose: () => void }) {
  const [cat, setCat] = useState('All');
  const [query, setQuery] = useState('');

  const chars = useMemo(() => {
    const base = cat === 'All' ? ALL : CATEGORIES[cat]!;
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((ch) => ch.n.includes(q) || ch.c === query.trim());
  }, [cat, query]);

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-900/40 p-6" onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} className="flex h-[520px] w-[720px] max-w-full flex-col rounded-lg bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-3.5">
          <h2 className="text-[20px] font-semibold text-slate-900">Special Character</h2>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded text-slate-500 hover:bg-slate-100">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <nav className="w-40 shrink-0 space-y-0.5 overflow-y-auto border-r border-slate-200 px-3 py-4 text-[15px]">
            {CAT_NAMES.map((name) => (
              <button key={name} type="button" onClick={() => setCat(name)}
                      className={`block w-full text-left ${cat === name ? 'font-medium text-blue-600 underline underline-offset-4' : 'text-slate-600 hover:text-slate-900'}`}>
                {name}
              </button>
            ))}
          </nav>

          <div className="flex min-w-0 flex-1 flex-col p-4">
            <label className="mb-3 block">
              <span className="mb-1 block text-[13px] text-slate-500">Search</span>
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
                     className="h-10 w-full rounded-md border border-slate-300 px-3 text-[15px] focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </label>
            <div className="grid grid-cols-9 gap-1 overflow-y-auto">
              {chars.map((ch, i) => (
                <button key={`${ch.c}-${i}`} type="button" title={ch.n} onMouseDown={(e) => e.preventDefault()}
                        onClick={() => onPick(ch.c)}
                        className="grid h-10 place-items-center rounded border border-transparent text-[20px] text-slate-700 hover:border-slate-300 hover:bg-slate-100">
                  {ch.c}
                </button>
              ))}
              {chars.length === 0 && <p className="col-span-9 py-6 text-center text-sm text-slate-400">No matches.</p>}
            </div>
          </div>
        </div>

        <footer className="flex justify-end border-t border-slate-200 px-6 py-3.5">
          <button type="button" onClick={onClose} className="rounded-md bg-blue-600 px-6 py-2 text-sm font-semibold text-white hover:bg-blue-700">Close</button>
        </footer>
      </div>
    </div>
  );
}
