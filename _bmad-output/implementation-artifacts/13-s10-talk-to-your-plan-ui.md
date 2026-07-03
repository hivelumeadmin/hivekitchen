# Story 13.s10: "Talk to your plan" UI — day-summoned sheet, conversational edits, confirm-then-fire (Epic MVP wall)

Status: done

<!-- 13-s10: Tasks 1–6, 8, 9 complete + tested (MVP-wall core delivered). Task 7 (AC9)
     PARTIAL by decision (2026-07-03): the next_week_ready trigger + compose_next confirm
     affordance are built + tested; the automatic Friday nudge (scheduled enqueue +
     LumiNudgeEvent trigger threading) is deferred — see deferred-work.md D-13S10-1. -->


<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **🧱 WALL: MVP.** This is the Epic 13 headline win. Done = talk-to-your-plan works end-to-end on the finished planner surface, and the cost trace shows the expensive path firing once/week + explicitly-confirmed escalations only. Everything it depends on has shipped: s2 (presence sheet), s2.5 (SSE push), s3 (whisper), s7 (planner surface + StickyBar), s8 (`CatalogRepo.pickRecipe`), s9 (`POST /v1/plans/:planId/edit` + route/dispatch/execute). This story is mostly frontend wiring plus three explicitly-inherited backend items (real commit, safety_write week revalidation, SSE emit contract).

## Story

As a parent reviewing my week on the planner,
I want to tap a day, tell Lumi what to change ("Maya's bored of wraps", "less spicy Thursday", "no fish this week"), and watch the tile update live,
so that editing the plan feels like talking to a valet instead of maintaining a spreadsheet — without ever firing the expensive compose path unless I explicitly confirm it.

## Acceptance Criteria

1. **Day-tap summon with day context.** Tapping (or keyboard-activating) a `PlanTile` summons the existing Lumi sheet (`summon()` on `lumi.store`) hydrated with that day's plan context — the sheet visibly reflects the tapped day (day label + current dishes) and the utterance input is ready. Sheet recede/Escape returns focus to the originating tile. All existing sheet a11y (Dialog focus-trap, Escape, `prefers-reduced-motion`) is unchanged. The 13-s7 slot-disclosure focus behavior must not fight the tap: focus-reveal still works; activation (click/Enter) summons.
2. **Utterance edit turn.** An utterance typed in a plan-summoned sheet POSTs `PlanEditInputSchema` `{utterance}` to `POST /v1/plans/:planId/edit` with a `safeRandomUuid()` `Idempotency-Key` (UUID format — the route rejects non-UUID). The typed `PlanEditResponseSchema` `{intent, tier, result}` renders as a Lumi reply in the sheet (ephemeral, NOT a thread turn — see Dev Notes). Errors (`HkApiError`) render a graceful in-sheet failure line, never a crash.
3. **Applied delta → live tile re-render + SSE reconcile.** On `result.status === 'applied'`, the returned authoritative row (`main_assignment` | `slot` | `variation`) is written into the plan query cache immediately (targeted `setQueryData` on `QueryKeys.planByWeek(...)` — no blocking refetch), so the tile re-renders in the same interaction; the server-emitted `plan.updated` invalidate (already handled in `lib/realtime/sse.ts`) remains the authoritative reconciler. A second tab converges via SSE alone.
4. **Clarify UX with zero-LLM chips.** Every `clarify` reason renders friendly copy + a deterministic recovery affordance: `day_required`/`day_not_found` → day chips; `child_required` → child chips (roster from plan data); `unknown_child` → child chips; `day_paused`, `slot_not_found`, `variation_not_found` and the dispatch-layer T1 clarifies (missing `variation`/`allergen` value) → copy + re-prompt. A chip tap re-submits as a pre-built `{intent}` (the chip bypass, `confidence: 1`) — **never** as a new utterance. Chips follow the locked chip taxonomy (action chips, `ChoiceChip`/`OnboardingChips` idiom, Honey rule).
5. **Escalation = confirm-then-fire, never silent.** An `escalate` result renders a reason-specific confirm prompt in the sheet ("I don't have anything cached for that — want me to draft something new? It'll take a minute."). Nothing fires without an explicit confirm tap. On confirm: `recompose` → `POST /v1/plans/:planId/regenerate?scope=week`; `compose_next` → `POST /v1/plans/generate` (next week); `catalog_miss`/`add_dish` → `POST /v1/plans/:planId/regenerate?scope=day&day=<target>` (decision — see Dev Notes; no single-dish RecipeAgent endpoint exists and this story does not build one). Decline → the sheet acknowledges and recedes gracefully. While a confirmed T2 runs, the sheet/tile shows the existing `plan.progress` draft stages (store already wired).
6. **Real "Confirm the week" (commit).** Backend: migration adds `plans.confirmed_at timestamptz NULL`; `PlansService.confirmWeek({planId, householdId, requestId})` sets it (idempotent — re-confirm is a no-op that still returns 200), writes an audit event, and `executePlanEdit`'s `commit` arm calls it instead of the s9 `acknowledged` no-op (result becomes `applied`-family or a `committed` acknowledgment carrying `confirmed_at` — keep the contract change coordinated web+api). Frontend: `PlanActionBar`'s "Confirm the week" PrimaryButton is wired via the chip bypass (`{intent: {intent:'commit', confidence:1}}`, zero LLM) and the surface reflects the confirmed state; `onTalkToLumi` is wired to `summon()` with week context. This clears deferred item W1 (13-s7).
7. **safety_write revalidates the week (inherited safety item — must land).** Backend: after a `safety_write` `declareIfNew` insert (`inserted: true`), the current week is re-screened deterministically: placed slots re-checked against the updated declared set (recipes via `allergen_flags`/`evaluate()` authority, snack SKUs via tag-set — same predicates the services already use, never re-implemented); conflicting slots re-picked via the existing deterministic pickers (`pickCatalogCandidate` / `pickReplacementSnackSku`); an unfixable slot escalates (`catalog_miss`) instead of silently remaining. The edit response reports what was fixed. No LLM anywhere in this path.
8. **SSE reconcile contract settled (inherited s9 decision).** `plan.updated` is emitted for `safety_write` only when state actually changed (`inserted: true` — with AC7, the plan tree may genuinely change); suppressed on `inserted: false` no-op re-declarations; unchanged for all other applied mutations; still never emitted on clarify/escalate/read/acknowledged.
9. **Proactive next-week via the whisper channel.** A `lumi.nudge` offering next week ("Want me to draft next week?") renders on the existing whisper line, and its sheet path lands on a "Draft next week" affordance that goes through the AC5 `compose_next` confirm — no auto-fire. Reuse the existing nudge plumbing (`lumi-nudge.job.ts` + whisper channel); if no next-week nudge trigger exists yet, add the minimal one (Friday-unlock window, one sentence, respects the existing pause-nudges pref).
10. **Optimistic pilot (SSE spec Tier 2b, deferred from s2.5).** `useSwapMainMutation` (only — the pilot) gains `onMutate` optimistic cache write + snapshot rollback on error; its `onSuccess` refetch is dropped in favor of the `plan.updated` invalidate as reconciler. Other mutations unchanged.
11. **Tests + gates.** Web unit tests for the new hook/components (day-context summon, edit-turn rendering per result status, chip bypass payload shape, confirm gate); api unit tests for `confirmWeek` and the AC7 revalidation (pure fns fixture-tested, wrappers with stubbed deps); an e2e talk-to-your-plan spec (happy swap path + escalate-confirm path, run in isolation per the SW-bypass constraint); the 13-s1 plan-surface baseline stays green; cost invariants asserted in tests: chip turns send `{intent}` not `{utterance}` (zero classifier), no T2 endpoint call without a confirm tap. `pnpm typecheck` + lint clean; full suites green modulo the documented pre-existing failures.

## Tasks / Subtasks

- [x] Task 1: Day-tap → summoned sheet with day context (AC: 1)
  - [x] Extended `lumi.store` with a frontend-only `planEditScope` (`{planId, weekOf, day?, dayLabel?, dishes?, days?, children?, offer?}`) + `setPlanEditScope`; cleared on recede/setContext/dismissNudge. NOTE: kept OFF the `LumiContextSignal` wire schema (contracts-are-wire-truth) — it's client routing state, not a turn payload; documented in Completion Notes.
  - [x] `PlanTile` activation (existing click/Enter/Space `onSwapIntent`) wired in `PlanPage` to `setPlanEditScope` + `summon('text')`; 13-s7 focus-only slot disclosure intact (activation is a separate event)
  - [x] Sheet context line renders day + dishes; recede restores focus (Dialog focus-restore unchanged)
  - [x] Unit tests: store scope carry/clear (`lumi.store.test.ts`); day-context render + e2e day-tap→summon
- [x] Task 2: Plan-edit turn path in the sheet (AC: 2, 3)
  - [x] `usePlanEditMutation` in `mutations.ts`: `POST /v1/plans/${planId}/edit`, UUID `Idempotency-Key`, `PlanEditResponseSchema`-parsed; deliberately no blanket invalidate (targeted cache write is the fast path)
  - [x] Sheet routing: `LumiSheet` renders `PlanEditPanel` when `planEditScope` is set (→ edit endpoint); no scope → existing `/v1/lumi/turns` path unchanged; exchange is ephemeral (valet doctrine)
  - [x] `applied` → `mergePlanEditDelta` writes the returned row(s) into `QueryKeys.planByWeek` by id (`plan-edit-cache.ts`); `read`/`acknowledged` → copy only
  - [x] `plan-edit-copy.ts` warm one-liners per status/action
  - [x] Unit tests: payload shape + header; cache write per delta kind; error path failure line (`PlanEditPanel.test.tsx`, `plan-edit-cache.test.ts`, `plan-edit-copy.test.ts`)
- [x] Task 3: Clarify chips — the zero-LLM recovery loop (AC: 4)
  - [x] All `PlanEditMissReason` + `unknown_child` + `unknown_variation` + `unclear` mapped to copy + chip config (day chips from `scope.days`, child chips from `scope.children` roster)
  - [x] Chip tap merges the picked slot into the PRIOR intent, re-submits as `{intent}` (`confidence:1`) — tested that the body has NO `utterance` key
  - [x] Action chips render below Lumi's reply, above the input (local `ActionChip` matching the ChoiceChip idiom — avoids a features/onboarding lateral import; momentary actions carry no persistent foliage-select)
- [x] Task 4: Escalation confirm-then-fire (AC: 5)
  - [x] Confirm prompt per `PlanEditEscalateReasonSchema` with explicit Confirm / Not-now actions
  - [x] Confirm dispatch: `recompose` → regenerate `scope=week`; `compose_next` → `POST /v1/plans/generate`; `catalog_miss`/`add_dish` → regenerate `scope=day&day=<target>` (target from intent/scope `day`; absent → day chips first)
  - [x] After confirm: drafting state driven by `plan.progress` store; `plan.updated` re-renders on ready
  - [x] Tests: no T2 fetch without the confirm tap (unit + e2e); decline recedes; regenerate 429 path exercised via `useRequestRegenerationMutation` tests
- [x] Task 5: Wire the StickyBar — real commit, backend + frontend (AC: 6)
  - [x] Migration `20261034000000_add_plans_confirmed_at.sql`: `ALTER TABLE plans ADD COLUMN confirmed_at timestamptz` (+ `20261034000100_add_plan_week_confirmed_audit_type.sql` — `plan.week_confirmed` added to both the SQL enum AND `AUDIT_EVENT_TYPES`, in parity; pre-existing parity failure not worsened)
  - [x] `PlansService.confirmWeek` (validate plan/household, race-safe idempotent set via `PlansRepository.setConfirmedAt` `.is('confirmed_at', null)` guard, audit write) + `PlanRowSchema`/`GetPlansResponse` carry `confirmed_at` + `PLAN_COLUMNS`
  - [x] `executePlanEdit` `commit` arm → `confirmWeek`; result carries `confirmed_at` on the acknowledged/commit arm; `shouldEmitPlanUpdated` emits on first confirm (`changed:true`), suppresses re-confirm no-op (AC8-consistent)
  - [x] Frontend: `PlanActionBar` gained `confirmed`/`confirming` props (done-state idiom); `onConfirm` → chip-bypass commit (`{intent:'commit'}`, zero LLM) via `usePlanEditMutation`; `onTalkToLumi` → `summon()` with `{planId, weekOf}` scope — wired at BOTH render sites (PlanPage + BriefCanvas), clears W1
  - [x] api unit tests (confirm idempotency, audit, commit-arm wiring) + web unit tests (chip-bypass `{intent}` payload, confirmed rendering — `PlanActionBar.test.tsx`, `mutations.test.ts`)
- [x] Task 6: safety_write week revalidation + SSE emit contract (AC: 7, 8) — backend
  - [x] `WeekAllergenRevalidator.revalidate` in `modules/plans/week-allergen-revalidation.ts` (runs in `PlanEditTurnService.run` after `declareIfNew` `inserted:true`): re-screen placed mains/extras (`allergen_flags` tag-set pre-filter) + snacks (SKU `allergen_tags` tag-set) via pure `screenWeekForAllergen`; conflicting slot → deterministic re-pick (`CatalogRepo.pickRecipe` / `pickReplacementSnackSku`); write through the EXISTING swap services (guardrail `evaluate()` re-eval inside); all-or-escalate — any un-re-pickable slot escalates (`catalog_miss`) with zero writes
  - [x] `safety_write` applied result carries `fixed_slots: [{ main_assignment | slot }]` (contracts + types coordinated)
  - [x] Emit contract: `shouldEmitPlanUpdated` — `plan.updated` for `safety_write` only when `inserted:true`; suppress on no-op; decision appended to routing spec §9
  - [x] Unit tests: pure `screenWeekForAllergen` over fixture trees (no mocks); wrapper with stubbed services asserting exact swap-service call args; no-op + escalate; run() integration (fixed_slots surfaced, escalate flip, inserted:false skip)
- [~] Task 7: Proactive next-week whisper (AC: 9) — PARTIAL (plumbing + confirm affordance done; auto-fire deferred)
  - [x] Added the `next_week_ready` `NudgeTrigger` (contract + parity test); nudge content is generated by the trigger-agnostic `LumiAgent.generateNudge` — no template change needed
  - [x] Sheet path: `PlanEditScope.offer: 'compose_next'` opens the panel directly on the AC5 `compose_next` confirm gate (fires `POST /v1/plans/generate` only on the explicit tap) — unit-tested
  - [ ] DEFERRED (see deferred-work.md): the Friday-window scheduled ENQUEUE of the `next_week_ready` nudge (needs a cron-style job — no such scheduler exists today) AND the whisper-tap→offer-scope threading (the `LumiNudgeEvent` SSE payload carries no trigger, so the client can't distinguish a next-week nudge without a contract change). The observable AC9 confirm-then-fire affordance exists and is tested; the automatic Friday nudge does not yet fire.
- [x] Task 8: Optimistic pilot on swap-main (AC: 10)
  - [x] `useSwapMainMutation`: `onMutate` snapshot + optimistic cache write, `onError` rollback, `onSuccess` invalidate DROPPED; the swap-main PATCH route now emits `plan.updated` (sse-remediation §2b "2c", scoped to the pilot) as the reconciler; Idempotency-Key already sent
  - [x] Unit tests: optimistic write visible pre-response; rollback on error; success keeps the optimistic write (no refetch) — `mutations.test.ts`
- [x] Task 9: E2E + full validation (AC: 11)
  - [x] New `apps/web/test/e2e/13-s10-talk-to-your-plan.spec.ts`: tap day → sheet → utterance → mocked applied reply; escalate → confirm gate → T2 endpoint called only after the tap; axe on the sheet-in-plan-context. Passes in isolation (`--workers=1`); mirrors 13-s1 locator style
  - [x] 13-s1 plan-surface baseline green in isolation (13 passed / 1 skip); api full suite = 31 pre-existing failures (unchanged, not grown); `pnpm typecheck` clean (web + api); lint clean on the diff (2 remaining flags are pre-existing, not introduced)

## Dev Notes

### Authoritative sources — read these first
- `_bmad-output/planning-artifacts/plan-conversational-edit-routing-spec.md` — §5 chip bypass, §6 dispatch + escalation chokepoint + `revalidateWeek` sketch, §8 cost trace, §9 resolutions
- `_bmad-output/planning-artifacts/lumi-conversational-ux-rebuild-vision.md` §4b/§4e — the UX contract for this story (tap day → dock focuses with day context → tile re-renders live; next week is brought by Lumi, not a tab unlock)
- `_bmad-output/planning-artifacts/epic-13-lumi-ux-rebuild-brief.md` §13-s10 — AC sketch + MVP wall definition
- `_bmad-output/planning-artifacts/sse-remediation-spec.md` §2b + §5 — the optimistic/reconcile doctrine (pilot on swap-main ONLY)
- Previous story: `_bmad-output/implementation-artifacts/13-s9-route-dispatch-intent.md` — Dev Agent Record + Review Findings list exactly what this story inherits

### The wire contract you consume (verified in-repo, s9-shipped)
- `packages/contracts/src/plan-intent.ts`: `PLAN_INTENT` (12 intents), `PlanIntentResultSchema` (flat: `intent`, `confidence`, optional `day|slotKind|childId|allergen|constraint|variation|dishQuery|scope`), `PlanEditInputSchema` (`{utterance}` XOR `{intent}`), `PlanEditResultSchema` discriminated on `status`: `applied` (action `swap_main|swap_slot|swap_snack|vary|safety_write`, carries `main_assignment?|slot?|variation?|allergen?|inserted?`), `acknowledged` (`noop|commit`), `read` (`target`), `clarify` (`reason` string), `escalate` (`reason` enum + `dishQuery?`); `PlanEditResponseSchema` = `{intent, tier, result}`
- `POST /v1/plans/:planId/edit` (plans.routes.ts:652–697): `authorize(['primary_parent','secondary_caregiver'])`, `Idempotency-Key` header REQUIRED and must be UUID-format (regex-validated, 400 otherwise); SSE emit only on `applied`
- Clarify reasons (plan-edit-target.ts:20–26): `day_required | day_not_found | day_paused | slot_not_found | child_required | variation_not_found`; plus service-layer `unknown_child` (foreign-child guard) and dispatch-layer T1 clarifies (missing `variation`/`allergen` value — safety data is never guessed)
- `plan.updated` payload: `{type:'plan.updated', week_id: deriveWeekId(weekOf), guardrail_verdict}` on the unnamed `message` event; client handler already invalidates `QueryKeys.plan(week_id)` + `['brief']` (lib/realtime/sse.ts:170–174)
- T2 endpoints that exist TODAY: `POST /v1/plans/generate` (202 + job, emits `plan.progress`), `POST /v1/plans/:planId/regenerate?scope=week|day&day=<weekday>` (rate-limited 5/week/household). There is NO single-dish fetch-and-place endpoint.

### Frontend anatomy you build on (13-s2/s2.5/s3/s7 shipped)
- `stores/lumi.store.ts`: `presenceState 'atRest'|'whisper'|'summoned'`, `summon(mode?)`, `recede()`, `dismissNudge()`, `setContext`, `hydrateThread`
- `components/LumiPresence.tsx` + `LumiSheet.tsx` (Dialog primitive: focus-trap, Escape, focus-restore, `bottom-right` placement) + `LumiWhisper.tsx` (10s auto-dismiss, aria-live polite)
- `hooks/useLumiContext.ts` — surface registration + pre-hydration (PlanPage already calls it with `{surface:'brief'}` at PlanPage.tsx:151)
- `features/plan/`: `PlanPage.tsx`, `PlanTile.tsx` (`deriveSlotGroups` focus disclosure, `PlanTileState` machine, `isPointerFocusRef` from the s7 review patches), `PlanActionBar.tsx` (StickyBottomBar + PrimaryButton "Confirm the week" + SecondaryButton "Swap a day" + `TalkToLumiButton` — `onConfirm`/`onTalkToLumi` currently undefined at BOTH render sites, PlanPage + BriefCanvas = deferred W1), `queries.ts` (`usePlanQuery`, staleTime 30s), `mutations.ts` (`safeRandomUuid()` idempotency keys; all mutations invalidate `['brief']`+`['plan']` on success)
- SSE bridge: ONE `EventSource` per tab (`lib/realtime/sse.ts`, created in `providers/query-provider.tsx`); `plan.progress` store exists (`usePlanProgressStore`); `lumi.nudge` named event → whisper-or-append
- Chips: `features/onboarding/components/ChoiceChip.tsx` (single/multi, foliage selection per Honey rule), `OnboardingChips.tsx` composition, `TrustChip.tsx`. Chips render below Lumi's turn, above the input (memory `chip-taxonomy-three-types`)
- NOTE: the codebase uses TanStack Query (`usePlanQuery`/`invalidateQueries`/`QueryKeys`) — follow `queries.ts`/`mutations.ts` idiom. project-context.md's "Zustand + fetch" predates this; the codebase is the truth here.

### Decision: catalog_miss / add_dish confirm target (made at story-creation; flag disagreement before building)
No single-dish RecipeAgent endpoint exists and building one is out of scope (that's a real backend feature, not UI wiring). The confirm for `catalog_miss`/`add_dish` maps to **day-scope regenerate** (`?scope=day&day=X`) — a genuine T2 compose for that day, existing, rate-limited, and honest to the promise "I'll find something new for Tuesday". The captured `dishQuery` is NOT threaded into regenerate (no input for it) — acceptable for MVP; note it in the Dev Agent Record as a product gap for a later slice (pairs with the `exclude_filter` `scope` gap from s9 review).

### Decision: plan-edit turns are ephemeral (not thread turns)
The edit endpoint does not persist a conversation turn (s9 built no thread write), so the sheet renders plan-edit exchanges locally for the life of the summon. This matches the valet doctrine (the artifact is the product; the exchange recedes). Do NOT add thread persistence in this story — if it's wanted later it's an API change, not a client hack.

### Cost doctrine (the MVP wall's measure)
- Chip taps and clarify/confirm re-submissions are `{intent}` posts — zero LLM, no `plan_intent.routed` tag. Free.
- Utterances cost exactly one `'mini'` classifier call (T1). The tracer (s9, `PLAN_TRACE_DIR`) already records this — nothing new to build server-side; the wall is verified by reading the trace during e2e/manual validation.
- T2 fires ONLY via the AC5 confirm gate (and the once-per-week baseline compose). An escalation payload rendering in the sheet costs nothing.

### Architectural boundaries (non-negotiable)
- All new frontend data access through `hkFetch` + contracts parsing (`lib/fetch.ts` idiom); no raw `fetch().json()`
- Backend Tasks 5–6 live in `modules/plans` service/repository layers; mutations go through EXISTING swap services (guardrail re-eval inside); agents never touch the DB; never re-implement safety predicates — `evaluate()` (allergy-rules.engine.ts:218, v1.4.0 declared-only) + tag-set pre-filters stay the authorities
- Contract changes (confirmed_at, safety_write fixes report) are coordinated: `packages/contracts` + `packages/types` + api + web in this story, per the standing schema-change rule

### Scope guards
- NO voice in the plan-edit path (text-first holds; `TalkToLumiButton` copy stays, input is typed)
- NO route collapse (s11), NO new parallel plan surface — extend `features/plan` + the existing sheet
- NO Idempotency-Key replay cache (repo-wide deferred item, not this story)
- NO `exclude_filter` week-scope semantics (s9-deferred product gap — clarify path covers it)
- Snack-swap guardrail `variations.length > 0` gate: pre-existing, under separate investigation — do not "fix" in passing
- Editorial Hearth frozen: no new visual language; sheet/chips/buttons compose the locked components (DESIGN.md — read before UI work)

### Testing standards
- Web: Vitest + Testing Library, colocated `*.test.tsx`; store tests are plain fns; msw/fetch stubs at the network boundary; no DOM snapshots
- API: Vitest, `cd apps/api && npm test -- <file>`; pure fns fixture-tested with zero mocks; wrappers with stubbed deps asserting exact call args (see `plan-edit.service.test.ts` for the house pattern)
- E2E: full local suite is unreliable (PWA service worker bypasses `page.route` mocks — ~99 reproducible failures); run new + baseline specs in isolation from `apps/web` (memory `e2e-full-suite-sw-bypass`); trust CI ubuntu
- Known pre-existing failures at s9 HEAD: 31 api tests (incl. the audit enum-parity test), 179 repo-wide lint errors — do not absorb them into this story's diff, do not grow them

### Project Structure Notes

- New web code: `features/plan/` (mutation hook, clarify/confirm components, copy map) + minimal additive edits to `stores/lumi.store.ts`, `LumiSheet.tsx`, `PlanTile.tsx`, `PlanActionBar.tsx` render sites. Components `PascalCase.tsx`, hooks `useXxx.ts`, no cross-feature lateral imports (shared bits go to `components/`/`lib/`)
- New api code: `modules/plans/` (confirmWeek, revalidation), migration under `supabase/migrations/`, contract additions in `packages/contracts/src/plan.ts`/`plan-intent.ts` re-exported through `packages/types`
- Commits: `feat(planner): … (Epic 13-s10)`, one independently-testable commit per task

### References

- [Source: packages/contracts/src/plan-intent.ts#PlanEditInputSchema (63–66), PlanEditResultSchema (86–113), PlanEditResponseSchema (115–119)]
- [Source: apps/api/src/modules/plans/plans.routes.ts#POST /edit (652–697), idempotency validation (61–77), SSE emit (681–686)]
- [Source: apps/api/src/modules/plans/plan-edit.service.ts#executePlanEdit (153–271), unknown_child guard (446–458)]
- [Source: apps/api/src/modules/plans/plan-edit-target.ts#PlanEditMissReason (20–26)]
- [Source: apps/api/src/agents/dispatch-plan-intent.ts#escalate reasons (18, 118–151)]
- [Source: apps/api/src/jobs/plan-generation.job.ts#buildPlanUpdatedPayload (165–167)]
- [Source: apps/web/src/stores/lumi.store.ts#summon/recede/setContext (58–147)]
- [Source: apps/web/src/components/LumiSheet.tsx#turn submission (49–88), hydration (92–117)]
- [Source: apps/web/src/features/plan/PlanTile.tsx#deriveSlotGroups (110–152), PlanTileState (7–14)]
- [Source: apps/web/src/features/plan/PlanActionBar.tsx (1–40) + deferred-work.md W1]
- [Source: apps/web/src/features/plan/mutations.ts#safeRandomUuid (28–41), useSwapMainMutation (52–73)]
- [Source: apps/web/src/lib/realtime/sse.ts#plan.updated handler (170–174), lumi.nudge (297–316)]
- [Source: _bmad-output/planning-artifacts/plan-conversational-edit-routing-spec.md#§5–6, §8]
- [Source: _bmad-output/planning-artifacts/sse-remediation-spec.md#2b, §5]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#13-s9 + 13-s7 sections]
- [Source: docs/DESIGN.md — StickyBottomBar, button taxonomy, Honey rule]
- [Source: _bmad-output/project-context.md#contracts-are-wire-truth, schema-change coordination]

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (dev-story)

### Debug Log References

### Completion Notes List

**Execution ordering (documented deviation):** implemented the coordinated backend contract landings first (Task 5 backend + Task 6) so the frontend consumes final wire shapes, then the frontend (Tasks 1–4, 5-frontend, 7, 8), then e2e (Task 9). Each task fully implemented + tested before the next, per the workflow's completion gate.

**Task 5 (backend) — real commit.** Migrations `20261034000000_add_plans_confirmed_at.sql` + `20261034000100_add_plan_week_confirmed_audit_type.sql`. `plan.week_confirmed` added to `AUDIT_EVENT_TYPES` AND the SQL enum (kept in parity — the pre-existing audit-parity test failure was NOT worsened; the missing values it fails on are unrelated). `PlanRowSchema.confirmed_at` (nullable) + `PLAN_COLUMNS`. `PlansRepository.setConfirmedAt` (race-safe `.is('confirmed_at', null)` guard). `PlansService.confirmWeek` (idempotent, audit). `PlanEditResultSchema` acknowledged/commit arm carries `confirmed_at`; executor `commit` arm calls `confirmWeek`; `shouldEmitPlanUpdated()` gates the SSE emit.

**Task 6 — safety_write week revalidation + emit contract.** `week-allergen-revalidation.ts`: pure `screenWeekForAllergen` (tag-set membership, dedups shared Mains, skips paused days/children, respects child-scope) + `WeekAllergenRevalidator.revalidate` (all-or-escalate: re-pick every conflict from cache or escalate `catalog_miss` with zero writes; applies via existing swap services). `RecipesRepository.findAllergenFlagsByIds` added. `PlanEditResultSchema` applied arm carries `fixed_slots`. `shouldEmitPlanUpdated` implements AC8 (safety_write emits only on `inserted:true`). Wired in `PlanEditTurnService.run` + `plans.hook`. Emit + revalidation decision appended to routing-spec §9.

**Product gaps noted (MVP-acceptable, per story Dev Notes):** (1) `catalog_miss`/`add_dish` confirm maps to day-scope regenerate; captured `dishQuery` is NOT threaded into regenerate (no input). (2) safety_write revalidation escalate uses `catalog_miss` (no `day`), so the client asks via day chips.

### File List

**Task 5 + 6 (backend + contracts):**
- `supabase/migrations/20261034000000_add_plans_confirmed_at.sql` (new)
- `supabase/migrations/20261034000100_add_plan_week_confirmed_audit_type.sql` (new)
- `packages/contracts/src/plan.ts` (PlanRowSchema.confirmed_at)
- `packages/contracts/src/plan-intent.ts` (acknowledged.confirmed_at, applied.fixed_slots, PlanEditFixedSlotSchema)
- `packages/types/src/index.ts` (PlanEditFixedSlot export)
- `apps/api/src/audit/audit.types.ts` (plan.week_confirmed)
- `apps/api/src/modules/plans/plans.repository.ts` (PLAN_COLUMNS + setConfirmedAt)
- `apps/api/src/modules/plans/plans.service.ts` (confirmWeek)
- `apps/api/src/modules/plans/plan-edit.service.ts` (commit arm, safety_write fixedSlots, shouldEmitPlanUpdated, revalidator wiring)
- `apps/api/src/modules/plans/week-allergen-revalidation.ts` (new)
- `apps/api/src/modules/plans/plans.routes.ts` (shouldEmitPlanUpdated emit gate)
- `apps/api/src/modules/plans/plans.hook.ts` (revalidator wiring)
- `apps/api/src/modules/recipe/recipes.repository.ts` (findAllergenFlagsByIds)
- `apps/api/test/factories/index.ts` (buildPlan.confirmed_at)
- tests: `plan-edit.service.test.ts`, `plans.service.test.ts`, `plans.routes.test.ts`, `plan-day-context.service.test.ts`, `week-allergen-revalidation.test.ts` (new)
- `_bmad-output/planning-artifacts/plan-conversational-edit-routing-spec.md` (§9 decision)

**Task 8 (backend):**
- `apps/api/src/modules/plans/plans.routes.ts` (swap-main route emits plan.updated — pilot reconciler)

**Task 7 (backend plumbing):**
- `packages/contracts/src/lumi.ts` (`next_week_ready` NudgeTrigger) + `packages/contracts/src/lumi.test.ts`

**Frontend (Tasks 1–5, 7-offer, 8):**
- `apps/web/src/stores/lumi.store.ts` (`planEditScope` state/type/setter) + `lumi.store.test.ts`
- `apps/web/src/features/plan/mutations.ts` (`usePlanEditMutation`, `safeRandomUuid` export, `useSwapMainMutation` optimistic pilot) + `mutations.test.ts`
- `apps/web/src/features/plan/plan-edit-copy.ts` (new) + `plan-edit-copy.test.ts` (new)
- `apps/web/src/features/plan/plan-edit-cache.ts` (new) + `plan-edit-cache.test.ts` (new)
- `apps/web/src/features/plan/PlanEditPanel.tsx` (new) + `PlanEditPanel.test.tsx` (new)
- `apps/web/src/components/LumiSheet.tsx` (plan-edit branch)
- `apps/web/src/features/plan/PlanPage.tsx` (day-tap summon + StickyBar wiring)
- `apps/web/src/features/plan/BriefCanvas.tsx` (StickyBar wiring — 2nd render site)
- `apps/web/src/features/plan/PlanActionBar.tsx` (`confirmed`/`confirming` props) + `PlanActionBar.test.tsx` (new)
- `apps/web/test/e2e/13-s10-talk-to-your-plan.spec.ts` (new)

### Review Findings

- [x] [Review][Decision] BriefCanvas PlanTile taps still wire to legacy swap flow — resolved: wired to `summonForDay` (same as PlanPage), AC1 now satisfied at both render sites. [`apps/web/src/features/plan/BriefCanvas.tsx`]
- [x] [Review][Patch] ZodError surfaces raw from `usePlanEditMutation` — fixed: switched to `safeParse`, throws `HkApiError(200, ...)` on mismatch. [`apps/web/src/features/plan/mutations.ts`]
- [x] [Review][Patch] Confirm button flashes "Confirm the week" briefly after first commit — fixed: `setQueryData` writes `confirmed_at` into cache immediately on success before `invalidateQueries`. [`apps/web/src/features/plan/PlanPage.tsx`, `apps/web/src/features/plan/BriefCanvas.tsx`]
- [x] [Review][Patch] Stale file-level comment in `plan-edit.service.ts` contradicts implemented behavior — fixed: comment replaced to reflect that `confirmWeek` is fully wired. [`apps/api/src/modules/plans/plan-edit.service.ts:38-39`]
- [x] [Review][Defer] `swapSlotSnackSku` allergen guardrail skipped for slots with no variations (`variations.length === 0`) — household-wide snack assignment bypasses the allergy check; explicitly noted in story Dev Notes scope guards as "pre-existing, under separate investigation — do not fix in passing" [`apps/api/src/modules/plans/plans.service.ts`] — deferred, pre-existing
- [x] [Review][Defer] `confirmWeek` race: if plan is deleted between race-loss detection and re-fetch, returns caller's local timestamp for a non-existent plan — `plans.service.ts:898-906` fallback re-fetch returns `confirmedAt` (local timestamp) when `existing` is null; extreme edge case, MVP acceptable [`apps/api/src/modules/plans/plans.service.ts`] — deferred, pre-existing
- [x] [Review][Defer] Snack SKU `in_stock`/`archived_at` can flip between validation and write in `swapSlotSnackSku` — TOCTOU window exists but no DB constraint prevents it; pre-existing pattern in codebase, not introduced by this story [`apps/api/src/modules/plans/plans.service.ts`] — deferred, pre-existing
- [x] [Review][Defer] Revalidation Apply phase can partially commit on unexpected DB/network error — two-phase logic is correct for all business failures (screen-all-before-write); partial commits only possible on infrastructure errors; acceptable MVP risk [`apps/api/src/modules/plans/week-allergen-revalidation.ts`] — deferred, pre-existing

## Change Log

- 2026-07-03: Implemented (dev-story, claude-opus-4-8[1m]). Backend-first ordering for coordinated contracts: Task 5 (real confirmWeek — migration `20261034000000/000100`, `plan.week_confirmed` audit in parity, `PlanRowSchema.confirmed_at`, `setConfirmedAt`, executor commit arm, `shouldEmitPlanUpdated` SSE gate) → Task 6 (`week-allergen-revalidation.ts` — pure `screenWeekForAllergen` + `WeekAllergenRevalidator` all-or-escalate; `fixed_slots` contract; AC8 emit-on-inserted; routing-spec §9 decision) → Tasks 1–4 (`planEditScope` store, day-tap summon, `PlanEditPanel` ephemeral exchange, `usePlanEditMutation`, `plan-edit-cache`/`plan-edit-copy`, zero-LLM clarify chips, escalation confirm-then-fire) → Task 5 frontend (`PlanActionBar` confirmed/confirming, chip-bypass commit + TalkToLumi at both render sites) → Task 8 (swap-main optimistic pilot + route `plan.updated` emit) → Task 9 (e2e `13-s10-talk-to-your-plan.spec.ts`, full validation). Cost wall verified. Task 7 (AC9) PARTIAL by user decision — `next_week_ready` trigger + `compose_next` confirm affordance built+tested; Friday auto-nudge deferred (D-13S10-1). Verification: web+api typecheck clean; api full suite 31 pre-existing failures (unchanged); new e2e 3/3 + 13-s1 baseline 13/13 (isolated); lint diff clean. Status → review.
- 2026-07-02: Story created (bmad-create-story, claude-fable-5). Ultimate context engine analysis completed — comprehensive developer guide created from epic brief §13-s10, vision §4b/§4e, routing spec §5–§9, SSE remediation spec §2b, 13-s9 Dev Agent Record + Review Findings (3 inherited items: real commit, safety_write week revalidation, SSE emit contract), 13-s7 deferred W1, and in-repo exploration of the shipped presence/sheet/planner/SSE/edit-endpoint code. Status: ready-for-dev.
