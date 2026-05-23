# Epic 2.6 Brief — Personalized Onboarding Catalog (Two-Layer Model)

**Date:** 2026-05-23
**Author:** Drafted by Amelia (Developer persona) during Epic 2.5 retrospective; revised after schema review
**Triggered by:** Menon (catalog-scope review post-2.5 ship)
**Scope classification:** **Major** (per checklist 5.5 — successor architecture supersedes shipped 2.5-s9 design choices)
**Status:** Awaiting approval (revision 2 — reflects existing `recipes` + `household_recipe_usage` infrastructure from story 3-31)
**Format:** Sprint-change-proposal style (mirrors `sprint-change-proposal-2026-05-19.md` that birthed Epic 2.5)

---

## Section 0 — Revision History

- **Rev 1 (2026-05-23 morning):** Proposed new `lunch_catalog` + `curated_baseline_items` + `lunch_catalog_events` tables. 8 slices.
- **Rev 2 (2026-05-23):** Schema review identified that the proposed `lunch_catalog` table is **redundant** with `recipes` + `household_recipe_usage` already shipped via story 3-31. Brief revised to **extend existing tables** rather than create parallel infrastructure. Two-layer model adopted (suggestable name+tags at Stage 1, full structured recipe lazy via 3-31 at plan-time). 6 slices.
- **Rev 3 (2026-05-23, this version):** Edge-case findings from `bmad-check-implementation-readiness` + `bmad-review-edge-case-hunter` folded into per-slice acceptance criteria. New **"Edge cases to handle"** subsection added to each of the 6 slices. Operational definitions previously deferred (floor-breach denominator, mass-block denominator, cold-start threshold) now locked. No structural changes; same 6 slices, sharper ACs. See `implementation-readiness-report-2026-05-23.md` for the raw findings.

---

## Section 1 — Issue Summary

### Problem statement

Epic 2.5 shipped on 2026-05-22 with two design choices at M5 (the "starting line for Lumi" moment) that were the right MVP work for the 2026-05-19 timeline but are superseded by the **Household Food Catalog UX specification** finalized 2026-05-23 (`_bmad-output/planning-artifacts/ux-design-spec-household-food-catalog.md`):

1. **Static 18-chip global M5 catalog** sourced from a hardcoded `KEY_LABEL` map in `apps/api/src/agents/prompts/onboarding.prompt.ts`. The spec calls this out as violating Lumi's *"only suggests things that fit"* promise for any household whose cultural / dietary / allergen profile does not align with the static set's Anglo-Western-with-some-South-Asian shape. M5 chips must instead be **personalized per-household** from M1–M4 signals.

2. **Standalone `favorite_lunches` table** (≤~20 rows per household, encrypted text, no link to the structured `recipes` table that story 3-31 had already shipped two weeks earlier). The catalog UX spec calls for per-household "lunch ideas Lumi knows fit you" with provenance tracking. The architecturally-honest version of this concept is `household_recipe_usage` (which already tracks per-household engagement signals) plus a `catalog_provenance` column — NOT a parallel table.

### Architectural collision (the key insight)

The shipped tables from story 3-31 already provide most of what the catalog UX spec describes:

| What the spec calls for | What 3-31 already shipped |
|---|---|
| Per-household catalog with confidence + favorite flags | `household_recipe_usage` with `confidence_score`, `is_household_favorite`, `is_household_banned`, full counter set |
| Structured tag metadata (allergen, dietary, cultural, cuisine) | `recipes.allergen_flags` / `dietary_flags` / `cultural_tags` / `cuisine_tags` — GIN-indexed |
| Plan-time consumption | Kitchen Map composer already projects via `projectRecipes(raw.recipe_usage)`; planner already reads this |
| Plan-outcome signal feedback | `acceptance_count` / `swap_out_count` / `positive_outcome_count` already update on plan outcomes |
| Stage 3 "living catalog" enrichment | Already passively wired via `PlansService.commit()` materialization |

What the spec adds and 3-31 doesn't have: (a) `catalog_provenance` distinction (declared / inferred / parent_added) on `household_recipe_usage`, (b) Stage 0 curated baseline content, (c) Stage 1 background-async LLM seeding worker, (d) M5 chip card reading from this surface, (e) cold-start fallback path for under-represented cohorts.

### Two-layer model (architectural commitment)

Stage 1 LLM seeding produces **suggestable lunch ideas**, not full structured recipes. The distinction is intentional:

| Layer | Object | Content | When produced | Cost |
|---|---|---|---|---|
| **Layer 1 — Suggestable idea** | `recipes` row with `source='catalog_seeded'`, `ingredients=[]`, tags populated | `canonical_name`, `allergen_flags`, `dietary_flags`, `cultural_tags`, `cuisine_tags`, `applicable_slots` | Stage 1 LLM seeding (post-M2) | ~1 LLM call generates 50 ideas in a single response |
| **Layer 2 — Structured recipe** | `recipes` row with `source='agent_generated'` or `'imported'`, `ingredients` filled | Full structured ingredients (key/modifier/display/quantity/unit/optional/substitutes), `ingredient_keys`, `instructions`, `prep_time_minutes` | Lazily by `RecipeAgent` (story 3-31) when planner actually commits a plan using this name | ~1 Tavily fetch + 1 LLM extraction per recipe, only on first use |

**Why this matters for the brief:** the catalog grows quickly (50 names per household at onboarding); the structured-recipe shelf grows slowly (one materialization per first-time-used lunch). The cost model holds because most catalog items are never used in a plan; the ones that are get materialized once and then reused.

The Allergy Guardrail Service operates on `allergen_flags` (per the schema comment in `20260820000200_create_recipes_and_usage.sql` line 91: *"the allergy guardrail reads this for O(1) per-recipe evaluation rather than parsing ingredient text"*). Layer 1's tag set is sufficient for guardrail filtering. Layer 2's full ingredient list is needed only when the recipe enters a plan — at which point 3-31 runs a *second* guardrail pass against the now-known ingredients (defense in depth).

### How discovered

The catalog UX spec was being authored in parallel with Epic 2.5 execution. The two streams converged on 2026-05-23 when (a) the catalog spec workflow finalized and (b) the Epic 2.5 retrospective surfaced the collision while reviewing what `2.5-s9` actually shipped. A pre-approval schema review on this brief surfaced the further fact that the catalog UX spec maps onto existing 3-31 infrastructure with extensions, not net-new tables.

Neither shipped piece is a bug — both pass acceptance for the contract they were written against. The collision is a scope-emergence event compounded by `2.5-s9`'s design being done without reference to `3-31`'s recently-shipped `recipes` / `household_recipe_usage` tables.

### Evidence (3 specific gaps)

1. **M5 chip personalization gap.** The static 18-chip set is identical across households. For a Somali / Yemeni / Tibetan / sub-regional Caribbean household it produces "BLT? Ham sandwich? We don't eat that" — the failure mode named in the spec's Moment-1 falsification criteria.

2. **`favorite_lunches` ↔ `recipes` disconnect.** A parent declaring "dal-rice" at M5 today writes a `favorite_lunches` row with encrypted text and **no link to the recipes catalog or any planner-readable metadata**. The planner cannot see M5 favorites as candidate recipes; it sees them only as "this household has 12 favorite lunches" via a separate Kitchen Map projection. The signal that should drive plan generation is structurally invisible to the planner.

3. **`catalog_provenance` field gap.** `household_recipe_usage` today implicitly assumes one provenance: "this household has used this recipe in a plan." There is no current way to express "Lumi suggested this from M1-M4 signals" (`inferred`) vs "the parent declared this at M5" (`declared`) vs "the parent added this directly via Kitchen Profile" (`parent_added`). The catalog UX spec requires this distinction for trust weighting in the planner and as input to the Allergy Guardrail's confidence calculus.

### Categorization

Per checklist item 1.2: **Successor architecture surfaced post-ship, compounded by an architectural decoupling in `2.5-s9`.** The catalog UX spec's lifecycle architecture was not yet committed on 2026-05-19; `2.5-s9` was designed without reference to `3-31`. Both decisions were locally correct; the collision is global.

---

## Section 2 — Impact Analysis

### Epic Impact

| Epic | Status before | Status after | Notes |
|---|---|---|---|
| **Epic 2.5 — Onboarding Robustness & Kitchen Map Completion** | `in-progress` (all 11 slices `done`) | **Unchanged. Epic 2.5 stays as-shipped.** Retrospective completes normally. | "Components-done" history preserved; Epic 2.6 is additive. |
| **Epic 2.6 — Personalized Onboarding Catalog (this brief)** | — | **NEW. `backlog` → `in-progress` when first slice begins.** | 6 vertical slices. Single focused sprint. |
| **Epic 3 — Weekly Plan & Ready-Answer Open** | `in-progress`; 6 stories paused 2026-05-19, unblocked by 2.5 | **Unchanged.** No new pauses. Planner gains catalog provenance as an input when 2.6 ships; before that, planner reads `household_recipe_usage` as today. | Epic 2.6 strengthens the planner's source pool; it does not block Epic 3 resumption. |
| **Epic 3 — Story 3-31 (Recipe Agent — Tavily Structured Fetch)** | `done` | **Unchanged.** Lazy structured-recipe materialization path is reused by Epic 2.6. | Critical dependency — Layer 2 (full ingredients) is 3-31's job. |
| **Epic 3 — Story 3-32 (user-supplied recipe ingestion)** | `backlog` (drafted 2026-05-23) | **Unchanged.** AD-7 already cites the catalog scope correction. Compatible with whichever catalog ship order. | Story 3-32 is additive to swap surface; catalog work is upstream/orthogonal. |
| **Epic 7 — Visible Memory & Trust** | `backlog`; unblocked by 2.5-s11 | **Unchanged.** `catalog_provenance` + the existing `household_recipe_usage` event-shaped state become natural inputs to Visible Memory edit/forget surfaces if/when expanded. | No direct dependency for MVP. |
| **Epics 4, 5, 6, 8, 9, 10, 11, 12** | various | No change. | No direct contract dependency. |

### Story Impact

**Added (Epic 2.6):** 6 slices (see Section 4 for detail)

**No pauses.** Unlike Epic 2.5's birth, Epic 2.6 does not require pausing downstream work. The 2.5-shipped surfaces (`favorite_lunches`, static M5 chips, Kitchen Profile starting-line read) keep working until Epic 2.6 supersedes them slice-by-slice.

**Migration story:** `favorite_lunches` rows (tiny — table has been live <1 week) get migrated into `recipes` (lightweight rows, `source='parent_declared'`) + `household_recipe_usage` (`catalog_provenance='declared'`, `is_household_favorite=true`) during slice 2.6-s1. The `favorite_lunches` table is dropped at slice end. Kitchen Profile starting-line read is swapped to query the joined tables in the same slice — hot path stays unbroken.

### Artifact Conflicts

| Artifact | Conflict | Slice | Action |
|---|---|---|---|
| **PRD** (`_bmad-output/planning-artifacts/prd.md`) | FR129 (10 favorite lunches) needs amendment to reference catalog provenance and the recipes-table-as-catalog model; potential new FRs for Stage 0 baseline + cold-start fallback path | Pre-2.6-s1 | 1 amendment + 2 new FRs |
| **Architecture** (`_bmad-output/planning-artifacts/architecture.md`) | New §X.X (catalog as `recipes` + `household_recipe_usage` projection; `catalog_provenance` semantics; Stage-0/1/2 worker description; Layer 1 / Layer 2 distinction; planner source-pool ordering note) | Pre-2.6-s1 | 3 amendments |
| **UX Spec — household food catalog** (`_bmad-output/planning-artifacts/ux-design-spec-household-food-catalog.md`) | Already authoritative on user-facing behavior. Add an architectural footnote: catalog persisted via `recipes` + `household_recipe_usage`, not a separate `lunch_catalog` table. | Pre-2.6-s1 | 1 footnote |
| **Sprint Status** (`_bmad-output/implementation-artifacts/sprint-status.yaml`) | Add `epic-2.6` block with 6 slices + retrospective key | At brief approval | Direct edit |
| **Contracts** (`packages/contracts/src/`) | `kitchen-map.ts`: extend `recipes` projection to surface `catalog_provenance`; remove `favorite_lunches` projection; new `recipes-catalog.ts` contracts for the M5 read endpoint; `onboarding-tools.ts`: replace `favorite_lunch.add` with `recipe.declare(label, provenance='declared')` (or equivalent) | Slice 2.6-s1 | Code change |
| **DB migrations** (`supabase/migrations/`) | Add `catalog_provenance` column to `household_recipe_usage`; add `'catalog_seeded'` and `'parent_declared'` values to `recipes.source` CHECK; new `curated_baseline_items` table (small global table for Stage 0 hand-tagged items); migration from `favorite_lunches` to `recipes` + `household_recipe_usage`; drop `favorite_lunches` at slice end | Slice 2.6-s1 + 2.6-s2 | Code change |
| **Agent prompt** (`apps/api/src/agents/prompts/onboarding.prompt.ts`) | Delete static `KEY_LABEL` map; M5 chip rendering directive references runtime catalog read | Slice 2.6-s4 | Code change |
| **Agent prompt — new** (`apps/api/src/agents/prompts/catalog-seed.prompt.ts`) | New prompt for Stage 1 LLM seeding (produces Layer 1 suggestable ideas — name + tags only, no ingredients) | Slice 2.6-s3 | New file |
| **Web M5 component** (`apps/web/src/features/onboarding/...`) | M5 chip card reads ~18 personalized chips from catalog endpoint; wire format flip (labels not keys) | Slice 2.6-s4 | Code change |
| **Kitchen Profile UI** (`apps/web/src/features/kitchen-profile/...`) | Starting-line card data adapter swaps source: `favorite_lunches` read → `household_recipe_usage` joined `recipes` filtered by `catalog_provenance IN ('declared','parent_added') OR is_household_favorite=true` | Slice 2.6-s1 (in-slice swap, no separate slice needed) | Code change |
| **Background worker** (`apps/api/src/jobs/...`) | New BullMQ job `catalog.seed.stage1` triggered at M2 completion; new `catalog.recover.stage2` triggered on floor-breach / mass-block | Slices 2.6-s3, 2.6-s5 | Code change |
| **RecipeAgent** (`apps/api/src/agents/recipe-agent.ts`) | Add path: when planner attempts to use a `source='catalog_seeded'` row in a plan_item, trigger `RecipeAgent.discover()` against `canonical_name` to materialize structured ingredients before plan-commit. Reuses existing 3-31 flow; new entry point. | Slice 2.6-s3 (or deferred to Epic 3 if planner is the consumer) | Small extension |
| **Memory `mock-screen-reference-check`** | M5 personalized chips do not yet have a mockup; flag a new mock-screen requirement for 2.6-s4 | Pre-2.6-s4 | Update memory file + author new mock |
| **Project Context** (`_bmad-output/project-context.md`) | Add invariants: (a) "catalog is internal infrastructure; only the starting-line card is user-visible," (b) "catalog persists as `recipes` rows; M5/Stage 1 produces Layer 1 (name+tags); 3-31 produces Layer 2 (full ingredients) lazily" | At brief approval | Two-line edit |

### Technical Impact

- **DB schema growth:** 1 column added (`household_recipe_usage.catalog_provenance`), 2 new values on existing CHECK (`recipes.source` gains `'catalog_seeded'` and `'parent_declared'`), 1 new table (`curated_baseline_items`, small global reference, ~50 rows), 1 migration with data movement (`favorite_lunches` → `recipes` + `household_recipe_usage`), 1 table drop (`favorite_lunches`). **No net-new structured tables for per-household data.**
- **Tool surface change:** `favorite_lunch.add` tool becomes `recipe.declare(label, provenance)` (or kept under existing name, refactored). Tool writes a lightweight `recipes` row (`source='parent_declared'`, `visibility='private'`, `ingredients=[]`) + a `household_recipe_usage` row with `catalog_provenance='declared'`, `is_household_favorite=true`. Tool-time guardrail consultation: if parent text triggers an allergen-text match (best-effort hint, no structured ingredients yet), warn the parent; this is best-effort. Authoritative guardrail still fires at plan-commit when 3-31 has populated structured ingredients.
- **Composer query change:** `projectFavoriteLunches` deleted; `projectRecipes` extended to surface `catalog_provenance` per row (rename to `projectCatalog` if cleaner). Single CTE-based read instead of two parallel reads. Performance neutral or improved.
- **New background workers:** Stage 1 seeding (BullMQ job, triggered at M2 completion). Stage 2 recovery (triggered on Stage 1 floor breach / mass-block event). Both run outside the turn's hot path.
- **Encryption scope:** **DROPPED for parent-declared names.** `recipes.canonical_name` is plaintext (matches existing 3-31 pattern). Confidentiality is enforced via RLS + `visibility='private'` + `created_by_household_id` ownership check. The 2.5-s9 decision to encrypt `favorite_lunches.item` is reversed — see Section 3's "Encryption decision" note. **Existing encrypted data is decrypted-once during migration** (slice 2.6-s1) and persisted as plaintext.
- **Realtime / SSE:** No new realtime channels needed. Existing onboarding turn SSE channel carries the personalized M5 chip payload (now per-household). Existing Kitchen Map version-bump triggers on `household_recipe_usage` flips (see migration `20260820000200` lines 337-371) already cover cross-tab consistency.
- **Cost impact:** **One additional LLM call per onboarding** (Stage 1 seeding, ~50-item generation in a single structured response). Run cost is ~1× a typical onboarding turn. Mitigated by running async post-M2 — does not block M3/M4 latency. Stage 2 only fires on Stage 1 floor breach / mass-block (expected rare for served-by-precedent cohorts). **Layer 2 (structured ingredient extraction) cost is unchanged** — same lazy 3-31 path that exists today, just triggered for catalog-seeded rows on first planner use. No new external services.

---

## Section 3 — Recommended Approach

### Selected path: Extend `recipes` + `household_recipe_usage`; two-layer model

**Concretely:** Treat the existing `recipes` + `household_recipe_usage` tables as the catalog. Add a `catalog_provenance` column to `household_recipe_usage`. Extend `recipes.source` CHECK to accept `'catalog_seeded'` (Stage 1 LLM output) and `'parent_declared'` (M5 free-text). Stage 1 LLM emits Layer 1 (name + tags only). Layer 2 (full structured ingredients) is materialized lazily via the existing `RecipeAgent.discover()` path from story 3-31, on first planner use.

Migrate `favorite_lunches` → `recipes` + `household_recipe_usage` in slice 2.6-s1. Drop the table at slice end. Kitchen Profile starting-line read adapter is swapped in the same slice so the hot path stays unbroken.

### Why this path over alternatives

| Alternative | Why rejected |
|---|---|
| **Rev 1 approach: new `lunch_catalog` table** | Schema review showed `household_recipe_usage` already provides every signal the catalog spec calls for, plus plan-outcome feedback signals the spec assumes. Building a parallel table creates two consumers per plan slot and synchronization risk. |
| **Stage 1 LLM emits full structured ingredients** | ~50× more expensive per item. Most catalog items are never used in a plan. Reusing 3-31's lazy materialization for the items that ARE used preserves the cost model. The Allergy Guardrail operates on `allergen_flags`, not ingredient text, so Layer 1 is sufficient for filtering. |
| **Keep `favorite_lunches`, link via FK to `recipes`** | Two tables holding the same per-household entity differ only in metadata. DRY says they're one structure. Keeping both means two read paths (M5 reads one, planner reads the other), two write paths, and two consumers in the Kitchen Map composer. Folding now (table is <1 week old, ~dozens of rows in dev) is cheap. |
| **Defer scoping** | The catalog UX spec is committed; the static 18-chip set's quality gap is real for to-validate cohorts. Deferring means shipping known-thin first-impressions to Somali / Yemeni / Tibetan households who will be in early validation cohorts. |

### Encryption decision (resolved)

**Drop encryption for parent-declared lunch names.** Migrate `favorite_lunches.item` ciphertext → `recipes.canonical_name` plaintext. Confidentiality enforced via:
- `recipes.visibility = 'private'` for parent-declared and catalog-seeded rows
- `created_by_household_id` ownership check
- RLS policy: authenticated callers can SELECT shared recipes OR own-household recipes OR recipes they have a usage row for (per migration `20260820000200` lines 388-398)

**Rationale:** matches the existing 3-31 pattern (already in production for Tavily-extracted recipes whose names include culturally-specific dish names). Reduces planner read complexity (no per-row DEK reads). The marginal confidentiality improvement from encryption is small given the same DB-access attacker can already see `children.declared_allergens` (encrypted at column level but cross-table joinable) and the entire structured kitchen map. The 2.5-s9 encryption decision was locally correct but introduced a pattern inconsistency with 3-31. This brief resolves the inconsistency in favor of the older pattern.

### Risk register

| Risk | Mitigation |
|---|---|
| Stage 1 produces below-floor catalogs for to-validate cohorts | Stage 2 recovery as floor-breach handler (slice 2.6-s5); Stage 0 curated baseline as safety net (slice 2.6-s2); cold-start fallback path for confidence-below-threshold (slice 2.6-s6). All three are in scope. |
| Migration of live `favorite_lunches` data goes wrong | Slice 2.6-s1 includes dry-run + validation. Decryption happens once with rollback script. New rows inserted in `recipes` + `household_recipe_usage` atomically per source row. Rollback script ships with migration. |
| Encryption-drop decision is wrong (security review flags it later) | Re-add `canonical_name_encrypted` column as a follow-up; populate from `canonical_name` for `visibility='private'` rows; switch reads to encrypted variant. Reversible without schema-shape change. |
| M5 personalization regresses chip quality for served-by-precedent cohorts | Slice 2.6-s4 includes a quality-floor check vs. the prior static set for Anglo / Hindu-veg / Halal cohorts. If Stage 1 underperforms, Stage 0 baseline + Stage 1 mix is the fallback. |
| Planner doesn't know how to handle `source='catalog_seeded'` rows with `ingredients=[]` | Slice 2.6-s3 includes the integration point in `PlansService.commit()`: if recipe materialization is requested for a `source='catalog_seeded'` row with `ingredients=[]`, trigger `RecipeAgent.discover(canonical_name)` to populate before commit. Existing 3-31 path. |
| Stage 2 drifts from recovery-only into background-enrichment | Per spec §"Stage 2 discipline": AC explicitly forbids scheduled / background enrichment in MVP. Code review checklist includes this assertion. |
| Wire-format flip (labels ↔ keys) breaks existing E2E tests | Slice 2.6-s4 lists all OnboardingText E2E tests that touch M5 and updates them in the same slice. |

---

## Section 4 — Slice Decomposition (Draft)

**6 slices.** Walls are decision moments where the next slice cannot proceed without confirming the prior slice's invariant. MOCK-REF indicates a UI-touching slice that must cite or author an in-repo mockup.

### 2.6-s1 — Foundation: catalog as `recipes` + `household_recipe_usage`; migrate `favorite_lunches`

**Folds:** Foundation. Migration. Kitchen Profile read swap (in-slice — no separate slice).

**Acceptance criteria sketch:**
- New column: `household_recipe_usage.catalog_provenance` (enum, NOT NULL, DEFAULT `'plan_promoted'` for backfill of existing rows)
  - Values: `'declared'` / `'inferred'` / `'parent_added'` / `'plan_promoted'`
- Extended CHECK: `recipes.source` accepts `'agent_generated'` / `'curated'` / `'imported'` / `'catalog_seeded'` / `'parent_declared'`
- Migration: for each `favorite_lunches` row, decrypt `item` ciphertext → plaintext; INSERT into `recipes` (`canonical_name`, `source='parent_declared'`, `visibility='private'`, `created_by_household_id`, `ingredients=[]`, `ingredient_keys=[]`, `allergen_flags=[]`, `applicable_slots=ARRAY['main']`); INSERT into `household_recipe_usage` (`household_id`, `recipe_id`, `catalog_provenance='declared'`, `is_household_favorite=true`, `confidence_score=80`)
- `favorite_lunch.add` agent tool refactored to `recipe.declare(label, provenance='declared')` — preserves M5 hot path
- Kitchen Map composer: `projectFavoriteLunches` deleted; `projectRecipes` extended to surface `catalog_provenance` (rename to `projectCatalog` for clarity)
- Kitchen Profile starting-line card adapter (`apps/web/src/features/kitchen-profile/...`) swapped to read from `recipes` joined `household_recipe_usage` filtered by `catalog_provenance IN ('declared','parent_added') OR is_household_favorite=true`, `ORDER BY confidence_score DESC, last_used_at DESC NULLS LAST`, `LIMIT 20`
- `favorite_lunches` table dropped at slice end
- All Epic 2.5 E2E tests on M5 + Kitchen Profile still pass

**Edge cases to handle (folded rev 3):**
- **Migration atomicity per source row.** Each `favorite_lunches` row → `recipes` INSERT + `household_recipe_usage` INSERT must be in a single transaction. If `recipes` UNIQUE conflict (canonical_name already exists for this household — e.g., it was already created by Stage 0/1 in a parallel-running Epic 2.6 deploy), reuse the existing `recipes.id`, INSERT only `household_recipe_usage`. If `recipes` INSERT fails for any other reason, transaction rolls back both writes.
- **Decryption failure on corrupt ciphertext.** Per-row try/catch around DEK decryption. On failure: log structured event `migration.favorite_lunches.decrypt_failed` with row id (NOT plaintext attempt), quarantine the row (do not migrate), continue with next row. Abort entire migration only if >5% of rows fail decryption. Quarantined rows surfaced as ops follow-up; they remain in `favorite_lunches` until manually triaged (table drop is gated on zero quarantined rows OR explicit ops sign-off).
- **Rollback script semantics.** Forward-deployed Supabase context: "rollback" means a separate SQL script that re-creates `favorite_lunches`, copies `recipes`+`household_recipe_usage` rows back (re-encrypting `canonical_name` via household DEK), and drops the added `catalog_provenance` column. Rollback script ships in same migration directory; tested in dev against a representative dataset before prod apply.
- **Encryption-drop security checkpoint.** AC includes explicit gate: a security-review note in the slice spec stating "plaintext canonical_name + RLS + visibility='private' threat model reviewed and accepted (or deferred per brief Section 3)." If deferred, link to follow-up issue. Do not ship without checkpoint.

**WALL: schema wall.** No downstream slice proceeds until migration verified clean.

---

### 2.6-s2 — Stage 0: curated baseline + per-household reference rows

**Folds:** Stage 0 of the lifecycle.

**Acceptance criteria sketch:**
- New table: `curated_baseline_items` (small, global, unencrypted, ~50 hand-tagged items across major cuisine × dietary × allergen intersections)
  - Columns: `id`, `canonical_name`, `allergen_flags text[]`, `dietary_flags text[]`, `cultural_tags text[]`, `cuisine_tags text[]`, `applicable_slots text[]`, `notes text`
  - Acts as a seed source — NOT directly read by planner; rows get materialized into per-household `recipes` rows via Stage 0 worker
- Seed data file in `apps/api/src/seeds/curated-baseline.ts` with the ~50 items
- At household creation (post-2-1 signup completion), Stage 0 worker materializes baseline rows: for each `curated_baseline_items` row applicable to the household's declared cuisine buckets (defaults to a global subset if M3 hasn't happened yet), INSERT into `recipes` (`source='catalog_seeded'`, `visibility='private'`, `created_by_household_id`, `ingredients=[]`, tag arrays populated from baseline) + INSERT into `household_recipe_usage` (`catalog_provenance='inferred'`, `confidence_score=60`)

**Edge cases to handle (folded rev 3):**
- **Stage 0 fires before M1/M2 complete.** AC commits to a "broad safe seed" default: at household creation, materialize the subset of `curated_baseline_items` whose tag arrays do NOT contain anything beyond the most common dietary defaults (no nut-containing items, no shellfish, no pork — i.e., the union-of-safe set). This guarantees Stage 0 never seeds a row that would later be blocked by an M2 allergen declaration for the most common allergens. On M3 completion (cultural priors captured), Stage 0 worker re-materializes the cuisine-bucket-appropriate subset, additively (existing rows kept, new rows added; never deletes Stage-0-materialized rows that no longer match — preserves audit history).
- **Allergy Guardrail Service blocks some baseline items at materialization.** Baseline items pass through the guardrail at materialization time using the household's current allergen state. Blocked items are skipped (not materialized). If post-guardrail count drops below 30 baseline items materialized for this household, log structured event `catalog.stage0.below_floor` for ops visibility. **Materialization never fails the household creation flow** — even zero baseline items materialized is a valid (degraded) state; Stage 1 / Stage 2 / cold-start fallback compensate downstream.
- **Idempotency.** Stage 0 worker runs at most once per household per re-materialization trigger (initial signup, M3 completion). Use a `households.stage0_materialized_at` timestamp; skip if already set for this trigger. UNIQUE index on `recipes.canonical_name` (per household) catches double-inserts.

---

### 2.6-s3 — Stage 1: background-async catalog seeding worker (Layer 1)

**Folds:** Stage 1 of the lifecycle. **No UI change.** Layer 1 only — name + tags, NOT full ingredients.

**Acceptance criteria sketch:**
- New prompt file: `apps/api/src/agents/prompts/catalog-seed.prompt.ts`
- New BullMQ job `catalog.seed.stage1` triggered at M2 completion (allergens captured)
- Job reads household state (M1 children + age bands, M2 allergens, M3 cultural priors + dietary + cuisines + food preferences, M4 bag composition if available)
- LLM call generates ~50 lunch ideas with structured output schema: `{ canonical_name, allergen_flags, dietary_flags, cultural_tags, cuisine_tags, applicable_slots }` per item — **no ingredients, no instructions, no prep_time**
- Every item passes through Allergy Guardrail Service (Story 3.1) using `allergen_flags`; survivors are persisted
- Items matching `curated_baseline_items` (case-insensitive normalized match on canonical_name) reuse that row's tags — no duplicate `recipes` row
- LLM-original items: INSERT into `recipes` (`source='catalog_seeded'`, `visibility='private'`, `created_by_household_id`, `ingredients=[]`, tags populated) + INSERT into `household_recipe_usage` (`catalog_provenance='inferred'`, `confidence_score=50`)
- Idempotency: `recipes` per-household uniqueness via normalized canonical_name (already-existing row for same household + name is a no-op)
- Integration point in `PlansService.commit()`: when committing a plan_item whose `recipe_id` points at a `source='catalog_seeded'` row with `ingredients=[]`, trigger `RecipeAgent.discover(canonical_name)` to populate full structured ingredients (Layer 2 materialization) before commit. Same flow as today's plan-commit materialization.
- Job emits completion event (used by 2.6-s4 to gate M5 entry, and by 2.6-s5 to detect floor breach)
- p95 completion time **≤ 5s** from job pickup (so M3-M4 typing latency absorbs it)

**Edge cases to handle (folded rev 3):**
- **LLM response schema-invalid or partial.** Zod-validate every item against the structured output schema. Non-conforming items are discarded (logged as `catalog.stage1.item_invalid` with reason). Conforming items proceed through guardrail and persistence. If post-validation count is `<10`, treat as **Stage 1 failure** → fires Stage 2 recovery (2.6-s5 trigger condition (a) "floor breach").
- **LLM call timeout (>5s) or hard failure.** Cancel job; treat as Stage 1 failure → fires Stage 2 recovery. Timeout is NOT cold-start fallback (which is reserved for the confidence-below-threshold path in 2.6-s6).
- **Idempotency / canonical_name normalization.** Collision-detection key derived by: lowercase → Unicode NFC normalize → collapse internal whitespace → strip leading/trailing whitespace → remove hyphens and apostrophes. Examples: `"Dal-Rice"`, `"dal rice"`, `"dal-rice"`, `"Dal Rice"` all normalize to the same key. Preserve the original LLM-emitted `canonical_name` for display. UNIQUE index is on `(household_id, normalized_canonical_name)`; a `normalized_canonical_name` generated column on `recipes` carries this.
- **LLM emits item matching curated_baseline with different allergen_flags.** Curated baseline is authoritative for allergen_flags (hand-verified). Resolution: if normalized canonical_name matches a `curated_baseline_items` row, reuse the baseline row's allergen_flags + dietary_flags + cultural_tags + cuisine_tags (overriding LLM emission). Log `catalog.stage1.flag_disagreement` event with the LLM-emitted flags vs baseline flags for ops review and future curated baseline edits. The `recipes` row is created with `source='catalog_seeded'` but tag arrays sourced from baseline.
- **Concurrent Stage 1 + M3/M4 turn writes.** Stage 1 reads household state snapshot once at job start (post-M2 completion). If M3 or M4 modifies household state mid-job, Stage 1 does NOT re-read. The "stale Stage 1 output" risk is accepted because Stage 2 recovery handles the case where the resulting catalog no longer fits (e.g., parent adds a new allergen at M3 → Stage 2 recovery refreshes; or no-op if catalog still survives guardrail).
- **Layer 2 trigger failure in `PlansService.commit()`.** When `RecipeAgent.discover(canonical_name)` is triggered for a `source='catalog_seeded'` row and fails (Tavily timeout, no extractable result, LLM extraction schema-invalid): mark this `recipe_id` with `discover_failed_at = now()` in `household_recipe_usage` metadata; surface as a plan_item commit failure to the planner; planner falls back to alternate recipe candidate. **The plan never commits with `ingredients=[]` post-Layer-2 trigger.** Same defense-in-depth pattern as 3-31.

---

### 2.6-s4 — M5 chip card personalization (wire-format flip)

**Folds:** Replaces 2.5-s9's static-chip read path with catalog-sourced personalization.

**MOCK-REF:** Personalized M5 chip card mockup must be authored before slice begins (new mockup; existing 2.5-s9 mockup is the form factor reference only — chip content changes per household). Cohort variants (2-3 side-by-side) shown.

**Acceptance criteria sketch:**
- M5 entry blocks on Stage 1 completion (or 5s timeout → routes to 2.6-s6 cold-start fallback)
- New endpoint: `GET /v1/onboarding/catalog/m5-chips` selects ~18 chips from `recipes` joined `household_recipe_usage` for this household per a sort+diversity rule:
  - Filter: `is_household_banned = false`
  - Order: `is_household_favorite DESC, catalog_provenance` (declared > parent_added > inferred > plan_promoted), `confidence_score DESC`
  - Diversity constraint: max 3 chips per `cuisine_tags` element
  - Limit: 18
- Wire format flips: M5 chip payload carries **labels** (canonical_name strings, not keys)
- Persistence: when parent taps a chip, write via `recipe.declare(label, provenance='declared')` — flips that `household_recipe_usage` row's `catalog_provenance` from `inferred` → `declared` (or inserts new row if free-text item not yet in catalog), sets `is_household_favorite=true`, bumps `confidence_score` to 80
- Static `KEY_LABEL` map in `apps/api/src/agents/prompts/onboarding.prompt.ts` **deleted**
- M5 finalize gate's `m5_complete` derivation updated: `count(household_recipe_usage WHERE catalog_provenance='declared' AND household_id=?) >= 10` (or override path identical to 2.5-s10 sticky logic)
- Quality-floor check vs. served-by-precedent cohorts: Anglo + Hindu-veg + Halal cohort smoke tests render at least the 2.5-s9 static chip set's quality (qualitative; reviewer judgment)

**Edge cases to handle (folded rev 3):**
- **M5 entry fires before Stage 1 completes.** Render path blocks (with a brief "Lumi is thinking about your kitchen" affordance per UX spec line 227) for up to 5 seconds on the Stage 1 completion event. On timeout OR on Stage 1 failure signal → route to 2.6-s6 cold-start fallback path. **Never render an empty M5 chip card.** UX spec line 226–227 is the authoritative behavior; AC restates it.
- **Chip soft-forgotten between server render and parent tap.** Server-side validate at tap-time that the chip's `recipe_id` still exists in `household_recipe_usage` and is not banned. If invalid: return HTTP 410 Gone with `{chip_unavailable: true, recipe_id}`. Client removes the chip from view with a brief fade; parent continues without interruption.
- **Finalize gate edge: 9 declared + override taken.** Override is sticky-per-turn (matches 2.5-s10 pattern verbatim). 9 declared + override accepted = `m5_complete = true`. Override flag persists across turns until M5 finalize commits OR parent navigates away to an earlier moment and re-enters M5 (in which case override is re-confirmed via the cold-start-style branch or restated by the parent).
- **Diversity constraint underflow.** Sort + diversity selection rule is: filter banned → sort by `(is_household_favorite DESC, catalog_provenance priority, confidence_score DESC)` → apply max-3-per-cuisine constraint → take top 18. If applying the constraint drops total below 12, relax constraint to max-5-per-cuisine for this household's chip render only (logged as `catalog.m5.diversity_relaxed`). If still below 12, render whatever is available (≥0) and route to 2.6-s6 cold-start fallback path in parallel.
- **Wire-format label collision.** Two distinct `recipe_id`s can produce identical normalized labels only if they are the same recipe (collision-detection in 2.6-s3 makes this rare but possible across `parent_declared` and `catalog_seeded` provenances). Rendering uses `recipe_id` as React key; visible label is `canonical_name`. If two chips would render with identical visible labels in the same card, server deduplicates by preferring the higher-provenance row (`declared` > `parent_added` > `plan_promoted` > `inferred`).
- **Connection drops mid-finalize.** Each chip tap is independently persisted via `recipe.declare(label, provenance='declared')` — a single-row UPDATE on `household_recipe_usage`. There is no batched commit; partial selections are durable. On resume, M5 reads current state from `household_recipe_usage`; chip card re-renders with already-selected chips visually marked. No rollback path needed.

**WALL: M5 personalization wall (MVP wall).** After this slice, the user-visible improvement is real: M5 chips reflect the household, not the global default. Slices 2.6-s5 and 2.6-s6 are robustness paths that can ship in priority order after this.

---

### 2.6-s5 — Stage 2: recovery-only handler (floor breach + mass-block)

**Folds:** Stage 2 of the lifecycle (recovery-only, NOT enrichment).

**Acceptance criteria sketch:**
- Stage 2 fires ONLY on two named triggers (denominators locked rev 3):
  - **(a) Floor breach** — post-guardrail count of `recipes` rows for this household with `source='catalog_seeded'` is `< 35` (household-wide, not per cuisine bucket)
  - **(b) Mass-block** — `> 50%` of items that Stage 1 LLM emitted in this seeding pass were blocked by the guardrail. **Denominator = LLM emission count** (typically ~50; may be less if Stage 1 itself emitted partials). Computed as `blocked_count / emitted_count`, evaluated at Stage 1 completion event.
- Stage 2 fires ONLY on Stage 1 *completion* event (success or failure). It does NOT race with an in-flight Stage 1.
- Stage 2 does NOT run on a schedule, does NOT run as background enrichment, does NOT run on cron
- Mass-block path: extra `curated_baseline_items` rows for declared cuisine buckets are materialized into per-household `recipes` rows as fallback, with already-`declared` items preserved
- AC includes explicit assertion: "Stage 2 has no scheduler, no cron, no idle trigger. Trigger or not at all."
- Code review checklist: search for any new BullMQ schedule / cron / repeat trigger pointing at Stage 2 → reject

**Edge cases to handle (folded rev 3):**
- **Stage 2 produces zero items (terminal cascade fail).** If after Stage 2 the household's post-guardrail catalog count is still 0, route M5 entry to 2.6-s6 cold-start fallback path. Log `catalog.stage2.terminal_zero` for ops visibility. This is the absolute floor; below this, the parent goes through conversational onboarding instead of a chip card.
- **Concurrent Stage 1 + Stage 2 protection.** Stage 2 worker checks `households.stage1_completed_at` exists before running. If Stage 1 is in-flight (no completion timestamp yet), Stage 2 job is no-op + re-queued for 30s later (one retry max).
- **Stage 2 trigger discipline assertion.** AC includes literal text the code reviewer will grep for: `// STAGE 2 IS RECOVERY-ONLY. NO SCHEDULER. NO CRON.` placed at the top of the Stage 2 worker file. Per Action #4 from Epic 2.5 retro, a state diagram for the Stage 1 → Stage 2 → cold-start cascade lives in the slice spec before code review.

---

### 2.6-s6 — Cold-start fallback path (conversational tail)

**Folds:** Cold-start UX when Stage 1 confidence below threshold OR Stage 1 timeout exceeded.

**MOCK-REF:** Conversational fallback mockup required.

**Acceptance criteria sketch:**
- **Threshold locked (rev 3):** if post-guardrail count of `recipes` rows with `source='catalog_seeded'` for **any single declared cuisine bucket** is `< 5`, cold-start fallback fires. Per-cuisine (not all-or-nothing). Bucket membership derived from `recipes.cuisine_tags` overlap with the household's M3-declared cuisine_tags.
- Cold-start fallback also fires on M5 entry timeout (Stage 1 has not emitted a completion event within 5s of M5 entry per 2.6-s4 AC) — superseded by Stage 2 if Stage 2 completes within reasonable time, but Stage 2 itself can route here on terminal-zero.
- M5 chip card does NOT render in cold-start mode. M5 entry shows conversational prompt: *"I want to make sure I get this right — tell me three dishes your family eats most weeks."* (verbatim from UX spec line 282; rendering treatment per cold-start fallback mockup)
- Parent's free-text responses route through `recipe.declare(label, provenance='declared')` directly (no chip layer)
- M5 finalize gate threshold relaxed to `>=3` declared items for cold-start fallback path (matches the prompt)
- Cold-start triggered flag persisted: `onboarding_state.cold_start_triggered = true` + `cold_start_trigger_reason text` (`'per_cuisine_floor'` / `'stage1_timeout'` / `'stage2_terminal'`) for cohort analysis

**Edge cases to handle (folded rev 3):**
- **Mixed-confidence cohorts.** Parent declares two cuisines at M3 (e.g., Anglo + Tibetan); Stage 1 produces 22 items for Anglo bucket, 2 items for Tibetan bucket. Per-cuisine threshold says cold-start fires. UX consequence: parent gets the conversational prompt rather than a card mixing 22 Anglo chips with 2 Tibetan chips. **This is intentional** per UX spec Bet #1 — Tibetan parent must not see "competent for Anglo, sparse for Tibetan" mixed signal. Documented in slice spec.
- **Override via cold-start branch.** If parent supplies only 3 free-text items in cold-start mode, that's the `>=3` finalize threshold. If parent supplies fewer than 3 and attempts to finalize, surface the same override-style affordance as 2.5-s10's "fewer than 10" path — parent can override to commit with fewer items, but `cold_start_under_floor` flag set for telemetry. **Override threshold floor is 1** (parent must declare at least 1 item).
- **Cold-start triggered post-M5.** If parent navigates back to an earlier moment and Stage 1/Stage 2 re-fires (e.g., M2 allergen change triggers re-evaluation), and the post-recovery state newly breaches the per-cuisine threshold: cold-start mode is **NOT** retroactively re-entered. Existing `declared` rows are preserved; M5 chip card simply has fewer items. Cold-start is a first-impression mode only.

---

## Section 5 — Implementation Handoff

### Sequence

The slices have a partial ordering:

```
2.6-s1 (foundation + migration + Kitchen Profile read swap)   ← WALL: schema
  ├─ 2.6-s2 (Stage 0 baseline materialization)
  └─ 2.6-s3 (Stage 1 seeding worker + 3-31 integration)
       └─ 2.6-s4 (M5 chip card personalization)              ← WALL: MVP
            ├─ 2.6-s5 (Stage 2 recovery handler)
            └─ 2.6-s6 (cold-start fallback)
```

- **2.6-s1 first.** Schema wall; all downstream depends.
- **2.6-s2 and 2.6-s3 can ship in parallel** after s1 if team capacity allows; 2.6-s4 depends on both.
- **2.6-s5 and 2.6-s6** can both start after 2.6-s4 hits its wall; they touch different surfaces.

### Epic MVP wall

**Wall placement:** 2.6-s4 (M5 personalization). After this slice, the user-visible improvement is real.

### Pre-flight before approval

1. **Authoring the M5 personalized chip card mockup** (per `mock-screen-reference-check` memory). Existing 2.5-s9 mock is form-factor reference; content rendering is per-household at runtime, so the mock needs to show 2–3 cohort variants side-by-side.
2. **Authoring the cold-start fallback conversational mockup.**
3. **PRD amendment** — FR129 update + new FRs for Stage 0 + cold-start fallback. To be drafted as part of brief approval.
4. **Architecture amendment** — new §X.X for catalog-as-`recipes`+`household_recipe_usage`, Layer 1 vs Layer 2, Stage 0/1/2 workers. To be drafted as part of brief approval.
5. **UX spec footnote** — note in the household-food-catalog spec that the catalog persists via `recipes` + `household_recipe_usage`, not a separate `lunch_catalog` table.
6. **Confirm the operational definition** of "Stage 1 confidence-per-cuisine-bucket below threshold" for slice 2.6-s6. Spec defers this to operational tuning; the slice will need a starting heuristic.
7. **Curated baseline content authoring** — the ~50 items in `curated-baseline.ts` need to be hand-tagged before 2.6-s2 ships. This is content work, not engineering work, and can happen in parallel with 2.6-s1.

### Acceptance criteria — epic-level

Epic 2.6 is **done** when:

1. `favorite_lunches` table is dropped; `recipes` + `household_recipe_usage` is the catalog with provenance tracking
2. M5 chip card renders personalized per-household chips drawn from the catalog
3. Stage 0 baseline + Stage 1 seeding + Stage 2 recovery + cold-start fallback path are all live
4. Kitchen Profile starting-line card reads from the joined tables; behavior unchanged from 2.5-s11
5. Layer 2 materialization integration in `PlansService.commit()` is wired and tested for `source='catalog_seeded'` rows
6. All Epic 2.5 E2E tests still pass (no regressions on onboarding or Kitchen Profile)
7. PRD + Architecture amendments landed
8. UX spec footnote added clarifying the persistence layer

### What this brief explicitly does NOT cover

- **Edit / forget paths on Kitchen Profile.** These remain deferred per 2.5-s11 → Epic 7 (Visible Memory) scope.
- **Catalog browse surface.** Per the UX spec scope correction (2026-05-23), the catalog is internal infrastructure. No browse UI in Epic 2.6 or ever in MVP.
- **Active learning loop / Stage 3 enrichment.** Stage 2 is recovery-only. Stage 3 "living catalog" plumbing is already wired via `household_recipe_usage` counters that update on plan outcomes — no new slice needed.
- **Active planner consumption of catalog provenance.** Adding `catalog_provenance` as a planner ranking input is Epic 3 work; this brief surfaces the field but does not change planner logic.
- **Visible Memory / Epic 7 trust affordances over catalog.** The provenance signals make these possible later, but they are not in 2.6.
- **Re-encryption of parent-declared names.** If a security review later flags the plaintext-canonical-name decision, the follow-up adds an encrypted variant column to `recipes`; out of scope for this epic.

---

## Approval

- [x] **PM (Menon):** approved brief shape and slice scope (2026-05-23)
- [ ] **Architecture review:** Two-layer model (Layer 1 at Stage 1, Layer 2 lazy via 3-31) reviewed; encryption-drop decision accepted; Stage 2 recovery trigger discipline reviewed
- [ ] **Security review (optional, follow-up safe):** plaintext-canonical-name + RLS-private model reviewed; encrypted-variant follow-up scheduled if needed
- [ ] **UX review:** Personalized M5 chip mockup + cold-start fallback mockup authored
- [ ] **Content review:** ~50 curated baseline items hand-tagged in `apps/api/src/seeds/curated-baseline.ts` draft
- [x] **Sprint plan update:** Epic 2.6 added to `sprint-status.yaml` with 6 slices (2026-05-23)

Upon approval, this brief is the input to `bmad-sprint-planning` for Epic 2.6 generation.

---

## Appendix — References

- `_bmad-output/planning-artifacts/ux-design-spec-household-food-catalog.md` — Catalog UX spec (canonical for design decisions; persistence-layer footnote pending)
- `_bmad-output/planning-artifacts/sprint-change-proposal-2026-05-19.md` — Precedent format for this brief
- `_bmad-output/implementation-artifacts/2.5-s1-foundation-enforcement-contracts-db-schema.md` — `favorite_lunches` table origin
- `_bmad-output/implementation-artifacts/2.5-s9-moment-5-a-starting-line-for-lumi.md` — Static 18-chip catalog origin
- `_bmad-output/implementation-artifacts/2.5-s11-kitchen-profile-read-live-data.md` — Kitchen Profile starting-line card origin
- `_bmad-output/implementation-artifacts/3-31-recipe-agent-tavily-structured-fetch.md` — Layer 2 lazy structured-recipe materialization (reused by 2.6)
- `_bmad-output/implementation-artifacts/3-32-user-supplied-recipe-ingestion.md` — Compatible downstream; cites catalog scope correction
- `supabase/migrations/20260820000200_create_recipes_and_usage.sql` — `recipes` + `household_recipe_usage` schema (Epic 2.6 extends these)
- `supabase/migrations/20260903000400_create_favorite_lunches_table.sql` — `favorite_lunches` schema (dropped by Epic 2.6)
- `apps/api/src/modules/kitchen-map/kitchen-map.composer.ts` — Composer that projects `recipes` (extended) and `favorite_lunches` (deleted) projections
- `apps/api/src/modules/plans/plans.service.ts` — `PlansService.commit()` where Layer 2 materialization is triggered
- `apps/api/src/agents/recipe-agent.ts` — `RecipeAgent.discover()` reused for Layer 2
- `_bmad-output/planning-artifacts/prd.md` — Pending amendment (FR129 + new FRs)
- `_bmad-output/planning-artifacts/architecture.md` — Pending amendment (new §X.X for two-layer catalog model)
- Memory: `epic-2-5-catalog-scope-collision.md`, `recipe-agent-lazy-catalog.md`, `epic-2-6-brief-drafted.md`
