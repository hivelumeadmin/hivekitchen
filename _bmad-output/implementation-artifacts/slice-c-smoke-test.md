# Slice C smoke test — onboarding agent tool wiring

**What we're testing:** the new tool-call loop in `OnboardingAgent` actually
writes structured rows to the household DB during the conversation.

**Time budget:** ~15 minutes including DB inspection.

---

## 0. Preflight

Migrations from slices A0 + A0c + recipes must be applied. Verify:

```bash
pnpm supabase:diff
# Expected: no schema diff. If migrations are pending, run:
pnpm supabase:push
```

If the local Supabase is being used (not the linked remote), use `supabase
db reset` to apply all migrations cleanly.

### Required env

`apps/api/.env.local` must have:

- `OPENAI_API_KEY` — must be a working key.
- `JWT_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — already in place.
- `ELEVENLABS_*` — present for app boot even though voice isn't exercised here.

### Optional (default OK)

- `ONBOARDING_AGENT_TOOLS_ENABLED` — defaults to `true`. Leave unset (or set
  to `true`) for this test. Setting `false` exercises the legacy path.
- `ENVELOPE_ENCRYPTION_MASTER_KEY` — when unset, child rows store as
  NOOP-prefixed base64 (still readable). Fine for dev smoke testing.

---

## 1. Boot the API

```bash
pnpm dev:api
```

On startup, watch the logs for these confirming lines:

```
{"module":"vocabulary","action":"vocabulary.loaded","counts":{"allergens":17,"dietary":23,"cultural":18,"cuisines":60}}
```

If the counts are 0 anywhere, the vocabulary tables didn't seed — re-run
the migration `20260514005000_create_vocabulary_tables.sql`.

---

## 2. Authenticate

You'll need a JWT bound to a real household. Either:

**A.** Use the web app at `pnpm dev:web` → log in → open dev tools →
copy the `Authorization: Bearer ...` header value from a successful API call.

**B.** Use an existing dev user via `psql` / Supabase Studio — find a
`primary_parent` user whose `current_household_id` is non-null, then
hit `POST /v1/auth/login` with that user's email + password.

Save the JWT and household ID:

```bash
export JWT="<paste here>"
export HOUSEHOLD_ID="<paste here>"
```

---

## 3. Capture the pre-state

Before the conversation starts, snapshot the household's current state.

```sql
-- Run in psql or Supabase Studio. Substitute $HOUSEHOLD_ID for your value.

-- 0. Version + completeness baseline
SELECT id, kitchen_map_version FROM households WHERE id = '$HOUSEHOLD_ID';

-- 1. Existing children for this household
SELECT id, age_band, school_policy_notes, allergen_rule_version, created_at, updated_at
FROM children WHERE household_id = '$HOUSEHOLD_ID' ORDER BY created_at;

-- 2. Existing cultural priors
SELECT key, label, state, confidence, presence, created_at
FROM cultural_priors WHERE household_id = '$HOUSEHOLD_ID' ORDER BY created_at;

-- 3. Existing memory nodes
SELECT node_type, facet, subject_child_id, created_at
FROM memory_nodes WHERE household_id = '$HOUSEHOLD_ID'
  AND soft_forget_at IS NULL AND hard_forgotten = false
ORDER BY created_at;
```

Note the `kitchen_map_version` — it should bump after each turn that
writes anything.

---

## 4. Run the conversation

Talk to the agent via the text endpoint. Recommend three turns that exercise
each of the three tools at least once:

### Turn 1 — introduce a child

```bash
curl -X POST http://localhost:3000/v1/onboarding/text/turn \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hi, my daughter Layla is 7 years old and shes peanut-allergic."}'
```

Expected:
- Response body: `{"thread_id":"...","turn_id":"...","lumi_turn_id":"...","lumi_response":"...","is_complete":false}`.
- API logs: `onboarding.text_turn_tools` with `tools_used` including
  `child.upsert` (and ideally `memory.note` for the allergy).
- The conversational reply (`lumi_response`) should warmly acknowledge
  Layla and probe further — **without** narrating the tool call.

### Turn 2 — cultural identity + rhythm

```bash
curl -X POST http://localhost:3000/v1/onboarding/text/turn \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"message": "We are a halal household. Fridays are leftover night — we usually eat biryani made on Thursday."}'
```

Expected:
- API logs: `onboarding.text_turn_tools` with `cultural.note` and
  `memory.note` in the `tools_used` array.

### Turn 3 — refusals + a second hint

```bash
curl -X POST http://localhost:3000/v1/onboarding/text/turn \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"message": "Layla wont touch anything with mushrooms or olives. And she loves yogurt-based snacks."}'
```

Expected:
- Possibly another `memory.note` (or two) — one for the refusals, one
  for the yogurt preference. Could also re-touch `child.upsert` with
  updated dietary_preferences.

---

## 5. Capture the post-state

Run the same SQL queries from Step 3. Compare.

```sql
-- Confirm Layla now exists
SELECT id, age_band, allergen_rule_version
FROM children WHERE household_id = '$HOUSEHOLD_ID';

-- Confirm halal prior (state='suggested')
SELECT key, label, state, confidence, presence
FROM cultural_priors WHERE household_id = '$HOUSEHOLD_ID';

-- Confirm memory nodes for: leftover Friday, mushroom/olive refusal,
-- yogurt preference, peanut allergy
SELECT node_type, facet, prose_text, subject_child_id
FROM memory_nodes WHERE household_id = '$HOUSEHOLD_ID'
  AND soft_forget_at IS NULL AND hard_forgotten = false
ORDER BY created_at;

-- Version should have bumped (multiple times — once per write)
SELECT kitchen_map_version FROM households WHERE id = '$HOUSEHOLD_ID';
```

---

## 6. Smoke-test the Kitchen Map projection

Verify the cached projection actually composes for the household. There's
no public route yet (slice A0.5 only decorates `fastify.kitchenMapService`),
so do it via a quick one-off route or `tsx`:

Option A — quick smoke route (drop into `apps/api/src/app.ts` temporarily):

```ts
// REMOVE BEFORE COMMIT
app.get('/v1/_dev/kitchen-map', { preHandler: authenticateHook }, async (req) => {
  return app.kitchenMapService.get(req.user.household_id);
});
```

Then:

```bash
curl -H "Authorization: Bearer $JWT" http://localhost:3000/v1/_dev/kitchen-map | jq .
```

Expected:
- `meta.is_complete: true`
- `children: [{name: "Layla", declared_allergens: ["peanut"], ...}]`
- `cultural.suggested: [{key: "halal", ...}]`
- `memory.nodes: [{node_type: "rhythm", prose_text: "..."}, ...]`

Option B — script via `tsx`:

```bash
cd apps/api
npx tsx -e "import { buildApp } from './src/app.js'; import { parseEnv } from './src/common/env.js'; const app = await buildApp({ env: parseEnv() }); const map = await app.kitchenMapService.get(process.env.HOUSEHOLD_ID); console.log(JSON.stringify(map, null, 2)); await app.close();"
```

---

## 7. What "passing" looks like

For each turn:

| Signal | Where | What to look for |
|---|---|---|
| Tool calls happened | API log line `onboarding.text_turn_tools` | `tool_count >= 1`, `tool_errors === 0` |
| Database wrote rows | post-state SQL queries | `children` / `cultural_priors` / `memory_nodes` show new rows |
| Cache invalidated | `households.kitchen_map_version` | Higher than baseline |
| Agent reply feels right | conversation `lumi_response` | Warm, doesn't narrate tools, asks a good next question |
| No crashes | full API log scan | No unhandled error stacks; `onboarding.agent_failed` not present |

---

## 8. Common failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| Vocabulary loaded with counts 0 | Vocabulary tables not seeded (migration `20260514005000` skipped) | Re-run migrations: `pnpm supabase:push` |
| `onboarding.text_turn_tools` log line never appears | Feature flag disabled OR tool deps missing | Check `ONBOARDING_AGENT_TOOLS_ENABLED` env. Check service constructor in `onboarding.routes.ts`. |
| Tool errors with "Unknown allergen tag" | Agent emitted a vocabulary key that doesn't exist or is inactive | Either expected (agent self-corrects); persistent — add the missing tag to `allergen_tags` or update prompt |
| `kitchen_map_version` doesn't bump | Triggers didn't fire (migration `20260514000000` skipped) | Re-run migrations |
| `is_complete: false` after 3 turns | No `children` row was created | Look for tool errors in API log; check `child.upsert` actually fired |
| Cannot decrypt: ciphertext is not NOOP-prefixed but DEK is null | Real-encrypted rows exist but KEK isn't loaded | Set `ENVELOPE_ENCRYPTION_MASTER_KEY` in `.env.local` |

---

## 9. Cleanup

After the smoke test, the household has test data in it. If you want a
clean slate for the next run:

```sql
DELETE FROM memory_nodes WHERE household_id = '$HOUSEHOLD_ID';
DELETE FROM cultural_priors WHERE household_id = '$HOUSEHOLD_ID';
DELETE FROM children WHERE household_id = '$HOUSEHOLD_ID';
-- Close any active onboarding threads so the next test starts fresh
UPDATE threads SET status = 'closed' WHERE household_id = '$HOUSEHOLD_ID'
  AND type = 'onboarding' AND status = 'active';
```

If you added the dev smoke route, remove it before committing.
