# Autosave robustness — improvement spec

How to harden the content-item autosave against data loss (network blips, quick
reload, tab close). Local reference — not committed. Companion to `editor-status.md`.

## 1. Current state (as-built)
In `ItemEditor.tsx`:
- Per-field **debounced** save: on edit → update local state, set status `saving`,
  and schedule `api.saveField(itemId, fieldId, value)` **700 ms** later (one
  `setTimeout` per field, keyed in a `timers` ref).
- `api.saveField` → `PUT /content/items/:id/fields/:fieldId` → writes
  `content_field_values` (RLS-gated).
- A single editor-wide status: `idle | saving | saved | error`.
- **On unmount, the cleanup CANCELS pending timers** → any edit still inside the
  700 ms window is dropped.
- No retry, no unsaved-changes prompt, no offline handling, no flush-on-leave.

**Known loss window:** type → reload/close/navigate within ~700 ms → last edit lost,
silently.

## 2. EasyContent parity (verified by testing)
EasyContent uses a **plain debounced XHR save** (`POST` → `204`), and:
- **No** `beforeunload` "unsaved changes" prompt.
- **No** `sendBeacon` (saves are `xhr`, not `ping`).
- **No** offline / can't-save warning.
- Type → immediate reload/close = **lost, silently** — same limitation as ours.

**Implication:** these improvements make us *better than* EasyContent, not just at
parity. All are optional for parity; recommended for actually not losing users' work.

## 3. Improvements (prioritized)

### P1 — cheap, high-value (kills the loss you can reproduce today)
1. **Flush on leave.** On **field blur** and on **editor unmount**, save any pending
   edit *immediately* via the normal request (don't cancel the timer). Replace the
   "clear all timers" cleanup with "flush all pending, then clear."
2. **`beforeunload` guard.** If any field is dirty or a save is in flight, register a
   `beforeunload` listener that triggers the browser's native *"Leave site? Changes
   you made may not be saved"* prompt. Remove it once everything is saved.

### P2 — robustness on flaky networks
3. **Retry with backoff.** On failure, branch by cause:
   - **Network / 5xx** → retry with exponential backoff (1s, 2s, 4s… capped),
     keep the *latest* value (coalesce), until it succeeds.
   - **403 (no edit access)** → do **not** retry; show a permanent "can't save —
     no permission" state.
4. **Clear status indicator** (like Docs): `Saving…` → `All changes saved` →
   `Trying to reconnect…` → `Couldn't save`. Track a global `hasUnsavedChanges`
   (any field dirty/pending) to drive it and the `beforeunload` guard.

### P3 — nice-to-have / strongest protection
5. **Offline detection.** Listen to `online` / `offline` events → show
   *"You're offline — changes will save when you reconnect."*; pause attempts;
   flush all pending on reconnect.
6. **Local backup + recovery.** Mirror unsaved edits into `localStorage` keyed by
   `(itemId, fieldId)`. On load, if the local copy is newer than the server value,
   offer to recover it. Survives crashes/refresh mid-save. (Optionally add
   `sendBeacon` on `pagehide` for the true tab-close case — see caveat below.)

## 4. Important caveat — `sendBeacon` vs our auth
Our API authenticates with a **Bearer token** (Supabase JWT in the `Authorization`
header). **`sendBeacon` cannot set custom headers** — it sends cookies only. So a
last-ditch tab-close save via `sendBeacon` **won't authenticate** as-is. Options:
- Accept it: without `sendBeacon`, a tab-close *during the debounce window* stays
  unsaved — **same as EasyContent**, and P1 (flush on leave) already covers the
  common in-app cases.
- Or: add a cookie/session path or a signed short-lived token in the beacon body so
  a beacon endpoint can auth it (more work; only needed if we insist on surviving a
  hard tab-close).

**Recommendation:** ship P1 + P2 with normal `fetch` (which *can* set the auth
header); treat `sendBeacon` as out of scope unless hard-tab-close protection is
explicitly required.

## 5. What we deliberately do NOT need
Real-time OT/CRDT (Google-Docs live co-editing, cursors). Our model is **async,
per-field, usually one editor at a time** (write → review → approve), so
**last-write-wins per field** is fine. Optional lightweight guard: send the value's
last-known version and have the server reject a stale overwrite — catches the rare
"two people edited the same field" case without the heavy machinery.

## 6. Where to implement
- Refactor the save logic out of `ItemEditor.tsx` into a reusable hook, e.g.
  `apps/web/src/lib/useAutosave.ts`:
  - Per-field state: `{ value, status, dirty, retryCount, timer }`.
  - `queueSave(fieldId, value)` — the debounced entry point (replaces `onChange`'s
    inline timer logic).
  - `flush(fieldId?)` — save now (used by blur/unmount).
  - Exposes `hasUnsavedChanges` for the `beforeunload` guard + status UI.
- `RichTextField` / `Field` — call `flush(fieldId)` on blur.
- `ItemEditor` — flush all on unmount (replace the timer-clearing cleanup); register
  the `beforeunload` + `online`/`offline` listeners.
- Backend `saveField` stays as-is for P1/P2. (A beacon endpoint would be additional,
  only if we pursue the P3 tab-close case.)

## 7. Suggested build order
1. **Phase 1 (P1):** flush-on-leave + `beforeunload` guard. Small, removes the
   reproducible data loss.
2. **Phase 2 (P2):** retry-with-backoff + status indicator.
3. **Phase 3 (P3):** offline banner + local backup (and `sendBeacon` only if the
   auth caveat is worth solving).
