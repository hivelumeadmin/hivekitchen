# Deferred Work Log

## Deferred from: code review of 12-7-route-context-registration (2026-05-01)

- **`isHydrating` stuck `true` when surface changes mid-flight** — `hydrateThread`'s TOCTOU guard (store line 95) skips the `isHydrating: false` reset when `state.surface !== surface`; self-healing via next route's `setContext`, no practical impact for current 'general'-only routes. Revisit when surface-specific routes (Epic 3+) introduce mid-flight surface changes. [`apps/web/src/hooks/useLumiContext.ts:28-30`, `apps/web/src/stores/lumi.store.ts:94-95`]
- **Abort cleanup does not synchronously reset `isHydrating`** — `return () => controller.abort()` in the effect cleanup does not call `useLumiStore.setState({ isHydrating: false })`; the flag stays `true` until the async catch settles. Transient window; the async path is the correct reset point. Address in a hooks-hygiene pass if a synchronous observer of `isHydrating` is ever added. [`apps/web/src/hooks/useLumiContext.ts:38`]
- **Stale `signal` closure for future entity context fields** — `signal` is captured outside the `useEffect` dep array by design (all current callers pass static `{ surface: 'literal' }`); `entity_id`, `entity_summary`, and `recent_actions` on future surface-specific routes will not re-trigger `setContext` if those fields change without a `surface` change. Revisit when Epic 3–6 entity routes are built. [`apps/web/src/hooks/useLumiContext.ts:13`]

## Deferred from: code review of 12-6-lumiorb-and-lumipanel-in-root-layout (2026-05-01)

- **Stale-turns guard blocks re-hydration when surface/thread changes while panel is open** — `turnsNow.length > 0` short-circuits hydration before checking if surface or thread ID changed. Requires Story 12.7 `setContext()` wiring to properly flush turns on surface switch. [`apps/web/src/components/LumiPanel.tsx:23`]
- **`isPanelOpen` and `turns` persist across route navigation without context reset** — panel stays open carrying prior surface's turns when navigating between authenticated routes; Story 12.7's `setContext()` will flush turns on surface transition. [`apps/web/src/stores/lumi.store.ts`]
- **Voice `active → ended` animation transition snaps with no intermediate state** — orb jumps from `animate-ping` to no animation when voice session ends; Story 12.8 owns voice-state UX refinement. [`apps/web/src/components/LumiOrb.tsx:10-16`]
- **`AppLayout` has no authentication guard** — unauthenticated users navigating directly to `/app` or `/account` mount `LumiOrb` and `LumiPanel`; hydration fetch fires with no auth header and silently fails. Pre-existing pattern across all routes in this codebase. [`apps/web/src/routes/(app)/layout.tsx`]

## Deferred from: code review of 12-4-db-migration-drop-modality-discriminator-from-thread-uniqueness-constraint (2026-05-01)

- **`ThreadRepository.findActiveThreadByHousehold()` filters by modality for all types** — Story 12.5 addresses this with `LumiRepository.findActiveAmbientThread()` (modality-agnostic); the base repository method is not called for ambient lookups in current code but remains a trap for future callers. Update the method or add a clear doc comment when Story 12.5's lumi module is committed. [`apps/api/src/modules/threads/thread.repository.ts:59-74`]
- **`createThread` comment names the dropped `threads_one_active_per_household_type_modality` index** — Stale inline reference to the superseded Story 2.7 index. Update when Story 12.5 modifies the `createThread` signature or adds ambient thread creation. [`apps/api/src/modules/threads/thread.repository.ts:41-44`]
- **No `CREATE INDEX CONCURRENTLY`** — Takes a ShareLock during index build. Can't use CONCURRENTLY inside Supabase transaction-wrapped migrations. Acceptable for current table size; revisit before high-traffic production launch. [`supabase/migrations/20260620000000_ambient_lumi_thread_constraints.sql:42-51`]

## Deferred from: code review of 12-5-talk-session-lifecycle-post-delete-v1-lumi-voice-sessions (2026-05-01)

- **Dead `.slice(0, TURNS_LIMIT)` after DB `.limit()` in `getThreadTurns`** — DB query already limits to 20 rows; the JS `.slice()` is redundant dead code. Pre-existing from Story 12-3. Remove one or the other in a future housekeeping pass. [`apps/api/src/modules/lumi/lumi.repository.ts:53`]
- **auditContext not written on service error paths** — if `createTalkSession` or `closeTalkSession` throws, `request.auditContext` is never set and no audit event fires. Pre-existing architectural pattern across all routes; requires a cross-cutting design decision (e.g., a `onError` hook that emits failure audit events). [`apps/api/src/modules/lumi/lumi.routes.ts:62-71, 90-96`]
- **`closeTalkSession` UPDATE has no row-count check** — concurrent close between `findTalkSession` and the UPDATE results in silent no-op. Benign by design (service's `status === 'active'` pre-check + repo's own `.eq('status','active')` guard make the race idempotent). No behavioral bug but the silent success could be made explicit with a count assertion if strict idempotency semantics ever matter. [`apps/api/src/modules/lumi/lumi.repository.ts:138-146`]

## Deferred from: code review of 12-3-thread-turns-endpoint-get-v1-lumi-threads-threadid-turns (2026-04-30)

- **Two-query TOCTOU in `getThreadTurns`** — ownership check and turns fetch are two separate DB round-trips with no transaction; under service-role (bypasses RLS) and current household-immutability assumptions this is low-probability. Fix with a JOIN-based single query if household transfer ever becomes possible. [`apps/api/src/modules/lumi/lumi.repository.ts:28`]
- **`findActiveAmbientThread` omits `modality` filter** — diverges from `thread.repository.ts` intentionally per ADR-002 (ambient threads don't discriminate on modality); `assertAmbientSurface` guard is the single line of defence preventing onboarding surface from reaching this path. Ensure guard is tested when 12-5 lands. [`apps/api/src/modules/lumi/lumi.repository.ts:68`]
- **Duplicate `voice.session_ended` audit events on repeated DELETE** — service skips DB write for already-closed sessions but route unconditionally sets `auditContext`; two DELETEs on the same session ID produce two audit records. Story 12-5 scope — fix with an early return before setting `auditContext` when service reports no-op. [`apps/api/src/modules/lumi/lumi.routes.ts:90`]

## Deferred from: code review of 2-14-onboarding-mental-model-copy-anxiety-leakage-telemetry (2026-04-30)

- **`AuditService` re-instantiated per plugin in `households.routes.ts`** — pre-existing pattern across `auth.routes.ts` and `invite.routes.ts`; migrate all to `fastify.auditService` decorator when DI/lifecycle hardening pass lands. [`apps/api/src/modules/households/households.routes.ts:26`]
- **Direct `audit_log` count query in route handler bypasses repository layer** — the retry-count query is issued from the route handler via raw `fastify.supabase` instead of a named `AuditRepository` method; move to `AuditRepository.countRecentRetries()` in a future housekeeping pass. [`apps/api/src/modules/households/households.routes.ts:66-74`]
- **`family_rhythms` optional in `TextOnboardingFinalizeResponseSchema` but required in service interface** — contract schema under-specifies what the API actually returns; tighten to non-optional when a contracts hardening pass runs. [`packages/contracts/src/onboarding.ts`]
- **`getTileGhostFlag` defined but never called in production** — intentional infrastructure scaffold; Epic 3 Plan Tile component reads this flag to render "saved just now" pip; wire at that point. [`apps/api/src/modules/households/households.repository.ts`]
- **AbortController missing in `OnboardingMentalModel`** — in-flight POST continues after component unmount; silent catch makes this benign today; add AbortController in a React hooks best-practice cleanup pass. [`apps/web/src/features/onboarding/OnboardingMentalModel.tsx:23-31`]
- **`householdId` null→non-null race in `cultural-ratification` useEffect** — if `householdId` briefly becomes null during a re-render mid-flow, the effect could redirect to mental-model unexpectedly; guard with a stable ref or entry-time snapshot if this race surfaces in practice. [`apps/web/src/routes/(app)/onboarding.tsx`]

## Deferred from: code review of 2-13-visible-memory-write-primitives-memory-nodes-seed (2026-04-30)

- **Orphaned `memory_nodes` when `insertProvenance` fails in seeding path** — spec §Dev Notes explicitly says "partial seeding is acceptable"; Epic 7 reconciles orphaned nodes during the forget job. [`apps/api/src/modules/memory/memory.service.ts:104-117`]
- **`noteFromAgent` orphaned node when `insertProvenance` throws** — not in silence-mode; exception propagates to tool caller as expected. Epic 7 reconciliation covers tool-sourced orphans. [`apps/api/src/modules/memory/memory.service.ts:157-163`]
- **Prose text prefix format (`"Declared allergy: X"`, `"Cultural identity: X"`) bakes presentation into data** — spec-mandated seeding table format; not a free design choice. Epic 7 Visible Memory panel must strip prefix on display if needed. [`apps/api/src/modules/memory/memory.service.ts:174-186`]
- **RLS INSERT/UPDATE/DELETE policies missing from `memory_nodes` and `memory_provenance`** — spec explicitly defers write policies to Epic 7; all writes go through the API service-role client which bypasses RLS. [`supabase/migrations/20260601000000_create_memory_nodes_and_provenance.sql:72-86`]
- **`memory_provenance` SELECT RLS policy uses correlated subquery (O(n×m) at scale)** — no correctness impact at current beta scale; optimize with a JOIN-based policy or SECURITY DEFINER helper when row counts warrant. [`supabase/migrations/20260601000000_create_memory_nodes_and_provenance.sql:80-86`]
- **`memory_provenance` has no `updated_at` column or trigger** — not in spec schema; Epic 7 can add timestamped supersession when the forget job lands to enable ordering signal. [`supabase/migrations/20260601000000_create_memory_nodes_and_provenance.sql:44-53`]
- **`facet` column has no DB-level length constraint** — application-layer enforcement via Zod + `FACET_MAX = 200` is the consistent project pattern; add a DB `CHECK (char_length(facet) <= 200)` in an Epic 7 schema hardening pass if admin-level access becomes a concern. [`supabase/migrations/20260601000000_create_memory_nodes_and_provenance.sql:34`]
- **`set_updated_at` trigger function re-declared with `CREATE OR REPLACE`** — documented intentional in migration header (independently runnable); body is identical to prior migrations. Namespace the function (e.g., `set_memory_nodes_updated_at`) in a future migration hardening pass to avoid collisions if the shared function is ever changed by another migration. [`supabase/migrations/20260601000000_create_memory_nodes_and_provenance.sql:60-66`]
- **`memory.note` stub throws plain `Error`, not a typed `NotImplementedError`** — spec says "NotImplementedError-style"; no such class exists in the codebase. Define a typed `NotImplementedError` or `ToolNotWiredError` class in Story 3.2 so orchestrators can distinguish stub-not-wired from runtime failure via `instanceof`. [`apps/api/src/agents/tools.manifest.ts:37`]
- **Tool-written provenance rows always have `source_ref: {}`** — `sourceRef` is not in `MemoryNoteInputSchema`; all agent-written memory nodes have empty provenance context. Epic 5's tool-wiring story should add optional `source_ref` fields (e.g., `turn_id`, `session_id`) to `MemoryNoteInputSchema` for traceability. [`apps/api/src/agents/tools/memory.tools.ts:21`]

## Deferred from: code review of 12-2-global-lumi-store-lumi-store-ts (2026-04-30)

- **`isSpeaking` has no setter action** — the field exists in state and resets in `endTalkSession`, but no `setIsSpeaking` action is defined; it can never be set to `true`. Story 12.8 (tap-to-talk via ElevenLabs) is the expected owner of this action. [`apps/web/src/stores/lumi.store.ts`]
- **Async callbacks from `useVoiceSession` may fire after `OnboardingVoice` unmounts** — `callbacksRef` persists across renders; a queued `onError` callback could invoke the parent's `setVoiceError` after the user navigates away from the onboarding route. Acceptable under the current sequential WebSocket lifecycle but worth guarding in Story 12.8 when tap-to-talk introduces more complex session states. [`apps/web/src/hooks/useVoiceSession.ts`]

## Deferred from: code review of 2-6b-voice-pipeline-v2 Group A (2026-04-29)

- **`session.summary` silently lost if client disconnects during `closeSession` async tail** — DB is updated correctly but the client never receives the summary frame. The household completes onboarding in the DB but the client UX cannot confirm it. Design-level gap; consider a recovery endpoint (`GET /v1/voice/sessions/:id/status`) so the client can poll on reconnect. [`voice.service.ts` — closeSession completed path]
- **JWT expiry not re-verified mid WebSocket session** — JWT is validated once at WS open; a 15-min token remains usable for the full 10-min session window even if revoked. Acceptable for current threat model. Revisit if token revocation requirements tighten. [`voice.routes.ts` — WS handler]
- **`/v1/webhooks/` still in `SKIP_PREFIXES` of `authenticate.hook.ts`** — Webhook route was removed in 2-6b but the auth-skip prefix remains. No route registered under it so no exposure; remove in a cleanup pass. [`authenticate.hook.ts`]
- **ElevenLabs `xi-api-key` potentially captured in fetch error cause chain** — Some runtimes attach request headers to fetch `TypeError.cause`. If logged via `this.logger.warn({ err })`, the API key could appear in log storage. Validate against actual Node.js fetch error shape in staging before shipping to production log aggregation. [`voice.service.ts` — transcribe, streamTts]

## Deferred from: code review of 12-1-lumi-contracts-lumisurface-lumicontextsignal-lumiturnrequest (2026-04-29)

- **`LumiNudgeEventSchema` is not registered in the `InvalidationEvent` discriminated union** — `'lumi.nudge'` is not a member of the SSE union in `events.ts`. Story 12.11 implements proactive nudge SSE delivery; it must either fold `lumi.nudge` into `InvalidationEvent` or define a separate channel. Decide before 12.11 ships. [`packages/contracts/src/events.ts`, `packages/contracts/src/lumi.ts`]
- **`VoiceSessionCreateSchema` widening lets non-`'onboarding'` surfaces silently pass through to onboarding-only route** — `voice.routes.ts`/`voice.service.ts` ignore `context` and unconditionally use `'onboarding'` thread type. Until Story 12.5 introduces `/v1/lumi/voice/sessions`, the legacy route should runtime-reject non-`'onboarding'` contexts (HTTP 400). Story 12.1 spec explicitly forbids `apps/api` changes — must be a follow-up before 12.5 ships. [`apps/api/src/modules/voice/voice.routes.ts`, `apps/api/src/modules/voice/voice.service.ts`]
- **`LumiNudgeEventSchema` envelope lacks `thread_id` / event-id / timestamp** — Spec defines exactly `type` + `turn` + `surface`. SSE consumers cannot deduplicate or route without unpacking `turn`. Reconsider envelope-level routing/dedup metadata when 12.11 wires SSE delivery. [`packages/contracts/src/lumi.ts:59-63`]
- **`Turn.modality` is still optional** — Ambient Lumi mixes text and voice in one thread; modality semantics are ambiguous. Story 12.4 explicitly drops the modality discriminator from the thread uniqueness constraint. Verify whether the field is also removed from the `Turn` schema as part of that work. [`packages/contracts/src/thread.ts:75`]
- **`LumiThreadTurnsResponseSchema` does not cross-check that nested `turns[].thread_id` matches the outer `thread_id`** — Server-correctness concern. Add a `.refine()` only if a real ingestion path can produce mismatched turns. [`packages/contracts/src/lumi.ts:38-41`]
- **`voice.test.ts:22` "rejects unknown context" uses `'evening'` which is rejected only because it's not a `LumiSurfaceSchema` member** — If `'evening'` is ever added (or `'evening-check-in'` is renamed), this test silently flips to "accepts". Replace with a structurally invalid value (`null`, `123`, or `'__not_a_surface__'`). Pre-existing test file, not touched by 12.1. [`packages/contracts/src/voice.test.ts:22`]
- **`LumiTurnRequestSchema` strict-mode behavior is undefined** — Schema accepts unknown extra fields; no test asserts intended behavior; nothing prevents a future `.strict()` from silently breaking clients. Resolve as part of a project-wide schema strict-mode policy. [`packages/contracts/src/lumi.ts:31-34`]

## Deferred from: code review of 2-12-per-child-lunch-bag-slot-declaration (2026-04-29)

- **TOCTOU double-read in `setBagComposition` produces stale audit pre-image** — `findById` + `updateBagComposition` are two separate round-trips; a concurrent update between them yields a stale `old` value in the `child.bag_updated` audit record. Fix requires a DB-level CTE (`UPDATE ... RETURNING` with pre-image capture). [`apps/api/src/modules/children/children.service.ts:58-69`]
- **`assertCallerInHousehold` return type should be an assertion function** — currently typed as `void`; TypeScript cannot narrow control flow after the call. Should be `asserts callerHouseholdId is string` to provide compile-time guarantee that execution stops on mismatch. [`apps/api/src/modules/children/children.routes.ts:141-145`]
- **DB CHECK constraint doesn't validate `snack`/`extra` field types in `bag_composition`** — constraint only enforces `(bag_composition->>'main')::boolean = true`; a direct superuser DB write could store `{"main":true,"snack":"yes","extra":0}` without triggering the constraint. Zod guards at the API boundary are the effective protection. [`supabase/migrations/20260520000000_add_bag_composition_to_children.sql`]
- **Double-tap submit concurrency gap in `BagCompositionCard`** — two Save clicks within the same event-loop tick (before `pending` re-renders to `true`) can launch two concurrent PATCH requests that both call `onSaved`, duplicating the child in `savedChildren`. A ref-based in-flight guard would close this. [`apps/web/src/features/children/BagCompositionCard.tsx`, `apps/web/src/hooks/useSetBagComposition.ts`]

## Deferred from: code review of 2-6b-voice-pipeline-v2-hk-owned-websocket-elevenlabs-stt-tts (2026-04-28)

- **TOCTOU in `createSession` — no DB-level uniqueness constraint** — Two concurrent `POST /v1/voice/sessions` for the same household can both pass the `findActiveSessionForHousehold` null-check before either inserts, resulting in two `active` rows. Requires a partial unique index `(household_id) WHERE status = 'active'` in the DB schema. [`apps/api/src/modules/voice/voice.service.ts:78`]
- **No WS integration tests for AC2–AC7, AC12** — All WebSocket behaviors (audio processing, concurrent turns, timeout, client disconnect, TTS mid-stream failure) are untested. The dev agent record noted this as a gap. Recommend adding WS integration tests using `@fastify/websocket` test helpers or a real WS client in the test suite. [`apps/api/src/modules/voice/voice.routes.test.ts`]

## Deferred from: code review of 2-11-cultural-template-inference-parental-confirm Group 3 (2026-04-29)

- **404/403 on any action passes original action as `onResolved` action** — `_action` is intentionally ignored in `handleResolved` so the semantic mismatch has no runtime effect, but if analytics or audit instrumentation is added to `handleResolved` later, 404 removals will appear as user-initiated `forget` actions in logs. Document or rename parameter when analytics lands. [`apps/web/src/features/onboarding/CulturalRatificationCard.tsx:40`]
- **Multiple cards resolving simultaneously can double-fire `onComplete` edge case** — each `CulturalRatificationCard` has its own `useRatifyCulturalPrior` instance; two concurrent PATCH responses completing in the same microtask batch could both reach the `priors.length === 0` check before either state update commits. `queueMicrotask` is removed (Group 3 patch), reducing exposure, but full fix requires lifting `isPending` to step level. Defer until concurrency is exercised in practice. [`apps/web/src/features/onboarding/CulturalRatificationStep.tsx`]

## Deferred from: code review of 2-11-cultural-template-inference-parental-confirm Group 2 (2026-04-29)

- **`opt_in` from `forgotten` state is not explicitly blocked** — AC9 says "detected → opt_in_confirmed" but the service does not guard against `forgotten → opt_in_confirmed`; a household that has forgotten a template could re-opt-in. AC10 permits `forget` from any state (by design), so the inverse may be intentional. Needs spec clarification before Epic 3 planner reads prior data. [`apps/api/src/modules/cultural-priors/cultural-prior.service.ts:180`]
- **Supabase error path testing absent from routes tests** — mock `culturalPriorsTable` never returns `{ error: { message: '...' } }`; DB-level failures (network timeout, constraint violations, permission errors) are untested at the route layer. Add error-return test cases when the test infrastructure is revisited. [`apps/api/src/modules/cultural-priors/cultural-prior.routes.test.ts`]

## Deferred from: code review of 2-11-cultural-template-inference-parental-confirm Group 1 (2026-04-29)

- **`upsertDetected` re-run silently skips existing `detected` priors** — `ignoreDuplicates: true` means priors already at `detected` from a prior finalization run are not returned and not re-included in the ratification prompt on webhook retry. Intentional per spec forward-only state invariant; webhook retry idempotency is an ops concern for later. [`apps/api/src/modules/cultural-priors/cultural-prior.repository.ts`]
- **`lumi_response: z.string().optional()` vs AC5 requiring `lumi_response: string`** — optional() is correct for the shared response schema because opt_in and forget never return this field; a discriminated per-action response schema would be more precise but adds complexity without runtime benefit. [`packages/contracts/src/cultural.ts`]

## Deferred from: code review of 2-11-cultural-template-inference-parental-confirm (2026-04-28)

- **`upsertDetected` issues one DB round-trip per prior (max 6 sequential upserts)** — bounded by the Phase-1 template set; acceptable for current story scope. Batch-upsert optimisation deferred. [`apps/api/src/modules/cultural-priors/cultural-prior.repository.ts:51`]
- **No rate limit on `tell_lumi_more`** — each call invokes gpt-4o with no per-household cap. Infrastructure / middleware concern outside story scope. [`apps/api/src/modules/cultural-priors/cultural-prior.routes.ts:44`]
- **`<TrustChip variant="cultural-template">` not rendered** — component does not exist yet; inline sacred-plum span used as placeholder. Wire when TrustChip primitive lands. [`apps/web/src/features/onboarding/CulturalRatificationCard.tsx:55`]
- **`tell_lumi_more` keeps prior at `detected` indefinitely** — intentional behaviour; user is expected to pick a final action (opt_in / forget) after reading the follow-up. No change needed for this story. [`apps/api/src/modules/cultural-priors/cultural-prior.service.ts:116`]
- **No UX-DR45 linter rule for flag-emoji / "Celebrating X" ban** — tooling gap not introduced by this story. [`apps/web/src/features/onboarding/`]

## Deferred from: code review of 2-10-add-child-profile-with-envelope-encrypted-sensitive-fields (2026-04-28)

- **HouseholdsRepository not wired — AC 15 deferred to Story 5.5** — `HouseholdsRepository` exists and is unit-tested but is never imported or instantiated in live code. `caregiver_relationships` is always NULL in beta (no live code path writes to it). Story 5.5 (secondary caregiver invite redemption) must import and use `HouseholdsRepository` for all reads and writes to `caregiver_relationships` — that is the point at which AC 15 becomes exercisable. [`apps/api/src/modules/households/households.repository.ts`]

- **No AAD binding wrapped DEK to its household** — `wrapDek` uses plain AES-256-GCM with no additional authenticated data (AAD) tying the wrapped DEK to a specific household. A DEK wrapped for household A could theoretically be transplanted to household B's `encrypted_dek` column and would unwrap correctly, enabling cross-household decryption. Requires DB write access + KEK — already a total system compromise. Deferred; add AAD in a dedicated encryption hardening story before public launch. [`apps/api/src/lib/envelope-encryption.ts:40-46`]
- **Array element strings have no content validation beyond length** — allergens, cultural identifiers, and dietary preferences accept any non-empty string up to 100 chars. Values like `<script>alert(1)</script>` are schema-valid and stored encrypted. XSS risk depends entirely on rendering context (currently rendered as text nodes, not innerHTML). Deferred; add an allowlist or sanitiser if rendering context ever changes. [`packages/contracts/src/children.ts`]
- **CHILD_COLUMNS raw string — column-name typos silently return undefined fields** — Supabase JS returns any-typed rows; a misspelled column name in `CHILD_COLUMNS` produces `undefined` on the cast `ChildRow` with no TS error. Pre-existing pattern across all repositories in the codebase. Deferred until `supabase gen types` is wired into the build. [`apps/api/src/modules/children/children.repository.ts:43-44`]

## Deferred from: code review of 2-9-parental-notice-disclosure-pre-data-collection (2026-04-27)

- Unsafe `data as T` casts throughout `compliance.repository.ts` — Supabase JS returns `any`; fixing requires Supabase type generation (`supabase gen types`) applied codebase-wide. Not unique to this PR. Defer until type generation is wired into the build.
- `request.body as { document_version: string }` cast pattern in `compliance.routes.ts` — codebase-wide Fastify + Zod type-provider pattern. Defer until the type-provider generic threading is standardised across all route files.
- Service-level `findConsent` guard before `insertConsent` in `ComplianceService.submitVpcConsent` is redundant with the DB unique constraint backstop in `insertConsent` — adds a round-trip with no correctness benefit. Story 2.8 design carried forward. Defer to a compliance-module refactor pass.
- `findUserAcknowledgmentState` returns `null` for both "no acknowledgment" and "no users row" — indistinguishable from callers. Architecturally impossible for a valid JWT holder but creates a misleading `ParentalNoticeRequiredError` if a user row is deleted mid-request. Defer — fix requires a `NotFoundError` guard in both `acknowledgeParentalNotice` and `assertParentalNoticeAcknowledged`, coupled with a broader auth-invariant review.

## Deferred from: code review of 1-1-scaffold-apps-marketing-astro-and-packages-ui-workspace-package (2026-04-23)

- `@astrojs/check` pinned to `"latest"` not semver — CI non-determinism risk; intentional per Story 1.1 spec ("Astro-coupled"). Revisit in Story 1.2 when env/package wiring lands.
- `packages/ui/package.json` missing `exports` field — source-import convention matches rest of monorepo; acceptable for workspace-only packages. Revisit if `@hivekitchen/ui` ever needs to be published or consumed outside the monorepo.
- `packages/ui/tailwind.config.ts` relative `../design-system` import escapes package boundary — intentional Story 1.1→1.4 bridging pattern. Story 1.4 must resolve the `packages/design-system` vs `packages/ui/src/tokens` architectural split and replace this import.
- Tailwind `content: []` empty in `packages/ui/tailwind.config.ts` — stub; content globs and token values land in Story 1.4.
- `lint` and `typecheck` scripts in `apps/marketing` both run `astro check` — ESLint wiring is Story 1.5 scope; nothing to call for lint yet.
- `packages/ui` missing `lint` and `build` scripts — intentional empty barrel; scripts added when real components land.
- `packages/tsconfig/astro.json` extends `astro/tsconfigs/strict` not workspace base — intentional forward-compat decision; watch for drift if workspace base adds options that Astro upstream doesn't inherit.
- `tokenPresets = {}` silently no-ops `theme.extend` — placeholder; Story 1.4 replaces with v2.0 semantic token system.

## Deferred from: code review of 1-2-wire-workspace-package-json-scripts-dockerfile-per-app-env-local-example (2026-04-23)

- No `HEALTHCHECK` instruction in runner stage [apps/api/Dockerfile] — Fly.io config out of scope; healthcheck requires `/healthz` endpoint. Revisit with fly.toml story.
- `node:22-alpine` floating tag — no digest pin [apps/api/Dockerfile] — standard for dev-stage Dockerfiles; harden with digest pin in productionization/deploy story.
- `packages/contracts` and `packages/types` TypeScript sources in Docker deploy closure [apps/api/Dockerfile] — documented forward concern in story Dev Notes; surfaces when Story 1.3/1.6 introduce workspace-package imports into the API. Two remediation paths: (1) add tsc build step to shared packages, (2) bundle API with esbuild/tsup.
- `PORT` hardcoded in `apps/api/src/server.ts`, not read from env [apps/api/src/server.ts] — pre-existing from Story 1.1; Story 1.6 owns Zod env validation and server binding.
- `JWT_SECRET` placeholder lacks a generation command hint [apps/api/.env.local.example] — enhancement; consider `# Generate: openssl rand -hex 32` in Story 1.6's env template alignment pass.
- `test/helpers/` has no `tsconfig.json` — latent; surfaces when real seed logic replaces the stub and adds workspace-package imports or path aliases.
- Pre-existing `rm -rf dist` in `apps/api/package.json` clean script — not introduced by this diff; cross-platform chore for Story 1.5.

## Deferred from: code review of 1-4-establish-token-system-v2-0 (2026-04-23)

- Root-relative `/fonts/...` paths in `typography.css` break on non-`/` base-path deployments — known limitation per spec; current deployment model is root-only. Revisit in productionization/deploy story if sub-path is ever needed.
- Font file tests skip in CI (`it.skipIf(!!process.env.CI)`) — spec-intentional; fonts are committed assets so divergence requires an explicit code change. Revisit if CI environment diverges from repo state (e.g., large-file storage migration).
- Tailwind opacity modifiers (`bg-sacred-500/50`) silently produce no output when color tokens are `var()` references — known architectural tradeoff of two-layer CSS-var + Tailwind-preset approach. Document as constraint; revisit if opacity modifier usage is required in Epic 2+ components.
- Dark mode has no `prefers-color-scheme` initialization — always renders light mode on first paint — explicitly deferred per Story 1.4 spec; theme toggle JS belongs in a later story (preference persistence, OS detection).

## Deferred from: code review of 1-3-establish-foundation-gate-contracts-in-packages-contracts (2026-04-23)

- `WeeklyPlan.weekOf: z.string()` unconstrained [packages/contracts/src/plan.ts] — pre-existing from Story 1.1; not touched by 1.3.
- UUID validators across contracts accept the nil UUID `00000000-0000-0000-0000-000000000000` — sentinel-rejection policy belongs with Story 1.6 boundary/env work or global architecture guidance.
- `Turn.created_at`, `PresenceEvent.expires_at`, `ForgetCompletedEvent.completed_at` accept ISO strings without seconds — Zod `.datetime()` default; revisit when Story 1.10 pins wire-format precision.
- `PantryDelta` (unexported internal stub in `events.ts`) parses `{}` as a valid delta — Epic 3+ pantry domain will refine.
- `ApiError.fields[].code` reuses `ErrorCode` which mixes request-level and field-level semantics — future split into `FieldErrorCode` (e.g., `FIELD_REQUIRED`, `FIELD_INVALID_FORMAT`).
- `contracts:check` soft spots beyond the P3 `.tsx` fix: file-scoped `@unused-by-design` exemption; regex misses `export function` / `export type` / `export { X }` / multiline exports; `exportedNames` map silently overwrites on duplicate export names across files. All latent — no current violations.
- `z.string().datetime()` default rejects timezone offsets (accepts only `Z`-suffixed UTC) — use `{ offset: true }` if downstream producers emit offsets. Pin in Story 1.10 SSE wire-format pass.
- No `engines.node` declared at root or in `packages/contracts` — `check.ts` depends on Node 22+ (`globSync`, `import.meta.dirname`). Add `"engines": { "node": ">=22" }` in a root-hygiene or Story 1.6 pass.

## Deferred from: code review of 1-5-scope-charter-eslint-scope-allowlist-rules-dev-mode-runtime-assertions (2026-04-24)

- Shorthand `margin: '0 0 0 8px'` / `padding: '...'` with embedded physical values are not flagged by `logical-properties-only` — deferred; spec scope was long-hand properties only. Revisit when a shorthand-to-logical codemod pass is warranted.
- Physical non-margin/padding properties (`left`/`right`/`top`/`bottom`/`borderLeft`/`borderRight`/`textAlign: 'left'`) are not in the logical map — deferred; spec scope limited to margin/padding mapping.
- `import.meta.env.DEV` may be undefined under Vitest when hook tests land — deferred; handle with a test-setup shim when `useScopeGuard` hook tests are written.
- `apps/web/eslint.config.mjs` imports the scope allowlist via relative path `../../packages/ui/src/scope-allowlist.eslint.js` — deferred; fragile but functional. Replace with a proper `packages/ui/package.json#exports` entry when a subpath export is added for other reasons.
- Re-export barrel inside `apps/api/src/plugins/` would circumvent `no-restricted-imports` (a plugin could `export * from 'openai'` and be imported elsewhere) — deferred; plugins/ is small enough that a review catches this today.
- `no-cross-scope-component` does not visit dynamic `import()` or `require()` — deferred; rare pattern in Vite/React apps for components.
- Type-only imports flagged identically to runtime imports in `no-cross-scope-component` — deferred; cosmetic, type-only imports render nothing.
- Low-severity edge collection: allowlist substring match is positional-agnostic; arbitrary Tailwind values with spaces may split mid-match; computed style object keys (`{[key]: val}`) pass unchecked; `ScopeClass` has no runtime string validation for JS callers; the dev-mode scope guard does not observe subsequent DOM class mutations after mount — deferred as a batch; address if/when a real-world miss surfaces.

## Deferred from: code review of 1-6-wire-fastify-plugins-zod-env-validation-in-apps-api (2026-04-24)

- SendGrid decorator uses `as unknown as MailService` double-cast instead of spec's `as MailService` [apps/api/src/plugins/sendgrid.plugin.ts:7] — cosmetic TS cast; runtime shape is correct.
- BullMQ plugin omits local `BullMQFacade` interface and imports `Processor` type instead of `Parameters<typeof Worker>[1]` [apps/api/src/plugins/bullmq.plugin.ts:3-13] — typing reaches the same shape via `fastify.d.ts`.
- No `timeout`/`maxRetries` overrides on OpenAI / ElevenLabs / Twilio / Supabase clients — SDK defaults let slow upstreams hold Fastify request handlers for minutes; tune in a later performance/observability pass.
- `remapPaths()` uses first-match `String.replace` and silently drops non-string `files`/`ignores` entries [apps/api/eslint.config.mjs:11-22] — no current patterns trip it; revisit if flat-config entries gain RegExp/array shapes.
- `SUPABASE_URL` / `REDIS_URL` schemes not validated — `z.string().url()` accepts `http://`, `ftp://`, `javascript:`. Add `.refine()` on scheme in env-hardening pass.
- `PORT=""` (empty string) produces `NaN` rather than applying `.default(3001)` — Zod semantic; `z.coerce.number()` only uses the default when the key is `undefined`.
- `JWT_SECRET: z.string().min(32)` counts characters not bytes — comment says "32 bytes" but validation is on string length. Tighten with base64/hex decoded-byte refine later.
- `OTEL_EXPORTER_OTLP_HEADERS` format (`k=v,k=v`) not validated — malformed values pass Zod and fail silently inside the exporter at runtime; address with OTEL observability story.
- `sgMail.setApiKey` is a module-global singleton mutation with no reset on `onClose` — test-scope isolation concern only; tests that rebuild the app with different keys can leak across suites.
- Integration test `if (app) await app.close()` contradicts `let app: FastifyInstance` non-nullable declaration [apps/api/test/integration/plugins.int.test.ts] — runtime safe; tighten to `let app: FastifyInstance | undefined` when integration story resumes.
- `vitest.config.ts` include has redundant glob (`test/**/*.test.ts` already matches `.int.test.ts`) — Vitest dedupes; cosmetic.
- Vitest coverage reporter omits `lcov` — add when CI coverage aggregation story lands.
- `ELEVENLABS_WEBHOOK_SECRET` / `STRIPE_WEBHOOK_SECRET` required but unused by Story 1.6 — developers populate dummies that would later pass signature checks vacuously; revisit `.min()` / format when webhook stories land.
- No Supabase service-role-key liveness check on startup [apps/api/src/plugins/supabase.plugin.ts] — invalid/revoked keys surface only at first query. Startup probe story.
- Extensive unrelated working-tree changes (`packages/ui/*`, `apps/web/*`, `_color-gen.mjs`, `packages/eslint-config-hivekitchen/*`) outside Story 1.6 scope — tracked for separate PRs or prior-story rollups. Appears to include uncommitted Story 1.5 artifacts.
- Plugin registration ordering not type-enforced (a future reorder past `app.decorate('env', env)` would give SDK plugins `undefined`) [apps/api/src/app.ts:27-30] — Fastify pattern limitation; no feasible type-level guard.
- No global `unhandledRejection` / `uncaughtException` handlers routing through Pino [apps/api/src/server.ts] — deferred to Story 1.7 (Pino structured logging / OTEL skeleton scope).

## Deferred from: code review of 1-8-single-row-audit-log-schema-monthly-partitions-composite-index-audit-service-write (2026-04-24)

- [W1] Service role key shared across all requests — pre-existing architecture decision; single Supabase client with service-role key bypasses RLS system-wide. Revisit when per-request user context / RLS story lands (Epic 2).
- [W2] No FK/RLS on `household_id`/`user_id` in `audit_log` — explicitly deferred to Epic 2 in story Dev Notes; add FK + RLS policies when auth is wired.
- [W3] BullMQ `Worker` error event not explicitly handled in `audit-partition-rotation.job.ts` — pre-existing concern in `bullmq.plugin.ts`; verify plugin attaches a global `.on('error', ...)` handler; harden when BullMQ worker story lands.
- [W4] `AuditWriteInput` UUID fields (`household_id`, `user_id`, `correlation_id`, `request_id`) have no runtime validation — only TypeScript compile-time safety; add Zod validation at API boundary when audit writes are wired to routes (Epic 2).
- [W5] `audit_log_guardrail_rejections_idx` is partition-scoped only — Postgres partial index cannot serve cross-partition queries; known architectural limitation. Ops dashboard queries must always include a partition-key filter. Note when building Epic 9 dashboard queries.
- [W6] Direct `new AuditRepository(fastify.supabase)` instantiation in `audit.hook.ts` — matches spec intent; no DI container yet. Revisit if `AuditService` gains initialization cost or needs to be shared across multiple callers (Epic 2+).
- [W7] `BaseRepository` uses untyped `SupabaseClient` (no database generic) — `.from()` calls are `any`-typed at compile time. Defer until `supabase gen types typescript` is wired against a live Supabase instance (Epic 2). [apps/api/src/repository/base.repository.ts]

## Deferred from: code review of 1-7-pino-structured-logging-opentelemetry-skeleton-grafana-cloud-otlp (2026-04-24)

- `parseOtelHeaders` silently drops malformed header pairs (e.g., `Authorization:Bearer`) without warning — add a startup warning log or throw in OTEL hardening story. [apps/api/src/observability/otel.ts]
- Shallow `*` wildcard in `REDACT_PATHS` misses PII nested deeper than two levels — requires established log-shape guarantees; address in a dedicated observability hardening pass. [apps/api/src/common/logger.ts]
- `shutdownOtel()` errors not caught in `onClose` hook — add try/catch with timeout for clean graceful shutdown in OTEL hardening story. [apps/api/src/plugins/otel.plugin.ts]
- No `testTimeout` or pool isolation in `vitest.config.ts` — harden when CI integration is active and OTEL tests run against a real SDK. [apps/api/vitest.config.ts]

## Deferred from: code review of 1-9-tools-manifest-ts-skeleton-with-ci-lint-no-tool-without-manifest (2026-04-24)

- `toolName` unsanitized in Redis key interpolation [tool-latency.histogram.ts:12] — internal caller; toolName comes from manifest (`<domain>.<verb>` convention). Re-evaluate if toolName ever becomes externally influenced.
- `zadd` same-millisecond member collision silently drops a sample [tool-latency.histogram.ts:16] — loss of one sample at sub-ms granularity irrelevant for p95. Address in Story 3.4 if precision matters.
- Negative `latencyMs` values accepted without bounds check [tool-latency.histogram.ts] — internal caller; value derives from `Date.now() - start` (always ≥ 0). Add validation in Story 3.4 when public orchestrator API is defined.
- `spec[field] === undefined` passes `null` field values [check-tool-manifest.ts:68] — TS strict mode prevents null assignment; only reachable via runtime type bypass.
- `extractManifestNames` does not verify array elements are strings [check-tool-manifest.ts:20] — TS enforces `readonly string[]`; non-string elements require deliberate type bypass.
- `mockRedis` shared at `describe` scope — future test isolation risk [tool-latency.histogram.test.ts:6] — current tests unaffected; re-evaluate when Story 3.4 adds `mockResolvedValueOnce` patterns.
- GitHub Actions pinned to major tags, not commit SHAs — supply chain risk [ci.yml] — project-wide; address in a dedicated DevSecOps hardening story.
- Node 22 `engines` field missing from root `package.json` — project-wide; carry forward to a root-hygiene pass (see also 1-3 deferred log).
- Redis failure paths not tested in histogram unit tests [tool-latency.histogram.test.ts] — Story 3.4 scope when orchestrator wires live Redis calls.

## Deferred from: code review of 1-10-realtime-sse-bridge-central-invalidationevent-dispatcher (2026-04-24)

- Auth on `/v1/events` — explicitly deferred to Story 2.2 per spec; stub is open and unauthenticated.
- Redis pub/sub fan-out and actual event delivery on the SSE endpoint — Story 5.2; stub only writes `:ping` heartbeats today.
- `Last-Event-ID` Redis event-log replay (≥6h retention) on the server — Story 5.2; the bridge correctly does NOT strip `Last-Event-ID` (AC #4) but the server has no replay buffer.
- `client_id` echo suppression at the server — Story 5.2; without it, optimistic-mutation echoes can race with local state.
- Server-side `thread.turn` deduplication, reordering, and cached-array cap — Story 5.x; the bridge appends faithfully per AC #2 and trusts server contract for ordering.
- `reportThreadIntegrityAnomaly` is a no-op in production (only `console.warn` in DEV) — real `POST /v1/internal/client-anomaly` beacon is Story 5.17 per spec stub note.
- `thread.resync.from_seq` plumbing into the thread loader (so refetch starts from the resync point, not the stored cursor) — Story 5.1.
- `queryClient.clear()` on logout to evict cached PII (child names, allergies, heart notes) — auth flow not yet present (Story 2.2).
- Server graceful drain on SIGTERM for long-lived SSE connections (Fastify `app.close()` will hang on open SSE handlers) — operational, post-Story 5.2.
- Rate limit / connection cap per IP on `/v1/events` — Story 5.x operational hardening; current stub allows unbounded anonymous connections.
- `audit-hook` `onResponse` fires when the SSE stream closes — recorded request duration is the entire connection lifetime, skewing dashboards. Surfaces with Story 5.2 / Epic 9.
- `App.tsx` reads `window.location.pathname` inside render — works today by accident (no SPA router triggers re-render); fragile to future react-router integration in Epic 2.
- `apps/web/vitest.config.ts` uses `__dirname` instead of `import.meta.url` + `fileURLToPath` — tooling-config drift; the project invariant targets `src/` files. Low risk; tidy in a tooling-hygiene pass.

## Deferred from: code review of 1-12-contrast-audit-harness-in-packages-design-system (2026-04-24)

- `--passWithNoTests` flag in `@hivekitchen/design-system` test script masks silent test discovery failure — test currently discovered and runs correctly (22 passed); vitest default `include` pattern already picks up `contrast-audit.test.ts` at package root. Revisit if vitest config gains explicit `include` restrictions or if a future story adds test count assertions.

## Deferred from: code review of 1-13-anchor-device-perf-budgets-lighthouse-ci-in-github-workflows-perf-yml (2026-04-24)

- `window.__hivekitchen_qc` exposure risk if `VITE_E2E=true` accidentally included in a non-test deployment — implementation is correct (Vite tree-shakes when unset); deployment hygiene concern. Revisit in a deployment/secrets hardening story.
- Lighthouse budgets audit the unauthenticated route (`/`) which is likely a login redirect, not the actual app shell — no meaningful perf signal until auth routes exist. Revisit at Epic 2 (Household Onboarding) when authenticated routes are available.
- `sse-timing` GHA job silently relies on the `VITE_E2E`-enabled `web-dist` artifact from the `build` job; if the build job ever changes, `__hivekitchen_qc` will be absent and Playwright times out with a cryptic `waitForFunction` error instead of a clear failure. Add a comment or a smoke-check step in a future CI hardening pass.

## Deferred from: code review of 1-14-pr-template-with-patterns-checklist-ci-orchestration (2026-04-25)

- `quality` job renamed from `ci` — admin must update required-status-check labels in GitHub branch protection after merge (documented in Dev Notes); also remove the old `Typecheck · Lint · Test · Manifest` label and add `Typecheck · Lint · Test · Contracts · Manifest`, `E2E · A11y`, `DB schema drift check`. [`.github/workflows/ci.yml`]
- `supabase/config.toml` auth defaults from `supabase init` (enable_confirmations=false, minimum_password_length=6, secure_password_change=false) are local-dev defaults and should not be pushed to remote without override. Epic 2 auth setup must configure production auth values before any remote `supabase push`. [`supabase/config.toml`]
- `supabase/.gitignore` has no `seed.sql` exclusion; `config.toml` references `./seed.sql` as a seed path. Ensure seed.sql is added to supabase/.gitignore before Epic 2 creates it, to prevent accidental commit of fixture data. [`supabase/.gitignore`]
- `contracts:check` script uses `globSync` from `node:fs` (requires Node ≥22) with no `engines` field guarding the root `package.json`. Pre-existing from Story 1.3. Add `"engines": { "node": ">=22" }` in a root-hygiene pass.
- `turbo.json` has no registered tasks for `contracts:check` or `tools:check` — these scripts bypass Turbo remote cache. Story 1.14 explicitly deferred turbo.json changes. Wire in a future CI acceleration story if build times warrant it.
- `CODEOWNERS` uses personal account `@hivelumeadmin` — a PR author who is also the sole CODEOWNERS member bypasses the review requirement. Migrate to a named GitHub team handle once teams are configured. [`.github/CODEOWNERS`]
- Playwright/LH `webServer` start timeout is 15 s in `playwright.config.ts` and `lighthouserc.json` — tight on cold GitHub free-tier runners. Pre-existing from Story 1.13. Raise to 30 000 ms if flaky server-start timeouts emerge.
- `supabase/config.toml` auth timing defaults (`refresh_token_reuse_interval=10`, session lengths, etc.) are Supabase init defaults. Review and override before linking to a remote Supabase project in Epic 2.
- Fork PRs silently receive `TURBO_TOKEN=""` (GitHub Actions does not pass secrets to fork workflows) — Turborepo falls back to local cache only on every fork/dependabot PR. Documented graceful fallback; no action needed until fork-PR CI time becomes a concern.
- `e2e` job `--ignore-glob="**/perf/**"` glob is resolved relative to Playwright `testDir` on the CI runner's OS. Currently ubuntu-latest (Linux); glob is correct. If self-hosted Windows runners are ever added, verify glob separator handling.

## Deferred from: code review of 2-1-supabase-auth-email-password-google-apple-oauth — full review (2026-04-25)

- No `/v1/auth/refresh` endpoint — access tokens expire after 15 min with no recovery path until Story 2.2 implements token rotation. [`apps/api/src/modules/auth/`]
- Expired refresh tokens not checked at query time — `expires_at` column exists but no query reads it; expiry enforcement belongs in the refresh endpoint (Story 2.2). [`apps/api/src/modules/auth/auth.repository.ts`]
- No TTL cleanup job for `refresh_tokens` — table grows unbounded; add a nightly expiry-purge job in a future ops story. [`supabase/migrations/20260501125000_create_refresh_tokens.sql`]
- Access token stored in Zustand (XSS-readable) — accepted per AC4 spec; no localStorage used. Mitigated by 15 min TTL. [`apps/web/src/stores/auth.store.ts`]
- `auth.store` not persisted across page reloads — by design per AC4; silent refresh via refresh token is Story 2.2. [`apps/web/src/stores/auth.store.ts`]
- `authRoutes` instantiates `AuthService` + `AuthRepository` directly inside the plugin — works for a once-registered plugin; migrate to `fastify.decorate` pattern in a future refactor. [`apps/api/src/modules/auth/auth.routes.ts`]
- New `family_id` per login orphans the token rotation chain — Story 2.2 reuse-detection logic must link families across re-logins. [`apps/api/src/modules/auth/auth.service.ts:75`]
- `insertRefreshToken` separate from the `create_household_and_user` RPC — low-probability partial-write on first login if the insert fails after the RPC succeeds; existing error handler prevents a response from being sent. [`apps/api/src/modules/auth/auth.service.ts:72-79`]
- OAuth PKCE state not validated server-side — server-side `exchangeCodeForSession` runs on the service-role client with no PKCE verifier; short-lived single-use codes are the practical mitigation for beta. Add explicit state/nonce storage and server-side validation in a hardening epic before public launch. [`apps/api/src/modules/auth/auth.service.ts`]

## Deferred from: code review of 2-1-supabase-auth-email-password-google-apple-oauth (2026-04-25)

- `callback.tsx` provider coercion (`?? 'google'`) fires before schema validation — any non-`'apple'` query param (including invalid values) collapses to `'google'` before the body is assembled, so `OAuthCallbackRequestSchema`'s enum check never rejects an invalid provider. Flagged in contracts/types chunk; address in web chunk review. [`apps/web/src/routes/auth/callback.tsx`]
- `next` query parameter reflected into `navigate()` with no allowlist — open redirect; `navigate()` accepts absolute URLs, so `?next=https://evil.com` after a valid OAuth exchange navigates the browser off-site. Flagged in contracts/types chunk; address in web chunk review. [`apps/web/src/routes/auth/callback.tsx`]
- Apple OAuth can return no email (`data.user.email ?? ''`) — empty string passes into `createHouseholdAndUser` and gets persisted, then fails `AuthUserSchema`'s `.email()` check on serialization, producing a 500 instead of a handled error. Flagged in contracts/types chunk; address in service chunk review. [`apps/api/src/modules/auth/auth.service.ts`]

## Deferred from: code review of 2-2-4-role-rbac-prehandler-jwt-rotation-on-use (2026-04-25)

- Partial write window between `insertRefreshToken` and `consumeRefreshToken` — crash between the two steps leaves an orphaned new-token row; the client retries with the original (unconsumed) old token and succeeds on retry. Orphaned rows are non-exploitable but accumulate. TTL cleanup job (deferred from 2-1) will purge them. [`apps/api/src/modules/auth/auth.service.ts:87-94`]
- `householdScopeHook` accepts any non-empty string as `household_id` — whitespace or non-UUID values pass the guard. JWTs are signed by this API with validated DB UUIDs, so not exploitable from the login path. Validate UUID format in a future hardening pass. [`apps/api/src/middleware/household-scope.hook.ts:8`]
- `extractZodIssues` `.validation` array check missing `statusCode === 400` narrowing — pre-existing, deferred from Story 2-1 review. Any future custom error with an array `.validation` property could be misclassified as a 400. [`apps/api/src/app.ts`]
- `login.tsx` flash of login page for already-authenticated users — `useEffect`-based redirect fires after first render; brief flash before redirect to `/app`. Address in a UX polish pass. [`apps/web/src/routes/auth/login.tsx:24`]
- TOCTOU migration `20260501120500`: orphaned household has stale `primary_parent_user_id` FK — the losing concurrent first-login inserts a `households` row whose `primary_parent_user_id` points to a user whose `current_household_id` is the winning household. Future maintenance job should clean up orphaned households. [`supabase/migrations/20260501120500_create_household_and_user_idempotent.sql`]
- RLS `households_member_select_policy` subquery creates N+1 per-row security evaluation — `SELECT current_household_id FROM users WHERE id = auth.uid()` runs under RLS per row evaluated. Use a `SECURITY DEFINER` helper function or lateral join at scale. [`supabase/migrations/20260502090000_enable_rls_users_households.sql`]
- Double-slash URL `//v1/auth/login` bypasses `authenticate.hook.ts` skip-list prefix check — Fastify normalises double slashes at the routing layer so practically unreachable. Flagged for awareness if a non-standard reverse proxy is introduced. [`apps/api/src/middleware/authenticate.hook.ts:15`]
- Coverage gaps: `revokeAllByFamilyId` not verified at route layer in `auth.routes.test.ts`; no regression test for `insertRefreshToken` failure during `refreshToken`. Service-layer tests cover revocation logic. [`apps/api/src/modules/auth/auth.routes.test.ts`]

## Deferred from: implementation of 2-1-supabase-auth-email-password-google-apple-oauth (2026-04-25)

- Live `pnpm supabase:reset` verification of the three new migrations was skipped because Docker Desktop was not running on the dev machine. Migrations are direct copies of the spec; next dev with Docker should run `npx supabase start && pnpm supabase:reset && pnpm seed:dev` and confirm `\d users`, `\d households`, `\d refresh_tokens`, and `SELECT typname FROM pg_type WHERE typname='user_role';` succeed. [`supabase/migrations/`]
- Live `pnpm dev:api` smoke (with real Supabase env values) was not performed in this story; only `pnpm typecheck` validates env-schema parsing. Verify before any deploy that all six new env keys (SUPABASE_ANON_KEY, four OAuth credentials, WEB_BASE_URL) are populated in `.env.local`. [`apps/api/.env.local.example`]
- The `users.role` column defaults to `'primary_parent'` on insert, but only the bootstrap `create_household_and_user` RPC explicitly sets it. Story 2.3 (secondary-caregiver invite) needs to override this default at user creation time — document the override path when wiring 2.3. [`supabase/migrations/20260501120000_create_users_and_households.sql`]
- `auth.service.logout()` revokes the HK refresh-token row but does NOT call `supabase.auth.signOut({ scope: 'global' })` for the underlying Supabase session. The Supabase JWT issued by `signInWithPassword` is therefore still valid until its natural expiry (1 h default) — a hostile-cookie scenario could replay it against Supabase directly. Acceptable for 2.1 because the API is the only consumer, but Story 2.2 should call `auth.admin.signOut(supabase_session_token, 'global')` once we persist the Supabase session token alongside the HK refresh row. [`apps/api/src/modules/auth/auth.service.ts`]
- `setRefreshCookie` reads `env.NODE_ENV !== 'development'` for the Secure flag — this means `staging` and `test` get Secure (correct for staging, accidentally broken for `test` if any future browser-based test runs against an http test server). Add a `secure: env.NODE_ENV === 'production' || env.NODE_ENV === 'staging'` guard if test breakage emerges. [`apps/api/src/modules/auth/auth.routes.ts`]
- The frontend `/` route currently `Navigate`s to `/auth/login` for everyone — once Story 2.2 adds `authenticate.hook.ts` and a session-bootstrap query, swap this for an "if authed → /app, else → /auth/login" guard. The current redirect is intentional for 2.1 because no client-side session detection exists yet. [`apps/web/src/app.tsx`]
- `apps/web/src/lib/supabase-client.ts` constructs the client at module-load even when the user never reaches the login page (e.g., direct deep-link to a public marketing route once Epic 11 lands). Consider lazy initialization if cold-start bundle size becomes a concern. [`apps/web/src/lib/supabase-client.ts`]
- The fastify-type-provider-zod validation-array branch in the global error handler hand-rolls a "ZodError-like" pseudo-issue array. If `fastify-type-provider-zod` v5+ changes the validation shape, this branch silently drifts. Replace with a direct call to the library's documented error-mapping helper if/when one ships. [`apps/api/src/app.ts`]
- **Discovered during 2.1 live smoke** (out of 2.1 scope, pre-existing from Story 1.8): `apps/api/src/jobs/audit-partition-rotation.job.ts` declares `QUEUE_NAME = 'audit:partition-rotation'`. BullMQ v5 rejects queue names containing `:` ("Queue name cannot contain :") because Redis keys are colon-separated internally — this prevents `pnpm dev:api` from booting. Rename to `audit-partition-rotation` (and update any operator dashboards/queries that reference the old name) in a Story-1.8 follow-up. [`apps/api/src/jobs/audit-partition-rotation.job.ts`]

## Deferred from: code review of 1-15-upgrade-typescript-5-to-6 (2026-04-25)

- `@hivekitchen/tsconfig` package has no `typescript` devDependency — pre-existing condition; the package is config-only and has no devDependencies at all. TypeScript version enforcement is distributed across each workspace package's own `package.json`. No blocking issue; revisit if a canonical single-pin location is ever desired. [`packages/tsconfig/package.json`]

## Deferred from: code review of 2-1-supabase-auth-email-password-google-apple-oauth (chunk 3: migrations, 2026-04-25)

- `LoginRequestSchema.password` uses `.min(12)` — matches Supabase `minimum_password_length = 12` so registered users always satisfy it; low risk for greenfield beta. Revisit if users are ever migrated from a lower-minimum Supabase project. [`packages/contracts/src/auth.ts:6`]
- RLS migration `20260502090000_enable_rls_users_households.sql` shipped in Story 2.1 despite AC8 deferring RLS to Story 2.2. Migration was needed to support Story 2.2.4 (RBAC preHandler) shipped simultaneously; justified scope creep. Track for retrospective note. [`supabase/migrations/20260502090000_enable_rls_users_households.sql`]

## Deferred from: code review of 2-1-supabase-auth-email-password-google-apple-oauth (chunk 4: auth module, 2026-04-25)

- `revokeAllByFamilyId` on reuse-detection path swallows all errors with `catch {}` — family tokens remain live on transient DB failure with no log visibility. Requires logger injection into `AuthService` (currently no logger constructor param). [`apps/api/src/modules/auth/auth.service.ts:113-119`]
- `account.created` audit is fire-and-forget (void + catch) — silently unrecorded on transient DB failure. Consistent with fire-and-forget audit pattern throughout, but not durable. [`apps/api/src/modules/auth/auth.routes.ts:34-41`]
- `POST /v1/auth/logout` returns 204 when no cookie present — unauthenticated callers generate null-user audit rows; idempotent logout accepted as deliberate design choice. [`apps/api/src/modules/auth/auth.routes.ts:113`]
- `auth.token_reuse_revoked` audit set via `request.auditContext` then immediately throws — event written via `onResponse` hook after error response; process death between response and hook loses a security-critical event. Inherent in fire-and-forget hook architecture. [`apps/api/src/modules/auth/auth.routes.ts:86-91`]
- `create_household_and_user` SQL function relies on schema column defaults for `tier_variant='beta'` and `timezone='America/New_York'` rather than explicit INSERT values — correct today but fragile to future default changes. [`supabase/migrations/20260501120500_create_household_and_user_idempotent.sql:31`]

## Deferred from: code review of 2-1-supabase-auth-email-password-google-apple-oauth (chunk 5: web layer, 2026-04-25)

- No test file for `callback.tsx` — most complex web route (async effect, navigation side-effects, single-use OAuth code). Requires jsdom + React Testing Library + mocked `hkFetch`. Medium effort; no security impact — all auth logic is server-side. [`apps/web/src/routes/auth/callback.tsx`]
- `supabase-client.ts` casts `import.meta.env.VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to `string` with no runtime check — undefined env var produces a confusing SDK error at runtime. Add Zod/explicit env validation on web app bootstrap (similar to `apps/api/src/common/env.ts`). [`apps/web/src/lib/supabase-client.ts:10-11`]

## Deferred from: code review of 1-16-upgrade-zod-3-to-4 (2026-04-25)

- `zod-resolver.ts` silently drops root-level schema refinement errors — `if (path && !errors[path])` skips issues with empty `path` array; no root-level `.refine()` currently in `LoginRequestSchema`, so latent only. [`apps/web/src/lib/zod-resolver.ts:15`]
- `zod-resolver.ts` flat dot-path keys for nested errors (`"address.zip"` instead of `{ address: { zip: {...} } }`) — RHF resolver contract expects nested `FieldErrors<T>`; requires `toNestErrors` equivalent. Not active with current flat schemas but breaks any future nested form. [`apps/web/src/lib/zod-resolver.ts:14`]
- `zod-resolver.ts` missing `context` and `options` params — `criteriaMode: 'all'` and native validation silently ignored; cast `as unknown as Resolver<T>` suppresses type error. [`apps/web/src/lib/zod-resolver.ts:9`]
- Old-format UUIDs (`1111-1111`, `2222-2222`) surviving in `auth.service.test.ts`, `authenticate.hook.test.ts`, `login.test.tsx` — inconsistent with RFC 4122 v4 fix applied elsewhere; not causing current test failures (IDs don't flow through `.uuid()` validation in affected tests).
- `lists.ts` and `voice.ts` not explicitly audited per AC2 — both compile correctly under Zod 4 with no breaking changes; documentation gap only. [`packages/contracts/src/lists.ts`, `packages/contracts/src/voice.ts`]
- `z.discriminatedUnion()` and `ZodError.issues` Zod 4 compatibility not explicitly documented — implicitly verified by passing typecheck and tests.
- pnpm patch for `fastify-type-provider-zod` fixes a runtime bug not covered by AC3 (typecheck only); no integration test exercises a body-validation-failure → patched `createValidationError` path end-to-end. [`patches/fastify-type-provider-zod@4.0.2.patch`]

## Deferred from: code review of 2-4-account-profile-management-recovery (2026-04-26)

- No rate limiting on `POST /v1/auth/password-reset` — free email-bombing vector against any address; infra/middleware concern outside story scope. [`apps/api/src/modules/users/user.routes.ts`]
- `preferred_language` accepts any 2–10 char string with no locale validation — garbage values stored and returned silently. Locale validation is a future story concern. [`packages/contracts/src/users.ts`]
- `fastify-plugin` (`fp`) scoping means `/v1/auth/password-reset` auth-skip depends on global SKIP_PREFIXES — footgun if auth is ever moved to a plugin-scoped preHandler. [`apps/api/src/modules/users/user.routes.ts`]
- `.single()` in `updateUserProfile` throws PGRST116 if the user row is deleted between auth check and DB update — unmapped raw error, extremely unlikely race. [`apps/api/src/modules/users/user.repository.ts`]
- `updateUser` Zustand action silently no-ops when `state.user` is null (e.g., concurrent logout during a slow PATCH) — acceptable silent behaviour for this race. [`apps/web/src/stores/auth.store.ts`]
- `/v1/auth/` blanket `SKIP_PREFIXES` entry is an implicit convention — any future route added under `/v1/auth/` is unauthenticated by default without any explicit marker. Architectural doc concern. [`apps/api/src/middleware/authenticate.hook.ts`]
- Supabase mock chain in tests hardcodes method-chaining order — column name changes or query restructuring pass tests undetected. Accepted test-mock pattern in codebase. [`apps/api/src/modules/users/user.routes.test.ts`]
- Password-reset test does not assert that no auth token is required — nice-to-have assertion to confirm public-route intent. [`apps/api/src/modules/users/user.routes.test.ts`]

## Deferred from: implementation of 2-3-secondary-caregiver-invite-primitive (2026-04-26)

- Pre-existing baseline `pnpm typecheck` failure on `main` from Dependabot bump #21 (`stripe` 16.12.0 → 22.1.0): `apps/api/src/plugins/stripe.plugin.ts:6` sets `apiVersion: '2026-04-22.dahlia'` but the installed `stripe@22.1.0` types pin to `'2024-06-20'`. Not introduced by Story 2.3; confirmed by stash-and-typecheck against pristine main. Blocks the Story 2.3 exit gate `pnpm typecheck`. Suggested fix: bump `stripe` SDK to a version that recognizes the configured apiVersion, OR cast through `Stripe.LatestApiVersion`. [`apps/api/src/plugins/stripe.plugin.ts:6`]

## Deferred from: code review of 2-3-secondary-caregiver-invite-primitive-signed-jwt-single-use-jti-14-day-ttl (2026-04-26)

- **OAuth → `is_first_login` → onboarding redirect silently discards invite** — if a new user signs up via OAuth while following an invite link, `callback.tsx` redirects to `/onboarding` on `is_first_login: true`, permanently discarding the `?next=/invite/:token` destination. The invite token is never redeemed. Requires Story 5.5's full invite UX to fix correctly. [`apps/web/src/routes/auth/callback.tsx:37`]
- **DB insert orphan if JWT signing fails after `insertInvite`** — `createInvite` commits the invite row to the DB before `jwt.sign()` executes. If signing throws (e.g., during a secret rotation mid-request), the row exists with no corresponding token and cannot be redeemed until TTL expiry. Low probability in production. Architectural constraint: supabase-js does not support multi-statement transactions. [`apps/api/src/modules/auth/invite.service.ts:43-61`]

## Deferred from: code review of 2-5-notification-preferences-cultural-language-preference (2026-04-26)

- Service-layer read-modify-write on `notification_prefs` has no row lock — concurrent PATCHes from the same user both read the same stale row, compute divergent merged objects, and the last write wins, silently discarding the first write. Fix requires DB-side `jsonb_set` (atomic JSONB merge) or `SELECT ... FOR UPDATE` row locking in the repository. [`apps/api/src/modules/users/user.service.ts:95-107`]
- Ratchet check for family-language is service-only — not enforced by a DB CHECK constraint. Two concurrent forward-move PATCHes that both read `cultural_language = 'default'` both pass the guard and proceed to write; the 'default'-reversal protection also has this gap. Add a DB-level trigger or CHECK if the ratchet must be unconditionally durable. [`apps/api/src/modules/users/user.service.ts:121`]
- `UnauthorizedError` (401) for user-not-found after a valid JWT — semantically incorrect; should be 404 or 403. Pre-existing pattern throughout `user.service.ts` (`getMyProfile`, `updateMyProfile`, `updateMyNotifications`, `updateMyPreferences`). [`apps/api/src/modules/users/user.service.ts:96`]
- `updateMyPreferences` writes to the DB even when the input value exactly matches the current stored value (`fieldsChanged` = `[]`). No early-exit guard results in an unnecessary DB write + `fetchAuthProviders` Admin API call. [`apps/api/src/modules/users/user.service.ts:130`]

## Deferred from: code review of 2-6-voice-first-onboarding-interview-via-elevenlabs-three-signal-questions (2026-04-26)

- **`/v1/voice/llm` IDOR via leaked `ELEVENLABS_CUSTOM_LLM_SECRET`** — bearer secret is the only public auth gate. With the secret + an observed `conversation_id`, an attacker can drive an LLM response into any household. Operational mitigation: secret rotation policy + secret-storage hygiene; defense-in-depth via the `agent_id` verification patch (review item #14). Standard ElevenLabs Custom LLM auth model — full architectural fix (e.g., per-request signature, JTI nonce) is out of scope for this story. [`apps/api/src/modules/voice/voice.routes.ts`]
- **`getNextSeq` + `appendTurn` is non-atomic** — read `MAX(server_seq)+1` then `INSERT` is two round-trips with no transaction or RPC. Sequential webhook processing avoids the race today, but Story 5.x (concurrent text-mode appends to shared family thread) will hit the `UNIQUE (thread_id, server_seq)` constraint. Fix path: Postgres RPC or per-thread sequence with default expression. [`apps/api/src/modules/voice/voice.repository.ts`]
- **`extractSummary` accepts unbounded transcript length** — joins entire transcript and sends to gpt-4o without max-token clipping. Onboarding's 10-minute budget caps real-world size, low risk for this story. Add token-clipping when text-mode (Story 2.7) and longer threads land. [`apps/api/src/agents/onboarding.agent.ts`]
- **Real Supabase integration test for `UNIQUE (thread_id, server_seq)` collision** — current vitest mocks return `{ error: null }` regardless of duplicate `server_seq`, so the race-condition contract is unenforced by tests. Needs Supabase test-DB infra. [`apps/api/src/modules/voice/voice.routes.test.ts`]
- **Scoped content-type parser isolation test** — no test asserts that the `parseAs: 'string'` parser scoped to the webhook route does NOT bleed into other JSON routes. A regression that globalised the parser would not be caught. [`apps/api/src/modules/voice/voice.routes.test.ts`]

## Deferred from: code review of 2-7-text-equivalent-onboarding-path (2026-04-26)

- **F02 — `getNextSeq` starts at seq 1**: pre-existing pattern from Story 2.6; if DB schema uses 0-based `server_seq`, the first turn gets seq 1 instead of 0. Not confirmed without schema inspection. [`apps/api/src/modules/threads/thread.repository.ts:130`]
- **F15 — `onboarding.routes.ts` direct instantiation**: `ThreadRepository`, `OnboardingAgent`, and `OnboardingService` are created inline in the plugin without Fastify DI decorators or `onClose` lifecycle hooks. Consistent with existing route patterns in this codebase; revisit when a DI / lifecycle hardening pass is warranted.

## Deferred from: code review of 2-7-text-equivalent-onboarding-path — Round 2 (2026-04-26)

- **R2-W1 — Text-onboarding refresh/abort hydration**: `OnboardingText` initializes with only the hardcoded `OPENING_GREETING` and there is no GET endpoint to fetch the active thread's prior turns. Refresh, cross-device switch, or unmount-during-pending all desync UI from server (server may even hold a Lumi reply the client never received because abort-on-unmount cancels the response, not the server-side write). [`apps/web/src/features/onboarding/OnboardingText.tsx:18-43`; missing GET on `apps/api/src/modules/onboarding/onboarding.routes.ts`] — explicitly out of scope per Story 2-7 Dev Note "Re-entry and resume — out of scope" (line 266); track for a follow-up story alongside the broader thread resume primitive (Story 5.1).
- **R2-W2 — `householdHasCompletedOnboarding` extra DB roundtrips per turn**: every `submitTextTurn` and every `finalizeTextOnboarding` calls the helper, which does `findClosedThreadByHousehold` + `listTurns(closed)`. The closed-thread completion state is invariant for the household — caching it (or relying on a DB-level constraint preventing a second active thread once a closed one exists) would halve the per-turn roundtrips. [`apps/api/src/modules/onboarding/onboarding.service.ts:1267-1277`] — performance refinement, not a correctness defect; revisit if onboarding turn latency exceeds budget or if R2-D1's atomicity decision lands a DB constraint that obviates the helper.

## Deferred from: code review of 2-8-coppa-soft-vpc-signed-declaration-beta (2026-04-27)

- **[HIGH] Audit-emit failure leaves consent row recorded but no `vpc.consented` audit event** — the `audit.hook` `onResponse` write is fire-and-forget; if the audit-row insert fails (e.g., partition not yet rotated, transient DB error) the legal trail diverges from the live `vpc_consents` table silently. Pre-existing fire-and-forget audit pattern across all routes; not introduced by 2-8. Track as a Story 9.x compliance-trail hardening item (transactional outbox or pre-response audit write). [`apps/api/src/middleware/audit.hook.ts`, `apps/api/src/modules/compliance/compliance.routes.ts:52-59`]
- **[HIGH] R2-P5 orphan-resume synthetic greeting skipped** — Story 2-7 carryover: `submitTextTurn`'s `if (history.length === 0) prepend(OPENING_GREETING)` guard does not fire when the previous attempt persisted an orphaned user turn (history.length === 1 on retry). The agent then sees `[user: ...]` with no opening assistant context — the failure mode R2-P5 was meant to prevent. Open as a Story 2-7 follow-up patch; first-user-turn detection should consult assistant-turn-presence, not history length. [`apps/api/src/modules/onboarding/onboarding.service.ts` `submitTextTurn`]
- **[MED] `MIN_TURNS_FOR_COMPLETION_CHECK` floor inconsistent between `submitTextTurn` and `finalizeTextOnboarding`** — Story 2-7 carryover. The synthetic greeting is in-memory only, so finalize sees `history.length === 5` while submit sees `=== 6` for the same conversation, contradicting the "matches service guard" comment. Patch in next 2-7 round-3 review. [`apps/api/src/agents/onboarding.agent.ts:75-80`, `apps/api/src/modules/onboarding/onboarding.service.ts`]
- **[MED] `signed_by_user_id` not DB-confirmed against `households.primary_parent_user_id`** — for a COPPA legal artifact, ideal would be a server-side check that the signing user is currently the household's primary parent at write time. Today the JWT-claim-trust pattern is consistent across the API. Address as part of an auth-model hardening pass before public launch (also relevant to Story 2.4 / 7.5 deletion flows). [`apps/api/src/modules/compliance/compliance.routes.ts:43-47`]
- **[MED] `OnboardingConsent` retry can submit a stale-versioned POST mid-deploy** — if a v1→v2 deploy lands while a user is reading, the client signs the version they read; the server has no `document_version === CURRENT_DECLARATION_VERSION` guard. Acceptable for beta single-version state; revisit when v2 is introduced (add server-side current-version check + 409 response at that time). [`apps/web/src/features/onboarding/OnboardingConsent.tsx`, `apps/api/src/modules/compliance/compliance.service.ts`]
- **[MED] `findConsent` unique key on `(household, mechanism, document_version)` does not prevent multi-mechanism collision when `credit_card_vpc` ships** — Story 10.1 territory. Today only `soft_signed_declaration` is allowed (CHECK constraint), so this is not a current bug. When credit_card_vpc lands, `findConsent` callers must check the active mechanism explicitly and the consent-state query must aggregate across mechanisms. [`supabase/migrations/20260508000000_create_vpc_consents.sql`, `apps/api/src/modules/compliance/compliance.repository.ts`]
- **[MED] `OnboardingVoice.onComplete` fires on `onDisconnect`, before the ElevenLabs post-call webhook resolves** — voice webhook race is a known Story 2-6 concern (best-effort empty-summary pattern). 2-8 simply gates after disconnect; webhook-failure handling (retry, await with timeout, surface error to user before consent gate) is a 2-6 hardening item. [`apps/web/src/features/onboarding/OnboardingVoice.tsx:18-25`, `apps/api/src/modules/voice/voice.service.ts:191-205`]
- **[MED] `declarationContent` cached for process lifetime — version smear across rolling deploys** — different API pods may serve different cached `v1.md` contents during a rolling deploy with an in-place file edit. Mitigated by the version-pinning policy ("any text edit = bump `CURRENT_DECLARATION_VERSION`"); add this rule to the launch runbook so legal-fix deploys always bump the version. [`apps/api/src/modules/compliance/compliance.service.ts:25, 30-35`]
- **[MED] Migration `20260505000000_threads_modality_and_unique_constraints.sql` shipped here is a Story 2-7 R2 fix** — scope drift from 2-7 round-2: Story 2-7 was marked `done` while this required migration was unmerged, so anyone pulling main between 2-7's merge and 2-8 ran 2-7 code calling `findActiveThreadByHousehold(..., modality)` against a `threads` table without a `modality` column. Flag for sprint retrospective and consider a CI check that every story marked `done` has its migrations live in main. [`supabase/migrations/20260505000000_threads_modality_and_unique_constraints.sql`, `_bmad-output/implementation-artifacts/2-7-text-equivalent-onboarding-path.md`]
- **[MED] `householdHasCompletedOnboarding` accepts any closed thread with a summary turn but doesn't validate summary integrity** — Story 2-7 territory. Voice path's "best-effort empty summary" pattern can produce a summary turn with empty content; the gate would still mark the household done with empty allergens/preferences, blocking re-onboarding while plan generation runs blind. Patch alongside R2-P5 follow-up (require non-empty allergens or explicit "user declined" sentinel). [`apps/api/src/modules/onboarding/onboarding.service.ts:404-414`]


## Deferred from: Story 2-6b voice pipeline v2 (2026-04-28)

- **In-memory WsSession store** — `VoiceService.sessions` is a `Map<string, WsSession>`. At
  beta scale (150 concurrent HH) this is sufficient. At 5,000+ HH scale, WS connections must
  be routable to a specific API instance or the map must be replaced with Redis. Ticket: upgrade
  VoiceService to Redis-backed session store when API is deployed behind a load balancer.

- **ElevenLabs Scribe async mode** — Scribe v1 is synchronous REST (~200–400ms). ElevenLabs
  provides an async batched Scribe endpoint with lower per-word cost. Evaluate when voice
  usage exceeds 100 HH active simultaneously.

- **MediaSource streaming audio** — current implementation buffers all MP3 chunks and plays
  on response.end. MediaSource API would reduce perceived latency by ~200ms. Deferred until
  there is user feedback that the pause before Lumi speaks is noticeable.

- **JWT `?token=` in access logs** — `GET /v1/voice/ws?token=<jwt>` is logged by Fastify's
  request serialiser with the full query string. The bearer token is valid for 15 minutes and
  is written to any log-aggregation system (Datadog, CloudWatch, etc.). Fix: add a pino request
  serialiser in `app.ts` that redacts `?token=<value>` to `?token=REDACTED`.
  [`apps/api/src/app.ts`, `apps/api/src/modules/voice/voice.routes.ts:69`]

- **`submitTextTurn` race-recovery conflates "finalized" and "not found"** — when a
  `createThread` unique-violation is caught and the winner's thread is re-read as `null`
  (because it was immediately finalized), the code throws `ConflictError('onboarding already
  complete')`. If the null is instead due to Supabase read-after-write lag on a replica, the
  error message is factually wrong and the client has no signal to retry. Fix: after the re-read
  returns `null`, call `householdHasCompletedOnboarding` before choosing the error message.
  [`apps/api/src/modules/onboarding/onboarding.service.ts:96-107`]

- **Orphaned user turn detection false-positive on duplicate short messages** — `submitTextTurn`
  treats a trailing user turn as an orphan when `lastTurn.body.content === input.message`. Short
  confirmation messages ("Yes", "OK") sent twice in legitimate succession are silently
  de-duplicated; the second message reuses the old `turn_id`. Fix: add a guard that only marks a
  turn as orphaned when it has no following lumi reply AND was persisted recently (e.g., within
  the last 30 s). [`apps/api/src/modules/onboarding/onboarding.service.ts:136-141`]

- **VAD onnxruntime-web WASM not served in production build** — `@ricky0123/vad-react@0.0.36`
  depends on `onnxruntime-web` which fetches `.wasm` binaries at runtime. `vite.config.ts` has
  no WASM configuration (`vite-plugin-wasm`, `optimizeDeps.exclude`, or `assetsInclude`) and
  `apps/web/public/` contains no WASM files. Vite dev server may serve the files via module
  resolution, masking the issue in development. Test: `pnpm --filter @hivekitchen/web build &&
  vite preview` and open the voice onboarding step — if the WASM fetch fails the VAD will not
  initialise and the mic will never trigger. Fix: copy the required WASM files from
  `node_modules/onnxruntime-web/dist/*.wasm` to `apps/web/public/` and configure
  `ortConfig.wasmPaths = '/'` in `useMicVAD` options, OR add `vite-plugin-wasm` to
  `vite.config.ts`. [`apps/web/vite.config.ts`, `apps/web/src/hooks/useVoiceSession.ts`]

- **`@elevenlabs/elevenlabs-js` SDK client is dead code** — `elevenlabs.plugin.ts` decorates
  `fastify.elevenlabs` with an `ElevenLabsClient` instance, but no call site in the codebase
  accesses `fastify.elevenlabs`. All ElevenLabs API calls in `voice.service.ts` use raw
  `fetch()` with the API key passed as a string through `VoiceServiceDeps`. Fix: either remove
  `elevenlabs.plugin.ts` and the `@elevenlabs/elevenlabs-js` dependency (keeping raw fetch), or
  migrate `VoiceService` to call methods on the SDK client and remove the raw fetch calls.
  [`apps/api/src/plugins/elevenlabs.plugin.ts`, `apps/api/src/modules/voice/voice.service.ts`]
