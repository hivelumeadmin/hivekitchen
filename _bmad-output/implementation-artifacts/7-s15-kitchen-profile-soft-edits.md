# Story 7-S15: Kitchen Profile — Lumi-Conversational Soft Edits (Phase 2)

Status: done

Epic: 7 — Visible Memory & Trust Controls (post-retro addition)
Source: Brainstorming session `_bmad-output/brainstorming/brainstorming-session-2026-06-19-1553.md` (2026-06-19)
Builds on: 7-s14 (Phase 1 — parent-deterministic safety edits, done), 2.5-s11 (kitchen-profile live data read, done)
Design-decisions-in: this file (brainstorm marked Phase 2 as carrying its own design work)

> **Why this exists:** The brainstorm established a per-data-class split: safety data (allergens, non-negotiable cultural rules) is parent-deterministic (Phase 1, done). Soft/narrative data — starting-line favorites, cultural identity state (which identities are active), and shared-tastes prose — is Lumi-conversational. Those three data classes are still wired to `noop`/`logComposite` stubs. This slice replaces those stubs.

---

## Decision context — Phase 2 design (settled here)

The brainstorm deferred the mechanism ("how Lumi maps an NL composite to structured writes"). That design is settled in this story:

| Data class | Edit mechanism | LLM in path? |
|---|---|---|
| Starting-line favorites | Deterministic — component computes `nextValue.items` | **No** |
| Cultural identity chip state (activate / deactivate) | Deterministic — component computes `nextValue.cultural` delta | **No** |
| Shared-tastes prose | Lumi-conversational — NL note from `IdentityEditConversation` → `POST /v1/lumi/turns` → LumiAgent tool | **Yes** |

**Why favorites and chip-state are deterministic:** The `IdentityEditConversation` and `StartingLineEditConversation` components already compute structured output (`nextValue`). The user selected chips; the component tracked those selections. No interpretation required. Sending them through Lumi would add latency, cost, and failure modes for information that is already structured.

**Why shared-tastes uses Lumi:** The `[Message]` section in the identity composite is free-text prose ("we keep heat mild for the kids"). There is no deterministic parser for that. Lumi is the right interpreter, and the result maps to `food_preferences` rows (household-level, `child_id = null`). One new tool on LumiAgent handles this.

**Architectural note:** This story adds tool-calling to `LumiAgent` for the first time, but scopes it narrowly. Only one tool is exposed on the `kitchen_profile` surface: `food_preference.declare`. The tool-calling loop (call → check finish_reason → execute → append → call again) lives in `lumi.service.ts`, keeping `LumiAgent` DB-unaware.

---

## Story

As a Primary Parent,
I want to update my kitchen's starting-line favorites, add or remove cultural identity elements, and describe my household's shared food tastes in plain language on the Kitchen Profile page,
so that Lumi's weekly plans reflect my family's soft preferences without me filling out a form.

---

## Scope

**IN (this slice):**
1. Starting-line favorites — `StartingLineCard` / `StartingLineEditConversation` → `PUT /v1/households/:id/favorite-lunches` (replace-semantics) → `household_recipe_usage + recipes`.
2. Cultural identity chip state — chip adds/removes from `IdentityEditConversation` → `PATCH /v1/households/:id/cultural-priors/state` (keyed by `key` string, reuses existing `CulturalPriorService` state machine).
3. Shared-tastes prose — `[Message]` section of the identity composite → `POST /v1/lumi/turns` (`surface: 'kitchen_profile'`) → LumiAgent calls `food_preference.declare` tool → `food_preferences` rows updated.
4. Kitchen map refresh — after any successful write in this slice, the kitchen map re-fetches (optimistic update + server reconcile, same pattern as Phase 1).

**OUT (Phase 3 / later):**
- `ChildProfileCard` soft edits (child-level loves/avoids, bag composition) — separate story.
- Schools and Calendar sections — still static.
- Removing/retracting food preferences via Lumi (Phase 2 adds only; retract is Phase 3).
- `secondary_caregiver` write access — primary-parent-only for all soft edits (mirrors Phase 1).

---

## Key codebase facts (verified 2026-06-19 — read before implementing)

### Arc A — Starting-line favorites

- ⚠️ **`favorite_lunches` table was DROPPED** (migration `20260908000200_2_6_s1_drop_favorite_lunches.sql`). Favorites now live in **`household_recipe_usage + recipes`**.
- **Write path — add:** `apps/api/src/agents/tools/onboarding.tools.ts:795-857` shows the canonical pattern. Call `recipesRepository.declareForHousehold(householdId, canonicalName)` — creates a `recipes` row (visibility='private') and a `household_recipe_usage` row. Returns `recipes.id`.
- **Write path — remove:** No existing remove method. Need a new `RecipesRepository.revokeHouseholdFavorite(householdId, canonicalName)` — delete the `household_recipe_usage` row for a given household + canonical recipe name. Do NOT delete the `recipes` row (may be referenced elsewhere). Use `canonical_name` as the lookup key.
- **Cache:** `household_recipe_usage` has `bump_kitchen_map_from_recipe_usage()` trigger (migration `20260908000100`) — cache bust is **FREE**.
- **`StartingLineEditConversation.nextValue`** shape: `{ count, target, items: string[] }` — `items` is the FULL desired list after the user's chip interactions. Use it as replace-semantics (diff against existing on the server; add missing, remove extras).
- ⚠️ **`RecipesRepository` location:** `apps/api/src/modules/recipes/` — verify exact filename before implementing.
- **Kitchen map field:** `kitchenMap.favorite_lunches: KitchenMapFavoriteLunch[]` — each has `{ item: string, provenance: CatalogProvenance, position: number }`. `item` is `canonical_name`. After a successful `PUT`, update optimistically and re-fetch to get fresh positions from the server.

### Arc B — Cultural identity chip state

- **Existing ratify endpoint:** `PATCH /v1/households/:id/cultural-priors/:priorId` with body `{ action: 'opt_in' | 'forget' }` (`cultural-prior.routes.ts:48`). It takes a UUID priorId. The `IdentityEditConversation` tracks chips by `key` string (e.g., `'south_asian'`), NOT by priorId.
- ⚠️ **`KitchenMapActivePrior` does NOT expose `id`** — only `key, label, state, tier, confidence, presence, enforcement`. So we CANNOT call the existing ratify endpoint from the web layer without knowing priorId.
- **New endpoint needed:** `PATCH /v1/households/:id/cultural-priors/state` with body `{ key, action }`. Route looks up priorId from `CulturalPriorRepository.findByKeyForHousehold(householdId, key)` (new method — household-scoped lookup by `key` column), then delegates to `CulturalPriorService.handle(priorId, householdId, action)`. 404 if key not found (no existence leak).
- **⚠️ Route conflict risk:** The existing ratify endpoint has path `/:id/cultural-priors/:priorId`. The new endpoint path `/:id/cultural-priors/state` must be registered BEFORE `/:id/cultural-priors/:priorId` so Fastify/regex routing doesn't match `state` as a UUID priorId. Verify route registration order.
- **Reuse:** `CulturalPriorService.handle()` already handles idempotent `opt_in` (→ `opt_in_confirmed`) and `forget` (→ `forgotten`) with audit writes. No duplication needed.
- **Cache:** `cultural_priors_bump_kitchen_map` trigger — FREE.
- **Web delta computation:** `handleIdentityComposite` computes the delta client-side: compare current `kitchenMap.cultural.active[].key` set against `nextValue.cultural[].key` set. Keys in `nextValue` but NOT in current = `opt_in` calls. Keys in current but NOT in `nextValue` = `forget` calls. Enforcement changes from `nextValue.cultural` are handled by the Phase 1 PATCH enforcement endpoint (already wired).

### Arc C — Shared-tastes via LumiAgent

- **What shared-tastes IS:** `synthesizeSharedTastes(kitchenMap.food_preferences.filter(p => p.child_id === null))` in `kitchen-profile.tsx` derives the prose string from household-level `food_preferences` rows. Editing shared tastes = creating/updating `food_preferences` rows with `child_id = null`.
- **`FoodPreferencesRepository.declare()`** (`apps/api/src/modules/food-preferences/food-preferences.repository.ts`) upserts on `(household_id, child_id, item_hash)`. Columns: `household_id`, `child_id` (null = household), `item` (AES-256-GCM ciphertext), `item_hash`, `valence`, `enforcement`, `source`.
- **Cache:** `food_preferences_bump_kitchen_map` trigger — FREE.
- **`LumiAgent.respond()` currently has NO tools** — single `openai.chat.completions.create` call, no `tools` array, no tool-call loop.
- **Tool-calling loop to add** in `LumiAgent.respond()` (or extracted to `LumiService`):
  ```
  while true:
    response = create(messages, tools?)
    if finish_reason === 'tool_calls':
      for each tool_call: execute tool, append result message
      continue
    else:
      break
  return final text
  ```
  The clean split: `LumiAgent` handles the loop; `LumiService` provides the tool executor callback so LumiAgent stays DB-unaware.
- **New tool: `food_preference.declare`** — exposed only when `surface === 'kitchen_profile'`. Params: `{ item: string, valence: 'loves'|'likes'|'neutral'|'dislikes'|'refuses', enforcement: EnforcementLevel }`. Service executor calls `FoodPreferencesRepository.declare({ household_id, child_id: null, item, valence, enforcement, source: 'parent_edited' })`.
- **`LumiSurfaceSchema`** (`packages/contracts/src/lumi.ts:8`) — add `'kitchen_profile'` to the enum. This is a backward-compatible extension.
- **`[Message]` extraction:** `handleIdentityComposite` checks if composite contains `\n[Message]\n`. If yes, post the composite to `POST /v1/lumi/turns`; if no (user only made chip selections with no free-text note), skip the Lumi call — chip writes still proceed.
- **Lumi response display:** `IdentityEditConversation` already has a `lumiResponse?: string` prop (or similar — verify) for displaying Lumi's reply in the panel. If not present, add it and display the response text below the chip selectors.
- ⚠️ **Allergen / PII in food preferences:** The `item` field is AES-256-GCM encrypted (matches the household DEK pattern). `FoodPreferencesRepository.declare()` already handles encryption. Do NOT log the item value; it is PII. `item_hash` is safe to log.

### Component → handler wiring

Current stubs in `apps/web/src/routes/(app)/kitchen-profile.tsx`:
```ts
// Line ~204 — KitchenIdentityCard
onSendComposite={(c) => logComposite('Identity', c)}
// nextValue (IdentityEditValue) is silently dropped — wrong

// Line ~241 — StartingLineCard
onSendComposite={(c) => logComposite('Starting line', c)}
// nextValue (StartingLine) is silently dropped — wrong
```

Replace both with two-arg handlers:
```ts
onSendComposite={(composite, nextValue) => handleIdentityComposite(composite, nextValue)}
onSendComposite={(composite, nextValue) => handleFavoritesComposite(composite, nextValue)}
```

---

## Contracts (AC1)

**New file:** `packages/contracts/src/kitchen-profile-soft-edit.ts`

```ts
import { z } from 'zod';

// --- Cultural chip state (Arc B) ---
const CulturalStateActionSchema = z.enum(['opt_in', 'forget']);

export const SetCulturalStateRequestSchema = z.object({
  key: z.string().min(1).max(64),
  action: CulturalStateActionSchema,
});
export type SetCulturalStateRequest = z.infer<typeof SetCulturalStateRequestSchema>;

export const SetCulturalStateResponseSchema = z.object({
  key: z.string(),
  state: z.string(), // forward-compat; the state enum lives in cultural.ts
});
export type SetCulturalStateResponse = z.infer<typeof SetCulturalStateResponseSchema>;

// --- Starting-line favorites (Arc A) ---
export const SetFavoriteLunchesRequestSchema = z.object({
  items: z.array(z.string().min(1).max(128)).max(10),
});
export type SetFavoriteLunchesRequest = z.infer<typeof SetFavoriteLunchesRequestSchema>;

export const SetFavoriteLunchesResponseSchema = z.object({
  items: z.array(z.string()), // canonical_name strings in order
});
export type SetFavoriteLunchesResponse = z.infer<typeof SetFavoriteLunchesResponseSchema>;
```

Add `export * from './kitchen-profile-soft-edit.js'` to `packages/contracts/src/index.ts` and re-export inferred types from `packages/types/src/index.ts`.

Also extend `LumiSurfaceSchema` in `packages/contracts/src/lumi.ts` to include `'kitchen_profile'`.

Round-trip tests in `packages/contracts/src/kitchen-profile-soft-edit.test.ts`:
- `SetCulturalStateRequestSchema` accepts `{ key: 'halal', action: 'opt_in' }`, rejects unknown action, rejects empty key.
- `SetFavoriteLunchesRequestSchema` accepts array of strings up to 10 items, rejects 11 items, rejects `''`.
- `LumiSurfaceSchema` accepts `'kitchen_profile'`.

---

## API

### AC2 — Repo: `CulturalPriorRepository.findByKeyForHousehold`

**File:** `apps/api/src/modules/cultural-priors/cultural-prior.repository.ts`

```ts
// Returns the row for a given (householdId, key) pair, or null if not found or
// belongs to another household. Used by the key-addressed state endpoint.
async findByKeyForHousehold(householdId: string, key: string): Promise<CulturalPriorRow | null>
```
`.eq('household_id', householdId).eq('key', key).maybeSingle()`.

### AC3 — API: `PATCH /v1/households/:id/cultural-priors/state`

**File:** `apps/api/src/modules/households/kitchen-profile-edit.routes.ts` (extend existing file from Phase 1).

- `preHandler: requirePrimaryParent`.
- Param `id` must match `request.user.household_id` → 404 if not (no existence leak).
- Body: `SetCulturalStateRequestSchema`.
- Call `culturalPriors.findByKeyForHousehold(householdId, key)` → 404 if null.
- Delegate to `CulturalPriorService.handle({ priorId: found.id, householdId, action })`.
- Return `{ key: found.key, state: result.prior.state }`.
- ⚠️ Register this route BEFORE the existing `/:id/cultural-priors/:priorId` ratify route in `app.ts` (or in the same file, the new route file registers first) to avoid `state` matching the UUID param pattern.
- `PII-free auditContext`: mirror the existing ratify audit shape — `metadata: { prior_id, key, action }`.

### AC4 — Repo: `RecipesRepository.revokeHouseholdFavorite`

**File:** `apps/api/src/modules/recipes/` (verify exact repo class name).

```ts
// Removes the household_recipe_usage association for a given recipe name.
// Does NOT delete the recipes row — the recipe may be referenced by plans.
// No-op if the association doesn't exist (replace-semantics caller handles idempotency).
// Trigger busts kitchen_map_version.
async revokeHouseholdFavorite(householdId: string, canonicalName: string): Promise<void>
```
DELETE from `household_recipe_usage` WHERE `household_id = householdId` AND recipe_id IN (SELECT id FROM recipes WHERE canonical_name = canonicalName AND household_id = householdId).

### AC5 — API: `PUT /v1/households/:id/favorite-lunches`

**New route** in `kitchen-profile-edit.routes.ts`.

- `preHandler: requirePrimaryParent`.
- Param `id` must match `request.user.household_id` → 404 if not.
- Body: `SetFavoriteLunchesRequestSchema`.
- Logic (diff and replace):
  1. Fetch current favorites: `recipesRepository.findHouseholdFavorites(householdId)` → `string[]` of canonical names.
  2. Items in request NOT in current → `declareForHousehold(householdId, item)` for each.
  3. Items in current NOT in request → `revokeHouseholdFavorite(householdId, item)` for each.
  4. Return `SetFavoriteLunchesResponseSchema` with the new list (re-read after mutations to get correct positions).
- If `recipesRepository.findHouseholdFavorites` doesn't exist yet, add it (SELECT canonical_name FROM recipes JOIN household_recipe_usage USING (id) WHERE household_id = householdId ORDER BY position / created_at).
- PII-free audit: `{ event_type: 'household.profile_updated', metadata: { subject: 'favorite_lunches', added: N, removed: M } }` — canonical names are NOT logged (they are household data).

### AC6 — LumiAgent tool-calling for `kitchen_profile` surface

**Files:** `apps/api/src/agents/lumi.agent.ts`, `apps/api/src/modules/lumi/lumi.service.ts`.

**`LumiAgent.respond()` signature change:**
```ts
type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<string>;

async respond(
  history: ConversationMessage[],
  toolExecutor?: ToolExecutor,
  tools?: openai.Chat.ChatCompletionTool[],
): Promise<string>
```
Internal loop:
```ts
const msgs = [...history];
while (true) {
  const res = await this.openai.chat.completions.create({ model, messages: msgs, tools });
  const choice = res.choices[0];
  if (choice.finish_reason !== 'tool_calls' || !toolExecutor) {
    return choice.message.content ?? '';
  }
  msgs.push(choice.message);
  for (const tc of choice.message.tool_calls ?? []) {
    const result = await toolExecutor(tc.function.name, JSON.parse(tc.function.arguments));
    msgs.push({ role: 'tool', tool_call_id: tc.id, content: result });
  }
}
```

**`LumiService.handleTurn()`** — when `surface === 'kitchen_profile'`:
- Define `KITCHEN_PROFILE_TOOLS` (one tool):
  ```ts
  {
    type: 'function',
    function: {
      name: 'food_preference.declare',
      description: 'Record a household food preference from the parent's shared-tastes note.',
      parameters: {
        type: 'object',
        properties: {
          item: { type: 'string', description: 'Food item name (plain text, will be encrypted at rest)' },
          valence: { type: 'string', enum: ['loves', 'likes', 'neutral', 'dislikes', 'refuses'] },
          enforcement: { type: 'string', enum: ['non_negotiable', 'strong', 'default', 'soft', 'just_for_context'] },
        },
        required: ['item', 'valence', 'enforcement'],
      },
    },
  }
  ```
- Define `toolExecutor`: when `name === 'food_preference.declare'`, call `FoodPreferencesRepository.declare({ household_id, child_id: null, item: args.item, valence: args.valence, enforcement: args.enforcement, source: 'parent_edited' })`. Return `JSON.stringify({ declared: true })`.
- Pass `KITCHEN_PROFILE_TOOLS` and the executor to `lumiAgent.respond()`.
- ⚠️ **PII guard:** Do NOT log `args.item` from the tool call — it is household food data. Log only `{ tool: 'food_preference.declare', household_id }`.
- For all other surfaces, pass no tools (existing behavior unchanged).

---

## Web

### AC7 — `handleFavoritesComposite` in `kitchen-profile.tsx`

```ts
async function handleFavoritesComposite(composite: string, nextValue: StartingLine) {
  const householdId = user.current_household_id;

  // Optimistic update
  setKitchenMap((m) => {
    if (m === null) return m;
    return {
      ...m,
      favorite_lunches: nextValue.items.map((item, i) => ({
        item,
        provenance: 'parent_added' as const,
        position: i,
      })),
    };
  });

  const res = await hkFetch<SetFavoriteLunchesResponse>(
    `/v1/households/${householdId}/favorite-lunches`,
    { method: 'PUT', body: { items: nextValue.items } },
  );

  if (res === undefined) {
    // revert
    setKitchenMap(originalMap);
    setEditError('Could not update favorites.');
    return;
  }

  // Reconcile with server (positions may differ)
  setKitchenMap((m) => {
    if (m === null) return m;
    return {
      ...m,
      favorite_lunches: res.items.map((item, i) => ({ item, provenance: 'parent_added' as const, position: i })),
    };
  });
}
```

Use try/catch + revert pattern (same as `handleAddAllergen` in Phase 1).

### AC8 — `handleIdentityComposite` in `kitchen-profile.tsx`

```ts
async function handleIdentityComposite(composite: string, nextValue: IdentityEditValue) {
  const householdId = user.current_household_id;

  // 1. Cultural chip state delta (deterministic)
  const currentKeys = new Set(kitchenMap?.cultural.active.map((p) => p.key) ?? []);
  const nextKeys = new Set(nextValue.cultural.map((c) => c.key));

  const toAdd = [...nextKeys].filter((k) => !currentKeys.has(k));
  const toRemove = [...currentKeys].filter((k) => !nextKeys.has(k));

  await Promise.allSettled([
    ...toAdd.map((key) =>
      hkFetch(`/v1/households/${householdId}/cultural-priors/state`, {
        method: 'PATCH',
        body: { key, action: 'opt_in' },
      }),
    ),
    ...toRemove.map((key) =>
      hkFetch(`/v1/households/${householdId}/cultural-priors/state`, {
        method: 'PATCH',
        body: { key, action: 'forget' },
      }),
    ),
  ]);

  // Enforcement changes are already wired via Phase 1 handleSetEnforcement — no duplicate call needed.

  // 2. Shared-tastes via Lumi — only when composite has a [Message] section
  if (composite.includes('\n[Message]\n')) {
    const lumiRes = await hkFetch<LumiTurnResponse>('/v1/lumi/turns', {
      method: 'POST',
      body: { message: composite, context_signal: { surface: 'kitchen_profile' } },
    });
    if (lumiRes) {
      setIdentityLumiResponse(lumiRes.lumi_turn.body.type === 'message' ? lumiRes.lumi_turn.body.content : null);
    }
  }

  // 3. Re-fetch kitchen map (triggers catch updated food_preferences + cultural state)
  const fresh = await hkFetch<KitchenMap>(`/v1/kitchen-map`);
  if (fresh) setKitchenMap(fresh);
}
```

Notes:
- `Promise.allSettled` so one chip failure doesn't abort others; log individual failures.
- `setIdentityLumiResponse` = local state to pass the Lumi reply to `KitchenIdentityCard` for display.
- The re-fetch at the end catches both food_preferences changes (from Lumi tool) and cultural state changes.

### AC9 — `KitchenIdentityCard` — display Lumi response

`KitchenIdentityCard` should accept an optional `lumiResponse?: string` prop. When set, display it below the cultural chips / shared-tastes section — a calm one-liner in Lumi's voice confirming the update. Remove it on next panel open.

If `IdentityEditConversation` already has a `lumiResponse` prop (verify), wire through. If not, add it.

---

## Tests

### AC10 — API tests

**Cultural-state endpoint** (`kitchen-profile-edit.routes.test.ts` — extend Phase 1 file):
- `PATCH /state` opt_in happy path — 200, body `{ key, state: 'opt_in_confirmed' }`
- `PATCH /state` forget happy path — 200, body `{ key, state: 'forgotten' }`
- 404 when key not found for household
- 404 cross-household (no-existence-leak)
- 401 unauthenticated
- 403 secondary_caregiver

**Favorites endpoint** (`kitchen-profile-edit.routes.test.ts`):
- `PUT /favorite-lunches` happy path — items added and removed, 200 with new list
- `PUT /favorite-lunches` empty list — removes all existing favorites, 200 `{ items: [] }`
- 401 unauthenticated
- 403 secondary_caregiver

**LumiService kitchen_profile tools** (`lumi.service.test.ts` or a targeted file):
- When surface='kitchen_profile' and Lumi returns `finish_reason: 'tool_calls'` for `food_preference.declare`, service calls `FoodPreferencesRepository.declare()` and passes tool result back, then returns final text.
- Mock `openai.chat.completions.create` to emit a tool_call response first, then a text response second.

### AC11 — Web tests (`kitchen-profile.test.tsx` — extend Phase 1 file)

- **Favorites update:** user sends StartingLine composite → `PUT /v1/households/:id/favorite-lunches` called with `{ items: [...] }` → DOM reflects new list.
- **Favorites revert on failure:** server returns error → optimistic update reverted → original list restored.
- **Cultural state add:** identity composite with new key in `nextValue.cultural` → `PATCH /cultural-priors/state` called with `{ key, action: 'opt_in' }`.
- **Cultural state remove:** identity composite with removed key → `PATCH /cultural-priors/state` called with `{ key, action: 'forget' }`.
- **Lumi response displays:** identity composite with `[Message]` section → `POST /v1/lumi/turns` called → Lumi response text appears in identity panel.
- **No Lumi call when no `[Message]`:** chip-only change (no prose note) → `/v1/lumi/turns` NOT called.

### AC12 — Typecheck

`pnpm typecheck` clean for all changed files (contracts, types, API, web). Pre-existing baseline errors are out of scope.

---

## Tasks (implementation order)

1. **Contracts** — `kitchen-profile-soft-edit.ts` + index exports + types re-export + extend `LumiSurfaceSchema` + round-trip tests.
2. **API: repo additions** — `CulturalPriorRepository.findByKeyForHousehold` + `RecipesRepository.revokeHouseholdFavorite` + `RecipesRepository.findHouseholdFavorites`.
3. **API: cultural-state route** — `PATCH /v1/households/:id/cultural-priors/state` in `kitchen-profile-edit.routes.ts`. Verify route registration order.
4. **API: favorites route** — `PUT /v1/households/:id/favorite-lunches` in `kitchen-profile-edit.routes.ts`.
5. **API: LumiAgent tool-calling** — extend `LumiAgent.respond()` with tool loop; add `KITCHEN_PROFILE_TOOLS` and tool executor in `lumi.service.ts`.
6. **Web: `handleFavoritesComposite`** — replace `logComposite('Starting line', ...)` stub.
7. **Web: `handleIdentityComposite`** — replace `logComposite('Identity', ...)` stub.
8. **Web: `KitchenIdentityCard` Lumi response display** — add/wire `lumiResponse` prop.
9. **Tests** — API routes, LumiService tool-call loop, web interaction tests.
10. **Typecheck sweep** — contracts, types, API, web.

---

## Open questions (to resolve at implementation time)

**OQ-1:** Does `IdentityEditConversation` currently expose a `lumiResponse` prop? If yes, wire directly. If no, add `lumiResponse?: string | null` to its props.

**OQ-2:** What is the exact class name and file for the favorites/recipe repository? `onboarding.tools.ts` references `deps.recipesRepository` — find the class declaration.

**OQ-3:** `Promise.allSettled` is used for chip-state calls in `handleIdentityComposite`. Should partial failures be surfaced as an inline error? For Phase 2: yes — if any settle to rejected, show a generic "Some identity changes could not be saved" inline error and refresh the map to show the actual server state.

**OQ-4:** `LumiAgent.respond()` currently returns `string`. Adding `toolExecutor` and `tools` as optional params maintains the existing call sites unchanged (they pass neither). Verify no TypeScript overload conflict with the existing `generateNudge()` method.

**OQ-5:** Should `handleIdentityComposite` be fire-and-forget for the Lumi call (show a spinner in the panel and update on resolve), or blocking? Phase 2: show a loading state in the IdentityEditConversation panel after send, resolve on the Lumi turn response.

---

## Review notes (for code-review phase)

- Cultural-state route must be registered before the UUID-param ratify route to prevent routing ambiguity.
- `food_preference.declare` tool executor must NOT log the `item` value — it is encrypted PII at rest.
- The `Promise.allSettled` in `handleIdentityComposite` must not swallow all errors silently — surface partial failures to the user.
- LumiAgent loop must have a hard cap on tool-call iterations (max 5) to prevent runaway loops in case of malformed LLM output.
- The kitchen map re-fetch in `handleIdentityComposite` happens AFTER the Lumi turn completes — this means if Lumi's `food_preference.declare` tool wrote new rows, they will appear in the fresh map. This is correct.

---

## Dev Agent Record

### Implementation Plan (as executed)
All 3 arcs shipped end-to-end. Tasks 1–10 complete.

### Key reconciliations (story spec ↔ codebase)
- **Surface name** — story says `kitchen_profile` (snake_case); every other multi-word `LumiSurfaceSchema` member is kebab-case (`meal-detail`, `child-profile`, `heart-note`). Shipped as **`kitchen-profile`** (kebab) for consistency, applied uniformly across contract enum, `getSurfacePrompt` map, LumiService, and web. `getSurfacePrompt` map is `Record<LumiSurface,…>` (exhaustive) → added `'kitchen-profile': childProfile`.
- **OpenAI tool name** — OpenAI function names cannot contain dots; mirrored `OnboardingAgent`'s convention: internal `food_preference.declare` → wire `food_preference__declare`. LumiService owns the wire name; LumiAgent is naming-agnostic (passes `tc.function.name` to the executor verbatim).
- **`FoodPreferencesRepository.declare`** — actual signature is **positional** `(householdId, childId, item, valence, enforcement, source)`, not the object form in the story snippet. Executor calls it positionally with `child_id: null` (household-scoped).
- **`CulturalPriorService`** — exposes `ratify({ householdId, priorId, action })`, not `handle(...)`. New `/state` route resolves `priorId` via the new `CulturalPriorRepository.findByKeyForHousehold`, then delegates to `ratify`. `opt_in`/`forget` never touch threads/agent (only `tell_lumi_more` does), so wiring the service constructor's `threads`/`agent` deps is harmless.
- **Route registration order** — Fastify routes the static `/cultural-priors/state` segment ahead of the parametric `/cultural-priors/:priorId` regardless of plugin registration order, so the story's ordering concern is a non-issue; existing order kept.
- **Favorites storage** — `favorite_lunches` table was dropped (2.6-s1); favorites live in `recipes + household_recipe_usage`. `findHouseholdFavorites` mirrors the KitchenMap `projectFavoriteLunchesFromUsage` qualification (not banned AND (is_household_favorite OR provenance ∈ {declared, parent_added})). `revokeHouseholdFavorite` deletes only the `household_recipe_usage` row (never the `recipes` row). Diff is normalized + case-insensitive via the new exported `canonicalizeFavoriteName` helper (refactored out of `declareForHousehold`).
- **Web `lumiResponse`** — `IdentityEditConversation` had no `lumiResponse` prop (OQ-1); added it (rendered via the existing `EditConversation` `prose` slot) plus a read-mode line on `KitchenIdentityCard`.
- **`hkFetch`** — its method union lacked `PUT`; added it. `LumiTurnResponse` was not re-exported from `@hivekitchen/types`; added it.
- **Kitchen-map re-fetch path** — story AC8 used `/v1/kitchen-map`; actual route is household-scoped `/v1/households/:id/kitchen-map` (matches the page's initial load).

### Completion Notes
- **Arc A** — contracts `SetFavoriteLunches*`; `RecipesRepository.findHouseholdFavorites` + `revokeHouseholdFavorite` + exported `canonicalizeFavoriteName`; `PUT /v1/households/:id/favorite-lunches` (replace-semantics diff, PII-free `{added,removed}` audit); web `handleFavoritesComposite` (optimistic + revert).
- **Arc B** — contracts `SetCulturalState*`; `CulturalPriorRepository.findByKeyForHousehold`; `PATCH /v1/households/:id/cultural-priors/state` (reuses `CulturalPriorService.ratify`, `template.state_changed` audit on real transitions); web delta in `handleIdentityComposite` (opt_in for added keys, forget for dropped keys, `Promise.allSettled`).
- **Arc C** — `LumiSurfaceSchema` += `kitchen-profile`; `LumiAgent.respond` tool-call loop (cap 5, tool errors returned as JSON, single-shot path byte-for-byte unchanged when no tools); `KITCHEN_PROFILE_TOOLS` + Zod-validated executor in LumiService (optional `foodPreferencesRepository` dep — nudge-job ctor unaffected; `item` never logged); web posts the `[Message]` composite to `POST /v1/lumi/turns` and displays Lumi's reply.
- **Tests** — contracts 9; API route 24 (10 new: 6 cultural-state + 4 favorites); LumiService 37 (4 new kitchen-profile tool-wiring; 1 pre-existing enrichment baseline fail, confirmed on HEAD via git stash); LumiAgent +2 tool-loop; web 13 (5 new). `pnpm typecheck` clean across contracts/types/api/web.

### File List
**Contracts / types**
- `packages/contracts/src/kitchen-profile-soft-edit.ts` (new)
- `packages/contracts/src/kitchen-profile-soft-edit.test.ts` (new)
- `packages/contracts/src/index.ts` (export new file)
- `packages/contracts/src/lumi.ts` (`LumiSurfaceSchema` += `kitchen-profile`)
- `packages/types/src/index.ts` (re-export soft-edit types + `LumiTurnResponse`)

**API**
- `apps/api/src/modules/recipe/recipes.repository.ts` (`findHouseholdFavorites`, `revokeHouseholdFavorite`, exported `canonicalizeFavoriteName`, `FAVORITE_LUNCH_PROVENANCES`)
- `apps/api/src/modules/cultural-priors/cultural-prior.repository.ts` (`findByKeyForHousehold`)
- `apps/api/src/modules/households/kitchen-profile-edit.routes.ts` (PATCH `/cultural-priors/state` + PUT `/favorite-lunches`)
- `apps/api/src/modules/households/kitchen-profile-edit.routes.test.ts` (+10 tests, mock extensions)
- `apps/api/src/agents/lumi.agent.ts` (tool-call loop + input fields)
- `apps/api/src/agents/lumi.agent.test.ts` (+2 loop tests, surface smoke +kitchen-profile)
- `apps/api/src/agents/prompts/surfaces/index.ts` (`kitchen-profile` → childProfile)
- `apps/api/src/modules/lumi/lumi.service.ts` (tool defs, executor, optional foodPreferencesRepository dep, surface wiring)
- `apps/api/src/modules/lumi/lumi.service.test.ts` (+4 tool-wiring tests, buildDeps support)
- `apps/api/src/modules/lumi/lumi.routes.ts` (construct + inject FoodPreferencesRepository)

**Web**
- `apps/web/src/lib/fetch.ts` (method union += `PUT`)
- `apps/web/src/routes/(app)/kitchen-profile.tsx` (edit-mode state, `handleFavoritesComposite`, `handleIdentityComposite`, card wiring)
- `apps/web/src/routes/(app)/kitchen-profile.test.tsx` (+5 tests)
- `apps/web/src/features/kitchen-profile/components/KitchenIdentityCard.tsx` (`lumiResponse` prop + read-mode line)
- `apps/web/src/features/kitchen-profile/components/IdentityEditConversation.tsx` (`lumiResponse` prop via `prose` slot)

### Change Log
- 2026-06-19 — 7-S15 implemented (dev-story): Kitchen Profile Lumi-conversational soft edits (Phase 2) — Arc A favorites (deterministic), Arc B cultural chip state (deterministic), Arc C shared-tastes prose (first LumiAgent tool-calling). NO migration, NO new deps. Status → review. Sprint-status corrected `ready`→`ready-for-dev` before pickup.

---

## Review Findings (code review 2026-06-19 — 3-layer adversarial: Blind / Edge / Auditor)

- [x] [Review][Decision→Dismissed] Locked `non_negotiable` cultural prior can be forgotten from the edit panel — **RESOLVED 2026-06-19 (Menon): intended, no change.** Parents are the editors of record and must be able to correct/retract anything they agreed to during onboarding, including a hard rule (e.g. removing Hindu vegetarian if it's surfacing wrong recipes). The forget transition already writes a `template.state_changed` audit row (PII-free: prior_id + key + state codes), so corrections are logged/traceable. Original finding: read-mode hides the enforcement selector for locked chips but the edit panel's CurrentChip renders a Drop for every chip; `handleIdentityComposite`/route/`ratify` forget with no `non_negotiable` guard. (edge)
- [x] [Review][Decision→Dismissed] Active-only cultural delta semantics — **RESOLVED 2026-06-19 (Menon): dismissed, theoretical-only.** Per the real data flow, onboarding writes cultural priors as CONFIRMED (`active`/`opt_in_confirmed`) — finalizing onboarding IS the agreement — so the `suggested` bucket is empty on the Kitchen Profile in practice. With all chips `active`, `currentKeys` (active-only) equals the full chip set, so the delta is correct: dropping a chip → `forget`, adding a new one → `opt_in`. The flagged behaviors (kept suggestion auto-confirms; dropped suggestion is a no-op) require a `suggested`-state row on this surface, which does not occur. NOTE: if a future feature ever surfaces lingering `suggested` priors here, revisit the delta to base `currentKeys` on active+suggested. Original finding: `currentKeys` built from `active` only while chips merge active+suggested. (edge)
- [x] [Review][Patch] Partial chip-state failures swallowed — **FIXED 2026-06-19.** `handleIdentityComposite` now inspects `Promise.allSettled` results; on any rejection it sets `identityEditError` ("Some identity changes could not be saved."), threaded through `KitchenIdentityCard`→`IdentityEditConversation` and rendered as a `role=alert` in the edit panel (cleared on re-open + at send start). +1 web test. [apps/web/src/routes/(app)/kitchen-profile.tsx + KitchenIdentityCard.tsx + IdentityEditConversation.tsx] (blind+auditor)
- [x] [Review][Patch] `revokeHouseholdFavorite` ILIKE wildcard injection — **FIXED 2026-06-19.** Now wraps the lookup in `escapeIlikeWildcards(normalized)` so `%`/`_` match literally. (Pre-existing identical unescaped lookups in `declareForHousehold`'s conflict recovery left as-is — pre-existing, behavior-preserving.) [apps/api/src/modules/recipe/recipes.repository.ts revokeHouseholdFavorite] (blind)
- [x] [Review][Defer] Favorites PUT is non-transactional — `declareForHousehold`/`revokeHouseholdFavorite` run as sequential awaits; a mid-loop throw leaves partial DB state and skips the audit (set after both loops). Consistent with the repo-wide non-transactional pattern (`declareForHousehold` is itself best-effort); a true fix needs an RPC. [apps/api/src/modules/households/kitchen-profile-edit.routes.ts] — deferred, repo-wide pattern.
- [x] [Review][Defer] Pre-existing unrelated working-tree edits in the diff — `apps/web/src/lib/fetch.ts` (`setRestored()` in `tryRefreshSession`) + `apps/web/src/stores/auth.store.ts` were already modified before this story (auth session-restore plumbing). Not part of 7-S15; only the `PUT` method-union addition in fetch.ts belongs here. Commit/review separately. — deferred, pre-existing.
