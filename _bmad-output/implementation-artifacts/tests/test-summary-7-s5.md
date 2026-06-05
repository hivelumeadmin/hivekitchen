# Test Automation Summary — Story 7-S5 (Soft→Hard Promotion Job)

_Generated 2026-06-04 by the QA E2E workflow (invoked from code review). Framework: Vitest (the project's established runner). This slice is an API-only Fastify + BullMQ background job — there is no web/UI surface, so the "E2E" layer is plugin/worker integration, not Playwright._

## Generated Tests

### Integration ("E2E" for a background job)
- [x] `apps/api/src/jobs/memory-forget.job.integration.test.ts` (5 tests) — registers the **real** `memoryForgetJobPlugin` on a Fastify instance + a fake BullMQ facade, driving the wiring the unit tests bypass:
  - **AC#6** — scheduler registered on queue `memory-forget`, id `nightly-memory-forget`, cron `0 3 * * *` UTC, `attempts: 3`, `removeOnComplete: { count: 30 }`, worker bound to the same queue. _(This AC previously had no coverage.)_
  - **AC#1 / AC#2** — invoking the captured worker callback hard-deletes via the real `MemoryRepository` (over a mock Supabase delete-chain) and writes exactly one `memory.hard_forgotten` audit row per deleted node, with `{ node_id, node_type }` in metadata and `household_id` top-level.
  - **AC#3** — zero qualifying nodes ⇒ no audit rows written.
  - **AC#5** — a delete-query error makes the worker callback re-throw (the BullMQ retry path).
  - Boot guard — missing `supabase` decorator ⇒ plugin throws at registration.

## Coverage of the 7 Acceptance Criteria

| AC | Behavior | Covered by |
|----|----------|-----------|
| #1 | Hard-delete soft-forgotten >30d; provenance cascades | integration (worker→repo) + `memory.repository.test.ts` (`hardDeleteSoftForgotten`) |
| #2 | One `memory.hard_forgotten` audit per node, best-effort | integration + `memory-forget.job.test.ts` |
| #3 | Zero nodes ⇒ INFO `count:0`, no audit | integration + `memory-forget.job.test.ts` |
| #4 | Deleted node absent from `GET .../memory` | inherent (row deleted) + `findActiveNodes` tests |
| #5 | Repo error ⇒ throw ⇒ worker re-throws (retry) | integration + `memory-forget.job.test.ts` |
| #6 | `upsertJobScheduler` cron `0 3 * * *` UTC | **integration (new — was uncovered)** |
| #7 | D3: `editProse` on soft-forgotten ⇒ 404 | `memory.service.test.ts` (D3) + `memory.routes.test.ts` (null→404) + `memory.repository.test.ts` (P1 `soft_forget_at IS NULL` filter) |

## Verification
- New integration suite: **5/5 pass**. Full job surface (unit + integration): **10/10 pass**.
- API typecheck: 11 errors = documented baseline (0 new). New file lint-clean.

## Next Steps
- Run in CI alongside the existing API suite.
- A true DB-backed integration (real Postgres verifying the `ON DELETE CASCADE` on `memory_provenance` and the live BullMQ schedule) remains the documented **USER-SIDE GATE**: `supabase db push --include-all` + the job running against live Redis + Supabase.
