# Story 3-32: User-Supplied Recipe Ingestion (URL Paste + Name Search)

Status: backlog

**Slice key:** `3-32-user-supplied-recipe-ingestion`
**Epic:** 3 — Weekly Plan & Ready-Answer Open
**Builds on:** 3-1 (Allergy Guardrail Service), 3-12 (per-slot swap), 3-31 (Recipe Agent — Tavily discover + extraction)
**Should ship after:** 3-23, 3-24 (so the `uncertain` allergen-confidence path can use smarter handling instead of conservative reject; this slice ships fine before them with a conservative default — see AD-3)
**Unblocks:** none (additive feature)

> **Origin (2026-05-23):** Surfaced during planning conversation about the
> swap surface (`_dev-kitchen-inspiration`). Existing swap flow only shows
> Lumi's suggestions; parents need a way to bring a specific recipe into a
> slot by name or URL. Recipe Agent infrastructure from 3-31 already does
> the structured extraction half; this slice adds the user-initiated
> ingestion surface and wires it through the deterministic safety floor.

---

## Story

As a **Primary Parent reviewing or swapping a slot in the weekly plan**,
I want to **add a specific recipe by pasting a URL or typing a recipe name**,
so that I can **steer the plan toward a recipe I already have in mind without depending only on Lumi's suggestions** — while trusting that any allergen risk for my children is still caught by the same safety floor that protects Lumi's recommendations.

---

## Background & Motivation

The swap surface at `apps/web/src/features/kitchen-inspiration/` currently presents Lumi-curated suggestions and a "Talk to Lumi" affordance. There is no path for a parent to supply a specific recipe directly.

In practice parents will encounter recipes outside HiveKitchen — a friend's link, a cookbook page, a TikTok dish — and want to slot them into the plan. Today that requires going back to Lumi in chat and hoping the suggestion engine surfaces the same dish.

Story 3-31 already shipped the Recipe Agent: Tavily-driven discovery, LLM extraction against `RecipeAgentExtractionSchema`, vocabulary post-pass, Redis-backed candidate caching, plan-commit materialisation into the `recipes` table. The extraction half is reusable for URL-paste; the search half is reusable for name-only lookup.

Story 3-1 (Allergy Guardrail Service) is **deterministic, authoritative, and source-agnostic** — every recipe entering a plan flows through it. User-supplied recipes therefore inherit the same protection without new guardrail logic. The only new responsibility for this slice is to **block ingestion when the recipe fails the guardrail**, with a clear parent-facing message.

The product invariant being asserted (per 2026-05-23 conversation): **a pasted URL does not bypass safety**. If a child has a peanut allergy and the pasted recipe contains peanuts, ingestion fails before the recipe ever reaches the catalog or the plan.

---

## Architectural Decisions Locked In

1. **Reuse Recipe Agent. Do not fork.** URL-paste calls a new method (`RecipeAgent.extractFromUrl`) that takes a single URL, fetches its raw HTML (via Tavily's `extract` API or a thin fetch+readability pipeline — Tavily preferred for parity), then runs the same `RECIPE_AGENT_SYSTEM_PROMPT_V1_0_0` extraction. Name-search calls a thin wrapper over the existing `RecipeAgent.discover()` (count=1, intent=user's name string) and returns the top match. Same `RecipeAgentExtractionSchema`, same vocabulary post-pass, same head-noun normaliser.

2. **Domain whitelist applies symmetrically.** URL paste accepts only `allrecipes.com` and `recipetineats.com` URLs in v1 (matches 3-31's locked-in source surface). Other domains return a typed `UnsupportedSourceError` to the UI with a parent-facing message. Future domains expand this whitelist via a separate decision; this slice does not introduce arbitrary-domain scraping.

3. **Conservative default for `uncertain` allergen confidence.** Story 3-24 (paused) will define the smart behaviour for partially-decomposed compound ingredients (e.g. `pesto` → possibly contains pine nuts). Until 3-24 ships, this slice treats an `uncertain`-confidence match against a child's declared allergen **the same as a `certain` match: ingestion fails**. Two distinct user-facing messages, one identical safety outcome. Once 3-24 ships, the `uncertain` branch upgrades to substitution / parent-confirm flow without changing this slice's API surface.

4. **Ingestion is a two-step user flow: preview → confirm.** The endpoint returns a structured preview (name, source_url, ingredients, computed safety verdict per child) but does NOT yet stage the recipe as a swap candidate. The parent reviews the preview and explicitly confirms before the recipe is written to Redis under a `recipe_candidate_id` and offered as a swap target. This mirrors the existing Lumi-suggestion confirm pattern and prevents accidental ingestion from a fat-finger paste.

5. **Failed ingestion is audited.** A `recipe.user_ingest_blocked` audit event records `{ household_id, source_url|search_query, reason: 'allergen_match'|'unsupported_source'|'extraction_failed', blocked_allergens?: string[], children_affected?: uuid[] }`. No child names, no PII. This gives ops visibility into how often the guardrail rejects user input and which sources cause extraction failures.

6. **Catalog write happens on plan commit, not on ingest.** Same pattern as 3-31. A user-ingested recipe lives in Redis as a candidate until the parent commits it into a plan slot. If the candidate TTL expires before commit, the parent re-ingests. This keeps `recipes` table writes tied to actual plan use, not idle browsing.

7. **No catalog browse UI in this slice.** The user-facing surface is exactly the swap flow. There is no "my saved recipes" list, no library view. Per the 2026-05-23 catalog scope correction (see `ux-design-spec-household-food-catalog.md`), the catalog remains internal-only infrastructure. This slice does not introduce a catalog-browse affordance.

---

## Acceptance Criteria

**AC1.** A new endpoint `POST /v1/recipes/ingest` exists and is JWT-protected (Primary Parent only). Request body validates against `RecipeIngestInputSchema`:
```typescript
z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('url'), url: z.string().url() }),
  z.object({ mode: z.literal('name'), name: z.string().min(2).max(120) }),
])
```
Invalid input returns 400 with a Zod error envelope. Other roles return 403.

**AC2.** When `mode: 'url'`: the endpoint validates the URL's host is in the allowed-domains list (`allrecipes.com`, `recipetineats.com`). Hosts outside the list return 422 with `{ error: 'unsupported_source', supported_sources: [...] }`. The parent-facing message ("We can only import recipes from Allrecipes or RecipeTin Eats right now") is rendered by the UI from this code, not the server message.

**AC3.** When `mode: 'name'`: the endpoint calls a new `RecipeAgent.searchOne(name, householdConstraints)` which wraps the existing `RecipeAgent.discover()` with `count: 1`, `intent: name`, and the household's profile-derived constraints (cuisine_tags, cultural_tags, dietary_flags from the kitchen map). If Tavily returns zero results, the endpoint returns 404 with `{ error: 'no_match_found' }`. If extraction fails on the single result, returns 422 `{ error: 'extraction_failed' }`.

**AC4.** When `mode: 'url'`: the endpoint calls a new `RecipeAgent.extractFromUrl(url)` which:
- Fetches the URL's raw content via the Tavily `extract` API (or `search` with the URL as a constrained query — implementer's call based on API surface),
- Runs the same `RECIPE_AGENT_SYSTEM_PROMPT_V1_0_0` LLM extraction,
- Zod-validates against `RecipeAgentExtractionSchema`,
- Applies the same vocabulary post-pass and head-noun normaliser used by `discover()`.
On extraction failure (Zod parse error), returns 422 `{ error: 'extraction_failed' }` and writes an `extraction.parse_failed` log line at `warn`.

**AC5.** Every successful extraction runs through the **deterministic allergy guardrail** (existing `AllergyGuardrailService` from 3-1) against **every child in the household**. The guardrail returns a per-child verdict: `clear` | `blocked_certain` | `blocked_uncertain`. Verdicts feed into the endpoint response:
- All children `clear` → endpoint returns 200 with `RecipeIngestPreview` (see AC6).
- Any child `blocked_certain` → endpoint returns 422 with `{ error: 'allergen_match', verdict: 'certain', blocked_for_children: [{ child_id, child_name, matched_allergens: ['peanut'] }] }`.
- Any child `blocked_uncertain` (and none `blocked_certain`) → same 422 envelope with `verdict: 'uncertain'`. *(Per AD-3: conservative default until 3-24 ships.)*

**AC6.** A successful ingest (AC5 all-clear) returns:
```typescript
RecipeIngestPreview {
  candidate_id: uuid,        // staged in Redis with 30-min TTL, swap-flow can pick it up
  name: string,
  source_url: string,
  source_site: 'allrecipes' | 'recipetineats',
  prep_time_minutes: number | null,
  ingredients: RecipeIngredient[],   // existing shape from 3-31
  allergy_clearance: {
    children_evaluated: Array<{ child_id, child_name, verdict: 'clear' }>,
    audit_link: string,              // link to AllergyCleared audit row (3-10 pattern)
  },
}
```
The `candidate_id` uses the same Redis namespace as 3-31 (`lumi:plan-build:{plan_build_id}:recipe-candidate:{candidate_id}`) so the existing plan-commit materialisation path (3-31 AC7) handles persistence with zero new code.

**AC7.** The plan-build context for user ingestion uses a synthetic `plan_build_id` derived from the parent's active swap session, OR the plan's existing `plan_build_id` if the swap surface is opened from a current plan. The Redis key namespace is therefore consistent with planner-driven ingestion; plan commit cannot distinguish a user-ingested candidate from a Lumi-suggested one (and does not need to).

**AC8.** A blocked ingestion writes a `recipe.user_ingest_blocked` audit event via `AuditService` containing `{ household_id, mode: 'url'|'name', source_or_query: string, reason: string, blocked_allergens?: string[], children_affected?: uuid[] }`. No child names, no parent name, no PII. A successful ingestion writes a `recipe.user_ingest_succeeded` audit event with `{ household_id, source_url, source_site, ingredient_count }`.

**AC9.** **Frontend — inspiration surface gets an "Add your own" affordance.** On `_dev-kitchen-inspiration` (and its production counterpart when wired), a tertiary action sits alongside the existing "Load more rhythms" / "Talk to Lumi" pair: `Add your own recipe`. Tapping it opens a focused sheet (calm system pattern — one intent per screen) with a single input that auto-detects URL vs free-text and a single primary action labeled `Find it`. The sheet is dismissible without consequence. The visual treatment matches the existing `InspirationActions` button family (border-2, terracotta accent, tracking-widest uppercase).

**AC10.** **Frontend — preview state.** A successful preview (AC6 response) renders inside the same sheet as a `RecipeCard` (existing component) with the recipe details, ingredient list (truncated, expandable), and a green "Safe for [child A, child B]" allergy-cleared badge using the existing `RecipeBadge` `safety-cleared` style. Two actions: primary `Use this recipe` (commits the candidate into the active swap slot) and secondary `Cancel` (discards the candidate; Redis TTL handles cleanup).

**AC11.** **Frontend — blocked state.** A 422 `allergen_match` renders inside the sheet with an amber-warning treatment (not destructive red — calm system) and a parent-facing copy block:
> "**This recipe contains [peanut].** [Maya] has a [peanut] allergy. We can't add this one to the plan."
For `verdict: 'uncertain'` the copy is:
> "**This recipe might contain [peanut].** We couldn't verify every ingredient, and [Maya] has a [peanut] allergy. To keep her safe, we won't add this one to the plan."
Both states show a single dismissive action `Try another recipe`. No retry, no override.

**AC12.** **Frontend — error states.** `unsupported_source` renders the supported-sources message (AC2). `no_match_found` (name search) renders `"We couldn't find a recipe matching '[query]'. Try a different name or paste a URL from Allrecipes or RecipeTin Eats."` `extraction_failed` renders `"We couldn't read that recipe. Try a different link."` All three are non-destructive copy with a single `Try again` action that returns to the input state.

**AC13.** **Rate limit.** The endpoint applies a per-household rate limit of 20 ingest attempts per hour (counting both successes and 4xx errors, but not network failures). Exceeded limit returns 429 with `{ error: 'rate_limited', retry_after_seconds: number }`. The UI surfaces this as `"You've added a lot of recipes today. Take a breath — try again in a few minutes."`

**AC14.** **Unit tests.**
- `extractFromUrl` happy path for an Allrecipes fixture and a RecipeTin Eats fixture (both included as test HTML).
- `extractFromUrl` rejects an `example.com` URL with `UnsupportedSourceError`.
- `searchOne` happy path with a Tavily mock returning a single result.
- Guardrail integration test: a household with a child declaring peanut allergy + an ingested recipe containing peanut → endpoint returns 422 `verdict: 'certain'`.
- Guardrail integration test: same household + a recipe containing "pesto" (compound, no decomposition) → endpoint returns 422 `verdict: 'uncertain'`.
- Audit emission test for both blocked and succeeded paths.

**AC15.** **E2E test** (`apps/web/test/e2e/3-32-user-recipe-ingestion.spec.ts`): on the inspiration surface, opening the sheet, pasting a known-safe Allrecipes URL, seeing the preview with allergy-cleared badge, confirming, and asserting the recipe candidate is now selectable in the swap slot. A second test pastes a URL whose extraction is mocked to return peanut → asserts the blocked-state copy renders and no swap candidate is created.

---

## Dependencies & Context

**Already implemented (reuse, do NOT re-implement):**

- `RecipeAgent` and its discover pipeline: `apps/api/src/agents/recipe-agent.ts` (or wherever 3-31 landed it). Add `extractFromUrl` and `searchOne` as sibling methods.
- `RECIPE_AGENT_SYSTEM_PROMPT_V1_0_0`: `apps/api/src/agents/prompts/recipe-agent.prompt.ts`. Reuse unchanged.
- `RecipeAgentExtractionSchema`, `RecipeIngredientSchema`: `packages/contracts/src/recipe.ts`. Reuse unchanged.
- Tavily client wrapper + Fastify plugin: `apps/api/src/plugins/tavily.plugin.ts`. Reuse.
- `AllergyGuardrailService` (3-1): runs deterministic allergen matching against `child_allergens`. Expose / verify a method that takes a `RecipeAgentExtraction` + a `household_id` and returns the per-child verdict structure required by AC5. If 3-1's API is plan-item shaped, add a thin adapter — do not re-implement the matching logic.
- `AuditService`: `apps/api/src/audit/audit.service.ts`. New event types `recipe.user_ingest_blocked` / `recipe.user_ingest_succeeded`.
- `RecipesRepository.insertRecipe`, `household_recipe_usage` write: plan-commit path (3-31 AC7) handles this with no change.
- Redis candidate namespace: `lumi:plan-build:{plan_build_id}:recipe-candidate:{candidate_id}` with 30-min TTL. Use as-is.
- Frontend `InspirationActions`, `RecipeCard`, `RecipeBadge`: `apps/web/src/features/kitchen-inspiration/components/`. Reuse for AC9–AC11.
- Swap slot selection state (Zustand) — wherever the current swap flow stores the active slot. The confirm action in AC10 writes the `recipe_candidate_id` into that store.

**New surface area:**

- `RecipeIngestInputSchema`, `RecipeIngestPreviewSchema`, `RecipeIngestErrorSchema` in `packages/contracts/src/recipe.ts`. Export from `packages/contracts/src/index.ts`.
- `POST /v1/recipes/ingest` route handler.
- `RecipeAgent.extractFromUrl(url: string): Promise<RecipeAgentExtraction>`.
- `RecipeAgent.searchOne(name: string, constraints: RecipeDiscoverConstraints): Promise<RecipeAgentExtraction>`.
- Guardrail adapter if needed (see Dependencies above).
- Two new audit event types.
- Frontend: new `AddYourOwnRecipeSheet` component in `apps/web/src/features/kitchen-inspiration/components/`. Owns the input state, preview state, blocked state, error states (AC9–AC12).
- Frontend: small button addition to `InspirationActions` for AC9 trigger.
- One new rate-limit declaration on the route.

**Key invariants:**

- The guardrail runs server-side, deterministic, before any preview is returned to the client. The UI never sees a blocked-recipe's full ingredient detail (only the matched allergens) — prevents accidental client-side bypass.
- All DB access stays in the API layer. The agent layer does not read or write `recipes`, `children`, or `child_allergens`.
- `RecipeAgent` does not import Redis, `AuditService`, or any repository directly — the route handler / service wrapper owns those side effects.
- No PII in audit payloads or Pino lines.
- Domain whitelist is enforced server-side. The client-side check in AC2 is UX-only and not authoritative.

---

## PRD / Contract Additions

This slice introduces net-new product capability. Before development, add to the PRD (`_bmad-output/planning-artifacts/prd.md`):

- **FR128 (proposed):** Primary Parent can ingest a specific recipe into the swap flow by pasting a URL (Allrecipes or RecipeTin Eats) or typing a recipe name. The system extracts the recipe's structured form, runs the allergy guardrail against every child in the household, and either presents the recipe as a swap candidate (all children clear) or blocks ingestion with a parent-facing message (any child blocked).
- **NFR (proposed):** User-initiated recipe ingestion is subject to the same allergy guardrail, audit logging, and vocabulary controls as Lumi-driven recipe discovery. There is no parent override for a guardrail-rejected recipe in v1.

A separate `bmad-edit-prd` pass should land FR128 before this slice exits backlog. Optional sub-task in Task 1 below.

---

## Tasks / Subtasks

### Task 1 — PRD anchor (optional, pre-dev)
1. Run `bmad-edit-prd` to add FR128 + the NFR above. Cross-reference this slice key.

### Task 2 — Contracts
1. Add `RecipeIngestInputSchema`, `RecipeIngestPreviewSchema`, `RecipeIngestErrorSchema` to `packages/contracts/src/recipe.ts`.
2. Export from `packages/contracts/src/index.ts`.
3. `pnpm typecheck` clean.

### Task 3 — RecipeAgent: extractFromUrl
1. Add `extractFromUrl(url: string): Promise<RecipeAgentExtraction>` to `RecipeAgent`.
2. Use Tavily `extract` API (preferred) or `search` constrained to the URL. Pass raw content through the same LLM extraction + Zod validation + vocabulary post-pass + head-noun normaliser used by `discover()`.
3. Throw `UnsupportedSourceError` for hosts outside the allow list (defensive — the route handler validates first, but the agent must not assume).
4. Unit tests against fixture HTML for both supported sources.

### Task 4 — RecipeAgent: searchOne
1. Add `searchOne(name: string, constraints: RecipeDiscoverConstraints): Promise<RecipeAgentExtraction | null>` to `RecipeAgent`.
2. Internally calls `discover()` with `count: 1`, `intent: name`. Returns the first extracted result or null.
3. Unit test with Tavily mock.

### Task 5 — Allergy guardrail adapter
1. Inspect `AllergyGuardrailService` API. If it cannot take a `RecipeAgentExtraction` directly, write a thin adapter `evaluateExtractionForHousehold(extraction, householdId): Promise<PerChildVerdict[]>`.
2. Verdict shape: `{ child_id, child_name, verdict: 'clear' | 'blocked_certain' | 'blocked_uncertain', matched_allergens: string[] }`.
3. Integration test against a seeded household with peanut-allergic child.

### Task 6 — Route handler
1. Create `apps/api/src/modules/recipe/recipe-ingest.route.ts` with `POST /v1/recipes/ingest`.
2. Zod-validate input. Dispatch to `extractFromUrl` or `searchOne` by mode.
3. Run guardrail. Build response per AC5/AC6.
4. On block: emit `recipe.user_ingest_blocked` audit. On success: write candidate to Redis + emit `recipe.user_ingest_succeeded` audit.
5. JWT + role gate (Primary Parent). 403 otherwise.
6. Rate-limit decorator: 20/hour per household.
7. Register route in `apps/api/src/app.ts` (or wherever route registration lives).

### Task 7 — Frontend: AddYourOwnRecipeSheet
1. New component in `apps/web/src/features/kitchen-inspiration/components/AddYourOwnRecipeSheet.tsx`.
2. Local state machine: `idle | submitting | preview | blocked | error`.
3. Input field with URL-vs-text auto-detection (simple regex on `^https?://`).
4. Calls `POST /v1/recipes/ingest` via the existing API client.
5. Preview state renders `RecipeCard` + allergy-cleared badge; primary action writes `recipe_candidate_id` into the swap slot store and closes the sheet.
6. Blocked state renders amber-warning copy per AC11.
7. Error states per AC12.
8. Uses existing design tokens; no new colors. Calm pattern — one intent per screen.

### Task 8 — Frontend: InspirationActions trigger
1. Add `Add your own recipe` button to `InspirationActions.tsx`.
2. New prop `onAddYourOwn?: () => void`. Parent component (inspiration page / route) wires it to `AddYourOwnRecipeSheet`'s open state.
3. Update `_dev-kitchen-inspiration` mockup + production route to render the sheet.

### Task 9 — E2E test
1. Happy path: open sheet → paste Allrecipes URL (Tavily mocked) → preview → confirm → assert candidate in swap slot.
2. Blocked path: paste URL → mocked extraction with peanut → assert blocked-state copy, no candidate created.

### Task 10 — Verify + ship
1. `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` all green.
2. Manual walkthrough against the calm-system design principles (no destructive red, one intent per screen, ready-answer not constructed).
3. Update `sprint-status.yaml`: `3-32-user-supplied-recipe-ingestion: review`.

---

## Out of Scope (v1)

- Arbitrary-domain scraping (only allrecipes.com + recipetineats.com in v1; see AD-2).
- A "my saved recipes" catalog browse UI (see AD-7; catalog stays internal per 2026-05-23 scope correction).
- Parent override for guardrail-blocked recipes (no override in v1; see PRD NFR).
- Sharing user-ingested recipes between households.
- User-uploaded photos / OCR / image-based ingestion.
- TikTok / Instagram / video-source ingestion.
- Editing an ingested recipe's ingredients before commit.
- Smart `uncertain`-confidence handling — substitution, parent-confirm, ingredient swap. Deferred to 3-24 follow-on; until then, `uncertain` blocks identically to `certain` (see AD-3).

---

## Risks & Open Questions

- **Tavily `extract` API surface** — story 3-31 used `search` with `includeRawContent`. If Tavily's dedicated extract endpoint isn't available or is meaningfully different, fall back to the same `search`-with-URL pattern. Implementer's call during Task 3.
- **Allrecipes / RecipeTin extraction quality variance** — 3-31 has a `dropped_count` audit field for extraction failures. Monitor it after this slice ships; if user-initiated extractions fail more often than planner-initiated ones (different page paths, different content surfaces), tune the prompt or fixture set.
- **Guardrail performance on URL-paste path** — guardrail is in-process and deterministic; should add <50ms. Verify no regression against the 3-1 latency budget after Task 5.
- **Parent expectations on `uncertain` block** — the conservative default may frustrate parents whose pasted recipe contains compound items that aren't actually unsafe. Track `recipe.user_ingest_blocked` with `reason: 'allergen_match'` + `verdict: 'uncertain'` after launch; if the rate is high, prioritise 3-24 to upgrade the UX.
- **Rate limit calibration** — 20/hour is a guess based on plausible mis-paste behaviour. Revisit after 2 weeks of real usage.
