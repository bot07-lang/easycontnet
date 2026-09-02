---
name: ec-feature-parity
description: Use BEFORE building or changing ANY user-facing feature that replicates EasyContent in the easy_content project — a new panel, dialog, menu, field, toolbar, button, empty state, etc. Forces gathering the EXACT reference UI + behavior (layout, placement, labels/copy, option order, enabled/disabled, inline-vs-modal, defaults, edge cases) from the user's screenshots/HTML and the repo docs, then CONFIRMING a short spec with the user, and only then coding. Exists to stop the recurring waste where UI was inferred, shipped wrong, and reworked after the user screenshotted the difference. Consult it at the START of any feature and to self-check before writing UI code.
---

# EasyContent feature parity — gather + confirm BEFORE you build

**Why this exists:** repeatedly, features were built with *inferred* UI — button placement, labels, option order, inline-vs-modal, empty/hover states, exact copy — and each wrong guess forced a screenshot → rework cycle that wasted time. This skill kills that loop: pin down the real reference first, confirm a small spec, build once.

## The rule
**Never infer user-facing UI or behavior for an EasyContent feature. Verify it or ask, up front.** Writing UI code before you have concrete answers to the checklist below is the mistake this skill prevents.

## What must be KNOWN before coding (do not guess any of these)
- [ ] **Placement & layout** — where each control lives (top bar / right sidebar / per-field / inside a modal) and the order of things.
- [ ] **Exact labels & copy** — button text, menu-item names, headings, tooltips, empty-state text, toast/confirmation wording — **verbatim** (match casing and phrasing).
- [ ] **Options & their order** — which menu items / options / tabs exist, in what order, and which are **enabled vs disabled**.
- [ ] **Interaction pattern** — inline vs **modal** vs dropdown; what hover / selected / active look like; the **default** selection.
- [ ] **Behavior & edge cases** — what each action does, confirmations, what shows on empty / error, defaults, and anything destructive.
- [ ] **Meaningful styling** — colors/icons/badges only where they carry meaning (e.g. status dots, kind badges).

## Step 1 — Check what's already specified (don't re-ask)
Read the repo docs first: `docs/PLAN.md`, `docs/editor-status.md`, `docs/file-library.md`, and any other `docs/*.md`. If a doc already specifies the behavior, **implement against the doc — don't re-infer from code or from EasyContent.** [[read-docs-before-inferring]]

## Step 2 — Ask the user for the reference, in ONE message
Before coding, tell the user exactly what would let you match it first-try, so they can send it all at once:
- **Screenshots of every relevant state** in EasyContent: default, empty, hover, each **open menu**, each **modal/dialog**, and confirm/error states.
- For anything with **text, URLs, or structure that matters** (exports, file/image markup, saved HTML), ask them to **inspect the element and paste the HTML** — that's how the file/image thumbnail + `data-full-name` structure was nailed exactly.
- Any specific checklist item above that's still ambiguous.

## Step 3 — Write a SHORT spec and get explicit confirmation
Produce a compact, skimmable spec (bullets or a small table) covering: placement/layout · labels & copy · option list + order · interaction pattern (inline/modal) · key behaviors + edge cases. Ask the user to **confirm or correct it. Do not start coding until they say go.** This confirmation step is the one that saves the rework — treat it as required, not optional.

## Step 4 — Build to the confirmed spec, then verify against the reference
- Match the spec **exactly**: labels, order, placement, copy, enabled/disabled.
- After building, re-check against the reference screenshots. If you **deliberately** deviate, say so and why (like the file-library "Option B: commit on Insert" note).

## Architectural / dependency / security choices → present options, let the user pick
If the feature involves a data-model, dependency, cost, or security decision (e.g. public vs private bucket, on-the-fly vs stored thumbnails, which diff library), lay out the options with trade-offs and **let the user decide before building.** [[ask-before-architectural-choices]] [[plan-stepwise-and-in-repo]]

## Anti-patterns this skill forbids
- Shipping a plausible-looking UI and waiting for the user to screenshot the difference.
- Inventing labels/copy ("Save version" vs "SAVE VERSION"), option order, or inline-vs-modal.
- Choosing a data/dependency/security approach silently instead of surfacing the trade-off.
