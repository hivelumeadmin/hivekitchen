# Spec — SSE Remediation (finish "Story 5.2": push, don't poll)

**Date:** 2026-06-28
**Author:** Drafted by Claude (engineering) at Menon's request
**Status:** DRAFT — implementation-ready spec.
**Scope:** Make the SSE layer push the state changes the UI already knows how to consume, collapse the duplicate connection, and add resume-on-reconnect. Backend-led; small, mostly-additive.

> **Why this exists.** The SSE *infrastructure* is solid (Redis pub/sub, multi-instance, 20s heartbeat). The problem is the emitters were never wired — **9 of 13 contract event types have a working client handler but no server `emit`** — so the most real-time flow (plan generation) is *polled* via `setInterval`. This is finishing deferred work ("Story 5.2"), not new architecture. Directly serves the product doctrine (`apps/web/CLAUDE.md`: "Invisible Intelligence… AI is a background capability"; memory `lumi-valet-not-chat-app`) and unblocks Epic 13 s3 (whisper) + s10 (talk-to-your-plan).

---

## 0. Current state (file-grounded)

**Infra (keep):** `apps/api/src/plugins/sse-dispatcher.plugin.ts` — `emit(householdId, event, data)` PUBLISHes `event: ${event}\ndata: ${data}\n\n` on `sse:household:{id}`; a dedicated subscriber fans out to local sockets. Multi-instance-safe. `apps/api/src/routes/v1/events/events.routes.ts` — single `GET /v1/events`, JWT via `?token`, household-scoped via `register(payload.hh, reply.raw)`, 20s `:ping` heartbeat.

**Emitted today (4 sites):** `lumi.nudge` (named event; `lumi-nudge.job.ts:76`), `packer.assigned` + `thread.turn` (`households.routes.ts:407,444`), `presence.partner-active` (`presence.helpers.ts:32`).

**Wired client-side but never emitted:** `plan.updated`, `memory.updated`, `memory.forget.completed`, `pantry.delta`, `allergy.verdict`, `thread.resync`, `voice.session.*`, `child_request.received/resolved`. The client switch (`apps/web/src/lib/realtime/sse.ts:160-272`) handles all 13 exhaustively.

**Polled instead of pushed:** plan generation + regeneration completion — `plan-generation.job.ts:693` logs `'plan.updated SSE emission deferred to Story 5.2'`; the client compensates with `setInterval(invalidate, 5000)` in `BriefCanvas.tsx` (compose-now: 5s × 24 ≈ 2 min).

**Two connections per tab:** the invalidation bridge (`sse.ts`, listens `message`) and `useLumiNudgeSSE.ts` (listens named `lumi.nudge`) each open a separate `EventSource` to `/v1/events`.

**No resume:** the emit frame has no `id:` field, so a dropped connection loses events sent during the gap (only `thread.turn` is partially protected via `from_seq` gap-recovery).

---

## 1. Goals / non-goals

**Goals:** (1) push plan readiness + progress so the spinner reflects reality and the polls die; (2) push data-mutation invalidations for cross-tab/device consistency; (3) one SSE connection per tab; (4) resume-on-reconnect (Last-Event-ID).
**Non-goals:** changing the transport (stays SSE per `apps/web/CLAUDE.md`), changing auth, redesigning the contract union (we *add* one progress type), per-user fan-out (household scope stays; optional surface filtering is Tier 3).

---

## 2. The fixes (3 tiers by ROI)

### Tier 1 — finish the wiring (small, high impact)

**1a. Emit `plan.updated` on plan-generation completion.** All values are in scope at `plan-generation.job.ts:693`.

```ts
// plan-generation.job.ts — REPLACE the sse.deferred debug log (lines 690-696) with:
const verdict = lastAttemptComposeOutput.guardrail_verdict ?? { verdict: 'cleared' as const };
fastify.sseDispatcher.emit(
  household_id,
  'message',                                   // InvalidationEvent rides the default `message` event
  JSON.stringify({ type: 'plan.updated', week_id: weekId, guardrail_verdict: verdict }),
);
```
- The client handler (`sse.ts:161`) already invalidates `plan(week_id)` + `['brief']`. **This deletes both `setInterval` polls** in `BriefCanvas.tsx` (the `isRegenerating` 5s loop at `:316` and the compose-now loop at `:80`).
- **Also emit on the failure path** (`generationWorker.on('failed')`, `:704`) so the UI stops waiting on a hard-fail. Add a `plan.failed` member (see 2-Tier-2 note) OR reuse `plan.updated` with a `blocked` verdict — **decision below**.

**1b. Collapse two EventSources into one.** The bridge becomes the single SSE owner; fold the nudge listener into it.

```ts
// sse.ts → openConnection(), after the existing `message` listener:
thisEs.addEventListener('lumi.nudge', (e: MessageEvent) => {
  const parsed = LumiNudgeEvent.safeParse(JSON.parse(e.data));
  if (parsed.success) lumiStore.getState().applyNudge(parsed.data); // orb breath + live append
});
```
- Delete `useLumiNudgeSSE.ts`'s own `EventSource`; it becomes a thin selector over `lumiStore`, or is removed and `layout.tsx:24` drops the hook. **Halves connections + JWT verifies**, and the nudge path inherits the bridge's jittered backoff + stale-handler guards (it currently has none).

### Tier 2 — the realtime *feel*

**2a. Plan-generation progress events.** Add one contract member so the spinner shows real stages instead of a fixed "~30s."

```ts
// packages/contracts/src/plan.ts — new member of InvalidationEvent
export const PlanProgressEvent = z.object({
  type: z.literal('plan.progress'),
  week_id: z.string().uuid(),
  stage: z.enum(['queued', 'composing', 'guardrail', 'persisting', 'ready', 'failed']),
});
```
- Emit at each phase boundary in `plan-generation.job.ts` (start, compose done, guardrail done, commit). Client handler updates a `planProgress[week_id]` store → the Brief draft state renders the stage. `ready`/`failed` are terminal (and `ready` coincides with the `plan.updated` emit).

**2b. Optimistic edits + SSE reconciliation.** Today every plan mutation is `onSuccess: invalidateQueries` (refetch-after-action). Move to `onMutate` (tile moves instantly) and let the server-emitted `plan.updated` reconcile.
- Files: `apps/web/src/features/plan/mutations.ts` (`useSwapMainMutation`, `useUpdateVariationMutation`, `useSwapSlotRecipeMutation`, pause/override/confirm-variant). Add `onMutate` cache writes + rollback on error; drop the `onSuccess` refetch (the SSE `plan.updated` invalidates).
- **This is the highest realtime-feel win and the highest-risk change** (reconciliation edge cases) — see §5.

**2c. Emit invalidations at data-mutation sites** (id-only payloads; the client handlers exist):

| Mutation | Emit | Site |
|---|---|---|
| allergen / kitchen_map_version bump | `plan.updated` (verdict re-eval) or a light `kitchen.updated` | `HouseholdAllergensRepository` write path / kitchen-profile-edit routes |
| memory write / forget | `memory.updated` / `memory.forget.completed` | memory mutation + forget job |
| pantry change | `pantry.delta` | pantry mutation |
| child request submit / resolve | `child_request.received` / `child_request.resolved` | `child-request.service.ts:10-15` (the explicit 4-S15 deferral) |

### Tier 3 — robustness

**3a. Last-Event-ID resume (replay buffer).** Make `emit` stamp a monotonic id and buffer recent events per household; replay on reconnect.
- **Server (emit):** also `XADD sse:stream:household:{id} MAXLEN ~ 200 * type … field …` (Redis Stream gives a global per-household order + native ids), and set the SSE frame id: `id: ${streamId}\nevent: ${event}\ndata: ${data}\n\n`. (emit stays fire-and-forget: `void (async () => { const id = await xadd(...); await publish(frameWithId); })()`.)
- **Route (`events.routes.ts`):** read `request.headers['last-event-id']`; before `register(...)`, `XRANGE sse:stream:household:{id} (lastId +` and write each buffered frame, then go live. Native `EventSource` sends `Last-Event-ID` automatically on reconnect.
- TTL the stream (e.g. 1h) so it self-prunes. Closes the gap for *every* event type, not just `thread.turn`.

**3b. (Optional) Per-surface filtering.** Today every household tab gets every household event (`client_id` captured but unused for routing). Lower priority — the client already filters in its switch. If pursued: pass the current surface on connect (`?surface=`) and filter server-side in the dispatcher fan-out. Defer unless event volume becomes a problem.

---

## 3. Event-to-trigger matrix (target state)

| Event (`type`) | Payload | Trigger site to add | Client handler | Status |
|---|---|---|---|---|
| `plan.updated` | `{week_id, guardrail_verdict}` | `plan-generation.job.ts:693` (completion) + regenerate path | invalidate `plan` + `brief` ✓ | **add (1a)** |
| `plan.progress` *(new)* | `{week_id, stage}` | `plan-generation.job.ts` phase boundaries | new store handler | **add (2a)** |
| `allergy.verdict` | `{plan_id, verdict}` | fold into `plan.updated` (it already carries the verdict) | invalidate `plan(plan_id)` ✓ | merge → prefer `plan.updated` |
| `memory.updated` | `{node_id}` | memory mutation onSuccess | invalidate `memory` ✓ | add (2c) |
| `memory.forget.completed` | `{node_id}` | forget job completion | invalidate `memory` ✓ | add (2c) |
| `pantry.delta` | `{delta}` | pantry mutation | invalidate `pantry` ✓ | add (2c) |
| `child_request.received/resolved` | `{household_id}` | `child-request.service.ts:10-15` | invalidate `childRequests` ✓ | add (2c) |
| `thread.turn` | `{thread_id, turn}` | Lumi conversational turn persist (currently only packer system turns) | append + gap recovery ✓ | extend to Lumi turns |
| `packer.assigned` | `{date, packer_id}` | `households.routes.ts:407` | invalidate `packers` ✓ | **emitted ✓** |
| `presence.partner-active` | `{thread_id, user_id, surface, expires_at}` | `presence.helpers.ts:32` | invalidate `presence` ✓ | **emitted ✓** |
| `lumi.nudge` *(named)* | full turn `{type, turn, surface}` | `lumi-nudge.job.ts:76` | orb breath + append ✓ | **emitted ✓** (move to single ES, 1b) |
| `thread.resync` | `{thread_id, from_seq}` | (resume/replay path) | reset cursor + invalidate ✓ | with 3a |
| `voice.session.started/ended` | `{session_id, user_id}` | voice session lifecycle | logged only | defer (Epic 5) |

---

## 4. Decision: `plan.failed` vs reuse `plan.updated`

On guardrail hard-fail / infra failure (`generationWorker.on('failed')`), the UI must stop waiting. Two options:
- **A (recommended): reuse `plan.updated` with `guardrail_verdict: { verdict: 'blocked', … }`.** No new contract member; the existing handler invalidates and the Brief renders the blocked state. Simplest, and the verdict union already has a `blocked` arm.
- **B: add a `plan.failed` member.** Cleaner semantics for infra failures (which aren't a guardrail verdict), but widens the contract + client switch.

Recommend **A** for guardrail rejections; if infra failures need a distinct UI, add the **`plan.progress` `stage:'failed'`** (2a) rather than a separate `plan.failed`.

---

## 5. Risks / edge cases

| Risk | Mitigation |
|---|---|
| Optimistic edit (2b) diverges from server truth | `onMutate` snapshot + rollback on error; the authoritative `plan.updated` invalidate is the reconciler; keep the operation idempotent. Pilot on ONE mutation (swap-main) before the rest. |
| `emit` becomes async for replay (3a) | Keep the public signature sync/fire-and-forget; do `xadd`→`publish` inside a `void (async () => …)()`. XADD `*` ids are monotonic regardless of races. |
| Replay duplicates a live event | Client already dedups `thread.turn` by id + seq; for invalidation events, duplicate invalidations are harmless (idempotent refetch). |
| Removing the polls (1a) before the emit ships | Land the emit first, verify in the trace/logs, *then* delete the `setInterval`s — same slice, ordered. |
| Single connection (1b) regresses nudge behavior | Move the nudge logic into the bridge with a test; the named-event listener coexists with `message` on one ES (native ES supports multiple named listeners). |
| Multi-instance ordering | Redis Stream per household gives a single global order; pub/sub stays the live transport. |

---

## 6. Sequencing — slot into Epic 13

This is a **dependency of Epic 13**, not a separate epic. Recommended placement: a new slice **between s2 (presence) and s3 (whisper)**, since the whisper channel and "talk to your plan" both require real push.

```
13-s2 (presence primitive)
  └─ 13-s2.5 (SSE push: Tier 1 + 2a/2c)   ← THIS spec; unblocks whisper + live edits
       └─ 13-s3 (whisper channel)          ← renders pushed background actions
            …
                 └─ 13-s10 (talk to your plan)  ← optimistic (2b) + plan.updated reconcile
```

**Suggested build order within the slice:** 1a (emit `plan.updated`, delete polls) → 1b (one connection) → 2c (data-mutation emits) → 2a (progress) → 3a (replay) → 2b (optimistic, piloted on swap-main). Tier 3b deferred.

**Verify per step:** with `ONBOARDING_TRACE_DIR`-style logging or a simple integration test asserting the `emit` fires; an E2E that a second tab updates without navigation; confirm the `BriefCanvas` `setInterval`s are gone and the plan still lands.

---

## Appendix — References

- `apps/api/src/plugins/sse-dispatcher.plugin.ts` — `emit/register/unregister`, `sse:household:{id}`
- `apps/api/src/routes/v1/events/events.routes.ts` — `GET /v1/events`, JWT `?token`, heartbeat, `register(payload.hh, …)`
- `apps/api/src/jobs/plan-generation.job.ts` — completion (`:690-696` deferred log), failure (`:704`), `NUDGE_QUEUE` enqueue (`:677`)
- `apps/api/src/jobs/lumi-nudge.job.ts:76` — the one working `emit`
- `apps/api/src/modules/households/households.routes.ts:407,444` — `packer.assigned`, `thread.turn`
- `apps/api/src/modules/child-requests/child-request.service.ts:10-15` — the 4-S15 emit deferral
- `packages/contracts/src/events.ts` — `InvalidationEvent` (13 members); `packages/contracts/src/plan.ts:46` — `PlanUpdatedEvent {week_id, guardrail_verdict}`, `AllergyVerdict`
- `apps/web/src/lib/realtime/sse.ts` — the bridge: exhaustive switch (`:160-272`), backoff (`:51`), gap recovery (`:98`)
- `apps/web/src/hooks/useLumiNudgeSSE.ts` — the second EventSource (to be folded into the bridge)
- `apps/web/src/features/plan/BriefCanvas.tsx:80-97, 316-336` — the `setInterval` polls to delete
- `apps/web/src/features/plan/mutations.ts` — refetch-on-success mutations (→ optimistic, 2b)
- `apps/web/CLAUDE.md` — "Invisible Intelligence"; memory `lumi-valet-not-chat-app`
- `_bmad-output/planning-artifacts/epic-13-lumi-ux-rebuild-brief.md` — the epic this unblocks (proposed s2.5)
