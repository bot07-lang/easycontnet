# File Library — behavior spec (module 10 `assets`)

Status: draft for review. Captures the **correct** EasyContent behavior for the
project file library + the file/image field, and the gaps against our current
implementation. Implement against this; don't re-infer from the code.

## 1. Mental model — three layers

| Layer | What it is | Where it lives |
|---|---|---|
| **Storage** | the raw file bytes | Supabase `content-files` bucket (`storage_path`) |
| **Library (catalog)** | the metadata record that makes a file *appear* in the project | `public.project_files` row |
| **Link (attachment)** | a reference from a *content item* to a library file | the item's file-field value (`content_field_values`) |

A file **shows in the "From project library" list** because a `project_files`
row exists (catalog). A file is **on a content item's field** because that item
**links** to it.

## 2. Core rules

1. **The library is project-scoped and shared.** Every file uploaded to a
   project is visible from the file dialog of *every* content item in that
   project. Not tied to the item it was uploaded from.
2. **Links are many-to-many.** One library file can be linked to many content
   items at once. Linking it to a new item **adds** a link; it never moves or
   removes existing links.
3. **Linked vs Unlinked** = whether a library file has **≥1** link.
   - **Linked** — attached to at least one content item (card shows which:
     "🔗 <item name>", possibly several).
   - **Unlinked** — in the library but attached to nothing (unused / orphan).
4. **Upload ≠ Link.** Two distinct actions:
   - **Upload** = add a *new* file to the library (bytes → storage + catalog row).
   - **Link/attach** = point a content item at an *existing* library file.

## 3. The two Insert paths

Both tabs end in **Insert**, and **Insert always links the chosen file(s) to the
content item you're currently editing.** The difference is only whether the file
is new (must be uploaded first) or already in the library.

| Tab | On Insert | Toasts shown |
|---|---|---|
| **Upload files** (new file) | upload → add to library → **link to current item** | *"New files have been added successfully."* **+** *"The files are attached to content item."* |
| **From project library** (existing file) | **link to current item** only (no upload) | *"The files are attached to content item."* |

Exact toast copy (match EasyContent verbatim):
- `New files have been added successfully.`
- `The files are attached to content item.`

## 4. Staging model — **Option B: commit on Insert** (chosen)

Nothing touches storage or the database until **Insert**.

- **Upload files tab:** picking/dropping files shows **local preview cards**
  (browser only — `URL.createObjectURL`). No upload yet.
- **Delete a card before Insert** → removed locally; **nothing** was uploaded, so
  nothing to clean up. The file never appears in the library.
- **Cancel / close the dialog** → all staged files discarded; nothing persists.
- **Insert** → for each staged *new* file: upload bytes → create `project_files`
  row → link to item. For each selected *library* file: create link to item.
  This is when the brief "Processing…" happens.
- **After Insert** → dialog closes, then the toast(s) show.

> Deliberate deviation: EasyContent shows "Processing…" on drop (it uploads
> eagerly). We chose Option B (upload on Insert) for simplicity and zero orphan
> risk, so the processing indicator shows *during* Insert instead. Same end
> result: nothing enters the library until Insert; delete/cancel discards.

## 5. Library tab UI

- **Search bar** — placeholder "Search by file or item name". Filters by file
  name **or** the name of any content item the file is linked to.
- **Segmented filter** — **All / Linked / Unlinked** (by link count).
- **Each file card**: thumbnail (image) or type badge, name, size, uploaded-by +
  relative time, linked item(s) ("🔗 <item>"), a select checkbox, and a ⋮ menu.
- Files already attached to the *current* field render as already-selected/added.

## 6. Data-model mapping (our schema)

- **Library** → `public.project_files` (exists).
- **Link** → represented by the file's `id` appearing in an item's file-field
  value (`content_field_values.value` JSONB array of `{id,...}`). `linked_items`
  is computed by scanning these (already implemented in `FilesService.listFiles`).
- Many-to-many falls out for free: a file is linked to every item whose field
  value references its id.
- **Decision:** keep links implicit via field-value references (no separate
  `file_links` table) — it already supports many-to-many and the Linked/Unlinked
  + search-by-item requirements. Revisit only if we need item-level links
  independent of a specific field.

## 7. Backend impact

- `createUploadUrl` and `recordFile` stay as-is; the change is **when** the
  frontend calls them (now on Insert, not on drop).
- **No new endpoint needed** for Option B (no eagerly-uploaded objects to discard).
- `deleteFile` (row + storage object) stays for the field-level trash and dupe
  cleanup.

## 8. Frontend impact (`AddFilesDialog.tsx`)

- Staged uploads become **local-only** until Insert (rework `Pending` +
  `uploadOne` → stage; `removePending` → local removal).
- `insert()` becomes async: upload+record new files, link all selected, show
  toasts, close.
- Add **search** + **All/Linked/Unlinked** filter state over `library.data`.
- Card shows linked item(s).
- Needs a lightweight **toast** mechanism (none exists yet) for the two messages.

## 9. Cleanup

- Delete today's **10 unlinked test dupes** in the Blog library (rows **and**
  storage objects, so nothing orphans).

## 10. Out of scope (separate items)

- `featured_image` field upload (still disabled; unspecified in PLAN — leave).
- File comments ("Comment — coming in Phase 2").
- Folder move / the full ⋮ menu (partially present already).

## 11. Gap checklist

- [ ] Staging = commit on Insert (Option B)
- [ ] Upload-new Insert: add to library **and** link → both toasts
- [ ] Library Insert: link only → one toast
- [ ] Delete-before-insert & Cancel discard locally (no orphans)
- [ ] Search by file **or** item name
- [ ] All / Linked / Unlinked filter
- [ ] Card shows linked item(s)
- [ ] Dialog closes + toast(s) on Insert
- [ ] Toast mechanism (2 messages, exact copy)
- [ ] Clean up 10 unlinked test dupes
