import { api } from './api';

/**
 * Reliable field-save queue that OUTLIVES the editor component.
 *
 * Each field save retries with exponential backoff + jitter, and is mirrored to
 * localStorage so a value is never silently lost if the request fails or the tab
 * is closed mid-flight — it's recovered and re-saved on next load. A newer save
 * for the same field supersedes any in-flight retry chain for it.
 */

const MAX_ATTEMPTS = 6;
const BASE_DELAY_MS = 800;
const LS_PREFIX = 'cw:unsaved:';

export type SaveStatus = 'saving' | 'saved' | 'retrying' | 'error';

type Callbacks = {
  onStatus?: (s: SaveStatus) => void;
  onSaved?: () => void;
};

// One retry chain per (item, field). `token` lets a newer save's callbacks
// ignore a stale one; `controller` actually cancels its in-flight HTTP request
// so an older save can never land on the server after a newer one (which
// would otherwise silently overwrite it — the token only gated client-side
// handling, not server write order).
const chains = new Map<string, { timer?: ReturnType<typeof setTimeout>; token: number; controller?: AbortController }>();
let tokenSeq = 0;

const memKey = (itemId: string, fieldId: string) => `${itemId}::${fieldId}`;
const lsKey = (itemId: string, fieldId: string) => `${LS_PREFIX}${itemId}::${fieldId}`;

function stash(itemId: string, fieldId: string, value: unknown) {
  try {
    localStorage.setItem(lsKey(itemId, fieldId), JSON.stringify(value));
  } catch {
    /* quota exceeded / private mode — best-effort backup only */
  }
}

function unstash(itemId: string, fieldId: string) {
  try {
    localStorage.removeItem(lsKey(itemId, fieldId));
  } catch {
    /* ignore */
  }
}

/**
 * Queue a reliable save for one field. Stashes it to localStorage immediately,
 * then PUTs with retry/backoff; clears the stash on success. Supersedes any prior
 * pending save for the same field.
 */
export function saveField(itemId: string, fieldId: string, value: unknown, cb?: Callbacks) {
  const k = memKey(itemId, fieldId);
  const prev = chains.get(k);
  if (prev?.timer) clearTimeout(prev.timer);
  prev?.controller?.abort(); // cancel any in-flight request for this field — it must not land after ours
  const token = ++tokenSeq;
  const controller = new AbortController();
  chains.set(k, { token, controller });

  stash(itemId, fieldId, value); // recoverable from the very first attempt
  cb?.onStatus?.('saving');

  const attempt = (n: number) => {
    api.saveField(itemId, fieldId, value, controller.signal).then(
      () => {
        if (chains.get(k)?.token !== token) return; // superseded by a newer save
        chains.delete(k);
        unstash(itemId, fieldId);
        cb?.onSaved?.();
        cb?.onStatus?.('saved');
      },
      (err: unknown) => {
        if (chains.get(k)?.token !== token) return; // superseded (includes our own abort())
        // 401/403 won't be fixed by retrying (no edit access); stop early.
        const permanent = err instanceof Error && /^40[13]:/.test(err.message);
        if (permanent || n >= MAX_ATTEMPTS) {
          // Give up for now; the value stays in localStorage and is re-saved on
          // next load (recoverPending), so it isn't lost.
          cb?.onStatus?.('error');
          return;
        }
        cb?.onStatus?.('retrying');
        const delay = BASE_DELAY_MS * 2 ** (n - 1) + Math.floor(Math.random() * 400); // jitter
        const timer = setTimeout(() => attempt(n + 1), delay);
        chains.set(k, { timer, token, controller });
      },
    );
  };
  attempt(1);
}

/**
 * Save one field NOW and await the result — used to flush a pending edit before
 * an action that would otherwise lose it (e.g. moving the item into a read-only
 * status, which the server then refuses to accept edits for). Cancels any
 * pending retry chain for the field, supersedes it, and clears the stash on
 * success. Resolves `true` if it committed, `false` if the save failed (the
 * value stays stashed for later recovery).
 */
export async function flushField(itemId: string, fieldId: string, value: unknown): Promise<boolean> {
  const k = memKey(itemId, fieldId);
  const prev = chains.get(k);
  if (prev?.timer) clearTimeout(prev.timer);
  prev?.controller?.abort(); // cancel any in-flight request for this field — it must not land after ours
  const token = ++tokenSeq;
  const controller = new AbortController();
  chains.set(k, { token, controller });
  stash(itemId, fieldId, value);
  try {
    await api.saveField(itemId, fieldId, value, controller.signal);
    if (chains.get(k)?.token === token) { chains.delete(k); unstash(itemId, fieldId); }
    return true;
  } catch {
    return false; // leave it stashed; recovered on next load
  }
}

/** Unsaved edits stashed for an item — used to recover + re-save on load. */
export function recoverPending(itemId: string): { fieldId: string; value: unknown }[] {
  const prefix = `${LS_PREFIX}${itemId}::`;
  const out: { fieldId: string; value: unknown }[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      const raw = localStorage.getItem(key);
      if (raw == null) continue;
      // One field's stash being malformed (partial write, stale schema from an
      // older app version) must not abort recovery of every other field — skip
      // just that entry instead of losing the whole loop to one bad JSON.parse.
      try {
        out.push({ fieldId: key.slice(prefix.length), value: JSON.parse(raw) });
      } catch {
        /* corrupted entry — drop it, nothing to recover from it anyway */
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

/** Whether any field anywhere still has an unsaved edit (for the leave guard). */
export function hasPendingSaves(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      if (localStorage.key(i)?.startsWith(LS_PREFIX)) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}
