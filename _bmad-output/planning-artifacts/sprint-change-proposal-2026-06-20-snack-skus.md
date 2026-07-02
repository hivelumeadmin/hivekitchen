# Sprint Change Proposal — Snacks as Household-Maintained SKUs (un-fold from `recipes`)

**Date:** 2026-06-20
**Author:** Claude (think-out-loud session with Menon)
**Triggered by:** Menon — observed plan-compose hard-failure during manual testing
**Scope classification:** **Moderate** — touches the canonical data model + a safety-posture decision + the planner; no epic replan
**Status:** Decisions locked (1–3 below); awaiting approval to slice

---

## Section 1 — Issue Summary

### Problem statement

A manual "Compose my plan" run for household `a4c7b309-…` (week `2026-06-22`) **hard-failed with no plan committed**. The planner picked valid Mains (Chicken Biriyani, Chicken Shawarma, Grilled chicken kebab with rice — all resolvable in the catalog) but invented snack names (`Banana`, `Carrot Sticks`, `Cucumber Slices`) that don't resolve. `plan.compose → resolveRecipeId → findIdByNameForHousehold` throws on any miss; with the 8-iteration ceiling (3-s37/3-s38) the loop exhausted 6 compose retries and hit the cap (failure trace: `STOP → recipe.search×3 → plan.compose×6`).

### Root cause (two layers)

1. **Proximate:** the `recipes` catalog for this household has **zero snack-classified rows** — every recipe is `applicable_slots = {main}`. The planner had no valid snack to anchor to, so it hallucinated, and `plan.compose` rejected the names.
2. **Structural:** the canonical data-model redesign **folded `snack_skus` into `recipes`** (`recipe.service.ts`: *"folded from snack_skus in 3-DM-A2"*) and **DROPPED the `snack_skus` table** (`20261006000000_snack_sku_fold.sql:120`). The 10 seed rows were re-inserted into `recipes` with `applicable_slots=['snack']` (id-preserving), but normal households get no snack-classified recipes, so the planner hallucinates. The fold also collapsed a real ontological distinction: **prepackaged store-bought snacks are products (brand, label allergens, no method), not recipes**, and they should be a **family-maintained list**, not entries in a shared/agent-discovered recipe pool. **Un-folding (3-s40) RE-CREATES the dropped table — it is not an `ALTER`.**

### Categorization

Original-requirements oversight + an over-aggressive model collapse. The `snack_skus` design (Stories 3.20/3.21) already modeled exactly the desired behavior — unit-level SKUs with pre-computed `contains_*` allergen flags and an `extra_library` family-authored pattern — and the canonical fold discarded it.

---

## Section 2 — Decision (Option B: un-fold snacks into a household-scoped SKU catalog)

**Locked with Menon:**

1. **`plan_slots.snack_sku_id`** — explicit nullable column. Snack slots reference a SKU, not a `recipes` row. (The old flat `plan_items` had `item_sku_id`; the tree model dropped it — we restore it on the tree.)
2. **Deterministic rotation** — the planner does **not** creatively choose snacks. It rotates the family's snack list, honoring per-child `children.extra_rules` `{pins, bans}`. No LLM involvement for snack slots → the hallucination failure is structurally impossible.
3. **Keep the 10 global seed SKUs + family Add/Remove** — RE-CREATE `snack_skus` (dropped in `20261006000000`) with `created_by_household_id` (nullable). `NULL` = curated/global starter SKUs; non-null = a family's own additions. Family list = global picks + own rows. A "Snack shelf / My Snacks" management surface lets parents **add** and **remove** (soft-delete) snacks, following the `extra_library` pattern (parent-authored, `archived_at`, audit events).

> **Terminology note:** Menon called this the "pantry." `pantry` already denotes the *ingredient inventory* (the `<pantry>` planner block, Epic 6 grocery/leftover logic). This snack list is a **distinct** concept — table stays `snack_skus` (household-scoped); UI label "Snack shelf / My Snacks". Not unified with the grocery pantry unless decided otherwise.

### Two-phase allergen doctrine (Menon)

- **Phase 1 — add-time is parent-sovereign, no enforcement.** A family adds snacks they know are safe for *their* kids. The system does not gate snack additions on allergens. Consistent with the app's treatment of parent-declared safety data as authoritative.
- **Phase 2 — plan-time deterministic fail-safe (later).** Once SKUs carry `contains_*` flags, the guardrail cross-checks SKU allergens against each child's declared allergens at commit — a backstop, not the primary gate. `snack_skus` was literally designed for this (pre-computed booleans, conservative-unknown default).

### ⚠️ Safety-posture change being accepted (must be conscious, hence recorded)

Today's 3-s39 guardrail **fails closed** on "unverifiable" items for any child with a declared allergen. A Phase-1 snack SKU with no allergen data *is* unverifiable. So Phase 1 requires: **snack SKUs are marked parent-attested → exempt from the fail-closed path.** Otherwise every allergic child's plan blocks the moment it includes a no-data snack. Phase 2 flips them back into deterministic checking once `contains_*` data exists. This is a deliberate relaxation of current fail-closed behavior, scoped to parent-vouched snacks.

---

## Section 3 — Concrete shape

| Layer | Change |
|---|---|
| **DB** | `ALTER TABLE snack_skus ADD created_by_household_id uuid REFERENCES households(id)` (nullable; NULL = global seed). `ALTER TABLE plan_slots ADD snack_sku_id uuid REFERENCES snack_skus(id) ON DELETE SET NULL`. New `kitchen_map_version` bump trigger on `snack_skus` (household-scoped rows feed planner context — **without this, edits sit behind the 1-hr stale Redis cache**, a bug we've hit before). Audit event types for snack add/remove (mirror `extra_library`). |
| **Contracts** | `SnackSkuSchema`, add/remove request schemas; `plan_slots`/tree compose schema gains `snack_sku_id` for snack slots. |
| **Planner** | Snack slots filled by **deterministic rotation** over the household snack list (respect `extra_rules` pins/bans). `plan.compose` resolves snack reference → `snack_skus` (household-scoped), not `recipes`. Planner prompt: snacks are no longer the agent's to invent — drop snack composition from the creative path. |
| **Guardrail** | Phase 1: treat snack SKUs as parent-attested (exempt from unverifiable fail-closed). Phase 2: evaluate `contains_*` against declared allergens. |
| **Web** | "Snack shelf / My Snacks" screen — list global + own SKUs, add (name/brand/category, optional Phase-2 allergen ticks), remove (soft-delete). Per `extra_library` UX precedent + kitchen-profile soft-edit (7-s15) pattern. |
| **Kitchen Map** | Household snack list surfaced into planner context block. |

---

## Section 4 — Impact

| Epic | Effect |
|---|---|
| **Epic 3 — Weekly Plan** | Planner snack path changes (recipe-resolve → SKU rotation). The empty-snack hard-fail is fixed. |
| **Epic 6 — Grocery & Pantry** | Adjacent; keep `snack_skus` distinct from grocery `pantry`. No merge for now. |
| Others | No change. |

**Immediate unblock (independent of this proposal):** the proximate bug can be patched today by seeding snacks-as-recipes (`applicable_slots={snack}`) — forward-compatible, lets manual testing proceed while Option B is sliced.

---

## Section 5 — Open / deferred

1. **SKU allergen sourcing for Phase 2** — parent label-ticks vs. curated/barcode enrichment. Conservative-unknown default means many plan-time flags until real data lands; acceptable as a fail-safe but worth a UX decision.
2. **Rotation policy details** — variety window (don't repeat a snack 2 days running?), per-child vs. shared snack, how `pins` force inclusion.
3. **Global seed governance** — who curates/extends the 10 shared SKUs over time.
4. ~~Slice breakdown — TBD on approval.~~ **Resolved 2026-06-20** → see Section 6 (new Epic 3 slices `3-s40`…`3-s43`).

---

## Section 6 — Slice Breakdown (Epic 3: `3-s40` … `3-s43`)

Vertical slices (each ships a demo-able behavior). **Scope: snack slots only** — Extras (`extra_library`/`extra_kind`) untouched. Mode: batch; home: new Epic 3 slices (confirmed with Menon 2026-06-20).

### 3-s40 — Planner rotates snacks from `snack_skus` (un-fold) 🔓 unblock
- **Demo:** "Compose my plan" fills each snack slot by **deterministic rotation** over the 10 global seed SKUs (no LLM choice), honoring per-child `extra_rules` {pins,bans} (empty by default) → plan composes with real snacks; hallucination hard-fail gone.
- **Layers:**
  - DB: RE-CREATE `snack_skus` (+`created_by_household_id`, re-seed 10 global rows) — it was DROPPED in `20261006000000`; `plan_slots.snack_sku_id` (nullable FK, `ON DELETE SET NULL`); `commit_plan` RPC persists it.
  - Agent: `plan.compose` makes snack slots **optional in LLM output**; new `SnackRotationService` deterministically assigns a SKU per (child, day) before guardrail/commit (round-robin, no same-snack adjacent days). Snack `recipe_id` resolution removed from the planner path.
  - Guardrail: snack-SKU slots marked **parent-attested → exempt** from 3-s39 fail-closed-on-unverifiable (Phase-1 doctrine).
- **Deferred:** 3-s41, 3-s42, 3-s43.
- **Manual test:** clear plan → Compose → plan commits with a snack each day; no `plan.compose recipe_id not found` in logs.

### 3-s41 — Family snack shelf: add / remove
- **Demo:** "My Snacks" → global seeds + **add** (name/brand/category) + **remove** (soft-delete) own SKUs; added enter rotation pool, removed drop next compose.
- **Layers:**
  - DB: `snack_skus += created_by_household_id` (nullable; NULL=global seed) + `archived_at`; snack add/remove audit types (mirror `extra_library`); **`kitchen_map_version` bump trigger on `snack_skus`** (household rows feed planner context → avoids 1-hr stale cache).
  - API: `GET/POST/DELETE /v1/households/:id/snacks` (mirror `extra_library` repo/service); `SnackSkuSchema` + request contracts.
  - Web: "My Snacks" screen (`extra_library` + 7-s15 soft-edit patterns).
  - Agent: rotation pool = global seeds + household-owned active SKUs.
- **Deferred:** allergen ticks + fail-safe (3-s43).
- **Manual test:** add "Pretzel Twists" → Compose → in rotation; remove → next Compose drops it.

### 3-s42 — Per-child snack rules (pins/bans editing)
- **Demo:** Kitchen profile → set child to "ban dairy-category snacks" / "always include fruit"; rotation respects per child (reading wired in 3-s40; this adds the editing surface).
- **Layers:**
  - API: `PATCH children/:id/extra-rules` (or extend kitchen-profile edit route); `children.extra_rules` already exists.
  - Web: per-child snack-rules editor in the kitchen-profile card.
- **Manual test:** ban dairy for Child A → Compose → A never gets String Cheese/Yogurt; B still can.

### 3-s43 — Phase-2 deterministic allergen fail-safe
- **Demo:** Shelf SKU flagged `contains_dairy` + child with dairy allergen → at commit the guardrail blocks that SKU for that child; rotation picks a safe alternative. Snack SKUs flip from parent-attested-exempt → deterministic checking.
- **Layers:**
  - Guardrail: `clearOrRejectCommit` evaluates `snack_sku_id` slots via `contains_*` vs declared allergens (conservative-unknown default); rotation re-picks safe SKU.
  - Web: `contains_*` allergen ticks on the add-snack form.
- **Note:** **Beta gate** — required before any household with declared allergens relies on snack rotation (closes the Phase-1 relaxation).
- **Manual test:** child allergic to peanut + `contains_peanut` shelf SKU → Compose → never lands for that child.

### Sequencing
```
3-s40 (unblock) ─ 3-s41 (family shelf) ─┬─ 3-s42 (per-child rules)
                                        └─ 3-s43 (allergen fail-safe)  ← beta gate for allergic households
```
3-s40 strictly first. 3-s42 / 3-s43 parallelizable after 3-s41.

### Not slices (per "no schema-only stories")
- The `plan_slots.snack_sku_id` column and `snack_skus` household columns come into existence **with** the first behavior needing them (3-s40 / 3-s41), not as standalone migrations.
- Advanced rotation variety, barcode/curated allergen enrichment, shared-seed governance → deferred refinements.

---

## Section 7 — Implementation Handoff

**Scope classification: Moderate** — backlog reorganization (add 4 Epic-3 slices) + coordinated DEV implementation; no PRD/architecture replan. Touches the canonical-model commitment and a safety-posture relaxation, both recorded above.

**Backlog reorg:** add `3-s40`…`3-s43` to `sprint-status.yaml` under `epic-3` as `backlog`, with `3-s40` as the unblock entry point. Standard story cycle per slice (create-story → dev-story → code-review).

**Success criteria:** after 3-s40, a cl<eared household composes a plan with real snacks and no hard-fail; after 3-s43, allergic households are deterministically protected at the snack layer.
