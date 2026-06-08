# 5-S12 — DisambiguationPicker L3/L4 with Bidirectional Tether

> **Folds:** story 5.4, PRD UX-DR21, Step 5 §Tap-to-Conversation  
> **Status:** done  
> **Epic:** 5 — Household Coordination & Ambient Intelligence

---

## Story

**As a parent** who taps "Swap Main" on Wednesday's tile and realizes I need Lumi's help to find an alternative, I want to type my preference inline without leaving the Brief — so Lumi can propose a swap that fits the family, and I can watch it resolve on the tile without a page navigation.

---

## Acceptance Criteria

| # | Criterion |
|---|-----------|
| AC1 | DisambiguationPicker L1 has a "Swap Main" action button when `dayView` contains a slot with `slot_kind === 'main'` and `main_assignment_id !== null`. |
| AC2 | Tapping "Swap Main" transitions to a new `l3-propose-swap` level. L3 renders a thread breadcrumb ("Continuing from [Day]'s dinner") and a conversational text input. |
| AC3 | Submitting the L3 form calls `POST /v1/plans/:planId/swap-proposals` with body `{ day, content }` (authenticated, idempotency key required). The API responds 201 with `{ proposal_id: string }`. |
| AC4 | The API route creates a `thread_turn` row with `role: 'user'` and `TurnBodyProposal` (`type: 'proposal'`, `proposal_id`, `content`) in the household's active family thread. If no active family thread exists, the route creates one (type `'family'`, modality `'text'`). |
| AC5 | After a successful proposal, `onSwapStarted(proposalId)` is called with the returned `proposal_id`, and `onDismiss()` closes the picker. BriefCanvas stores the `proposalId` in a new `pendingProposalId` state. |
| AC6 | When `pendingProposalId` is set, the PlanTile for the matching day receives `state='proposal-pending'`. The tile renders the sacred-plum pulse: a 6px dot with the `hk-sacred-plum-pulse` CSS keyframe animation (1.6 s ease-in-out infinite, opacity 0.6 → 1 → 0.6). |
| AC7 | `prefers-reduced-motion` users see a static plum dot (no animation): the `hk-sacred-plum-pulse` animation is suppressed via `@media (prefers-reduced-motion: reduce)`. |
| AC8 | The `PlanTileState` union is extended with `'proposal-pending'`. The tile's interactive affordances (swap button, "Why this?") are disabled while in this state. |
| AC9 | `DisambiguationPicker` L3 "Back" button returns to L1. The L3 input auto-focuses on mount. |
| AC10 | The contracts package exports `ProposeSwapInputSchema`, `ProposeSwapResponseSchema`, and their inferred types. |
| AC11 | Unit tests cover: (a) L1 shows "Swap Main" when a main slot is present; (b) L3 renders breadcrumb and input; (c) submit calls the API and fires `onSwapStarted`; (d) L3 "Back" returns to L1. |

---

## Scope Notes

### "Tap-to-Conversation" — what this story builds vs. defers

This story ships the **send side** of the bidirectional tether:
- The picker captures the user's intent as a `TurnBodyProposal` turn in the family thread.
- The tile pulses to signal "Lumi is thinking."

**Deferred (out of scope here):**
- The Lumi agent that consumes the proposal turn and resolves it with a `swapMain` call + `plan_diff` turn.  
  That wiring belongs in the agent orchestration layer (Epic 9 candidate). For the demo, the pulse can be manually cleared by navigating away and back, or a dev-mode helper can be added to clear `pendingProposalId` via a keyboard shortcut.
- The SSE listener that auto-clears `pendingProposalId` when a `plan_diff` turn arrives for the matching day. Add to `deferred-work.md` as D-5S12-1.
- Per-thread message ordering or dedup. The thread already handles `server_seq` sequencing.

---

## Implementation Tasks

### Task 1 — Contracts (`packages/contracts/src/plan.ts`)

Add `ProposeSwapInputSchema` and `ProposeSwapResponseSchema`:

```ts
// Slice 5-S12 — conversational swap proposal (L3 DisambiguationPicker).
export const ProposeSwapInputSchema = z.object({
  day: WeekdaySchema,        // already defined in this file
  content: z.string().min(1).max(500),
});
export type ProposeSwapInput = z.infer<typeof ProposeSwapInputSchema>;

export const ProposeSwapResponseSchema = z.object({
  proposal_id: z.string().uuid(),
});
export type ProposeSwapResponse = z.infer<typeof ProposeSwapResponseSchema>;
```

**Verify:** `pnpm --filter @hivekitchen/contracts build` passes.

---

### Task 2 — API route (`apps/api/src/modules/plans/plans.routes.ts`)

#### 2a. Schema imports

Add to the import block at the top of `plans.routes.ts`:
```ts
import type { ProposeSwapInput } from '@hivekitchen/types';
import { ProposeSwapInputSchema, ProposeSwapResponseSchema } from '@hivekitchen/contracts';
```

#### 2b. Route definition

Add after the existing `PATCH /v1/plans/:planId/main-assignments/:mainAssignmentId/recipe` handler:

```ts
// Slice 5-S12 — Conversational swap proposal. Stores the user's intent as a
// TurnBodyProposal turn in the household's family thread. Lumi's resolution
// (swapMain + plan_diff turn) is handled by a subsequent agent step (deferred).
fastify.post(
  '/v1/plans/:planId/swap-proposals',
  {
    preHandler: requireMember,
    schema: {
      params: PlanParamSchema,
      body: ProposeSwapInputSchema,
      response: { 201: ProposeSwapResponseSchema },
    },
  },
  async (request, reply) => {
    requireIdempotencyKey(request.headers['idempotency-key']);
    const { planId } = request.params as { planId: string };
    const body = request.body as ProposeSwapInput;
    const householdId = request.user.household_id;

    // Verify the plan belongs to this household.
    const plan = await fastify.plansService.findById(planId, householdId);
    if (plan === null) throw fastify.httpErrors.notFound('Plan not found');

    // Ensure there is an active family thread (create if absent).
    const thread =
      await fastify.threadRepository.findActiveThreadByHousehold(
        householdId, 'family', 'text',
      ) ??
      await fastify.threadRepository.createThread(householdId, 'family', 'text');

    const proposalId = crypto.randomUUID();
    await fastify.threadRepository.appendTurnNext({
      threadId: thread.id,
      role: 'user',
      body: { type: 'proposal', proposal_id: proposalId, content: body.content },
      modality: 'text',
    });

    return reply.status(201).send({ proposal_id: proposalId });
  },
);
```

> `threadRepository` must be available on the Fastify instance. Check whether it is already decorated (search `fastify.decorate.*threadRepository`). If not, add it in the plugin that registers `ThreadRepository` alongside the existing repositories.

**Verify:** `pnpm --filter @hivekitchen/api test -- plans.routes` covers the new 201 path and a 404 when the plan is not found.

---

### Task 3 — PlanTile state extension (`apps/web/src/features/plan/PlanTile.tsx`)

Extend `PlanTileState`:
```ts
export type PlanTileState =
  | 'decided'
  | 'pending-input'
  | 'swap-in-progress'
  | 'proposal-pending'   // Slice 5-S12 — waiting for Lumi to resolve a swap proposal
  | 'locked'
  | 'mutability-frozen'
  | 'paused';
```

In the render function, add the sacred-plum pulse dot alongside the existing `swap-in-progress` indicator. Locate the `{state === 'swap-in-progress' && (...)}` block and add after it:

```tsx
{state === 'proposal-pending' && (
  <span
    aria-label="Lumi is finding a swap"
    className="
      inline-block w-1.5 h-1.5 rounded-full bg-[#7B4EA0]
      [animation:hk-sacred-plum-pulse_1.6s_ease-in-out_infinite]
      motion-reduce:[animation:none]
    "
  />
)}
```

Also ensure the tile is non-interactive during `proposal-pending`. Locate the `isInteractive` derived value and add `state !== 'proposal-pending'` to the guard:

```ts
const isInteractive = !isPast && !isFrozen && !isPaused
  && state !== 'swap-in-progress'
  && state !== 'proposal-pending';
```

Add the CSS keyframe to `apps/web/src/index.css` (or the global stylesheet):

```css
@keyframes hk-sacred-plum-pulse {
  0%, 100% { opacity: 0.6; }
  50%       { opacity: 1;   }
}
```

---

### Task 4 — DisambiguationPicker new level (`apps/web/src/features/plan/DisambiguationPicker.tsx`)

#### 4a. Extend `PickerLevel`

```ts
type PickerLevel =
  | 'l1'
  | 'l2-select-variation'
  | 'l3-variation-ingredients'
  | 'l2-select-slot-override'
  | 'l4-override'
  | 'l2-select-pause-child'
  | 'l3-propose-swap';    // Slice 5-S12
```

#### 4b. Add `onProposeSwap` prop

```ts
interface DisambiguationPickerProps {
  // ... existing props ...
  // Slice 5-S12 — called when user submits a conversational swap proposal.
  // Returns the proposal_id from the API (caller stores it for pulse state).
  onProposeSwap?: (day: Weekday, content: string) => Promise<string>;
}
```

#### 4c. State additions

```ts
const [proposalInput, setProposalInput] = useState('');
const [isProposing, setIsProposing] = useState(false);
const proposalRef = useRef<HTMLInputElement>(null);

useEffect(() => {
  if (level === 'l3-propose-swap') proposalRef.current?.focus();
}, [level]);
```

#### 4d. L1 "Swap Main" button

Inside the L1 `flex flex-wrap gap-2` block, add (after the existing "Change an item" button):

```tsx
{dayView.slots.some((s) => s.slot_kind === 'main' && s.main_assignment_id !== null) &&
  onProposeSwap !== undefined && (
  <button
    type="button"
    onClick={() => setLevel('l3-propose-swap')}
    disabled={isPending}
    className="rounded-full border border-stone-300 px-3 py-1.5 text-[13px] text-stone-700 hover:bg-stone-50 transition-colors motion-reduce:transition-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-400"
  >
    Swap Main
  </button>
)}
```

#### 4e. L3 proposal render block

Add inside the picker's return, after the `l3-variation-ingredients` block:

```tsx
{level === 'l3-propose-swap' && (
  <>
    <p className="text-[11px] text-stone-400 uppercase tracking-wide">
      Continuing from {DAY_LABEL[day]}'s dinner
    </p>
    <label
      htmlFor={`${pickerId}-propose`}
      className="text-stone-500 text-[13px]"
    >
      What should Lumi swap it for?
    </label>
    <input
      ref={proposalRef}
      id={`${pickerId}-propose`}
      type="text"
      value={proposalInput}
      onChange={(e) => setProposalInput(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !isProposing) { void handleProposalSubmit(); }
      }}
      placeholder="e.g. something lighter, maybe a wrap"
      className="w-full rounded-md border border-stone-300 px-3 py-2 text-[14px] text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400"
    />
    {error !== null && (
      <p role="alert" className="text-[12px] text-red-600">{error}</p>
    )}
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => { void handleProposalSubmit(); }}
        disabled={isProposing || proposalInput.trim().length === 0}
        className="rounded-full bg-stone-900 px-4 py-1.5 text-[13px] text-white hover:bg-stone-700 transition-colors motion-reduce:transition-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-400"
      >
        {isProposing ? 'Sending…' : 'Ask Lumi'}
      </button>
      <button
        type="button"
        onClick={() => setLevel('l1')}
        disabled={isProposing}
        className="text-[12px] text-stone-400 hover:text-stone-600 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-300"
      >
        Back
      </button>
    </div>
  </>
)}
```

#### 4f. `handleProposalSubmit` function

```ts
async function handleProposalSubmit() {
  if (!onProposeSwap || proposalInput.trim().length === 0) return;
  setIsProposing(true);
  setError(null);
  try {
    const proposalId = await onProposeSwap(day, proposalInput.trim());
    onSwapStarted(proposalId);
    onDismiss();
  } catch {
    setError('Could not send. Please try again.');
  } finally {
    setIsProposing(false);
  }
}
```

---

### Task 5 — BriefCanvas wiring (`apps/web/src/features/plan/BriefCanvas.tsx`)

#### 5a. State

```ts
// Slice 5-S12 — tracks an in-flight swap proposal; the matching tile pulses.
const [pendingProposalId, setPendingProposalId] = useState<string | null>(null);
```

#### 5b. Mutation helper

Add a `proposeSwap` function alongside the existing mutation helpers:

```ts
async function handleProposeSwap(day: Weekday, content: string): Promise<string> {
  if (planId === null) throw new Error('No plan');
  const res = await hkFetch<{ proposal_id: string }>(
    `/v1/plans/${planId}/swap-proposals`,
    {
      method: 'POST',
      body: JSON.stringify({ day, content }),
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    },
  );
  return res.proposal_id;
}
```

#### 5c. DisambiguationPicker usage

Pass `onProposeSwap` and update the `onSwapStarted` handler to capture proposal IDs:

```tsx
<DisambiguationPicker
  // ... existing props ...
  onProposeSwap={canSwap ? handleProposeSwap : undefined}
  onSwapStarted={(id) => {
    // id may be a variationId (existing flow) or proposalId (5-S12 flow).
    // For proposal flow, id is the proposal_id UUID; BriefCanvas stores it
    // separately so PlanTile knows which state to render.
    setSwappingItemId(id);
    setPendingProposalId(id);
  }}
  onSwapSettled={() => {
    setSwappingItemId(null);
    // pendingProposalId clears when the plan_diff SSE arrives (deferred).
    // Until then, leave it set so the tile keeps pulsing.
  }}
/>
```

> **Note:** The existing variation/pause flows call `onSwapStarted(variationId)`. Storing that same id in `pendingProposalId` is harmless — `PlanTile` only shows the pulse dot when its `state` prop is `'proposal-pending'`, which is gated on a separate condition below.

#### 5d. Tile state derivation

Update the `state` prop calculation for each PlanTile. Locate the block around line 460:

```tsx
// Before (5-S9 era):
: summary.items.some((i) => i.plan_item_id === swappingItemId)
  ? 'swap-in-progress'

// After:
: pendingProposalId !== null && summary.day === activeSwapDay
  ? 'proposal-pending'
  : summary.items.some((i) => i.plan_item_id === swappingItemId)
    ? 'swap-in-progress'
```

> `summary.day` is `Weekday`; `activeSwapDay` is the day the picker is open for. The tile for that day enters `proposal-pending` while `pendingProposalId` is set.

---

### Task 6 — Tests

#### 6a. DisambiguationPicker (`DisambiguationPicker.test.tsx`)

Add a new `describe('Swap Main / L3 proposal flow')` block:

```ts
it('shows Swap Main button when main slot is present and onProposeSwap provided', () => {
  // render with dayView containing slot_kind='main' + onProposeSwap callback
  // assert button with text /swap main/i is present
});

it('transitions to L3 on Swap Main click', () => {
  // click Swap Main
  // assert breadcrumb text contains "Continuing from"
  // assert input is focused
});

it('submits proposal and fires onSwapStarted + onDismiss', async () => {
  // mock onProposeSwap resolving 'proposal-uuid'
  // type text → press Enter or click Ask Lumi
  // assert onProposeSwap called with (day, text)
  // assert onSwapStarted called with 'proposal-uuid'
  // assert onDismiss called
});

it('Back on L3 returns to L1', () => {
  // navigate to L3, click Back, assert L1 renders
});
```

#### 6b. API route (`plans.routes.test.ts`)

```ts
describe('POST /v1/plans/:planId/swap-proposals', () => {
  it('returns 201 with proposal_id', async () => { ... });
  it('returns 404 when plan not found', async () => { ... });
  it('returns 422 without idempotency key', async () => { ... });
});
```

---

## Deferred Work

| ID | Item |
|---|---|
| D-5S12-1 | SSE listener in BriefCanvas to clear `pendingProposalId` when a `plan_diff` turn arrives for the matching day — pulse auto-stops on resolution. |
| D-5S12-2 | LumiAgent consuming `TurnBodyProposal` turns and calling `swapMain` + appending a `plan_diff` turn to the family thread. Candidate for Epic 9. |

Add these entries to `_bmad-output/implementation-artifacts/deferred-work.md`.

---

## Dev Agent Record

### Implementation summary (2026-06-08)

All 6 tasks / 11 ACs implemented. The **send side** of the bidirectional tether
is complete: the picker captures a free-text swap intent as a `TurnBodyProposal`
turn in the household's family thread, and the matching PlanTile pulses
sacred-plum while Lumi (deferred) resolves it.

**Contracts (Task 1):** `ProposeSwapInputSchema` (`day` = `WeekdaySchema`,
`content` 1–500 chars) + `ProposeSwapResponseSchema` (`proposal_id` uuid) added
to `plan.ts`; inferred types `ProposeSwapInput` / `ProposeSwapResponse` re-exported
from `@hivekitchen/types`.

**API (Task 2):** `POST /v1/plans/:planId/swap-proposals` (requireMember,
idempotency-key required, params validated inline). Validates household ownership
via new `PlansService.findById` (delegates to `repo.findByIdForPresentation`,
returns `null` → 404). Lazily finds/creates the active `family`/`text` thread and
appends a `role:'user'` proposal turn via `threadRepository.appendTurnNext`.

**UI (Tasks 3–5):** `PlanTileState` gains `'proposal-pending'`; the tile renders a
6px sacred-plum dot with the `hk-sacred-plum-pulse` keyframe and is non-interactive
in that state. `DisambiguationPicker` gains the `l3-propose-swap` level (breadcrumb
+ auto-focused text input, Enter-to-submit), an `onProposeSwap` prop, and a "Swap
Main" L1 button gated on a main slot with `main_assignment_id !== null`. BriefCanvas
wires `handleProposeSwap` and tracks `pendingProposal` so the right tile pulses.

### Key reconciliations (spec ↔ codebase)

1. **`fastify.threadRepository` was not decorated.** It is constructed locally per
   plugin elsewhere (households/voice/onboarding). To keep the new route
   test-injectable, decorated it once in `plans.hook.ts` and added the type to
   `fastify.d.ts` — matches the story's "add it in the plugin that registers
   ThreadRepository" guidance.
2. **`PlansService.findById` did not exist.** The story snippet called it; added a
   thin method delegating to the existing `repo.findByIdForPresentation` (the same
   ownership-check repo call `getCurrentPlanTree`/`requestRegeneration` already use).
3. **`hkFetch` double-stringify bug in the story snippet.** `hkFetch` already
   `JSON.stringify`s `init.body`; the story passed `body: JSON.stringify(...)` which
   would double-encode. Fixed to pass the raw object `{ day, content }`.
4. **Missing-idempotency-key status is 400, not 422.** `requireIdempotencyKey`
   throws `ValidationError` (status 400) repo-wide. Test asserts 400 (story snippet
   said 422).
5. **`pendingProposalId` could not pulse the right tile.** The story's tile
   derivation keyed on `activeSwapDay`, which `onSwapStarted`/`onDismiss` reset to
   null before the pulse renders. Replaced with `pendingProposal: { id, day }`
   captured in `handleProposeSwap` (via `lastProposalRef`) so the matching day
   pulses, and `onSwapStarted` does **not** set `swappingItemId` for the proposal
   id (which would have locked the whole canvas).
6. **Sacred-plum token, not arbitrary hex.** Used `bg-sacred-500` (design-system
   token, `--sacred-plum-500`) instead of the story's `bg-[#7B4EA0]`, consistent
   with the warm-neutral palette and the existing `bg-sacred-200` usage in PlanTile.
7. **AC7 reduced-motion** satisfied via Tailwind's `motion-reduce:[animation:none]`
   (compiles to `@media (prefers-reduced-motion: reduce)`); the `@keyframes` lives
   in `apps/web/src/styles/globals.css` (the app global stylesheet, not a non-existent
   `index.css`).
8. **No `family` thread enum constraint.** `threads.type` is free text; `'family'`
   is valid. No migration (confirmed by the story).

### Verification

- Typecheck: API 12 / web 7 (all pre-existing baseline files; **0 new**), contracts/types 1
  (pre-existing heart-notes `$ZodIssue` baseline).
- Contracts: `plan.test.ts` 18/18 (+6 new).
- API: `plans.routes.test.ts` 61/61 (+7 new); `findById` mock + injected
  `threadRepository` mock.
- Web: `DisambiguationPicker.test.tsx` 25/25 (+8 new); plan-feature dir 192 pass /
  1 fail — the single failure is the **pre-existing** `PackerAssignmentDialog.test.tsx`
  (5-S3 `initialPackerUserId` debt), not from this slice.
- No migration, no new deps.

### Completion Notes

- Deferred (added to `deferred-work.md`): **D-5S12-1** (SSE auto-clear of the
  pulse on `plan_diff`), **D-5S12-2** (LumiAgent consuming the proposal turn).
- USER-SIDE GATE: live-stack manual smoke — open the picker on a day with a Main,
  tap "Swap Main", submit; confirm the proposal turn lands in the family thread
  and the tile pulses sacred-plum.

## File List

**Modified**
- `packages/contracts/src/plan.ts` — `ProposeSwapInputSchema` / `ProposeSwapResponseSchema`
- `packages/contracts/src/plan.test.ts` — round-trip tests
- `packages/types/src/index.ts` — schema imports + inferred type re-exports
- `apps/api/src/modules/plans/plans.service.ts` — `findById`
- `apps/api/src/modules/plans/plans.hook.ts` — decorate `threadRepository`
- `apps/api/src/modules/plans/plans.routes.ts` — `POST /v1/plans/:planId/swap-proposals`
- `apps/api/src/modules/plans/plans.routes.test.ts` — route tests + thread-repo mock
- `apps/api/src/types/fastify.d.ts` — `threadRepository` decorator type
- `apps/web/src/features/plan/PlanTile.tsx` — `'proposal-pending'` state + pulse dot + guard
- `apps/web/src/features/plan/DisambiguationPicker.tsx` — `l3-propose-swap` level + `onProposeSwap`
- `apps/web/src/features/plan/DisambiguationPicker.test.tsx` — L3 proposal tests
- `apps/web/src/features/plan/BriefCanvas.tsx` — `handleProposeSwap` + `pendingProposal` wiring
- `apps/web/src/styles/globals.css` — `@keyframes hk-sacred-plum-pulse`
- `_bmad-output/implementation-artifacts/deferred-work.md` — D-5S12-1 / D-5S12-2

## Change Log

| Date | Change |
|---|---|
| 2026-06-08 | Implemented 5-S12 send-side conversational swap proposal end-to-end (all 11 ACs). Status → review. |

---

## Review Findings

> Code review 2026-06-08 (3-layer adversarial: Blind Hunter / Edge Case Hunter / Acceptance Auditor). 1 decision-needed (resolved → patch), 5 patch, 5 defer, 7 dismissed. All 11 ACs SATISFIED and all 8 dev reconciliations CONFIRMED by the Acceptance Auditor.

### Decision needed (resolved)

- [x] [Review][Decision→Patch] **Proposal turn drops the `day` field — deferred LumiAgent can't know which day to swap** — `ProposeSwapInputSchema` requires `day` and the client sends it, but the persisted `TurnBodyProposal` body was `{type:'proposal', proposal_id, content}` with no `day`. **Resolved 2026-06-08 → Option A: persist the day.** Extend `TurnBodyProposal` with `day: WeekdaySchema` and store `body.day` in the route so D-5S12-2 has a structured swap target. See patch below.

### Patch (all applied + verified 2026-06-08)

- [x] [Review][Patch] **Persist `day` in the proposal turn body** [`packages/contracts/src/thread.ts:27`, `apps/api/src/modules/plans/plans.routes.ts:323`] — added `day: WeekdaySchema` to `TurnBodyProposal` (imported from `plan.js`, no cycle) and `day: body.day` to the `appendTurnNext` body so the deferred LumiAgent (D-5S12-2) has the target day without re-parsing free text. API test asserts the persisted `day`; `thread.test.ts` gains a no-day rejection case.
- [x] [Review][Patch] **AC8 partial: "Why this?" stays clickable during `proposal-pending`** [`apps/web/src/features/plan/PlanTile.tsx:223`] — render guard now also requires `state !== 'proposal-pending' && state !== 'swap-in-progress'`, so the button is hidden whenever a swap is in flight.
- [x] [Review][Patch] **Double-submit race (Enter + click in same tick → two POSTs)** [`apps/web/src/features/plan/DisambiguationPicker.tsx:331`] — added a synchronous `isSubmittingProposalRef` guard at the top of `handleProposalSubmit` (reset in `finally`), blocking the second same-tick dispatch.
- [x] [Review][Patch] **Whitespace-only content passes the contract** [`packages/contracts/src/plan.ts:884`] — `content` is now `z.string().trim().min(1).max(500)`, rejecting whitespace-only payloads and trimming before persistence.
- [x] [Review][Patch] **Shared `error` state bleeds into L3 from the variation flow** [`apps/web/src/features/plan/DisambiguationPicker.tsx:386,645`] — "Swap Main" and "Back" now `setError(null)` before changing level.

**Verification:** contracts `thread.test.ts`+`plan.test.ts` 51/51; API `plans.routes.test.ts` 61/61; web `DisambiguationPicker.test.tsx`+`PlanTile.test.tsx` 61/61. Typecheck: 0 new errors (API 12 / web 7 / contracts 1 — all pre-existing baseline, none in touched files).

### Deferred (pre-existing or out of scope this slice)

- [x] [Review][Defer] **`pendingProposal` is never cleared → tile permanently stuck/non-interactive in production** [`apps/web/src/features/plan/BriefCanvas.tsx`] — already logged as D-5S12-1 (SSE auto-clear) + D-5S12-2 (agent resolution). HIGH impact in production (no agent exists yet); spec scope-notes acknowledge manual clear via navigate-away.
- [x] [Review][Defer] **`pendingProposal` is single-slot — a second proposal erases the first day's pulse** [`apps/web/src/features/plan/BriefCanvas.tsx:135,493`] — multi-day concurrent proposals not modeled; related to D-5S12-1.
- [x] [Review][Defer] **Idempotency-Key required but not honored (no replay cache)** [`apps/api/src/modules/plans/plans.routes.ts:304`] — pre-existing repo-wide pattern; `plans.routes.ts:50-51` notes "Full Redis replay-cache deferred." All 9 plan routes do format-only validation.
- [x] [Review][Defer] **`createThread` unique-violation race → unhandled 500** [`apps/api/src/modules/plans/plans.routes.ts:306-313`] — narrow first-proposal window; `ThreadRepository` exposes `isUniqueViolation` but no caller maps it (pre-existing). Low severity.
- [x] [Review][Defer] **Picker re-targeted day→day without remount keeps stale L3 state** [`apps/web/src/features/plan/BriefCanvas.tsx:560`] — no `key={activeSwapDay}`; pre-existing class (the `l3-variation-ingredients` `ingredientInput` has the same issue). A `key` prop fixes both but is broader than this slice.

### Dismissed (verified non-issues)

- Cross-household IDOR — `findByIdForPresentation({planId, householdId})` filters by household (same call as `getCurrentPlanTree`/`requestRegeneration`); 404 test exercises the null path.
- `onSwapStarted` shared-id ref disambiguation — `lastProposalRef` is set only after a successful `onProposeSwap` resolves, immediately consumed; failed proposals never set it; variation flow leaves it null. UUID collision negligible.
- `crypto.randomUUID` in non-secure context — app-wide pre-existing reliance; prod is HTTPS/localhost.
- Draft plan (guardrail not cleared) → 404 — consistent by design; the same presentation filter gates tile rendering, so a visible tile implies a swappable plan.
- "Swap Main" on past/frozen days — picker only opens via `onSwapIntent` on interactive tiles; past/frozen tiles are non-interactive.
- `hasMainSlot` requiring `main_assignment_id !== null` — matches AC1 verbatim.
- `proposal-pending` ordering before `swap-in-progress` — subsumed by the stuck-pulse defer; cosmetic.
