# Epic 6 — Vertical Slice Re-Decomposition

**Status:** Applied approach (b) — see [`epic-4-vertical-slices.md`](epic-4-vertical-slices.md) for slicing methodology.

**Source:** [`epics.md`](epics.md) §"Epic 6: Grocery & Silent Pantry-Plan-List Loop" — 6 horizontal stories (6.1 → 6.6).

**Output:** 11 vertical slices. **MVP wall at 6-S6** — the silent Pantry-Plan-List loop closes (Epic 6's core promise).

**Pre-existing scaffolding:** `/app/grocery-list` route is already mounted (γ Phase 4) with mock data — `GroceryHero`, `LumiHint`, `AddItemComposer`, `StoreGroup`, `StoreSession` components exist. Most slices are "replace mock with real data" rather than "build a new surface."

---

## Slice map

| Slice | Demo path | Old stories folded in |
|---|---|---|
| 6-S1 | Open `/app/grocery-list` → see real ingredients from this week's plan, grouped by category | 6.1 (partial: derivation only, no pantry subtraction yet) |
| 6-S2 | Snack section is visually + ordinally separate from Main-recipe ingredients | 6.1 (FR110 carve-out) |
| 6-S3 | Tap "Store mode" → one-column large-text list, aisle-sorted, sticky "12/24 done" header, ≥48px tap targets | 6.2 |
| 6-S4 | Tap items in Store mode to mark purchased → state persists across refresh | 6.2 (full), 6.4 (UI side only) |
| 6-S5 | Marking items purchased silently writes `pantry_state` rows — no UI confirmation, no surface opens | 6.4 (pantry update side) |
| 6-S6 | Next week's grocery list is shorter because pantry-inferred items are subtracted | 6.1 (full), 6.4 (loop closure) **MVP wall** |
| 6-S7 | Add non-plan items via composer ("paper towels") → appears in list, doesn't affect pantry inference for plan | 6.6 (manual items) |
| 6-S8 | Store mode + airplane mode → banner "You're offline. I'll catch up when you're back." + taps queue + reconnect resyncs | 6.6 (connectivity-loss) |
| 6-S9 | Pantry correction — long-press a purchased item → "We already had 2 of these" → confidence drops, future derivations adjust | 6.4 (correction path) |
| 6-S10 | Pantry has spinach expiring Friday → Lumi proposes "Tuesday protein → spinach lunch" in thread → confirm → plan updates with QuietDiff | 6.5 |
| 6-S11 | Household has Geolocation opted in (5-S16) + plan has atta → list shows "Haji's Indian Grocery: atta" + "Kroger: everything else" sub-sections | 6.3 |

**Count:** 11 slices vs 6 original stories.

---

## Sequencing

```
S1 ─ S2 ─ S3 ─ S4 ─ S5 ─ S6 ──┬─ S7  (manual items)
                     [MVP wall]├─ S8  (offline UX)
                              ├─ S9  (pantry correction)
                              ├─ S10 (leftover swap proposals)
                              └─ S11 (cultural-supplier routing)
```

**MVP wall = S6.** Below the wall is strictly sequential. After S6 the headline promise — "the list is ready, I shop, I never update a pantry, next week respects what's in my fridge" — works end-to-end. Slices above the wall are independent enhancements parallelizable across developers.

---

## Slice 6-S1 — Real grocery list from this week's plan

**Demo:** Log in → tap "Grocery list" → see ingredients from this week's plan grouped by category (Produce, Dairy, Pantry, Meat). No pantry subtraction yet.

**Layers:**
- **UI:** `routes/(app)/grocery-list.tsx` from γ Phase 4 swaps `groceryListMock` for TanStack Query reading real data. StoreGroup components receive real category groups.
- **API:** `GET /v1/households/:id/grocery-list?week=current` joins `plan_items` × ingredient master list × category map.
- **Agent:** none.
- **DB:** read-only over existing plan_items + a new `ingredient_categories` lookup table seeded with ~200 common ingredients.

**Deferred:** Pantry subtraction (S6), store-aisle sort (S3), supplier routing (S11), Snack/Main split (S2).

**Cited PRD codes:** FR48 (partial).

**Manual test path:**
1. Have a current plan with ≥3 different meals
2. Open `/app/grocery-list`
3. See ingredients from those meals grouped by category
4. Reload → list is identical (deterministic derivation)

---

## Slice 6-S2 — Snack vs Main visual + ordinal separation

**Demo:** Plan has both Snack items (bag composition slot) and Main-recipe ingredients. List renders Snacks as a distinct section visually separate (different header/border) and ordinally first.

**Layers:**
- **UI:** Two `StoreGroup` blocks with a divider; Snack section labeled `<h2>Snacks</h2>` with Snack header styling (uses existing TrustChip pattern).
- **API:** Response shape gains `{ snacks: GroceryGroup[], mains: GroceryGroup[] }` discriminator (was a flat list in S1).

**Cited PRD codes:** FR110.

---

## Slice 6-S3 — Store Mode (one-handed)

**Demo:** Open grocery list → "Store mode" button → enter immersive mode at `/app/grocery/store` → single-column, ≥17pt text, store-aisle-sorted, sticky header showing "12/24 done", every tap target ≥48px. Haptic on supported devices.

**Layers:**
- **UI:** New route `/app/grocery/store`. Single-column layout, sticky `<header>` with progress counter, larger tap targets, haptic via `navigator.vibrate(10)` on supported devices.
- **API:** `GET /v1/households/:id/grocery-list?sort=store-aisle` returns items in store-aisle order (uses category → aisle map for a default store; per-store mapping waits for S11).
- **DB:** `store_aisle_orders(category, aisle_sequence)` reference table.

**Deferred:** Per-store aisle order (waits for S11 supplier routing).

**Cited PRD codes:** FR49.

---

## Slice 6-S4 — Tap to check off

**Demo:** In Store mode, tap items → strikethrough + dim → counter increments. Refresh page → checked items stay checked. Tap again to uncheck.

**Layers:**
- **UI:** Local optimistic strike-through + counter increment.
- **API:** `POST /v1/grocery-items/:id/state` writes purchase intent (`status: 'checked' | 'unchecked'`).
- **DB:** `grocery_item_states(grocery_item_id, household_id, status, updated_at)`.

**Deferred:** Pantry write (S5), offline queue (S8).

**Cited PRD codes:** FR49 (full).

---

## Slice 6-S5 — Silent pantry update

**Demo:** Mark items purchased in Store mode → no UI confirmation, no pantry surface opens. Open Supabase SQL editor → `SELECT * FROM pantry_state WHERE household_id = $me` → see rows for each item with `quantity` and `purchased_at`.

**Layers:**
- **API:** S4's check-off endpoint now ALSO writes to `pantry_state` in same transaction (item, quantity inferred from recipe scale, purchased_at, source='purchase').
- **DB:** `pantry_state(household_id, ingredient_id, quantity, expiry_estimate, purchased_at, confidence)`.

**Cited PRD codes:** FR51 (silent pantry update).

---

## Slice 6-S6 — Pantry-aware derivation 🚧 MVP WALL

**Demo:** Purchase milk in week N. Open grocery list for week N+1 — milk is absent (or quantity reduced) because pantry inference subtracted it. Whole loop now closes: **plan → list → shop → pantry → next plan derivation**, all without you opening a pantry surface.

**Layers:**
- **API:** `GET /v1/households/:id/grocery-list` now subtracts `pantry_state` quantities (with expiry-aware decay — a 2-week-old half-gallon of milk is treated as zero) before grouping.
- **Agent:** Planner specialist (Story 3.3) reads pantry_state as context — so when generating next week's plan, recipes that use pantry-resident ingredients get a soft positive weight.

**Cited PRD codes:** FR48 (full), FR51 (full), FR55 partial.

**Why this is the MVP wall:** Epic 6's entire pitch — "I shop, I never update a pantry, next week respects what's in my fridge" — requires the loop to close. Anything less than S6 ships *parts* of the loop but not the loop itself. Beta cohorts cannot evaluate the silent-pantry promise until S6 lands.

**Manual test path:**
1. Week N: open grocery list → tap "milk" to mark purchased
2. Wait for next week's plan to generate (or trigger manually)
3. Week N+1: open grocery list → milk absent (or quantity reduced)
4. Open Supabase → `pantry_state` shows milk with decay applied

---

## Slice 6-S7 — Manual items (non-plan staples)

**Demo:** In list view, use `AddItemComposer` (already-mounted from γ Phase 4) → type "paper towels" → appears in list with a "manual" tag. Confirm via Supabase that this item does NOT flow into pantry_state when checked off (it's manual, not plan-derived).

**Layers:**
- **UI:** AddItemComposer becomes interactive (was stubbed).
- **API:** `POST /v1/grocery-items` with `source: 'manual'`; check-off skips pantry_state write for `source='manual'`.

**Cited PRD codes:** FR53.

---

## Slice 6-S8 — Connectivity-loss UX

**Demo:** Store mode → toggle airplane mode → after 3s, banner appears: "You're offline. I'll catch up when you're back." Continue tapping items — they show pending dots. Toggle back online → pending dots clear, state syncs.

**Layers:**
- **UI:** Connectivity hook + banner; pending-state marker per item; retry queue.
- **API:** Idempotent state-write endpoint accepts replays (already idempotent via item_id).

**Note:** Reuses the service-worker work from 4-S10 if it ships first; otherwise this slice gets its own scoped network-aware logic.

**Cited PRD codes:** FR54.

---

## Slice 6-S9 — Pantry correction

**Demo:** Long-press a purchased item (or via Account → Pantry surface) → "We already had 2 of these" → save. `pantry_state.confidence` drops. Next derivation respects the correction.

**Layers:**
- **UI:** Long-press / right-click affordance + correction modal. Also surfaces via a minimal Pantry view in Account.
- **API:** `PATCH /v1/households/:id/pantry/:ingredient_id` with `{ quantity, correction_reason }`; confidence formula adjusts.

**Cited PRD codes:** FR55 (full).

---

## Slice 6-S10 — Leftover-aware swap proposals

**Demo:** Pantry has spinach with expiry inside 2 days. Lumi originates thread turn: "I noticed the spinach. Want Tuesday's lunch to use it?" → tap Confirm → plan_items mutate → Brief renders `<QuietDiff>` "Tuesday's protein swapped for the spinach".

**Layers:**
- **Agent:** Orchestrator detects pantry surplus / expiry-window items via a periodic job; proposes swap via Lumi thread turn (proposal turn type, lands in S5-S14's DisambiguationPicker L3 surface, or earlier in S5-S1's text-thread surface).
- **API:** `plan.updated` SSE invalidates Brief on confirmation.

**Cross-epic dependency:** Epic 5 thread infrastructure (5-S1 minimum). Doesn't need full 5-S14 disambiguation flow — text-thread proposal is sufficient.

**Cited PRD codes:** FR52, FR55.

---

## Slice 6-S11 — Cultural-supplier directory routing

**Demo:** Household has Geolocation opt-in (5-S16) + cultural template active. This week's plan includes specialty items (atta, halal meat). Open list → top section "Haji's Indian Grocery (1.2 mi)" with `atta + paneer`; second section "Kroger" with everything else. If no specialty supplier within 5 miles, item routes to "general grocery" with annotation.

**Layers:**
- **UI:** Multi-store split rendering in `StoreGroup`.
- **API:** Planner queries `cultural_suppliers` within 5-mile radius (PostGIS); list response gains per-store grouping; aisle order from S3 keys per-store.
- **DB:** `cultural_suppliers(name, address, lat, lng, cuisines TEXT[], specialty_items TEXT[])` seeded with major US-metro routings.

**Cross-epic dependency:** 5-S16 (Geolocation opt-in). Without geolocation, slice still works for households who manually configured a default supplier address — recommend allowing manual-entry fallback so the slice isn't blocked.

**Cited PRD codes:** FR50.

---

## What's intentionally NOT a slice

- **"Build the pantry_state table"** is not a slice. The table comes into existence in S5 *with the first user-visible behavior that needs it*. No schema-only stories.
- **"Build the supplier directory data import job"** is not a slice. The seed data lives in a migration file shipped alongside S11.

---

## Cross-epic dependencies

| Slice | Depends on | Status |
|---|---|---|
| 6-S6 | Story 3.20 (bag composition modeling) — DONE | ✅ ready |
| 6-S10 | Epic 5 thread proposal turns (5-S1 or 5-S14) | ⚠️ Epic 5 conversion done, slices not implemented yet |
| 6-S11 | 5-S16 (Geolocation opt-in) | ⚠️ depends on 5-S16 shipping first |

**Recommended sequencing across epics:** ship 5-S1 → 5-S6 → 6-S1 → 6-S6 first. That delivers Epic 5's two-parent coordination + Epic 6's silent loop as parallel beta-ready slices. Epics 5 and 6 enhancements (above the walls) can interleave.

---

## Recommended next epic

**Epic 7 — Visible Memory & Trust Controls** is next. It's the trust-and-control surface, deeply user-facing, and has clean vertical slices around: see what's known → edit a sentence → soft-forget → hard-reset → JSON export → 30-day account wipe. Continue?
