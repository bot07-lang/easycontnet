# Content Workflow Platform — Plan

> **Status:** living document. 🟢 decided · 🟡 open.
> Decisions are recorded in the Decision Log at the bottom **with reasoning**, so nobody re-litigates them later.

---

## 1. What we're building 🟢

A multi-tenant **content workflow platform**. Organisations create projects, invite people with roles, define an editorial workflow (a status ladder), and move structured content items through it — writers draft in a rich-text editor, reviewers approve or send back, and the item ends in a locked, publish-ready state.

**Core loop — the thing that must work:**

```
org → project → people+roles → workflow → content item → editor → review → approved
```

**MVP focus:** the **workflow engine** and the **editor**. Auth is explicitly *not* a focus — see §6.

---

## 2. Where the research came from 🟢

Functional reference: [EasyContent](https://easycontent.io). All findings came from **public, unauthenticated** sources — marketing site, `/help` knowledge base (~60 articles), `/faq`, `/pricing`, their **published OpenAPI spec** at `easycontent.io/swagger`, and the JS bundles their app serves to every visitor. No login, no credentials, no bulk scraping, no customer data.

**Scope of imitation — deliberate:**

| We do | We don't |
|---|---|
| Replicate *functionality and behaviour* (ideas aren't protectable) | Copy their source code |
| Learn from their documented data model | Reproduce their visual design pixel-for-pixel (trade dress) |
| Build our own implementation | Use their name or branding |

---

## 3. Findings that shape the design 🟢

Each traces to their docs or published spec — findings, not opinions.

**3.1 — The permission model is four gates, not one.** A capability requires passing *all*:

```
1. PROJECT MEMBERSHIP   user ∈ project.members
2. ROLE PERMISSION      permission ∈ user.role.permissions      (org-wide)
3. REVIEWING ROLE       user.role ∈ status.reviewingRoles       (per-project, per-status)
4. ITEM ASSIGNMENT      user ∈ item.assignees[currentStatus]    (per-item)
+ HARD OVERRIDE         status.readOnly ⇒ deny all writes, unconditionally
```

Documented escape hatch: `manage_content_items` substitutes for gates 3 + 4.

```
canEdit = (user ∈ currentStatus.assignees OR has(manage_content_items))
          AND NOT currentStatus.readOnly
```

Collapsing this into a single RBAC check is the most likely way to build the wrong thing.

**3.2 — There is no content-type enum. The Template *is* the type.** "Blog Post", "Landing Page" are templates, not types. No `type` column. This is the central design decision of the product.

**3.3 — The field is the atomic unit.** Locking, diffing, comments, and AI suggestions are *all* keyed to a field ID. Must be in the schema from the first commit.

**3.4 — Roles are org-global; role→status bindings are per-project.** One role per user, org-wide. A user *cannot* hold different roles on different projects. Per-project variation comes from wiring that role to different statuses per project. New roles review nothing — fails closed.

**3.5 — Item IDs are plain integers.** The `202502610072 how to clean...` in the screenshots is a **customer naming convention inside a free-text `name`**, not a generated ID. Their spec shows `id: 9`, URLs read `/project/297/edit/9`. **Do not build an ID generator.**

**3.6 — Their realtime is simpler than their marketing.** The site sells "live editing". The shipped bundle does **per-field pessimistic locking** — remote typing flips other editors to `setMode("readonly")` with a "*X is typing*" banner. No CRDT anywhere.

**3.7 — Length limits are cosmetic.** `recommendedLength` renders a red counter + error icon and **blocks nothing** — confirmed in their compiled component. Only `isRequired` blocks submission.

---

## 4. Stack 🟢

| Layer | Choice |
|---|---|
| **Database** | **Supabase** Postgres |
| **Auth** | **Supabase Auth** — seeded dummy users + dev switcher (§6) |
| **API** | **NestJS** — the only thing the browser talks to |
| **Security** | **RLS on from day one**, as a second lock beneath the API |
| **Storage** | Supabase Storage (Phase 3) |
| **Realtime** | Supabase Realtime — presence + broadcast (likely replaces a custom WS gateway) |
| **Frontend** | React + Vite **SPA** (behind a login — no SEO need, so no SSR) |
| **Editor** | **TipTap** (ProseMirror) |
| **Worker / Redis** | **Dropped from MVP** — nothing needs a queue yet |

**Why TypeScript end-to-end:** the hard part is the editor, not the CRUD. Track changes, comments anchored to text ranges that survive edits, and per-field diffing need a **structured document model the server also understands**. That model is JavaScript (ProseMirror). TS defines it **once** in a shared package and runs it on both sides. PHP/Python writes it twice — or bolts on a Node sidecar, which is exactly what EasyContent was forced into (SignalR/.NET beside Yii/PHP). We skip that tax.

**Why Supabase as *platform*, not as the whole backend:** the four-gate model and the workflow engine (submit/approve/reject, soft-vote, clearing reviews) are intricate transactional logic. That belongs in code, not in RLS policies and Edge Functions. We take Supabase's database, auth, and storage; we skip its auto-generated API.

**Two deliberate cost savings:**
1. **No CRDT in v1** — their shipped code uses per-field locking, and it works *because fields are small*.
2. **No TinyMCE + NYTimes ICE** — their stack (TinyMCE 5.10.9 is EOL; ICE v0.5.0 untouched since ~2012). TipTap reaches the same data shape (comments are already `<mark data-comment="…">`, i.e. marks) with a maintained library.

### 4.1 How NestJS talks to Supabase 🟢

NestJS connects to Postgres as a role that **respects RLS**, and sets the verified token claims on **each transaction** — mirroring exactly what Supabase's own API does internally.

```
browser ──JWT──> NestJS ──verify──> set claims on txn ──> Postgres (RLS applies)
```

Consequences:
- RLS policies are written **once** and behave identically whether hit from our API or from Supabase directly.
- `org_id` and `role` are injected into the JWT via a **Custom Access Token Hook**, so the tenant check is a *token read*, not a per-row subquery. This is what keeps multi-tenant RLS fast.
- The privileged service role is reserved for genuinely admin operations. **Never for a user request.**

---

## 5. Data model 🟢 *(shape settled; full schema next)*

Fully normalised. **Orgs and projects are rows, not tables.** 10 customers or 10,000 → same ~14 tables.

```
organizations     (id uuid, slug, name)              ← tenants are ROWS
  ├─ profiles     (id uuid → auth.users, org_id, role_id, name)
  ├─ roles        (id, org_id, name, is_active)
  ├─ projects     (id uuid, org_id, slug, name, archived_at)
  │    ├─ project_members     (project_id, profile_id)
  │    ├─ workflow_statuses   (id, project_id, name, position,
  │    │                       read_only, auto_due_days, is_initial, is_terminal)
  │    │    └─ status_reviewing_roles  (status_id, role_id)
  │    ├─ templates           (id, project_id, name, is_default)
  │    │    └─ template_tabs  (id, template_id, name, position, is_system)
  │    │         └─ template_fields (id, tab_id, type, label, position,
  │    │                             guidelines, ai_guidelines, is_required,
  │    │                             recommended_length, choices)
  │    └─ content_items       (id bigserial, project_id, template_id, name)
  │         ├─ content_field_values  (item_id, field_id, value)
  │         └─ item_status_assignees (item_id, status_id, profile_id, due_at)
  └─ (every table carries org_id)

permissions       (key)                        ← global lookup, no org_id
role_permissions  (role_id, permission_key)
```

### 5.1 Identifiers 🟢

| Thing | Type | Why |
|---|---|---|
| Org, profile, project | **UUID** | Never guessable; profiles are UUID anyway (Supabase `auth.users`) |
| **Content item** | **plain integer** (`bigserial`) | Humans say them out loud — "look at item 412". EasyContent's spec does the same (`id: 9`) |
| Org / project in URLs | **`slug`** | `app.com/brightrays/projects` — the UUID never appears in a URL |

**On guessable IDs — the honest version:** UUIDs are **not** what protects data. The permission check is. UUIDs are a *second lock*: they avoid leaking your customer count, give an attacker nothing to enumerate, and mean a single missing permission check isn't instantly exploitable.

### 5.2 The slug, and deferred subdomains 🟢

`slug` is the org's short name (`brightrays`). It does two jobs:

```
Today:  app.com/brightrays/projects       ← slug in the path
Later:  brightrays.app.com/projects       ← slug as a subdomain
```

Switching later = read the slug from the Host header instead of the path, plus wildcard DNS + wildcard TLS. **No migration, no data change, no new column.** So subdomains are deferred at **zero** future cost — they buy branding (agencies showing clients *their* URL), not function.

**Reserve dangerous slugs from day one** — `www, api, app, admin, mail, static, cdn, assets, help, docs, support, blog, status, staging`. If a customer takes `api` today, the day subdomains switch on, `api.app.com` is both our API *and* a customer. Ten minutes now; impossible to fix once a customer owns the name. Also enforce: lowercase, alphanumeric + hyphen, unique, 3–63 chars (the DNS limit — free now, mandatory later).

---

## 6. Auth in the MVP 🟢

**Auth is not an MVP focus.** But we do **not** hardcode a fake user, because Supabase Auth is already built — skipping it saves nothing and costs two real things:

1. **RLS can't work without a real token** — there'd be nothing for the database to read.
2. **You cannot test four gates as one fake user.** The permission model only means something when you can *be* an Admin, then a Writer, then an Editor, and watch the buttons change.

**Instead:**

- A **seed script** creates dummy orgs, users, roles, projects, templates, workflow statuses, and content items.
- A **dev-only user switcher** — *"Acting as: Abuzar (Writer)"* — signs in a seeded user on click.
- Tokens and RLS are real. **No login screen exists.** No auth work happens.
- Real login later = build a login page, delete the switcher. Nothing else changes.

---

## 7. Backend modules 🟡 *(shape agreed, boundaries to confirm)*

| # | Module | Owns | Phase |
|---|---|---|---|
| 1 | `identity` | Orgs, profiles, JWT verification, custom claims hook, seed + dev switcher | 0 |
| 2 | `access` | Roles, permissions, **PolicyService**, guards | 0 |
| 3 | `projects` | Projects, membership, settings, archive/duplicate | 0 |
| 4 | `templates` | Templates, tabs, fields, field types | 1 |
| 5 | `content` | Content items, field values, categories | 1 |
| 6 | `workflow` | Statuses, reviewing roles, assignees, transitions, deadlines | 1 |
| 7 | `editor` | Document schema, field read/write, autosave | 1 |
| 8 | `collaboration` | Comments, mentions, presence, field locks | 2 |
| 9 | `versions` | Snapshots, per-field diff, restore | 2 |
| 10 | `assets` | Project file library, uploads, attribution | 3 |
| 11 | `notifications` | Email, in-app, digests | 3 |
| 12 | `insights` | Dashboard widgets, calendar | 3 |
| 13 | `integrations` | Public API, API keys, webhooks | 4 |
| 14 | `ai` | Prompt library, generation, per-field suggestion diffs | 4 |

**Dependency rule:** `access` depends only on `identity`. Everything else depends on `access`. No module reaches into another's tables — cross-module reads go through services.

---

## 8. Phases 🟡

**Phase 0 — Walking skeleton.** *(Much smaller now — no auth to build.)*
Supabase project + local dev, schema for orgs/profiles/roles/permissions/projects/members, RLS policies + custom claims hook, seed data + dev user switcher, NestJS skeleton with JWT verification and the RLS transaction wrapper, SPA shell.

**Phase 1 — MVP core loop.** ← *the target.*
Templates (tabs, fields, 11 types), content items, the workflow engine (per-project statuses, reviewing roles, per-status assignees, auto-due, read-only, submit/approve/reject/manual, claiming, soft-vote), TipTap editor with per-field autosave.

**Phase 2 — Collaboration.** Comments (4 anchor types), versions + diff + restore, presence + field locking, track changes.

**Phase 3 — Operations.** File library, notifications, dashboard widgets, calendar.

**Phase 4 — Extension.** Public API, webhooks (with HMAC + retries — *they document none*), shareable links, AI, import/export.

---

## 9. Open decisions 🟡

| # | Decision | Options | Leaning |
|---|---|---|---|
| D2 | Default role→permission mapping | *Undocumented upstream — only 2 of 115 cells published. Our call.* | Admin=all, Writer=draft-only |
| D3 | Editor in Phase 1 | Plain rich text / bring suggestions forward | Plain rich text |
| D4 | Status dot colours | Deadline state / status identity | Deadline state |
| D5 | First/last status | Positional / flagged | Flagged (`is_initial`/`is_terminal`) — positional breaks on reorder |
| D8 | Field values storage | Row per field / JSONB blob per item | Row per field — per-field locking, diffing, comments all need it addressable |
| D9 | Query layer | Kysely / Drizzle / raw SQL | Kysely — typed SQL, no ORM magic, fine with externally-managed migrations |

---

## 10. Key risks 🟢

1. **Permission correctness** — four gates, easy to collapse. *Mitigation:* one `PolicyService`, table-driven tests per gate, fail-closed, no ad-hoc controller checks.
2. **Editor scope creep** — track changes + anchored comments + diffing is where schedules die. *Mitigation:* plain rich text in Phase 1.
3. **Comment anchors drifting** on concurrent edits. *Mitigation:* marks (ProseMirror remaps through transforms), not character offsets.
4. **Templates-as-data** over-engineering into a generic form builder. *Mitigation:* ship the 11 field types, resist a 12th.
5. **RLS performance** on multi-tenant reads. *Mitigation:* `org_id` as a JWT claim (token read, not subquery); `(select auth.uid())` wrapping for initplan caching.

---

## 11. Verification 🟢

- **Walk the loop by hand, as each role** (the switcher makes this cheap): create project → invite Writer + Editor → build template → create item → draft → submit → approve → confirm terminal lock.
- **Permission suite:** table-driven over `(role, permission, status, assignment, readOnly)` → assert allow/deny. The test suite that matters most.
- **Workflow suite:** submit from non-first status → deny; approve without assignment → deny; manual jump with `manage_content_items` → allow + reviews cleared; edit in read-only status **as Owner → deny**.
- **Tenancy:** Org A cannot read any Org B row — asserted against RLS directly, not just through the API.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green before merge.

---

## Decision Log

| Date | Decision | Reasoning |
|---|---|---|
| 2026-07-17 | Independent of Yug | Explicit instruction — no shared conventions or code |
| 2026-07-17 | NestJS + React, TypeScript end-to-end | The document model is JS and must run on client *and* server; avoids the two-runtime split EasyContent was forced into |
| 2026-07-17 | TipTap over TinyMCE + ICE | Same data shape (marks), maintained library, no inherited EOL debt |
| 2026-07-17 | No CRDT in v1 | Their shipped code uses per-field locking; fields are small enough that it works |
| 2026-07-17 | **D1: shared DB + `org_id`** | One database, every row labelled with its owner, enforced automatically so it can't be forgotten. DB-per-customer costs a migration per customer forever and only earns its keep when a contract demands physical isolation — which can be done for one customer later |
| 2026-07-17 | **Naming: `organizations` / `org_id`** | "Org" is the word Akash uses naturally. "Account" is ambiguous — company account or login account? |
| 2026-07-17 | **Mixed IDs: UUID for org/profile/project, integer for content items** | UUIDs stop enumeration and customer-count leakage where IDs are shared around; integers stay for items because humans say them out loud, as EasyContent's own spec does |
| 2026-07-17 | **Slug column now, subdomains later** | Slug keeps UUIDs out of URLs today *and* becomes the subdomain later with no migration — deferral at zero future cost. Reserved-word list from day one, because it's unfixable once a customer owns `api` |
| 2026-07-17 | **Supabase as platform, NestJS in front** | Supabase *is* Postgres, so the schema is unaffected. Take its DB + Auth + Storage; skip its auto-API, because the four-gate model and workflow engine are intricate transactional logic that belongs in code, not RLS policies |
| 2026-07-17 | **D7: Supabase Auth — answered by the platform choice** | Nothing to build |
| 2026-07-17 | **D6: RLS from day one — answered by the platform choice** | RLS *is* Supabase's security model; it stops being optional |
| 2026-07-17 | **Dummy data via seeded real users + dev switcher, not a fake user** | Delivers the ask (no auth work, no login friction) without the cost. A fake user makes RLS untestable and makes the four-gate model impossible to exercise — you must be able to *be* each role |
| 2026-07-17 | **Worker + Redis dropped from MVP** | Nothing needs a queue until diffing/exports in later phases |
| 2026-07-20 | **Reused the discarded Yug-V2-Staging Supabase project** | All 4 tables held 0 rows and no auth user had ever existed; public schema wiped clean. Verified before dropping, not assumed |
| 2026-07-20 | **Write rules live in RLS, not the API** | This is what "RLS from day one" costs and buys: an API bug cannot become a breach, because the database refuses the write regardless of what asked for it |
| 2026-07-20 | **`is_editable` flag + RLS, not one or the other** | RLS filters rows using data *in* the row. Permissions answer WHO may edit; the flag answers WHICH rows may be edited. Name-matching (`name != 'Admin'`) breaks on rename and across orgs |
| 2026-07-20 | **Per-org sequential `project_number`, no project slug** | Readable URLs (`/brightrays/projects/1`) without slug rename breakage. Race-safe via a counter on the org row — the `UPDATE ... RETURNING` takes a row lock. Verified by test |
| 2026-07-20 | **27 permissions, not 23** | Screenshots of a real EasyContent Roles screen showed 4 the help article omits: `manage_billing`, `use_ai_features`, `purchase_credits`, `manage_ai_prompt_templates`. `view_account_report` is also live, despite docs saying "coming soon" |
| 2026-07-20 | **D2 settled: 5 generic default roles, restrictive matrix** | Generic names (Admin/Content Manager/Editor/SME/Writer) because a new customer wouldn't know what "HOC" means. Deliberately stricter than the real account observed: **Writer gets no `manage_content_items`** — they edit via assignment (gate 4), which needs no permission. Defaults should start tight; loosening is one tick, tightening rarely occurs to anyone |
| 2026-07-20 | **Teams deferred to Phase 3** | Confirmed cosmetic — "adding a user to a team doesn't give them any special permissions". Nothing depends on them |
| 2026-07-20 | **✅ RLS-through-NestJS VALIDATED** | The project's biggest untested assumption. Simulated the request path (`set role authenticated` + claims on the transaction) against seeded data: membership gate, `manage_projects` metadata-only visibility, and the tenant wall all behaved exactly as designed. Two people in the same org saw different projects; nobody crossed the org boundary. The design is proven, not assumed |
| 2026-07-20 | **Build in vertical slices from here** | Schema-first was right for a coherent data model, but continuing layer-by-layer would defer all integration risk to the end. Attack highest uncertainty first — which is why the RLS proof came before more tables |
| 2026-07-21 | **D8: field values as one row per field** (not a JSONB blob per item) | Per-field locking, field-anchored comments and per-field diffing all need each field individually addressable. Value column is JSONB so one shape holds text, arrays and {url,alt} |
| 2026-07-21 | **Templates are per-project** (carry `project_id`) | Matches EasyContent (Default badge differs per project; "clone into another project" exists). Chosen over org-shared for project isolation — editing a template can't break another project's content. Cost: same template must be cloned per project |
| 2026-07-21 | **Ratings/reviews and custom-structure deferred to Phase 2** | Reviewer rating values and the soft-vote approval store depend on Submit/Approve/Reject, which haven't been observed yet. Modelling them blind now risks getting them wrong |
| 2026-07-21 | **API data access: direct Postgres + `withUser`, NOT Supabase PostgREST** | Briefly pivoted to PostgREST/RPC (passwordless) to unblock without a DB password, but reverted to the conventional backend pattern: the API owns a direct DB connection as an RLS-bound role and sets identity per transaction. Chosen for defense in depth and because it is how backends conventionally own data access. Cost: the API needs a DB connection string |
| 2026-07-21 | **Defense in depth: PolicyService in code AND RLS in the DB** | Permission checks run twice — a `PolicyService`/`@RequirePermission` guard in the API (early, friendly rejection) and RLS in Postgres (the unbypassable wall). RLS is the real enforcement; the code layer catches mistakes early and gives clear errors. Worth it for a permissions-critical product |
| 2026-07-21 | **`app_org_id()` derives the tenant from the signed-in user** | Reads `org_id` from the JWT claim if present, else looks it up from the caller's profile by `auth.uid()`. Works whether or not a custom-claims hook is configured; `withUser` sets the claim, so the claim path is used in practice |
| 2026-07-20 | **D4 settled — status colours are IDENTITY, not deadline state** | Overturned by a real Workflow screen: each status carries its own configured colour (Draft red, Editorial yellow, Approved green, Completed grey), and a content item's dot is simply its current status's colour. My original leaning was wrong |
| 2026-07-20 | **D5 settled — `is_initial` / `is_terminal` flags, pinned** | The real screen shows no drag handle on the first or last status, and the terminal status has no reviewing-role checkboxes at all. Middle statuses reorder freely |
| 2026-07-20 | **Product defaults moved out of SQL into `packages/shared`** | `create_organization()` and `seed_default_workflow()` hardcoded role names, permission lists, status names and hex colours. Those are product decisions that change — baking them into SQL meant a migration per tweak. The functions now take definitions as JSONB and validate them; what stays in SQL is the part that belongs there: one transaction, so an org can never exist half-built. Proven generic by seeding two orgs with *different* role sets and workflows from the same function |
| 2026-07-20 | **Const objects, not TypeScript `enum`s** | `const enum` is incompatible with `isolatedModules`; plain `enum` emits unused runtime code and wraps values so they need converting before hitting SQL. `as const` objects give the same union-type safety while the values stay plain strings that cross into Postgres unchanged |
