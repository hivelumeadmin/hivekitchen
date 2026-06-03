# Planner Prompt Rollback Runbook

**Owner:** Ops on-call (until Epic 9 9-s4 ships the operational metrics dashboard, threshold judgment is manual).
**Authored:** 2026-06-02 (Story 3-DM-C2).
**Cross-referenced from:** `apps/api/src/agents/orchestrator.ts:430` (planner safeParse site) and `:593` (swap safeParse site).

---

## When to use this runbook

You're here because the `planner.bad_output` audit row count has climbed beyond an actionable threshold and the operational impact (failed plans, retry storms, BullMQ backlog) is real.

The `planner.bad_output` event is emitted in two places:
- `apps/api/src/agents/orchestrator.ts:430` — planner agent path (`planWeek`); the LLM returned a `plan.compose` result that failed `PlanComposeTreeOutputSchema.safeParse(...)`.
- `apps/api/src/agents/orchestrator.ts:593` — swap agent path (`swapBlockedItems`); same failure mode under the mini-tier swap agent.

Both sites preserve the original throw — downstream BullMQ retry semantics and the `<AccountableError />` flow are unchanged. The audit row is the operator signal, not a behavior change.

**Threshold guidance (manual until Epic 9 9-s4 wires the Grafana alert):** treat sustained `> 5% bad_output rate in any 1-hour window` (per agent type) as actionable. A handful of bad rows is normal LLM noise; sustained elevation is a prompt or model regression.

---

## What "revert prompt" means today

Important context before doing anything: **the planner prompt and the `PlanComposeTreeOutputSchema` are tightly coupled post-canonical-cutover.** The old prompt (pre-Story 3-DM-C1 Phase 5) instructed the planner to emit a flat `plan_items[]` array. The current schema is the canonical tree shape (`main_assignments[]`, `days[]`, `slots[]`, `variations[]`). A prompt-only revert produces nothing but `planner.bad_output` audit rows because the schema rejects the flat shape outright.

You have three options, listed cheapest-first:

### Option A — Fix forward (almost always correct)

If the `planner.bad_output` cluster is a deterministic shape miss (every row carries the same `zodIssues` path, e.g. always missing `main_assignments[0].sequence`), the prompt has drifted and the fix is a targeted prompt edit. Land it on `main`, deploy, watch the audit rate.

Don't revert. Don't escalate. This is the normal path.

### Option B — Page on-call; consider provider failover

If the `planner.bad_output` cluster is ad-hoc / non-deterministic (each row's `zodIssues` differs, output looks structurally garbled), the LLM provider has regressed — not our prompt. Page on-call.

The 3-30 LLM-provider circuit breaker (`apps/api/src/agents/circuit-breaker.ts`) trips automatically on persistent provider errors and fails over to the secondary provider. If the breaker hasn't tripped (because the bad output is structurally invalid but not an upstream error), force a failover manually — instructions live in the Epic 3 3-30 runbook (TBD until 9-s4 ships).

Don't revert the prompt here either. The prompt is fine; the model is misbehaving.

### Option C — Full revert of prompt + schema (last resort, never partial)

ONLY use this if the `planner.bad_output` rate is at or near 100% and you've confirmed (a) the prompt was the most recent change to ship, and (b) fix-forward in Option A failed to converge.

**Critical:** you cannot do a prompt-only revert. Reverting `planner.prompt.ts` to its pre-tree-shape state means the LLM emits the flat `plan_items[]` array, which the current `PlanComposeTreeOutputSchema` rejects 100% of the time. You must revert the schema too — which means rolling back Story 3-DM-C1 in its entirety, breaking apps/web's tree-shape consumers and the canonical-model migration. This is an "all-the-way-back-to-pre-C1" rollback, not a surgical revert.

If you reach this point, the planner has been broken for hours and there is no fix-forward path. Page leadership before committing the revert.

### Option D — Compatibility shim (do NOT take this path)

A theoretically possible middle path: revert the prompt only, then patch `buildCommitInput` to translate flat `plan_items[]` → tree shape on the fly. **Do not take this path.** Estimated weeks of implementation, full test churn, and you end up with a code path that exists only to support a rolled-back prompt nobody wants to keep. List it here so future-you knows it was considered and rejected.

---

## Decision tree (quick branching)

```
planner.bad_output rate elevated
   │
   ├── Is the rate ~100% across all householdIds?
   │     YES → Option C (full revert of prompt + schema). Page leadership.
   │     NO  → continue
   │
   ├── Do all rows share the same zodIssues.path?
   │     YES → Option A (fix forward; targeted prompt edit). Most common.
   │     NO  → continue
   │
   ├── Is the output structurally garbled (non-deterministic failures)?
   │     YES → Option B (page on-call; consider 3-30 provider failover).
   │     NO  → Option A — investigate the prompt; the issue is subtle.
```

---

## Git SHAs of the prompt's prior canonical states

The planner prompt has shipped in three notable revisions. SHAs are listed newest → oldest.

| SHA | Date | Description |
|-----|------|-------------|
| `3416a47` | 2026-06-02 | 3-DM-C1 Phase 9a — production swap to typecheck-green; tree-shape becomes the only valid output. |
| `f3df89c` | 2026-06-01 | 3-DM-C1 Phase 5 — orchestrator + planner prompt tree-shape rewrite (additive; flat schema still alive at this point). |
| `f00ef2f` | 2026-05-31 | chore: sprint catchup — the LAST commit where `planner.prompt.ts` emitted the flat `plan_items[]` shape. This is the "pre-cutover canonical" SHA. |
| `eceb1b1` | Story 3-3 era | story 3-3 — planner prompt v1.0.0 (initial canonical version, flat shape). |

**Revert command (Option C only):**
```
git checkout f00ef2f -- apps/api/src/agents/prompts/planner.prompt.ts
git checkout f00ef2f -- packages/contracts/src/plan.ts  # also revert the schema
# ... and ~40 sibling files. This is a Story 3-DM-C1 revert, not a one-file revert.
```

For Option A (fix forward), make the targeted edit to `apps/api/src/agents/prompts/planner.prompt.ts` directly; no revert command needed.

---

## Tests to re-run after any prompt or schema change

Minimum gate (run before any commit touching the prompt):
```
pnpm --filter @hivekitchen/api test src/agents/orchestrator.test.ts
pnpm --filter @hivekitchen/api test src/jobs/plan-generation.job.test.ts
```

Full gate (run before deploy):
```
pnpm --filter @hivekitchen/api test
pnpm --filter @hivekitchen/web test
pnpm typecheck
```

If the full sweep introduces new failures beyond the documented baseline (10 files / 22 tests; see `3-dm-c2-phase-c-cleanup.md` AC #1), the change is not deployable until the new failures are resolved.

---

## Related references

- Audit event: `apps/api/src/audit/audit.types.ts` — `'planner.bad_output'`
- Audit metadata shape: `{ agent: 'planner' | 'swap', weekOf: string, zodIssues: ZodIssue[] }`. PII-safe (ZodIssue path/message/code carry no input values).
- Predecessor implementation log: `_bmad-output/implementation-artifacts/3-dm-c1-plan-structure-cutover.md`
- Future alert wiring: Epic 9 9-s4 (operational metrics dashboard) — wire a "rate > 5% in any 1-hour window → page" rule against `planner.bad_output`.
