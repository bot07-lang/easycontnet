# Collaborative editor — analysis & plan

Local design note (not committed). Captures the discussion on whether/how to make
our content editor collaborative, and why EasyContent's isn't.

## 1. Is EasyContent's editor collaborative? — No (and why)

EasyContent's editor is a **single-user-at-a-time** rich-text editor (TipTap-style)
with autosave + version history. It is **not** real-time collaborative (no live
cursors, no simultaneous typing merged automatically). The reasons:

- **EC is a workflow tool built around stage ownership.** Content moves through
  statuses (Draft → Editorial review → Approved → Completed). Two independent
  mechanisms are at play (not the same thing):
  - **Assignment** = *who is responsible* for a stage (accountability/coordination).
    It is a label, NOT a hard edit-lock — a non-assignee isn't technically frozen
    out of editing.
  - **Read-only status** (e.g. Completed) = freezes editing for **everyone**,
    including the assigned people. A property of the status, not of people.
- **Coordination is done by the workflow, not by live co-editing** — assignments,
  status locks, the **Claim** button, **comments**, and **versions**.
- **Cost/fit:** true real-time editing needs a CRDT + a live sync server +
  presence — heavy machinery that buys little when the model is "one owner per
  stage."

## 2. The multi-assignee nuance (important caveat)

EC **does** allow multiple people per status (e.g. Editorial review = two
reviewers). So the workflow does **not** fully serialize editing — it only makes
clashes unlikely.

**What happens if two people assigned to the same status edit at once:**
- Assignment = **responsibility, not an exclusive lock**.
- The editor has **no real-time merge** → **last-write-wins** (later autosave
  overwrites the other's concurrent changes).
- EC mitigates **socially + with recovery**, not technically: the **Claim**
  button (signal "I've got this"), **comments**, and **version history**.

**Conclusion:** concurrent editing by co-assignees is a **real gap** in EC —
handled by convention + versions, not technology. Two shared-stage assignees
*can* silently clobber each other.

## 3. Levels of "collaborative" for us

| Level | What the user sees | What it needs |
|---|---|---|
| **1. Conflict-safe** | No live editing, but never a silent overwrite — "someone else edited this, reload" | Version/etag checks on save (extend the existing per-field autosave) |
| **2. Presence + soft-lock** | See who else is viewing/editing the item; a field someone is editing shows locked/claimed | A realtime **presence** channel (we already have **Supabase Realtime**) — no CRDT |
| **3. Full real-time multiplayer** | Google-Docs-style live cursors + simultaneous typing merged automatically | **Yjs** CRDT + TipTap collaboration extension + a **WebSocket sync server** + persistence + presence |

## 4. Technical constraints (mainly for Level 3)

- **Our API is on Vercel serverless — it cannot hold WebSocket connections.**
  A separate realtime backend is required: self-hosted **Hocuspocus**, a hosted
  service (**Liveblocks / PartyKit**), or **Supabase Realtime** + a Yjs adapter.
- **Our editor is many separate fields** — each is its own TipTap instance, so
  collaboration needs a **Yjs document per field** (or one shared doc with
  fragments).
- **Persistence rework** — today we store HTML per field; collaboration stores
  the **CRDT binary state** and syncs that to the DB.
- **Auth + workflow integration** — the realtime connection must respect project
  membership, assignment, and read-only statuses.

## 5. Recommendation

**Level 2 (presence + soft-lock)** is the best fit:
- It directly closes EC's real gap (co-assignees clobbering each other) — so it's
  **strictly better than EC** on the multi-assignee case.
- It reuses **Supabase Realtime** (already in the stack) — no new backend, no CRDT.
- It matches our workflow/stage-ownership model instead of fighting it.

Level 3 is impressive but is a large project (new backend service, per-field CRDT,
persistence rework) and somewhat at odds with stage ownership.

## 6. Open decision

Which level to build (2 recommended). Level 2 next steps would be:
1. Presence channel per item (who's viewing) via Supabase Realtime.
2. Per-field "claim"/soft-lock: when user A focuses a field, broadcast a lock;
   others see it as locked until A blurs / times out.
3. UI: avatars of who's in the item; locked-field affordance.
4. Integrate with read-only statuses + assignment gating.

## 7. Level 3 — libraries & integrations needed (in simple terms + cost)

To build full real-time multiplayer (Level 3), here's everything we'd pull in and
whether it costs money. (Levels 1 & 2 need **none** of this.)

### A. Editor + merge libraries (run in the browser) — all FREE, open-source
| Library | What it does | Cost |
|---|---|---|
| **Yjs** | The merge engine (CRDT) that combines simultaneous edits | **Free** (MIT) |
| **@tiptap/extension-collaboration** | Plugs our TipTap editor into a Yjs doc (content sync) | **Free** (MIT) |
| **@tiptap/extension-collaboration-cursor** | Shows other people's live cursors + names | **Free** (MIT) |
| **A Yjs "provider"** (the connector to the transport) | Moves Yjs updates between clients — e.g. `y-supabase` (Supabase Realtime) or `@hocuspocus/provider` (WebSocket server) | **Free** (open-source) |

So **every actual library/package is free and open-source.** The cost is never the
code — it's the always-on *infrastructure* that moves the live data (below).

### B. The transport / sync ("always-on connection") — the cost decision
Real-time needs a persistent WebSocket layer, which our Vercel serverless API
can't host. Three ways to get one:

| Option | What it is | Cost |
|---|---|---|
| **1. Supabase Realtime** *(recommended — already ours)* | Use our existing managed Realtime as the transport; Postgres for persistence | **Free within our plan's connection limits**; scaling past them = higher Supabase plan/add-on (paid) |
| **2. Self-hosted Hocuspocus** (`@hocuspocus/server`) | Run our own Yjs server | **Software free** (MIT), but must run on an **always-on host** (Railway / Render / Fly.io / VM) → **hosting fees (paid)** |
| **3. Hosted collab providers** | Managed, easiest, most features | **Paid** — Liveblocks, PartyKit, Ably, Pusher, Tiptap Cloud (free tiers, then usage-based) |

### C. Persistence — ALREADY OURS
| Piece | What it does | Cost |
|---|---|---|
| **Supabase Postgres** | Stores the CRDT blob (+ the readable HTML snapshot) | **Free within our plan** (storage counts toward it) |

### Bottom line
- **All the libraries are free/open-source** (Yjs + TipTap collaboration extensions
  + a provider).
- The **only potential cost is infrastructure** to carry the live connection.
- If we use **Supabase Realtime + Postgres (both already ours)**, there is **no new
  paid service** — cost appears only if we scale past our Supabase plan's limits.
- A **dedicated hosted provider (Liveblocks / PartyKit / Tiptap Cloud)** is optional
  and **paid** — nice convenience (server-owned persistence, easy setup), not required.

## 8. Level 3 — why it's hard (challenges, in short)

The CRDT (Yjs) is free and does the hard merge math for us. The difficulty is
everything *around* it — build effort + risk, not cost:

- **Catch-up/sync** — a new joiner must load the saved state and reconcile it with
  live edits (ordering, the load-vs-subscribe gap).
- **Persistence ownership** — no server owns the doc, so a *client* must save the
  merged state; risk of losing the last edits if it disconnects abruptly.
- **Per-field lifecycle** — manage many Yjs docs + channels as fields mount/unmount.
- **Undo rework** — replace TipTap's built-in undo with Yjs's collaborative undo.
- **Two representations in sync** — keep the CRDT blob and the readable HTML
  consistent; migrate existing HTML content into Yjs docs.
- **Auth wiring** — client needs a Supabase-recognizable token for Realtime; gate
  channel writes (a bad actor could inject text into others' live view).
- **Message volume** — batch/debounce the many small updates, respect Realtime rate
  limits, add periodic full resyncs to recover from drops/offline.
- **Downstream rework** — versioning, diff/compare, read-only and autosave all
  assume "HTML per field" and must be adapted.
- **Concurrency testing** — race/concurrency bugs are hard to reproduce and test.

Level 2, by contrast, needs none of the above — it reuses the existing autosave and
just adds presence + soft-lock over Supabase Realtime.

## 9. Level 2 — DONE vs REMAINING (do later)

**Done (implemented, building green):**
- Presence viewer avatars in the editor top bar (`lib/presence.ts`, `ItemEditor`).
- Soft-lock driven by TYPING: heartbeat while typing (throttled ~1/1.5s) + TTL
  release ~3–4s after typing stops. No focus/blur (that misfired). Field shows an
  overlay "X is editing"; disconnect/leave clears via presence-leave + TTL.
- "Viewing"/"editing" wording made consistent (dropped the "Viewing" label).

**Remaining — complete later:**
1. **Permission-based read-only.** Today the editor's read-only lock is
   status-based only, so a user who lacks edit rights (e.g. a Writer on an item
   past their stage — no `manage_content_items`, not a reviewing-role/assignee for
   the current status) can still TYPE, and every autosave 403s. Fix: make the
   editor read-only for the current user when they can't edit the item at its
   current status (mirror the RLS gate on the client). Kills the 403 spam.
   *(Also worth verifying against EC: their docs are ambiguous on whether the UI
   locks or just fails saves; a Writer assigned to Draft could still edit an item
   in Editorial in EC — so EC's edit gate may be more permissive than our RLS.)*
2. **Channel security hardening.** Add Supabase Realtime RLS (channel
   authorization) so only project members can join an item's `item:<id>` channel
   (reuse `app_is_project_member`). Low risk today (presence/lock are advisory and
   the real enforcement is the save API), but not hardened.
