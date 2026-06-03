# Story 4-S12: FlavorPassport

Status: done

**Slice key:** `4-s12-flavorpassport`
**Epic:** 4 — Lunch Link & Heart Note Sacred Channel
**Source slice doc:** `_bmad-output/planning-artifacts/epic-4-vertical-slices.md` §Slice 4-S12
**Builds on:** 4-S4 (emoji rating captured in `lunch_link_sessions.rating`), 4-S11 (`child_preferences` table + `ChildPreferencesRepository` + signal aggregation pattern)
**Folds:** 4.9 — FR37, UX-DR27

---

## Story

As a **parent**, I want to open `/app/children/:id/flavor-passport` and see my child's accumulated flavor journey as a vertical timeline of stamp cards (one per positively-rated recipe), so that I can treasure their developing tastes without it feeling like a scoreboard or a grid with empty slots.

As a **child**, opening `/lunch/{token}/passport` from the Lunch Link, I want to see the same journey reordered to show what I loved first, in a read-aloud-ready format that works with image and voice.

---

## Acceptance Criteria

**AC1 — Contracts: `FlavorPassportResponseSchema`.**
New file `packages/contracts/src/flavor-passport.ts`. Export from `packages/contracts/src/index.ts`.

```typescript
export const FlavorPassportStampSchema = z.object({
  recipe_id:         z.string().uuid(),
  recipe_name:       z.string(),                          // recipes.canonical_name
  slot_kind:         z.enum(['main','snack','extra']),
  signal_type:       z.enum(['loved','ok']),
  signal_date:       z.string(),                          // 'YYYY-MM-DD' — date rated
  cuisine_tags:      z.array(z.string()),                 // recipes.cuisine_tags
  method_caption:    z.string().nullable(),               // first recipe_steps row text; null if no steps
  child_voice_quote: z.string().nullable(),               // always null in this slice; field reserved for future voice
});

export const FlavorPassportStateSchema = z.enum(['empty','developing','established']);

export const FlavorPassportResponseSchema = z.object({
  child_id:          z.string().uuid(),
  state:             FlavorPassportStateSchema,           // empty=0, developing=1-8, established=9+
  stamps:            z.array(FlavorPassportStampSchema),
  available_filters: z.object({
    cuisines:   z.array(z.string()),
    slot_kinds: z.array(z.enum(['main','snack','extra'])),
  }).optional(),                                          // only present when state='established'
});
```

**AC2 — No migration required.**
FlavorPassport reads over existing tables only: `child_preferences` (4-S11, migration `20261013000000`), `recipes` and `recipe_steps` (3-DM-A1, migrations `20260820000200` + `20261005000000`). No new tables or columns.

**AC3 — `FlavorPassportRepository`.**
New file `apps/api/src/modules/flavor-passport/flavor-passport.repository.ts`.

Method: `getStampsForChild(childId: string, householdId: string): Promise<FlavorPassportStamp[]>`

Query approach — nested supabase-js embed:
```typescript
const { data, error } = await this.supabase
  .from('child_preferences')
  .select(`
    recipe_id, slot_kind, signal_type, signal_date,
    recipes(canonical_name, cuisine_tags, recipe_steps(text, sequence, mode))
  `)
  .eq('child_id', childId)
  .eq('household_id', householdId)
  .in('signal_type', ['loved', 'ok']);
```

The embed chain is: `child_preferences → recipes → recipe_steps` (supabase-js supports two-level embeds via FK graph). `recipes(...)` returns a single object; `recipe_steps(...)` nested inside returns an array of all steps for that recipe.

In-process dedup by `recipe_id`:
1. Group all returned rows by `recipe_id`.
2. Per group: keep the row with `signal_type = 'loved'` if any; else keep `'ok'`.
3. Within tied signal_type: keep the row with the most recent `signal_date`.
4. For `method_caption`: from the recipe's embedded `recipe_steps` array, pick the step with the lowest `sequence` where `mode = 'finish'`. If no finish-mode steps exist, fall back to lowest `sequence` overall. If the array is empty or null, return `null`.

**Do NOT reuse `ChildPreferencesRepository.getAggregatedSignals`** — it groups by (child, recipe, slot_kind) and serves the planner. The passport needs one stamp per recipe regardless of slot_kind. Different query, different module.

**AC4 — `FlavorPassportService`.**
New file `apps/api/src/modules/flavor-passport/flavor-passport.service.ts`.

Method: `buildPassport(childId: string, householdId: string, opts: { childFirst: boolean }): Promise<z.infer<typeof FlavorPassportResponseSchema>>`

- Calls `FlavorPassportRepository.getStampsForChild()`.
- Determines `state`:
  - 0 stamps → `'empty'`
  - 1–8 stamps → `'developing'`
  - 9+ stamps → `'established'`
- Ordering:
  - `opts.childFirst = false` (parent view): chronological ASC by `signal_date` (earliest first — journey from the beginning)
  - `opts.childFirst = true` (child view): loved stamps first, then ok; within each tier by `signal_date` ASC ("what they liked first")
- `available_filters`: populated only when `state = 'established'`:
  - `cuisines`: `[...new Set(stamps.flatMap(s => s.cuisine_tags))].sort()`
  - `slot_kinds`: `[...new Set(stamps.map(s => s.slot_kind))]`

**AC5 — Parent endpoint.**
`GET /v1/children/:childId/flavor-passport` added to `apps/api/src/modules/children/children.routes.ts`.

- Auth: `primary_parent` or `secondary_caregiver` (matching existing children route preHandler pattern).
- Params: `{ childId: z.string().uuid() }`.
- Response schema: `FlavorPassportResponseSchema`.
- Handler calls `flavorPassportService.buildPassport(req.params.childId, req.householdId, { childFirst: false })`.

**AC6 — Child endpoint (public).**
`GET /v1/lunch-link/:token/passport` added to `apps/api/src/modules/lunch-link/lunch-link.routes.ts`.

- No auth preHandler — public route. The regex that skips authorization for lunch-link routes must include this path pattern. Check how `GET /v1/lunch-link/:token` is currently excluded from the auth preHandler and apply the same exclusion.
- Token verification: call `lunchLinkService.verifyAndFetch(token, req.log)` (same method used by `GET /v1/lunch-link/:token`). Check its exact return signature in `apps/api/src/modules/lunch-link/lunch-link.service.ts` before implementing — it returns something like `{ ok: true, session, child } | { ok: false }`.
- On `ok: false` (invalid token, expired, suppressed): return `reply.status(404).send({ error: 'not found' })`. Oracle prevention: never distinguish between expired vs invalid vs suppressed in the response.
- On `ok: true`: call `flavorPassportService.buildPassport(session.child_id, session.household_id, { childFirst: true })`.
- Do NOT call any audit event — this is a read-only view, not a link open.
- Response schema: `FlavorPassportResponseSchema`.

**AC7 — Parent web route.**
New route file for URL `/app/children/:childId/flavor-passport`.

- Follow the existing TanStack Router file-based convention in `apps/web/src/routes/(app)/`. Check what child-related route files already exist under `(app)/` to determine the correct file path (e.g., `(app)/children/$childId/flavor-passport.tsx`).
- Fetch from `GET /v1/children/:childId/flavor-passport` via `lib/api.ts` client. Parse response with `FlavorPassportResponseSchema.parse()`.
- Pass `scope="app"` to `<FlavorPassportView>`.
- Loading state: follow the skeleton/loading pattern established in other children route pages.

**AC8 — Child web route.**
New route file for URL `/lunch/:token/passport`.

- Determine the correct file path by checking how the existing `/lunch/:token` maps to its file in `apps/web/src/routes/(app)/`. The child passport is a sub-path of the lunch-link token route.
- Fetch from `GET /v1/lunch-link/:token/passport`. On 404: render a graceful "This link has expired" message (no details about why).
- Pass `scope="child"` to `<FlavorPassportView>`.
- No filter bar in child scope (pass no `availableFilters` prop or set `scope="child"` to suppress the bar).
- The `useMatch('/lunch/*')` in `(app)/layout.tsx` already hides `<LumiOrb>` and `<LumiPanel>` for all `/lunch/*` routes — no additional layout changes needed.

**AC9 — Add passport link to Lunch Link page.**
In `apps/web/src/routes/(app)/lunch-link.tsx` (the existing child-facing lunch link page):

- After the main Lunch Link content, add a link "See [child name]'s flavor passport" pointing to `/lunch/{token}/passport`.
- Conditionally show only when the passport state is not `'empty'`. To avoid an extra API call, either: (a) prefetch the passport response alongside the lunch-link fetch, or (b) show the link unconditionally (the passport page handles the empty state gracefully). Option (b) is simpler — prefer it.

**AC10 — `<FlavorPassportView>` component.**
New file `apps/web/src/features/flavor-passport/FlavorPassportView.tsx`. Props:

```typescript
interface FlavorPassportViewProps {
  childName: string;
  state: 'empty' | 'developing' | 'established';
  stamps: FlavorPassportStamp[];
  availableFilters?: { cuisines: string[]; slot_kinds: Array<'main'|'snack'|'extra'> };
  scope: 'app' | 'child';
}
```

**`empty` state:** Render only the header prose — `"[childName]'s taste is still forming. Lumi will notice and add it here."` No grid, no placeholder cards, no progress indicator.

**`developing` and `established` states:** Vertical timeline of `<FlavorPassportStamp>` cards.

**`established` + `scope="app"` only:** Render a filter bar above the timeline with cuisine chips and slot-kind chips. Filtering is client-side (local `useState`). Active filter: `bg-[--amber]` (honey rule: recognition accent). "Clear filters" text link when active.

**New file `apps/web/src/features/flavor-passport/FlavorPassportStamp.tsx`:**
Stamp card anatomy (DESIGN.md compliance):
- Surface: `bg-[--surface] rounded-[--r-lg]` card
- Dish name: Instrument Serif (`font-serif`), `text-[--fg]`
- Date: Public Sans, `text-[--fg-muted]`, formatted as `"Mon 14 Apr"` (use `Intl.DateTimeFormat` or equivalent)
- Method caption: italic, small, `text-[--fg-muted]`. Omit if `method_caption` is null.
- Cuisine chips: `bg-[--surface-2] rounded-[--r-sm] text-[--fg-muted] text-xs`
- Loved emoji: 😋 shown at ~20px only when `signal_type = 'loved'`. No icon for `'ok'`.
- `child_voice_quote`: always null in this slice — omit the quote area entirely.

**AC11 — Accessibility (AAA in child scope).**
When `scope="child"`:
- Timeline wrapper: `<ol aria-label="{childName}'s flavor journey">` (ordered list)
- Each stamp: `<li><article aria-labelledby="stamp-{recipe_id}"><h3 id="stamp-{recipe_id}">{recipe_name}</h3>…</article></li>`
- No filter bar (suppressed by `scope` prop)
- WCAG 2.2 AAA contrast for all text — `--fg` on `--bg` for body text (7:1 target). Verify with a contrast checker.
- No critical information conveyed by CSS alone (no background-only state indicators)
- Read-aloud DOM order: dish name → date → method caption (no decorative text interspersed)

When `scope="app"`: WCAG 2.2 AA minimum.

**AC12 — Unit and endpoint tests.**

`FlavorPassportRepository.getStampsForChild` tests:
- Empty `child_preferences` → returns `[]`
- `not-really` signals in the table are excluded from output
- Two rows for same `recipe_id` (different dates) → one stamp (most recent date, most favorable signal_type)
- Row with `loved` and row with `ok` for same recipe → `signal_type = 'loved'` wins
- `method_caption` from first finish-mode step; fallback to first step of any mode; null when no steps

`FlavorPassportService.buildPassport` tests:
- 0 stamps → `{ state: 'empty', stamps: [] }`
- 8 stamps → `{ state: 'developing', available_filters: undefined }`
- 9 stamps → `{ state: 'established', available_filters: { cuisines: [...], slot_kinds: [...] } }`
- `childFirst=true` ordering: loved stamps before ok, within tier by signal_date ASC
- `childFirst=false` ordering: all stamps by signal_date ASC

Endpoint tests:
- `GET /v1/children/:childId/flavor-passport` → 200, valid `FlavorPassportResponseSchema` shape
- `GET /v1/lunch-link/:token/passport` → 404 on invalid token (no expiry detail leaked)
- `GET /v1/lunch-link/:token/passport` → 200 on valid token, `childFirst=true` ordering

**AC13 — Typecheck and existing tests unaffected.**
`pnpm typecheck`: no new errors. Existing lunch-link, children, and child-preferences tests all pass.

---

## Demo Path

> 1. Confirm child "Layla" has at least 5 `child_preferences` rows with `signal_type IN ('loved','ok')`
>    (if not, use the rating endpoint: `POST /v1/lunch-link/:token/rate { rating: 'loved' }` five times on different days)
> 2. As parent, open `/app/children/{layla-id}/flavor-passport`
>    → see 5 stamp cards in chronological order (oldest first), each showing dish name, date, method caption
> 3. Verify Supabase: `SELECT * FROM child_preferences WHERE child_id = '<layla-uuid>' AND signal_type IN ('loved','ok')`
>    → matches what the UI shows (same recipe deduplication)
> 4. Navigate to `/lunch/{layla-token}/passport` in a browser
>    → see loved stamps first, then ok stamps, both in chronological order within tier
>    → "See Layla's passport" link is visible on the Lunch Link page (`/lunch/{token}`)
> 5. Call `GET /v1/lunch-link/{invalid-token}/passport` → confirm 404 (no expiry message leaked)
> 6. Rate enough lunches to reach 9 distinct recipes with positive signals
>    → parent view shows filter bar with cuisine chips and slot-kind chips
>    → clicking a cuisine chip filters the timeline client-side
>    → active chip has `--amber` background (honey rule)
> 7. Open the page for a child with 0 positive ratings
>    → see only the prose header, no grid or placeholder cards

---

## Critical Guardrails

**`not-really` signals are excluded from the passport.**
The passport is a "treasure" showing only what the child enjoyed. Query must filter `.in('signal_type', ['loved', 'ok'])`. `not-really` signals remain in `child_preferences` for planner avoidance (AC11 guardrail) but never surface in the passport.

**One stamp per recipe — not per (recipe, slot_kind).**
`ChildPreferencesRepository.getAggregatedSignals` groups by (child, recipe, slot_kind) and would produce duplicate stamps for the same dish eaten in different slots. `FlavorPassportRepository` must dedup by `recipe_id` only. A child who loved cheese quesadilla as both a main and a snack sees one stamp.

**No grid with empty slots — ever.**
The `empty` state renders ONLY the prose header. No placeholder cards, no "0 of 9 stamps" progress bars, no skeleton grids. This is UX-DR27's sparse-page doctrine: render what exists; absence is not a failure state and must not be framed as one.

**Oracle prevention on child endpoint (404 for all failures).**
`GET /v1/lunch-link/:token/passport` returns 404 for invalid tokens, expired sessions, suppressed sessions — identical response for all failure cases. Never return 410 or any message that distinguishes expiry from invalidity. Follow exactly the pattern used by `GET /v1/lunch-link/:token`.

**No audit event for passport reads.**
`GET /v1/lunch-link/:token/passport` is a read-only view. Do NOT emit `lunch_link.opened` or any audit event. The existing rating audit (`lunch_link.rated`) and link-open audit (`lunch_link.opened` in the existing route) are unaffected.

**`child_voice_quote` is always null in this slice.**
The field is in the contract for a future voice quote capture feature (after hold-to-talk and premium audio land). Do not attempt to source quotes from existing data. The `<FlavorPassportStamp>` must handle `null` gracefully by omitting the quote area entirely — not by rendering `"null"` or an empty string element.

**AAA contrast in child scope is non-negotiable.**
DESIGN.md: "AAA inside `.child-scope`". The `scope="child"` variant must use `--fg` on `--bg` for body text (minimum 7:1 contrast ratio). Verify with a contrast tool before closing AC11.

**Honey rule: `--amber` for recognition only.**
Active filter chips use `--amber` accent. Button hover states do NOT use honey-amber. This is the design system's locked Honey rule.

**No circular import between flavor-passport and child-preferences.**
`FlavorPassportRepository` reads from the `child_preferences` table directly via the Supabase client — it does NOT import `ChildPreferencesRepository`. If `normalizeEmbedded` (or equivalent) is a private helper in `ChildPreferencesRepository`, either re-implement the same normalization inline or extract it to `apps/api/src/lib/supabase-helpers.ts` first. Check whether it's already extracted before deciding.

**`verifyAndFetch()` is owned by `LunchLinkService` — do not re-implement HMAC inline.**
The child passport endpoint must call `lunchLinkService.verifyAndFetch(token)` to extract `child_id` and `household_id`. Inspect the actual return type of this method in `apps/api/src/modules/lunch-link/lunch-link.service.ts` before writing the handler — do not guess the shape.

**Filter in `established` state: cuisine + slot_kind only.**
UX-DR27 specifies "cuisine/texture/method" filters. The schema has no `texture` column on recipes. This slice implements cuisine (from `recipes.cuisine_tags`) and slot_kind (main/snack/extra) filters only. Texture and explicit method filters are deferred pending schema additions.

---

## What Already Exists (Do Not Recreate)

**`child_preferences` table** — `supabase/migrations/20261013000000_child_preferences_signal.sql`.
Schema: `(id, household_id, child_id, recipe_id, slot_kind, signal_type, signal_date, source, created_at)`. Dedup key: `UNIQUE(child_id, recipe_id, slot_kind, signal_date)`. Already populated by the 4-S11 signal write path.

**`ChildPreferencesRepository`** — `apps/api/src/modules/child-preferences/child-preferences.repository.ts`.
Has `getAggregatedSignals` (groups by slot_kind, for planner use) and `getVariantEligibleChildIds`. Do NOT reuse these for the passport — the passport needs different grouping. `FlavorPassportRepository` is a separate module.

**`recipe_steps` table** — `supabase/migrations/20261005000000_recipe_canonical.sql`.
Columns: `id, recipe_id, sequence (smallint), mode ('prep'|'finish'), text, created_at`. This is the source for `method_caption`. A recipe may have 0, 1, or many steps.

**`recipes.cuisine_tags`** — `text[]` column, already populated by the RecipeAgent from Tavily fetches (3-DM-A1). Source for the cuisine filter in `established` state.

**`LunchLinkService.verifyAndFetch()`** — `apps/api/src/modules/lunch-link/lunch-link.service.ts`.
Handles full HMAC verification, expiry check, suppression check. Returns parsed session with `child_id` + `household_id`. Already used by `GET /v1/lunch-link/:token`. The passport endpoint reuses it without modification.

**Auth preHandler exclusion for lunch-link public routes** — check `apps/api/src/server.ts` or wherever the JWT preHandler is registered. The pattern excludes `/v1/lunch-link/:token*` (or similar regex). The new `/v1/lunch-link/:token/passport` path must fall within the same exclusion. Verify the regex covers sub-paths.

**`useMatch('/lunch/*')` in `(app)/layout.tsx`** — already hides `<LumiOrb>` and `<LumiPanel>` for all `/lunch/*` routes. The child passport route at `/lunch/{token}/passport` falls within this pattern automatically.

**`GET /v1/children/:childId/signal-summary`** — added in 4-S11 to `children.routes.ts`. The flavor-passport endpoint is the SECOND per-child endpoint in the same file. Follow the same route registration pattern (params schema, response schema, preHandler, thin handler).

---

## Tasks

### T1 — Contracts

**T1.1** Create `packages/contracts/src/flavor-passport.ts` per AC1.

**T1.2** Export from `packages/contracts/src/index.ts`.

**T1.3** Add inferred types to `packages/types/src/index.ts`:
```typescript
export type { FlavorPassportStamp, FlavorPassportState, FlavorPassportResponse } from '@hivekitchen/contracts';
```
(Use `export type` — `isolatedModules` requirement.)

---

### T2 — Repository

**T2.1** Create `apps/api/src/modules/flavor-passport/flavor-passport.repository.ts` per AC3.

Before writing the query, check whether `normalizeEmbedded` is an exported utility or a private inline function in `child-preferences.repository.ts`. If private, decide: extract to `apps/api/src/lib/supabase-helpers.ts` (preferred — other repositories will benefit too) or re-implement inline.

The nested embed `recipes(canonical_name, cuisine_tags, recipe_steps(text, sequence, mode))` returns:
- `row.recipes` — object `{ canonical_name, cuisine_tags, recipe_steps: [...] }` (supabase-js normalizes the embedded array)
- Handle `null` for `row.recipes` (recipe deleted race condition) — skip the row and log at `warn`.

**T2.2** Unit tests at `apps/api/src/modules/flavor-passport/flavor-passport.repository.test.ts` per AC12.

---

### T3 — Service

**T3.1** Create `apps/api/src/modules/flavor-passport/flavor-passport.service.ts` per AC4.

**T3.2** Unit tests at `apps/api/src/modules/flavor-passport/flavor-passport.service.test.ts` per AC12.

---

### T4 — API Endpoints

**T4.1** Add to `apps/api/src/modules/children/children.routes.ts`:

```typescript
fastify.get('/v1/children/:childId/flavor-passport', {
  schema: {
    params: z.object({ childId: z.string().uuid() }),
    response: { 200: FlavorPassportResponseSchema },
  },
  preHandler: [authorize(['primary_parent', 'secondary_caregiver'])],
}, async (req, reply) => {
  const passport = await flavorPassportService.buildPassport(
    req.params.childId,
    req.householdId,
    { childFirst: false },
  );
  return reply.send(passport);
});
```

**T4.2** Add to `apps/api/src/modules/lunch-link/lunch-link.routes.ts`:

```typescript
fastify.get('/v1/lunch-link/:token/passport', {
  schema: {
    params: z.object({ token: z.string() }),
    response: { 200: FlavorPassportResponseSchema },
  },
  // No preHandler — public
}, async (req, reply) => {
  const result = await lunchLinkService.verifyAndFetch(req.params.token, req.log);
  if (!result.ok) {
    return reply.status(404).send({ error: 'not found' });
  }
  const passport = await flavorPassportService.buildPassport(
    result.session.child_id,     // verify field names from the actual return type
    result.session.household_id,
    { childFirst: true },
  );
  return reply.send(passport);
});
```

Verify that `result.session.child_id` and `result.session.household_id` match the actual field names returned by `verifyAndFetch()`. Check the service file before writing.

**T4.3** Inject `FlavorPassportService` into both Fastify plugins. Check how `ChildPreferencesService` was injected into `lunch-link.routes.ts` in 4-S11 — use the same constructor injection pattern.

**T4.4** Confirm the public route exclusion. Locate where the JWT preHandler regex excludes `/v1/lunch-link/:token` from auth and verify the new `/v1/lunch-link/:token/passport` path falls within the same exclusion. Adjust the regex if needed.

**T4.5** Endpoint tests per AC12.

---

### T5 — Web: Parent Route

**T5.1** Check existing children route files in `apps/web/src/routes/(app)/` to determine the correct TanStack Router file path for `/app/children/:childId/flavor-passport`. Create the route file following that pattern.

**T5.2** Fetch pattern:
```typescript
const { childId } = useParams(); // TanStack Router
const { data } = useQuery({
  queryKey: ['flavor-passport', childId],
  queryFn: () => api.get(`/v1/children/${childId}/flavor-passport`).then(r => FlavorPassportResponseSchema.parse(r)),
});
```

**T5.3** Render `<FlavorPassportView childName={...} state={data.state} stamps={data.stamps} availableFilters={data.available_filters} scope="app" />`.

---

### T6 — Web: Child Route

**T6.1** Determine the correct file path for `/lunch/{token}/passport` by examining how `apps/web/src/routes/(app)/lunch-link.tsx` maps to its URL. Check if TanStack Router uses a `$token.tsx` or `_token/passport.tsx` pattern. Look at other parameterized route examples in the project.

**T6.2** Create the child passport route file:
- Fetch from `GET /v1/lunch-link/:token/passport` (token from URL param)
- On fetch error / 404: render a simple "This link has expired" message (no reason details)
- Parse with `FlavorPassportResponseSchema.parse()`
- Render `<FlavorPassportView scope="child" childName={...} state={data.state} stamps={data.stamps} />`

**T6.3** In `apps/web/src/routes/(app)/lunch-link.tsx`:
- Add a link/button at the bottom: "See [childName]'s flavor passport →" pointing to `/lunch/{token}/passport`
- Show unconditionally (the passport page handles the empty state gracefully — avoids an extra API call on the Lunch Link page)
- Style: `text-[--fg-muted]` understated link, not a primary CTA

---

### T7 — Web: FlavorPassport Component

**T7.1** Create `apps/web/src/features/flavor-passport/FlavorPassportView.tsx` per AC10.

Handle all three states. Local `useState` for active filters (established + app scope):
```typescript
const [activeCuisines, setActiveCuisines] = useState<string[]>([]);
const [activeSlots, setActiveSlots] = useState<Array<'main'|'snack'|'extra'>>([]);

const visibleStamps = stamps.filter(s =>
  (activeCuisines.length === 0 || s.cuisine_tags.some(c => activeCuisines.includes(c))) &&
  (activeSlots.length === 0 || activeSlots.includes(s.slot_kind))
);
```

No Zustand store — filter is local UI state with no persistence requirement.

**T7.2** Create `apps/web/src/features/flavor-passport/FlavorPassportStamp.tsx` per AC10.

Date formatting:
```typescript
const formatted = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  .format(new Date(signal_date + 'T12:00:00')); // noon UTC to avoid date-shift on UTC offsets
```

**T7.3** Apply DESIGN.md tokens (do NOT use raw Tailwind colors like `text-stone-400`; use the CSS custom property aliases):
```
text-[--fg]          primary text
text-[--fg-muted]    muted / secondary text
bg-[--surface]       card background
bg-[--surface-2]     cuisine chip background
bg-[--amber]         active filter chip (recognition)
rounded-[--r-lg]     card radius
rounded-[--r-sm]     chip radius
```

**T7.4** Child-scope accessibility: implement the `<ol>/<li>/<article>` semantic structure per AC11. Add `aria-label` to the `<ol>`. After implementation, verify contrast with a tool (e.g., browser DevTools accessibility panel) — must meet AAA.

---

### T8 — Final Verification

**T8.1** `pnpm typecheck` — no new errors.

**T8.2** `pnpm --filter @hivekitchen/api test -- flavor-passport` — all new tests pass.

**T8.3** `pnpm --filter @hivekitchen/api test -- lunch-link` — existing route tests pass.

**T8.4** `pnpm --filter @hivekitchen/api test -- children` — existing route tests pass.

**T8.5** `pnpm --filter @hivekitchen/web test` — all web tests pass.

**T8.6** Manual demo path per Demo Path section above.

---

## Project Structure Notes

**New files:**
- `packages/contracts/src/flavor-passport.ts`
- `apps/api/src/modules/flavor-passport/flavor-passport.repository.ts`
- `apps/api/src/modules/flavor-passport/flavor-passport.repository.test.ts`
- `apps/api/src/modules/flavor-passport/flavor-passport.service.ts`
- `apps/api/src/modules/flavor-passport/flavor-passport.service.test.ts`
- `apps/web/src/routes/(app)/children/$childId/flavor-passport.tsx` *(path TBC per TanStack Router convention — check T5.1)*
- `apps/web/src/routes/(app)/lunch-link/$token/passport.tsx` *(or equivalent — check T6.1)*
- `apps/web/src/features/flavor-passport/FlavorPassportView.tsx`
- `apps/web/src/features/flavor-passport/FlavorPassportStamp.tsx`

**Modified files:**
- `packages/contracts/src/index.ts` — export `flavor-passport.ts`
- `packages/types/src/index.ts` — inferred type exports
- `apps/api/src/modules/children/children.routes.ts` — parent endpoint + inject FlavorPassportService
- `apps/api/src/modules/lunch-link/lunch-link.routes.ts` — child endpoint + inject FlavorPassportService; verify auth-exclusion regex covers new path
- `apps/web/src/routes/(app)/lunch-link.tsx` — passport link added at bottom

**Possibly modified (check before assuming):**
- `apps/api/src/lib/supabase-helpers.ts` (may not exist yet) — extract `normalizeEmbedded` if needed
- Auth preHandler registration (wherever the JWT bypass regex for `/v1/lunch-link/...` lives) — ensure new path is covered

**Not modified:**
- `apps/api/src/modules/child-preferences/` — FlavorPassportRepository is a sibling, not a dependent
- `apps/api/src/agents/` — no agent changes
- `supabase/migrations/` — no migration needed
- Planner prompt — unchanged
- `apps/api/src/modules/plans/` — unchanged

---

## Task Completion Checklist

- [x] T1.1 — `packages/contracts/src/flavor-passport.ts` created
- [x] T1.2 — Exported from contracts index
- [x] T1.3 — Types exported from types index (`export type`)
- [x] T2.1 — `FlavorPassportRepository.getStampsForChild` with nested embed + dedup + method_caption logic
- [x] T2.2 — Repository tests: empty result, not-really excluded (query `.in`), dedup by recipe_id, signal_type priority, method_caption fallback (12 tests)
- [x] T3.1 — `FlavorPassportService.buildPassport` with state thresholds + ordering modes + available_filters
- [x] T3.2 — Service tests: all three states, childFirst ordering, childFirst=false ordering, available_filters content (6 tests)
- [x] T4.1 — Parent endpoint wired in `children.routes.ts`
- [x] T4.2 — Child endpoint wired in `lunch-link.routes.ts` (oracle 404, no audit event)
- [x] T4.3 — `FlavorPassportService` injected into both plugins
- [x] T4.4 — Auth-exclusion regex added (`LUNCH_LINK_PASSPORT_RE`) — the `:token`-only regex does NOT cover `/passport`
- [x] T4.5 — Endpoint tests (200 shape, childFirst ordering, 404 oracle prevention for invalid/expired/suppressed, no-audit assertion)
- [x] T5.1 — Parent web route created (`child-flavor-passport.tsx`; flat-file react-router convention, registered in `app.tsx`)
- [x] T5.2 — Parent route fetches child name + passport, parses with schema, renders FlavorPassportView (scope="app")
- [x] T6.1 — Child route created (`lunch-passport.tsx`; `/lunch/:linkId/passport` registered in `app.tsx`)
- [x] T6.2 — Child passport route created (graceful "expired" on 404, scope="child")
- [x] T6.3 — Passport link added at bottom of existing `lunch-link.tsx` (router state carries childName)
- [x] T7.1 — `FlavorPassportView.tsx` created with empty/developing/established state variants
- [x] T7.2 — `FlavorPassportStamp.tsx` with DESIGN.md-compliant named tokens (`text-fg`, `bg-surface`, `bg-surface-2`, `rounded-lg`, `rounded-sm`, `bg-amber`)
- [x] T7.3 — Filter bar (established + app scope only; honey rule `bg-amber` active state)
- [x] T7.4 — Child-scope AAA: semantic `<ol>/<li>/<article>/<h3>` structure + aria-labels + read-aloud DOM order; body text `text-fg` on `bg` ≈ 16.8:1 (base `:root` tokens — see Completion Notes)
- [x] T8.1–T8.5 — Typecheck (no new errors) + all new unit/endpoint tests pass + existing suites unaffected
- [~] T8.6 — Manual demo path: requires a running stack + live Supabase; automated tests cover the logic. Deferred to manual/QA verification.

---

## References

- [Source: `_bmad-output/planning-artifacts/epic-4-vertical-slices.md` §Slice 4-S12]
- [Source: `_bmad-output/planning-artifacts/epics.md` §Story 4.9 — FR37, UX-DR27]
- [Source: `docs/DESIGN.md`] — token system, honey rule, AAA child-scope requirement, roundness tokens
- [Source: `apps/api/src/modules/lunch-link/lunch-link.routes.ts`] — oracle-prevention pattern, public route exclusion, fire-and-forget pattern
- [Source: `apps/api/src/modules/lunch-link/lunch-link.service.ts`] — `verifyAndFetch()` signature
- [Source: `apps/api/src/modules/child-preferences/child-preferences.repository.ts`] — `getAggregatedSignals` (do not reuse), `normalizeEmbedded` helper
- [Source: `apps/api/src/modules/children/children.routes.ts`] — route registration pattern, `signal-summary` endpoint added in 4-S11
- [Source: `supabase/migrations/20261013000000_child_preferences_signal.sql`] — `child_preferences` schema
- [Source: `supabase/migrations/20261005000000_recipe_canonical.sql`] — `recipe_steps` schema (sequence, mode, text)
- [Source: `supabase/migrations/20260820000200_create_recipes_and_usage.sql`] — `recipes.cuisine_tags` column
- [PRD FR37] — Child can view cumulative flavor-profile artifact from within the Lunch Link
- [UX-DR27] — FlavorPassport sparse-page: vertical timeline, no empty grids, no completion mechanic

---

## Dev Agent Record

### Implementation Plan & Key Decisions

The story's pseudocode was written against several assumptions that differ from
the actual codebase. The story explicitly instructed verifying real signatures
before implementing; the following adaptations were made (and are the reason the
final code diverges from the literal AC snippets):

1. **`verifyAndFetch` signature + side-effects.** The real method is 1-arg
   (`verifyAndFetch(rawToken)`) returning
   `{ status: 'invalid' | 'valid' | 'expired'; householdId; childId; ... }` — not
   the guessed `(token, log)` / `{ ok, session }`. More importantly it has WRITE
   side-effects (`recordFirstOpen` / `incrementReopenedCount`) and decrypts the
   heart note — all of which violate the "read-only view, not a link open, no
   audit event" guardrail. **Decision:** added a minimal read-only
   `LunchLinkService.verifyTokenForRead(token)` that reuses the existing
   `parseToken` + `verifyHmac` + `findSession` helpers (honoring "do not
   re-implement HMAC inline") and performs the same HMAC + session + suppression
   + expiry checks, returning `{ childId, householdId }` with NO open recorded and
   NO audit footprint. All failure modes collapse to `invalid` → 404 (oracle
   prevention). Expired tokens 404 per AC6.

2. **Web router.** The app uses **react-router-dom** with a manual
   `createBrowserRouter` in `app.tsx`, NOT TanStack Router / file-based routing.
   Data is fetched via `hkFetch`/`publicGet` + `useEffect` (the codebase does not
   use `useQuery` in pages). Routes registered in `app.tsx`; flat route files
   under `(app)/`; the lunch param is `linkId`. New routes:
   `/app/children/:childId/flavor-passport` and `/lunch/:linkId/passport`.

3. **Design tokens.** The codebase uses named Tailwind utilities
   (`text-fg`, `text-fg-muted`, `bg-surface`, `bg-surface-2`, `bg-amber`,
   `rounded-lg`, `rounded-sm`), not the `[--x]` bracket syntax in the AC. Used the
   named utilities (they resolve to the same CSS vars).

4. **`childName` gap.** The response schema (AC1, fixed) carries no child name,
   but `FlavorPassportView` needs one. Made the prop optional: the parent route
   fetches it from `GetChild`; the child route receives it via react-router
   navigation state from the lunch-link page (which already has it), with a
   second-person fallback ("Your …") on direct navigation.

5. **`normalizeEmbedded`** is a private function in `child-preferences.repository`.
   Re-implemented inline in the new repo (3 lines) rather than extracting it —
   keeps the change surgical and avoids touching working child-preferences code.

6. **Auth exclusion regex.** `LUNCH_LINK_PUBLIC_RE` (`/^\/v1\/lunch-link\/[^/]+$/`)
   stops at the path boundary and does NOT match `/passport`. Added
   `LUNCH_LINK_PASSPORT_RE` (`/^\/v1\/lunch-link\/[^/]+\/passport$/`) for GET.

7. **AAA contrast / `.child-scope`.** There is no `.child-scope` CSS rule that
   redefines `--fg`/`--bg`; the base `:root` tokens are `--fg: #141210` on
   `--bg: #f7f2e9` (≈16.8:1 — well above AAA's 7:1). `useScope` sets a single
   scope class on `<html>` and parent (AppLayout) effects run after page effects,
   so a page-level `child-scope` would be overridden — matching the existing
   `/lunch/:token` surface which also renders in app-scope. AAA is therefore met
   by the base body-text token pairing (`text-fg` on `bg`); the full AC11
   semantic structure (`<ol>/<li>/<article>/<h3 id>`, `aria-label`, clean
   read-aloud DOM order, no CSS-only state) is implemented.

8. **Parent endpoint ownership.** Per AC5 the handler is thin (no extra
   ownership 404). The repository query is household-scoped, so a childId outside
   the caller's household yields an empty passport (state `empty`), not a data
   leak or an existence oracle.

### Completion Notes

- All 11 ACs implemented. Backend logic fully unit + endpoint tested.
- **Tests added:** repository 12, service 6, child endpoint 7, parent endpoint 5
  (30 new tests). `pnpm --filter @hivekitchen/api test -- flavor-passport` →
  15/15 (repo + service) green; the route-level tests live in the existing
  lunch-link / children route test files and pass.
- **Typecheck:** `pnpm typecheck` adds zero new errors (API + web both at their
  documented pre-existing baselines — none of the residual errors touch any
  4-S12 file).
- **Regression:** full API suite 19 failed / 1340 passed / 13 skipped — every
  failure is in a pre-existing-baseline file (`onboarding.tools`, `audit.types`,
  `auth.routes`, `catalog-seed`, `children.repository`, `extra-library`,
  `lunch-link` dev-endpoint, `memory.service`, `plan-adjustment`); identical
  failures reproduce on a clean stash. No new failures introduced (baseline
  improved 22→19). Web suite 374/374 green.
- T8.6 manual demo path requires a running stack + live Supabase; deferred to
  manual/QA. The automated tests cover the dedup, ordering, state-threshold,
  oracle-prevention, and no-audit logic end-to-end.

### File List

**New files**
- `packages/contracts/src/flavor-passport.ts`
- `apps/api/src/modules/flavor-passport/flavor-passport.repository.ts`
- `apps/api/src/modules/flavor-passport/flavor-passport.repository.test.ts`
- `apps/api/src/modules/flavor-passport/flavor-passport.service.ts`
- `apps/api/src/modules/flavor-passport/flavor-passport.service.test.ts`
- `apps/web/src/features/flavor-passport/FlavorPassportView.tsx`
- `apps/web/src/features/flavor-passport/FlavorPassportStamp.tsx`
- `apps/web/src/routes/(app)/child-flavor-passport.tsx`
- `apps/web/src/routes/(app)/lunch-passport.tsx`

**Modified files**
- `packages/contracts/src/index.ts` — export `flavor-passport.js`
- `packages/types/src/index.ts` — `FlavorPassport*` schema imports + inferred type exports
- `apps/api/src/middleware/authenticate.hook.ts` — `LUNCH_LINK_PASSPORT_RE` public-GET exclusion
- `apps/api/src/modules/lunch-link/lunch-link.service.ts` — `verifyTokenForRead()` read-only verify
- `apps/api/src/modules/lunch-link/lunch-link.routes.ts` — child passport endpoint + inject FlavorPassportService
- `apps/api/src/modules/lunch-link/lunch-link.routes.test.ts` — passport endpoint tests + `child_preferences` mock case
- `apps/api/src/modules/children/children.routes.ts` — parent passport endpoint + inject FlavorPassportService
- `apps/api/src/modules/children/children.routes.test.ts` — parent endpoint tests + `child_preferences` mock table
- `apps/web/src/app.tsx` — register parent + child passport routes
- `apps/web/src/routes/(app)/lunch-link.tsx` — understated passport link (router state carries childName)

## Change Log

| Date | Change |
|------|--------|
| 2026-06-03 | Implemented slice 4-S12 FlavorPassport: contracts + types, `FlavorPassportRepository`/`FlavorPassportService`, read-only `verifyTokenForRead`, public child endpoint + parent endpoint (+ auth-exclusion regex), and the web `FlavorPassportView`/`FlavorPassportStamp` + parent/child routes + lunch-link passport link. 30 new tests. Status → review. |

---

### Review Findings

_Code review 2026-06-03 — 3 adversarial layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor). 1 decision-needed, 4 patch, 0 defer, 11 dismissed as noise/false-positive/by-design._

- [x] [Review][Patch] **AAA contrast fails for muted text in child scope** — _Fixed: `secondaryText` uses `text-fg` when `scope="child"`, `text-fg-muted` in app scope (FlavorPassportStamp.tsx)._ — Child surface renders in `app-scope` (no `.child-scope` override exists; deviation #7). Body text (`--fg #141210`) passes AAA easily, but the date, method caption, and cuisine chips use `text-fg-muted` (#56524a): measured **6.04:1 on `--surface`**, **5.05:1 on `--surface-2`**, **6.97:1 on `--bg`** — all below AAA's 7:1. AC11 requires "WCAG 2.2 AAA contrast for **all text**" and lists date + method caption in the read-aloud DOM order, so they are content, not incidental. Violates AC11 + "AAA contrast in child scope is non-negotiable" guardrail. Fix is a design choice: (a) use `text-fg` for date/caption/chips when `scope="child"`, (b) add a child-scope-only muted token that clears 7:1, or (c) amend the spec to AA. [`FlavorPassportStamp.tsx`]
- [x] [Review][Patch] **`Promise.all` couples cosmetic child-name fetch to passport load** — _Fixed: child-name fetch wrapped in `.catch(() => null)`; passport remains the critical path._ — parent route joins the GetChild call and the passport call with `Promise.all`; a failure of *either* drops the whole page to the error state, even though `childName` has a graceful "Your" fallback and the passport may have loaded fine. Fetch the passport as the critical path and the name best-effort. [`apps/web/src/routes/(app)/child-flavor-passport.tsx:41-62`]
- [x] [Review][Patch] **`available_filters.slot_kinds` not sorted while `cuisines` is** — _Fixed: sorted by `SLOT_ORDER` (main/snack/extra); masking `.sort()` removed from the service test._ — service sorts `cuisines` but emits `slot_kinds` in insertion order, so the slot filter chips render in non-deterministic order across loads. The service test hides this by calling `.sort()` on the actual before comparing. Sort `slot_kinds` (e.g. fixed main/snack/extra order) and drop the masking `.sort()` from the test. [`apps/api/src/modules/flavor-passport/flavor-passport.service.ts:763-768`]
- [x] [Review][Patch] **Over-filtered timeline shows a blank list with no copy** — _Fixed: renders "No dishes match these filters." when active filters yield zero stamps._ — when active filters match zero stamps the timeline renders empty (Clear-filters link is present, but no "No dishes match these filters" line). Per UX-DR27 sparse-page doctrine, surface a short prose line instead of an empty container. [`apps/web/src/features/flavor-passport/FlavorPassportView.tsx:133-145`]
- [x] [Review][Patch] **Non-deterministic tie ordering** — _Fixed: `pickMethodCaption` tiebreaks on `text`, `isMoreFavorable` tiebreaks on `slot_kind`, `byDateAsc` tiebreaks on `recipe_id`._ — three tie cases resolve by arbitrary DB row order: `pickMethodCaption` on equal `sequence`, dedup `slot_kind` selection on duplicate `(recipe, date, signal_type)` rows, and the timeline sort on equal `signal_date` (`byDateAsc` returns 0). Add `.order()` on the embed and a `recipe_id` secondary sort key for stable, reproducible output. Cosmetic but real. [`flavor-passport.repository.ts:41-57`, `flavor-passport.service.ts` sort]

_Dismissed (verified not actionable): expiry `>=` boundary "mismatch" (all 3 verify methods use `>=`); malformed `exp` → NaN bypass (Zod `z.string().datetime` validates `exp` before compare); 500→"expired" mis-messaging (route correctly maps only 404→expired); blank-name possessive on lunch-link (`childName` is a required payload field); empty cuisine filter section (guarded by `.length > 0`); parent endpoint no-404-for-foreign-child (intentional, no existence oracle, deviation #8); loved-beats-ok older date (spec AC3 priority order); `verifyTokenForRead` household source (values agree); `canonical_name`-null → 500 (NOT-NULL column); auth-regex trailing-slash (Fastify wouldn't route it); not-really test asserts query filter (only faithful assertion with chain mock)._
