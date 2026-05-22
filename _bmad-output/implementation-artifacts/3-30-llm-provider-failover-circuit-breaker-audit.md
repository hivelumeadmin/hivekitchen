# Story 3.30: LLM-Provider Failover Circuit-Breaker + Audit

Status: done

## Story

As a developer,
I want the orchestrator's LLMProvider failover automated via circuit-breaker with audit trail,
So that NFR-REL-5's 15-min secondary-provider failover is structural, not heroic (AR-2, integration GG).

## Acceptance Criteria

1. **Given** Story 3.2 is complete,
   **When** the OpenAI provider fails 5 times in 60s,
   **Then** circuit-breaker opens; orchestrator swaps to next provider in chain; `audit.llm.provider.failover` audit row written with `metadata: {from, to, reason}`; ops Grafana alert fires.
   **And** passive health-check probe re-enables OpenAI after 15min if probe call succeeds.

## Dependencies & Context

**Already implemented (do NOT re-implement):**
- Story 3.2: `LLMProvider` interface in `apps/api/src/agents/providers/llm-provider.interface.ts`; `openai.adapter.ts` (OpenAI primary); `anthropic.adapter.ts` (stub raising `NotImplementedError`); `orchestrator.ts` takes `{provider: LLMProvider}` constructor arg
- Story 3.2 description mentions: "circuit-breaker around `provider.complete()` (5 failures in 60s → swap, 15-min health-check recovery) writes `audit.llm.provider.failover` on swap" — **this is the stub that was left for Story 3.30 to implement**
- Story 1.7: Pino structured logging + OpenTelemetry → Grafana Cloud; audit log powers the Grafana alert
- Story 1.8: `AuditService.write()` — single-row audit log
- `AUDIT_EVENT_TYPES`

**Key invariants:**
- Circuit-breaker is stateful (closed / open / half-open); state lives in memory (process-scoped); Redis not required for MVP (single API process)
- Failure threshold: 5 failures within 60-second rolling window
- On circuit open: swap to next provider in the chain (OpenAI → Anthropic); write audit immediately
- Recovery: 15-minute passive health-check probe; if probe succeeds → circuit moves to half-open; next success → closed; next failure → stays open (resets timer)
- `anthropic.adapter.ts` is a stub — it will raise `NotImplementedError` for actual calls; the health-check must handle this gracefully
- All circuit-breaker state is in-process; on pod restart, circuit resets to closed (acceptable — restarts are infrequent and the pod health-check would catch a down OpenAI within the first request)
- `import type` for all type-only imports

---

## Tasks / Subtasks

### Task 1 — `CircuitBreaker` class

Create `apps/api/src/agents/providers/circuit-breaker.ts`:

```typescript
export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  failureThreshold: number;   // number of failures to open circuit
  windowMs: number;           // rolling window in milliseconds
  recoveryTimeoutMs: number;  // how long to wait before attempting recovery
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures: number[] = []; // timestamps of recent failures (ms)
  private openedAt: number | null = null;

  constructor(
    private readonly name: string,
    private readonly opts: CircuitBreakerOptions,
  ) {}

  get currentState(): CircuitState {
    return this.state;
  }

  // Returns true if the call should be allowed through.
  allowCall(): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'open') {
      // Check if recovery timeout has elapsed — transition to half-open.
      if (this.openedAt !== null && Date.now() - this.openedAt >= this.opts.recoveryTimeoutMs) {
        this.state = 'half-open';
        return true; // Allow one probe call.
      }
      return false;
    }
    if (this.state === 'half-open') return true; // Allow probe call.
    return false;
  }

  // Record a successful call.
  onSuccess(): void {
    if (this.state === 'half-open') {
      // Recovery succeeded — reset to closed.
      this.state = 'closed';
      this.failures = [];
      this.openedAt = null;
    }
    // In closed state, success is a no-op.
  }

  // Record a failed call. Returns true if the circuit just opened.
  onFailure(): boolean {
    const now = Date.now();
    this.failures = this.failures.filter((t) => now - t < this.opts.windowMs);
    this.failures.push(now);

    if (this.state === 'half-open') {
      // Probe failed — reopen the circuit, reset the timer.
      this.state = 'open';
      this.openedAt = now;
      return false; // Already open, not a new opening.
    }

    if (this.state === 'closed' && this.failures.length >= this.opts.failureThreshold) {
      this.state = 'open';
      this.openedAt = now;
      return true; // Circuit just opened.
    }

    return false;
  }

  // For testing and health-check: reset to closed.
  reset(): void {
    this.state = 'closed';
    this.failures = [];
    this.openedAt = null;
  }
}
```

### Task 2 — `FailoverLLMProvider`: wraps the provider chain with circuit-breaker logic

Create `apps/api/src/agents/providers/failover-llm-provider.ts`:

```typescript
import type { LLMProvider, LLMResponse, LLMEvent } from './llm-provider.interface.js';
import type { FastifyBaseLogger } from 'fastify';
import type { AuditService } from '../../audit/audit.service.js';
import { CircuitBreaker } from './circuit-breaker.js';

export interface ProviderEntry {
  name: string;
  provider: LLMProvider;
}

export class FailoverLLMProvider implements LLMProvider {
  private currentIndex = 0;
  private readonly breakers: CircuitBreaker[];

  constructor(
    private readonly providers: ProviderEntry[],
    private readonly auditService: AuditService,
    private readonly logger: FastifyBaseLogger,
    private readonly householdId?: string, // for audit metadata
  ) {
    if (providers.length === 0) throw new Error('FailoverLLMProvider requires at least one provider');
    this.breakers = providers.map(
      (p) =>
        new CircuitBreaker(p.name, {
          failureThreshold: 5,
          windowMs: 60_000,
          recoveryTimeoutMs: 15 * 60 * 1000,
        }),
    );
  }

  async complete(prompt: string, tools: unknown[], options: unknown): Promise<LLMResponse> {
    const startIndex = this.currentIndex;

    for (let i = 0; i < this.providers.length; i++) {
      const idx = (startIndex + i) % this.providers.length;
      const breaker = this.breakers[idx];
      const entry = this.providers[idx];

      if (!breaker.allowCall()) {
        this.logger.warn({ provider: entry.name }, 'circuit open — skipping provider');
        continue;
      }

      try {
        const result = await entry.provider.complete(prompt, tools, options);
        breaker.onSuccess();
        if (idx !== this.currentIndex) {
          // We recovered to a working provider — note it but don't reset currentIndex yet
          // (primary recovery happens via health-check).
        }
        return result;
      } catch (err) {
        const justOpened = breaker.onFailure();
        this.logger.error({ provider: entry.name, err }, 'LLM provider call failed');

        if (justOpened) {
          // Circuit just opened for this provider — attempt to swap.
          const nextIdx = (idx + 1) % this.providers.length;
          const nextEntry = this.providers[nextIdx];

          this.logger.warn(
            { from: entry.name, to: nextEntry.name },
            'circuit opened — swapping LLM provider',
          );

          this.currentIndex = nextIdx;

          // Write failover audit immediately (fire-and-forget).
          void this.auditService
            .write({
              event_type: 'audit.llm.provider.failover',
              household_id: this.householdId ?? 'system',
              request_id: 'system',
              metadata: {
                from: entry.name,
                to: nextEntry.name,
                reason: 'circuit_breaker_opened',
                failure_count: 5,
                window_ms: 60_000,
              },
            })
            .catch((auditErr) =>
              this.logger.error({ auditErr }, 'audit write failed for llm.provider.failover'),
            );
        }
      }
    }

    throw new Error('All LLM providers exhausted or circuit-open — no response available');
  }

  async *stream(prompt: string, tools: unknown[], options: unknown): AsyncIterable<LLMEvent> {
    // Streaming follows the same failover logic — delegate to the current provider.
    const entry = this.providers[this.currentIndex];
    const breaker = this.breakers[this.currentIndex];

    if (!breaker.allowCall()) {
      throw new Error(`LLM provider ${entry.name} circuit is open`);
    }

    try {
      yield* entry.provider.stream(prompt, tools, options);
      breaker.onSuccess();
    } catch (err) {
      breaker.onFailure();
      throw err;
    }
  }

  // Returns the name of the currently active provider (for health-check and monitoring).
  get activeProviderName(): string {
    return this.providers[this.currentIndex].name;
  }

  // Returns circuit state per provider (for the health-check endpoint).
  getProviderStatus(): Array<{ name: string; state: string }> {
    return this.providers.map((p, i) => ({
      name: p.name,
      state: this.breakers[i].currentState,
    }));
  }

  // Force-reset a provider's circuit breaker (used by health-check on recovery).
  resetCircuit(providerName: string): void {
    const idx = this.providers.findIndex((p) => p.name === providerName);
    if (idx === -1) return;
    this.breakers[idx].reset();
    if (this.currentIndex !== idx) {
      // Recovered provider is now back online — restore it as primary.
      this.currentIndex = idx;
      this.logger.info({ provider: providerName }, 'circuit reset — provider restored as primary');
    }
  }
}
```

### Task 3 — Wire `FailoverLLMProvider` in the orchestrator plugin

In `apps/api/src/agents/orchestrator.plugin.ts` (or wherever the orchestrator is registered as a Fastify plugin):

Replace the direct `OpenAIAdapter` instantiation with a `FailoverLLMProvider`:

```typescript
const openaiAdapter = new OpenAIAdapter(fastify.openai);
const anthropicAdapter = new AnthropicAdapter(); // stub — raises NotImplementedError

const failoverProvider = new FailoverLLMProvider(
  [
    { name: 'openai', provider: openaiAdapter },
    { name: 'anthropic', provider: anthropicAdapter },
  ],
  fastify.auditService,
  fastify.log,
);

const orchestrator = new DomainOrchestrator({
  provider: failoverProvider,
  services: { ... },
});

fastify.decorate('orchestrator', orchestrator);
fastify.decorate('failoverProvider', failoverProvider); // expose for health-check
```

### Task 4 — Health-check probe: BullMQ cron job

Create `apps/api/src/jobs/llm-health-check.job.ts`:

```typescript
// Runs every 15 minutes to probe the primary LLM provider after circuit opens.
// If probe succeeds, resets the circuit breaker and restores primary provider.

export async function registerLLMHealthCheckJob(fastify: FastifyInstance): Promise<void> {
  const healthQueue = new Queue('llm-health-check', { connection: fastify.redis });

  // Schedule a repeating check every 15 minutes.
  await healthQueue.upsertJobScheduler(
    'llm-health-check-scheduler',
    { every: 15 * 60 * 1000 },
    {
      name: 'llm-health-check',
      opts: { attempts: 1 },
    },
  );

  const worker = new Worker(
    'llm-health-check',
    async () => {
      const failoverProvider = fastify.failoverProvider;
      const statuses = failoverProvider.getProviderStatus();

      for (const status of statuses) {
        if (status.state !== 'open') continue;

        // Send a minimal probe to the open provider.
        fastify.log.info({ provider: status.name }, 'probing LLM provider for health-check recovery');

        try {
          // Minimal probe — short prompt, no tools.
          // Use a direct adapter call bypassing the circuit breaker (probe-only).
          const providerEntry = failoverProvider.providers.find((p) => p.name === status.name);
          if (!providerEntry) continue;

          await providerEntry.provider.complete('ping', [], { max_tokens: 1 });
          // Probe succeeded — reset circuit.
          failoverProvider.resetCircuit(status.name);
          fastify.log.info({ provider: status.name }, 'LLM health-check probe succeeded — circuit reset');

          await fastify.auditService.write({
            event_type: 'audit.llm.provider.recovered',
            household_id: 'system',
            request_id: 'health-check',
            metadata: { provider: status.name },
          });
        } catch (err) {
          fastify.log.warn({ provider: status.name, err }, 'LLM health-check probe failed — circuit remains open');
        }
      }
    },
    { connection: fastify.redis, concurrency: 1 },
  );

  fastify.addHook('onClose', async () => {
    await worker.close();
    await healthQueue.close();
  });
}
```

### Task 5 — Health-check HTTP endpoint for ops visibility

In `apps/api/src/modules/health/health.routes.ts` (or existing health route):

```typescript
fastify.get(
  '/v1/internal/health/llm-providers',
  {
    preHandler: authorize(['admin']), // or require internal API key
  },
  async (_request, reply) => {
    const statuses = fastify.failoverProvider.getProviderStatus();
    return reply.send({
      active_provider: fastify.failoverProvider.activeProviderName,
      providers: statuses,
    });
  },
);
```

### Task 6 — Audit event types

```typescript
'audit.llm.provider.failover',
'audit.llm.provider.recovered',
```

### Task 7 — Grafana alert documentation

Create `apps/api/src/monitoring/alerts/llm-provider-failover.alert.json`:

```json
{
  "name": "LLM provider failover",
  "description": "OpenTelemetry log alert: fires when audit.llm.provider.failover is written",
  "condition": "count of structured logs WHERE event_type = 'audit.llm.provider.failover' in last 5m > 0",
  "severity": "high",
  "message": "LLM provider circuit opened. Check audit_log for failover details. Ops: verify OpenAI API health.",
  "notification_channel": "ops-slack",
  "auto_resolve": "yes — resolves when audit.llm.provider.recovered is emitted"
}
```

### Task 8 — Tests

**`circuit-breaker.test.ts` (new):**
- 4 failures in window → circuit stays closed
- 5 failures in window → circuit opens; `allowCall()` returns false
- 5 failures in window but older than `windowMs` → circuit stays closed (rolling window)
- Circuit opens → after `recoveryTimeoutMs` → `allowCall()` returns true (half-open)
- Half-open: success → `onSuccess()` → circuit closes; `allowCall()` returns true
- Half-open: failure → `onFailure()` → circuit reopens

**`failover-llm-provider.test.ts` (new):**
- Primary provider fails 5 times → `currentIndex` switches to next; audit event written
- All providers exhausted → throws error
- Primary provider half-open → probe succeeds → `resetCircuit()` restores primary

**Typecheck:**
- `pnpm --filter @hivekitchen/api typecheck`

---

## Dev Notes

### In-memory circuit state is acceptable for MVP

The circuit-breaker state lives in the process. On pod restart (e.g., crash-loop), the circuit resets to closed. This means after a restart, the system will make one more failed call to the downed provider before re-opening the circuit. Acceptable — the alternative (Redis-backed circuit state) adds a dependency for an infrequent failure path.

If the cluster scales to multiple API pods, each pod has an independent circuit. This means pod A might failover while pod B's circuit remains closed. For MVP with a single API pod, this is not an issue. Redis-backed shared circuit state is a future story (document in `deferred-work.md`).

### Anthropic adapter is still a stub

`anthropic.adapter.ts` raises `NotImplementedError` for production calls. When the circuit breaker opens and failover occurs, the system will immediately fail on the Anthropic provider too. This is by design for MVP — the purpose of the failover architecture is to be structurally ready for a working Anthropic adapter, not to guarantee a successful failover today.

The health-check probe to the failed primary (OpenAI) is what actually recovers the system — the Anthropic adapter is a placeholder.

### `FailoverLLMProvider.providers` needs to be accessible for health-check

The health-check job accesses `failoverProvider.providers` (an array of `ProviderEntry`). This property must be public (or the method `getProviderForName()` must be exposed). Adjust the class design if TypeScript strict mode flags a privacy concern.

### `audit.llm.provider.failover` event matches Story 3.2's documented behavior

Story 3.2's acceptance criteria mention "circuit-breaker around `provider.complete()` (5 failures in 60s → swap, 15-min health-check recovery) writes `audit.llm.provider.failover` on swap." This story implements exactly that. The `AUDIT_EVENT_TYPES` const in Story 1.8's audit system should already have a placeholder; if not, add it here.

---

## Project Structure

**New files:**
```
apps/api/src/agents/providers/circuit-breaker.ts
apps/api/src/agents/providers/circuit-breaker.test.ts
apps/api/src/agents/providers/failover-llm-provider.ts
apps/api/src/agents/providers/failover-llm-provider.test.ts
apps/api/src/jobs/llm-health-check.job.ts
apps/api/src/monitoring/alerts/llm-provider-failover.alert.json
```

**Modified files:**
```
apps/api/src/audit/audit.types.ts                              + audit.llm.provider.failover, audit.llm.provider.recovered
apps/api/src/agents/orchestrator.plugin.ts                     + FailoverLLMProvider wired; fastify.failoverProvider decorated
apps/api/src/modules/health/health.routes.ts                   + GET /v1/internal/health/llm-providers
apps/api/src/jobs/index.ts (or app bootstrap)                  + registerLLMHealthCheckJob()
_bmad-output/implementation-artifacts/sprint-status.yaml       3-30 → ready-for-dev
_bmad-output/implementation-artifacts/deferred-work.md         + Redis-backed shared circuit state for multi-pod deployments; full Anthropic adapter
```

---

## Implementation Notes (2026-05-22)

### What existed vs what was built

The `CircuitBreaker` class and provider failover logic were already implemented in `DomainOrchestrator` (Story 3.2 delivered more than its stub description implied):
- `CircuitBreaker` at `apps/api/src/agents/circuit-breaker.ts` — callback-based, 6 tests
- `DomainOrchestrator.handleBreakerOpen()` → `swapProvider()` already writes `llm.provider.failover` audit
- `DomainOrchestrator.handleRecoveryAttempt()` already probes primary via `primary.probe()` after 15-min timer
- Failover + routing tests already existed in `orchestrator.test.ts`

**Tasks 1–3 (CircuitBreaker, FailoverLLMProvider, orchestrator wiring) were already done.** The BullMQ health-check job (Task 4) was satisfied by the existing `setTimeout`-based recovery in the CircuitBreaker — see deferred-work.md for the multi-pod BullMQ upgrade.

### What was added in this story

- `'llm.provider.recovered'` added to `AUDIT_EVENT_TYPES`
- `DomainOrchestrator.handleRecoveryAttempt()` now emits `llm.provider.recovered` audit on probe success
- `DomainOrchestrator.getProviderStatus()` — returns `{ active_provider, circuit_open, providers }`
- `GET /v1/internal/health/llm-providers` endpoint in `health.routes.ts`
- `apps/api/src/monitoring/alerts/llm-provider-failover.alert.json`
- 3 new tests: `getProviderStatus` (closed + open states) + recovery audit path

### Deferred

- BullMQ cron-based health-check probe (multi-pod scenario) — see deferred-work.md
- Full Anthropic adapter implementation — see deferred-work.md

### Review Findings (2026-05-22)

Adversarial 3-layer review: Blind Hunter + Edge Case Hunter + Acceptance Auditor. Triage: 4 decision-needed, 8 patches, 7 deferred, 10 dismissed.

**Decisions resolved (2026-05-22):**

- [x] [Review][Decision] Audit fire-and-forget for `llm.provider.recovered` → **add retry with exponential backoff** (becomes P9).
- [x] [Review][Decision] Per-provider circuit state → **keep narrow shape** (current `{ active_provider, circuit_open, providers: string[] }`). No code change.
- [x] [Review][Decision] CircuitBreaker stale-recovery → **fix in this story** (becomes P10 + P11).
- [x] [Review][Decision] alert.json log-field drift → **add `event_type` to pino log alongside audit write** (becomes P12).

**Patches (applied 2026-05-22):**

- [x] [Review][Patch] **Add auth preHandler to `/v1/internal/health/llm-providers`** [`apps/api/src/modules/internal/health.routes.ts`] — added inline JWT-verify + `ops`-role check (the global authenticate hook skips `/v1/internal/` for k8s liveness probes, so manual verification is needed). 401 if missing/invalid token, 403 if role !== 'ops'.
- [x] [Review][Patch] **Recovery audit metadata** [`apps/api/src/agents/orchestrator.ts:handleRecoveryAttempt`] — `request_id: randomUUID()` → `'health-check'`; added `household_id: 'system'`; added `from`/`to` to metadata for symmetry with failover audit.
- [x] [Review][Patch] **Fix alert.json description prefix drift** — description now reads `fires when llm.provider.failover is written` (matches condition + actual emitted event_type).
- [x] [Review][Patch] **Test: probe returns `false` → no audit emitted, stays on secondary** — added in `recovery: probe-driven audit + provider restoration` describe block.
- [x] [Review][Patch] **Test: probe throws → no audit emitted, no crash** — added.
- [x] [Review][Patch] **Test cleanup → `afterEach` with try/finally** — new recovery describe block uses an `afterEach` that disposes the orchestrator and resets fake timers, even if an earlier `expect` throws.
- [x] [Review][Patch] **Assert `circuit_open === false` after recovery** — added to the happy-path test.
- [x] [Review][Patch] **Assert `primary.probe()` was called** — added to the happy-path test.
- [x] [Review][Patch] **P9 (from D1) — Retry with exponential backoff on recovery audit write** — added `writeAuditWithRetry()` helper: 3 attempts at 100ms / 500ms / 2s backoff; logs final failure with `event_type` + `attempt` count. Recovery audit drives the alert `auto_resolve` path, so silent loss would leave ops paged.
- [~] [Review][Patch] **P10 (from D3) — Rescoped** [`apps/api/src/agents/circuit-breaker.ts`] — pre-existing test explicitly asserts that `recordSuccess` leaves the recovery timer running (the 15-min probe targets the *primary*, not the secondary that just succeeded — secondary success doesn't imply primary recovery). Original P10 (cancel-timer-in-recordSuccess) broke this design contract. Replaced with a defensive fix in `open()`: clear any pre-existing `recoveryTimeoutId` before arming a new one — prevents a leaked stale timer from prematurely closing a freshly-re-opened circuit (the actual E21 bug). Edge Case Hunter's stale-recovery findings (E2, E20) re-analyzed as *intentional* design: when the timer fires after self-heal, the system swaps back to primary if probe succeeds, and the `recovered` audit accurately captures that swap.
- [x] [Review][Patch] **P11 (from D3) — Symmetric `from`/`to` in recovered audit + clarifying guard comment** [`apps/api/src/agents/orchestrator.ts:handleRecoveryAttempt`] — captured `previous` provider before swap; recovered audit metadata now includes `{ from, to, provider }`. The pre-existing `if (this.currentProviderIndex === 0) return;` guard already correctly handles the no-failover case.
- [x] [Review][Patch] **P12 (from D4) — Structured pino log with `event_type` alongside both audit writes** — failover and recovery log lines now include `event_type: 'llm.provider.failover'` / `'llm.provider.recovered'` so OTel log-based alerts (alert.json `condition`) can match the field.

**Deferred** (see `deferred-work.md` for full entries):

- [x] [Review][Defer] Multi-provider failover chain (3+) doesn't recover beyond first hop [`apps/api/src/agents/orchestrator.ts: handleRecoveryAttempt`] — deferred, MVP is 2 providers
- [x] [Review][Defer] Recovery callback can fire after `dispose()` mid-shutdown [`apps/api/src/agents/orchestrator.ts:565`] — deferred, graceful shutdown edge
- [x] [Review][Defer] Magic strings duplicated across audit type union, orchestrator, alert.json [`apps/api/src/audit/audit.types.ts:80`] — deferred, refactor opportunity
- [x] [Review][Defer] Test uses `await Promise.resolve(); await Promise.resolve();` microtask kludge [`apps/api/src/agents/orchestrator.test.ts:61`] — deferred, works for current implementation
- [x] [Review][Defer] `getProviderStatus()` returns stale data during dispose race [`apps/api/src/agents/orchestrator.ts:557`] — deferred, edge case
- [x] [Review][Defer] No contract test for `/v1/internal/health/llm-providers` response shape [`packages/contracts/`] — deferred, separate test concern
- [x] [Review][Defer] Concurrent `complete()` during recovery may misattribute failures [`apps/api/src/agents/orchestrator.ts: complete`] — deferred, Dev Notes accept in-process MVP

**Dismissed (10):** false positives from blind-context review (`fastify.orchestrator` decoration / `getActiveProvider` / `isTripped` / 900_000 constant all exist in source); `'unknown'` fallback unreachable per constructor invariant; failover audit covered by Story 3.2 pre-existing tests; opaque test helpers pre-existing convention; defensive sync-throw scenario; recovery audit no-failover case covered by `index === 0` guard; sprint-status/deferred-work updates intentionally scoped out.

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-05-05 | Menon | Story 3.30 created — ready-for-dev. |
| 2026-05-22 | Claude | Implementation complete → review. |
| 2026-05-22 | Claude | Code review (3-layer adversarial) → 12 patches applied (auth gate on internal health endpoint, recovery audit retry + metadata, alert.json prefix, symmetric pino `event_type` logs, breaker `open()` timer-leak fix, 3 new branch-coverage tests, 5 new auth tests). 7 items deferred to `deferred-work.md`. P10 rescoped after a pre-existing test revealed the timer-keep-running behaviour is intentional; the real timer-leak fix landed in `CircuitBreaker.open()`. → done. |
