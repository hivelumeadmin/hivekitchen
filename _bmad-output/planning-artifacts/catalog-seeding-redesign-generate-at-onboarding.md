# Slice proposal: retire Stage 0, generate the M5 chip set from stated preferences

Status: proposal — open decisions below, not ready-for-dev
Authored: 2026-08-13
Origin: live onboarding run surfaced a chip list where ~16 of 20 options were rice-based

---

## Problem

A parent completing onboarding sees the M5 "starting line" chip set — roughly twenty
lunches, tapped to tell Lumi what the household already likes. On a fresh run it rendered
as fifteen variations of the same dish: *Steamed rice wrap dumplings*, *Mediterranean
veggie rice plate*, *Spanish saffron chicken rice*, *Tomato rice tiffin*, *Mexican citrus
chicken rice*, *Chicken fried rice*, *Sambar rice plate*, *Lemon rice lunch*, *Somali
chicken rice*, *Chickpea rice plate*, *Caribbean chicken rice*, *Doro wat rice plate*,
*Veggie pilau rice*.

The same turn also failed to ask a question — it acknowledged M4 ("Perfect — Main + snack
it is.") and stopped, leaving the chips under a bare "TAP ANY THAT APPLY" with nothing
explaining what they were for.

Both were symptoms. The underlying issue is that the catalog a parent sees at M5 is
assembled by three mechanisms whose ordering works against their own intent.

---

## Verified current-state facts

Established by reading the code and querying the live dev database on 2026-08-12/13.
Trust these over prose elsewhere; every one was checked, not inferred.

### The three stages

| Stage | Fires | Source | Provenance | Confidence |
|---|---|---|---|---|
| 0 — curated baseline | household creation (`auth.service.ts:189`) | 50 static rows in `curated_baseline_items` | `inferred` | **60** |
| 0 — re-materialise | leaving `m3_taste` (`onboarding.service.ts` Trigger 2) | same 50 rows, filtered by `cuisine_tags &&` overlap | `inferred` | 60 |
| 1 — LLM seed | leaving `m2_safe`, plus an M5-entry re-check (`onboarding.service.ts:1171-1176`) | `gpt-4o`, temp 0.7, 4k tokens, 30s abort (`catalog-seed.service.ts:59-62`) | `inferred` | **50** |
| 2 — recovery | post-Stage-1, if catalog < 35 rows or guardrail blocked > 50% (`catalog-seed.service.ts:68,73`) | recovery job | — | — |

### M5 chip selection is deterministic — there is no AI in it

`CatalogProjectionService` imports a logger, contracts and two repositories. No LLM, no
prompt, no orchestrator. The pipeline (`catalog-projection.service.ts`):

```
read household recipes (Stage 0 + Stage 1 merged)
  → filter: declared allergens, non-negotiable dietary flags
  → sort:   declared-cuisine match → is_household_favorite → provenance → confidence_score → id
  → pick:   pickWithDiversityCap(cap = 3), stop at TARGET_CHIPS = 20
  → if fewer than UNDERFLOW_THRESHOLD (12), retry at cap = 5
```

### Three defects, compounding

**1. Stage 1 runs before the taste moment.** Its trigger is `advancedOutOfM2`, so the LLM
generates a "personalised" catalog knowing declared allergens but **not the parent's
stated cuisine preferences**. `buildSnapshot` sources `cuisineTags` from
`cultural_priors` / `cultural_identifiers` — inferred cultural template, not M3 answers.

**2. Stage 0 is the one refreshed with stated preferences.** Trigger 2 re-materialises
after M3 using cuisine tags derived from M3's cultural priors. The static seed gets the
preference data; the AI seed runs blind and early. The intent is inverted.

**3. The sort then ranks static above AI.** Both stages write `catalog_provenance =
'inferred'`, so `provenancePriority` ties, and the tiebreak is `confidence_score`: Stage 0
at 60 beats Stage 1 at 50 on every row. The picker walks the sorted list top-down and
stops at 20. Stage 0's 50 rows carry enough distinct cuisine tags to satisfy the cap-3
buckets long before a single Stage 1 item is reached.

**Net effect: the M5 chips are essentially all Stage 0.** The personalised, guardrail-
filtered, cap-respecting LLM output is computed, persisted, and then sorted out of view.

### The diversity cap buckets the wrong axis

`pickWithDiversityCap` admits a row only if every one of its `cuisine_tags` is below the
cap. It does not consider starch or protein. *Greek chicken rice*, *Caribbean chicken
rice* and *Somali chicken rice* are three different cuisines — every bucket stays under 3,
all three are admitted. The cap worked exactly as written and was structurally blind to
the repetition a parent actually perceives.

### Measured, not assumed

On a live seeded household before the fix: **43 of 97 recipes rice-based**, of which Stage
1 contributed exactly **4** — precisely its documented `≤4` hard cap, honoured — and Stage
0 the other **39**. The LLM was never the cause.

### Already fixed (commit `c256ab2`)

`curated-baseline.ts` rebalanced 39/50 → 8/50 rice; migration `20261039000000` re-seeds.
The M5 entry turn now requires acknowledge-AND-ask (`onboarding.prompt.ts`). **These treat
symptoms.** The ordering and trigger-timing defects above are untouched, and a future
data skew in either stage would reproduce the same parent-visible result.

---

## Target design

Collapse three stages into one well-informed generation, and stop seeding recipes during
onboarding entirely.

```
M5 entry  → LLM generates ~30 chip suggestions from M1–M4
             (children, declared allergens, stated taste/cuisine, bag composition)
          → deterministic allergen filter  (see open decision 1)
          → "Lumi is putting together some ideas…" then render chips
onboarding complete
          → seed recipes ONCE, with the full picture including the chips actually tapped
```

### Why this is better than patching the sort

- **Generation sees everything.** M1–M4 rather than M1–M2. Stated cuisine, dietary
  enforcement and bag composition all inform the suggestions.
- **Chips need no catalog rows.** M5 is a preference-elicitation surface. Nothing is
  cooked from a chip; it is a statement of taste. Backing it with `recipes` rows forces
  seeding to happen before the information that should drive it exists.
- **One LLM call instead of a seed-then-correct cascade.** No Stage 0 materialisation, no
  M3 re-materialisation, no Stage 2 recovery racing a half-populated catalog.
- **The latency lands where the product can spend it.** A brief, explained wait at M5 is
  acceptable (product decision, 2026-08-13); a wrong chip list is not.
- **Recipe seeding gets strictly better input** by running after onboarding, when the
  declared favourites are known.

### What Stage 0 actually provided

Not personalisation — its "personalisation" is a `cuisine_tags &&` overlap filter over 50
fixed rows, which cannot express vegan × Mediterranean × halal × regional availability.
Its one real function is **guaranteeing M5 is never empty**. That guarantee must be
preserved by whatever replaces it (open decision 2), because:

- the LLM call can time out (30s budget), and
- the allergy guardrail can block most of a response — `STAGE2_MASS_BLOCK_RATIO = 0.5`
  exists because mass blocking is observed, not hypothetical.

---

## Open decisions

### 1. Deterministic allergen filter on chip suggestions — KEEP or DROP

**Proposed during design:** rely on the LLM's own allergen checks for chips, on the
grounds that a chip is only a suggestion and a parent will not tap something unsuitable
for their child.

**Recommendation: keep the deterministic filter.** Three specifics, all verified:

- **It is not what costs time.** `evaluate()` in `allergy-rules.engine.ts:264` is a
  synchronous in-process function over strings — no network, no model call. The 30 seconds
  is entirely the `gpt-4o` round trip. Removing the filter buys approximately zero latency,
  which is the goal it would be traded against.
- **This codebase documents the LLM failing this exact task.** `catalog-seed.service.ts:75`
  — *"FALCPA category words the LLM MUST not introduce… so a peanut household never gets a
  peanut item even if the LLM mis-tags `allergen_flags` as `[]`."* `FALCPA_KEYS` exists
  because that was observed. `STAGE2_MASS_BLOCK_RATIO` exists for when it happens at scale.
- **Selected chips are not inert.** `favorite_lunch.add` → `declareForHousehold`
  (`recipes.repository.ts:300-307`) writes `catalog_provenance='declared'`,
  `is_household_favorite=true`, `confidence_score=80` — the highest confidence in the
  system, above both seed stages. The parent-as-filter argument holds for rejected chips;
  accepted ones propagate into plan generation at maximum weight.

The failure mode is also asymmetric: a parent who declared a peanut allergy at M2 and then
sees a peanut dish suggested at M5 does not think "I will skip that one." They conclude the
app was not listening about the thing that matters most.

**If DROP is chosen anyway** (a legitimate call if the substring matching proves too blunt
and rejects good suggestions): instrument first. Run the filter in shadow mode, log what it
*would* have blocked, and review the real rate before removing it from the path.

### 2. Fallback when generation fails or is gutted by the filter

M5 must never render empty. Options:

- **(a)** Retain the curated 50 purely as an invisible fallback — never materialised into
  `recipes`, used only to populate chips when generation yields too few.
- **(b)** A much smaller hand-picked "safe handful" (~8), broad-safe, no cuisine claims.
- **(c)** No chips; invite free-text entry with Lumi offering examples conversationally.

(a) is the smallest change and reuses work already committed. (c) is arguably the most
honest but leans hardest on the model mid-onboarding.

### 3. Blocking vs progressive rendering

Wait for the full set before showing anything, or stream chips as they arrive? Blocking is
simpler and matches the agreed "advise the parent, then show". Progressive adds a partial-
state to design and test.

### 4. Trigger point — M5 entry vs M3 exit

M3 exit buys roughly two moments of generation time, hiding most of the wait, at the cost
of not knowing bag composition (M4). M4 likely does not change *which lunches a household
likes*, so M3 exit may be strictly better UX for near-zero information loss. Needs a
product call.

### 5. Fate of Stage 1 and Stage 2

If generation moves to M5/M3 and recipe seeding moves to post-onboarding, the current
Stage 1 trigger and the Stage 2 recovery path both need re-scoping or removal. Stage 2's
floors (`35` rows, `0.5` block ratio) assume a catalog that exists during onboarding.

---

## Scope

**In:** chip generation trigger and source; retirement of Stage 0 materialisation;
post-onboarding recipe seeding; the generating-state UI; re-scoping Stage 1/Stage 2.

**Out:** the allergy guardrail engine itself; plan generation; the M5 completion gate
(`count >= 10` / `override_fewer`); chip taxonomy (hint/action/choice); anything in
`apps/web` beyond the generating state.

**Non-goal:** improving `curated-baseline.ts` further. If decision 2 selects (b) or (c),
most of that file is deleted rather than curated.

---

## Draft acceptance criteria

1. No `recipes` rows are written for a household during onboarding. Verified by querying
   `recipes` for a household mid-interview.
2. M5 chip suggestions are generated from a snapshot containing M1–M4 data, evidenced by a
   prompt-input assertion covering stated cuisine and dietary enforcement.
3. A parent whose declared allergen appears in a generated suggestion never sees that chip
   (subject to decision 1).
4. M5 renders a non-empty chip set even when generation fails or times out (subject to
   decision 2), proven by a forced-failure test.
5. The parent sees an explanatory generating state, not a silent wait, and not chips
   without a question.
6. Recipe seeding runs once after onboarding completes, and its snapshot includes the
   declared favourites.
7. `pickWithDiversityCap` no longer admits a set where one starch or protein dominates —
   either by a second bucket dimension or because generation makes it unreachable.

---

## Risks

- **Latency is now parent-visible.** A 30s p99 in the middle of onboarding is a drop-off
  risk. Mitigated by decision 4 (earlier trigger) and honest copy.
- **Single point of failure.** Removing Stage 0 from the path makes generation the only
  source. Decision 2 is what keeps this from being a regression.
- **`cuisine_tags` vocabulary validation.** Stage 0 rows are hand-tagged against the
  vocabulary tables; generated suggestions are not guaranteed to be. Chips may not need
  valid tags, but the post-onboarding seed does.
- **The golden evals are currently red** on `catalogSeedCalls` (2 vs 1) from unreleased
  Stage-1 retry work. Any change here lands on a red baseline and must not be mistaken for
  a new failure.

---

## References

- `apps/api/src/modules/catalog/catalog-projection.service.ts` — chip selection, sort, cap
- `apps/api/src/modules/catalog/catalog-seed.service.ts` — Stage 1 + Stage 2 constants
- `apps/api/src/modules/catalog/curated-baseline.service.ts` — Stage 0 materialisation
- `apps/api/src/modules/onboarding/onboarding.service.ts:1171-1176` — Stage 1 checkpoints
- `apps/api/src/modules/recipe/recipes.repository.ts:300-307` — `declareForHousehold`
- `apps/api/src/agents/prompts/catalog-seed.prompt.ts` — the `≤4` rice cap, honoured
- `apps/api/src/seeds/curated-baseline.ts` — rebalanced roster + authoring rules
- Commit `c256ab2` — symptom fix (baseline rebalance + M5 acknowledge-and-ask)
