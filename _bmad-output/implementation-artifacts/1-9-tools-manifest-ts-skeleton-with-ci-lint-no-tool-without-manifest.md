# Story 1.9: tools.manifest.ts skeleton with CI lint (no-tool-without-manifest)

Status: done

## Story

As a developer,
I want a `tools.manifest.ts` registering every agent tool with `{ name, description, inputSchema, outputSchema, maxLatencyMs, fn }` plus a CI lint blocking PRs adding a tool without a manifest entry,
So that §3.5 budget computation has the data it needs at runtime.

## Acceptance Criteria

1. `apps/api/src/agents/tools.manifest.ts` exists with:
   - `ToolSpec` interface: `{ name: string; description: string; inputSchema: ZodTypeAny; outputSchema: ZodTypeAny; maxLatencyMs: number; fn: (input: unknown) => Promise<unknown> }`
   - `TOOL_MANIFEST` exported as `const Map<string, ToolSpec>` with one placeholder tool (`_placeholder`) registered — all 6 required fields present — to verify wiring and give the check script a valid baseline

2. `apps/api/scripts/check-tool-manifest.ts` script:
   - Scans `apps/api/src/agents/tools/*.tools.ts` using `node:fs/promises readdir`
   - For each `*.tools.ts` file found, dynamically imports it and reads its `MANIFESTED_TOOL_NAMES: readonly string[]` export
   - For each name in `MANIFESTED_TOOL_NAMES`, verifies it is registered in `TOOL_MANIFEST` and has all 6 required fields (`name`, `description`, `inputSchema`, `outputSchema`, `maxLatencyMs`, `fn`)
   - Missing registration or field → `process.exit(1)` with a diagnostic message naming the tool and missing field
   - Zero `*.tools.ts` files → exits 0 (valid for Story 1.9 where no real tools exist yet)

3. `pnpm tools:check` defined in `apps/api/package.json` (`tsx scripts/check-tool-manifest.ts`) and root `package.json` (`tsx apps/api/scripts/check-tool-manifest.ts`); wired as a step in `.github/workflows/ci.yml`

4. `.github/workflows/ci.yml` created with steps: checkout, pnpm setup, Node 22, `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm tools:check`

5. `apps/api/src/observability/tool-latency.histogram.ts` exports `recordToolLatency(redis: Redis, toolName: string, latencyMs: number): Promise<void>`:
   - Redis key: `tool:latency:hist:{toolName}` (sorted set)
   - `ZADD key now "latencyMs:now"` (score = timestamp ms, member encodes value + timestamp for uniqueness)
   - `ZREMRANGEBYSCORE key -inf cutoff` trims entries older than 1h
   - `EXPIRE key 3660` sets TTL to 1h + 60s buffer
   - Full Grafana p95 alert wiring deferred to Story 3.4

6. `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm tools:check` remain green workspace-wide

## Tasks / Subtasks

- [x] **Task 1 — Pre-flight** (no AC)
  - [x] Confirm Story 1.8 is `done` in `sprint-status.yaml`
  - [x] Confirm `apps/api/src/agents/` contains only `.gitkeep` (no existing manifest)
  - [x] Confirm `apps/api/src/agents/tools/` contains only `.gitkeep` (no existing tools)
  - [x] Confirm `apps/api/scripts/` does NOT exist (create it in Task 4)
  - [x] Confirm `.github/workflows/` does NOT exist (create it in Task 6)

- [x] **Task 2 — Create ToolSpec interface and manifest** (AC: #1)
  - [x] Create `apps/api/src/agents/tools.manifest.ts` per **Manifest Spec** in Dev Notes
  - [x] Export `ToolSpec` interface and `TOOL_MANIFEST` Map
  - [x] Register `_placeholder` tool with all 6 required fields
  - [x] Delete `apps/api/src/agents/.gitkeep` (directory now has real content)

- [x] **Task 3 — Create tool-latency histogram skeleton** (AC: #5)
  - [x] Create `apps/api/src/observability/tool-latency.histogram.ts` per **Histogram Spec** in Dev Notes
  - [x] Export `recordToolLatency(redis, toolName, latencyMs)` with Redis sliding-window write
  - [x] Create `apps/api/src/observability/tool-latency.histogram.test.ts` with unit tests (see **Histogram Test Spec**)

- [x] **Task 4 — Create check-tool-manifest script** (AC: #2)
  - [x] Create directory `apps/api/scripts/`
  - [x] Create `apps/api/scripts/check-tool-manifest.ts` per **Check Script Spec** in Dev Notes
  - [x] Uses `import.meta.url` + `fileURLToPath` (no `__dirname` — ESM only)
  - [x] Delete `apps/api/src/agents/tools/.gitkeep` (directory will hold real tools in Epic 3)

- [x] **Task 5 — Wire pnpm tools:check** (AC: #3)
  - [x] Add `"tools:check": "tsx scripts/check-tool-manifest.ts"` to `apps/api/package.json` scripts
  - [x] Add `"tools:check": "tsx apps/api/scripts/check-tool-manifest.ts"` to root `package.json` scripts
  - [x] Run `pnpm tools:check` from repo root — verify exits 0

- [x] **Task 6 — Create CI yml** (AC: #4)
  - [x] Create `.github/workflows/` directory
  - [x] Create `.github/workflows/ci.yml` per **CI Spec** in Dev Notes

- [x] **Task 7 — Verification** (AC: #6)
  - [x] `pnpm typecheck` — all packages green
  - [x] `pnpm lint` — 0 errors workspace-wide
  - [x] `pnpm test` — all tests green (including new histogram tests)
  - [x] `pnpm tools:check` — exits 0 (no `*.tools.ts` files → nothing to cross-check)
  - [x] Update `sprint-status.yaml` story to `review`

---

## Dev Notes

### Architecture References (authoritative sources)

- `_bmad-output/planning-artifacts/architecture.md` §3.5 — Tool-latency manifest + budget composition + early-ack split
- `_bmad-output/planning-artifacts/architecture.md` §4.3 — Tool call shape: `{ name, description, inputSchema, outputSchema, maxLatencyMs, fn }`, all six required; orchestrator DI wiring
- `_bmad-output/planning-artifacts/architecture.md` §1.4 — Tool naming: `<domain>.<verb>` (`allergy.check`, `memory.recall`, `recipe.search`, `pantry.read`, `plan.compose`)
- `_bmad-output/planning-artifacts/architecture.md` §2.2 — `agents/` internal layout (`tools.manifest.ts` lives directly in `agents/`, not in `agents/tools/`)
- `_bmad-output/planning-artifacts/architecture.md` §6 file tree — `tool-latency.histogram.ts` in `observability/`
- `_bmad-output/implementation-artifacts/1-8-single-row-audit-log-schema-monthly-partitions-composite-index-audit-service-write.md` — Story 1.8 patterns (`.js` extensions, `fp()`, fire-and-forget, ESLint fixes)

### CRITICAL: Boundary Rules That Affect This Story

**`agents/` boundary (enforced by `eslint-plugin-boundaries`):**
- Files in `agents/` CANNOT import from `fastify`, `routes/`, or any `.routes.ts` file
- `tools.manifest.ts` must NOT import anything from Fastify — plain module only
- Boundary element type `api-agents` pattern: `apps/api/src/agents/**/*`

**SDK import restriction:**
- Files outside `plugins/` and `*.repository.ts` cannot value-import vendor SDKs: `openai`, `@openai/*`, `@elevenlabs/*`, `stripe`, `@sendgrid/*`, `twilio`, `ioredis`, `bullmq`
- Type-only imports (`import type { Redis } from 'ioredis'`) ARE allowed (`allowTypeImports: true`)
- `tools.manifest.ts` only imports `zod` (not restricted) ✅
- `tool-latency.histogram.ts` uses `import type { Redis } from 'ioredis'` ✅ (type-only)

**`no-console` applies to `apps/api/src/**/*.ts` only — NOT to `apps/api/scripts/`:**
- `check-tool-manifest.ts` is in `scripts/`, so `console.log` / `console.error` are permitted

### Manifest Spec

```ts
// apps/api/src/agents/tools.manifest.ts
import { z } from 'zod';
import type { ZodTypeAny } from 'zod';

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: ZodTypeAny;
  outputSchema: ZodTypeAny;
  maxLatencyMs: number;
  fn: (input: unknown) => Promise<unknown>;
}

// Placeholder — verifies manifest wiring; remove when real tools land in Story 3.4
const PlaceholderInputSchema = z.object({ echo: z.string() });
const PlaceholderOutputSchema = z.object({ echo: z.string() });

const placeholderSpec: ToolSpec = {
  name: '_placeholder',
  description: 'Manifest health-check placeholder — remove before Epic 3 tools land',
  inputSchema: PlaceholderInputSchema,
  outputSchema: PlaceholderOutputSchema,
  maxLatencyMs: 50,
  fn: async (input) => {
    const parsed = PlaceholderInputSchema.parse(input);
    return { echo: parsed.echo };
  },
};

export const TOOL_MANIFEST = new Map<string, ToolSpec>([['_placeholder', placeholderSpec]]);
```

**Why `fn: (input: unknown) => Promise<unknown>`:**
- `any` is banned by `@typescript-eslint/no-explicit-any: error`
- `fn: (input: TInput) => Promise<TOutput>` is NOT assignable to a unified map type due to function parameter contravariance — a `(input: string) => ...` cannot accept `unknown`
- `unknown` parameters are sound: each `fn` implementation uses its local `inputSchema.parse(input)` to narrow at runtime (per the project invariant "every inbound boundary is Zod-parsed")
- The orchestrator in Epic 3 will call: `toolSpec.inputSchema.parse(rawArgs)` → `toolSpec.fn(parsed)` → `toolSpec.outputSchema.parse(result)`

**Tool naming convention (architecture §1.4):**
`<domain>.<verb>` — `allergy.check`, `memory.recall`, `recipe.search`, `pantry.read`, `plan.compose`. The placeholder uses `_placeholder` (underscore signals non-production intent; underscore prevents collision with the `<domain>.<verb>` namespace).

**Budget composition (architecture §3.5):**
`200ms thread load + 300ms intent classification + sum(maxLatencyMs) + 500ms audit + persist`. Orchestrator sums all tool `maxLatencyMs` before dispatching:
- `sum ≤ 6000ms` → synchronous ElevenLabs webhook response
- `sum > 6000ms` → early-ack `{ response: "one sec.", continuation: { resume_token, expected_within_ms } }`
- Any tool without a `maxLatencyMs` declaration fails `pnpm tools:check` in CI

**Future tool registration pattern (Story 3.4, for reference):**
```ts
// In apps/api/src/agents/tools/recipe.tools.ts:
export const MANIFESTED_TOOL_NAMES = ['recipe.search', 'recipe.fetch'] as const;

export function createRecipeSearchTool(recipeService: RecipeService): ToolSpec {
  return {
    name: 'recipe.search',
    description: '...',
    inputSchema: RecipeSearchInputSchema,
    outputSchema: RecipeSearchOutputSchema,
    maxLatencyMs: 300,
    fn: async (input) => {
      const parsed = RecipeSearchInputSchema.parse(input);
      return recipeService.search(parsed);
    },
  };
}

// In tools.manifest.ts, registered with services bundle:
// TOOL_MANIFEST.set('recipe.search', createRecipeSearchTool(services.recipe));
```

The `MANIFESTED_TOOL_NAMES` export is what `check-tool-manifest.ts` reads to discover which tools a `*.tools.ts` file claims to provide.

### Histogram Spec

```ts
// apps/api/src/observability/tool-latency.histogram.ts
import type { Redis } from 'ioredis';

const KEY_PREFIX = 'tool:latency:hist:';
const WINDOW_MS = 60 * 60 * 1000; // 1h sliding window
const TTL_SECONDS = Math.ceil(WINDOW_MS / 1000) + 60; // 3660s (1h + 60s buffer)

export async function recordToolLatency(
  redis: Redis,
  toolName: string,
  latencyMs: number,
): Promise<void> {
  const key = `${KEY_PREFIX}${toolName}`;
  const now = Date.now();
  const cutoff = now - WINDOW_MS;

  // Score = timestamp ms → enables ZRANGEBYSCORE for time-window queries
  // Member = "latencyMs:timestamp" → uniqueness prevents ZADD from deduplicating entries
  await redis.zadd(key, now, `${latencyMs}:${now}`);
  // Trim entries that have fallen outside the sliding window
  await redis.zremrangebyscore(key, '-inf', cutoff);
  // TTL prevents unbounded key growth if a tool stops recording
  await redis.expire(key, TTL_SECONDS);
}
```

**Deferred to Story 3.4:** p95 percentile computation (`ZRANGE key 0 -1 WITHSCORES` → sort members → read 95th entry); Grafana Cloud alert when sampled p95 > `maxLatencyMs × 1.5` for ≥1h.

**Where `recordToolLatency` is called:** In Epic 3, the orchestrator wraps each tool call:
```ts
const start = Date.now();
const result = await toolSpec.fn(parsedInput);
await recordToolLatency(fastify.ioredis, toolSpec.name, Date.now() - start);
```
`fastify.ioredis` is already decorated via `ioredisPlugin` (Story 1.6). The histogram function accepts `Redis` as a parameter — it does NOT need to import ioredis directly (boundary-compliant).

### Histogram Test Spec

```ts
// apps/api/src/observability/tool-latency.histogram.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import { recordToolLatency } from './tool-latency.histogram.js';

describe('recordToolLatency', () => {
  const mockRedis = {
    zadd: vi.fn().mockResolvedValue(1),
    zremrangebyscore: vi.fn().mockResolvedValue(0),
    expire: vi.fn().mockResolvedValue(1),
  } as unknown as Redis;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes to correct Redis key with score=now and encoded member', async () => {
    const before = Date.now();
    await recordToolLatency(mockRedis, 'allergy.check', 42);
    const after = Date.now();

    const zaddMock = vi.mocked(mockRedis.zadd);
    expect(zaddMock).toHaveBeenCalledOnce();
    const [key, score, member] = zaddMock.mock.calls[0] as [string, number, string];
    expect(key).toBe('tool:latency:hist:allergy.check');
    expect(score).toBeGreaterThanOrEqual(before);
    expect(score).toBeLessThanOrEqual(after);
    expect(member).toMatch(/^42:\d+$/);
  });

  it('trims entries older than 1h window', async () => {
    const before = Date.now();
    await recordToolLatency(mockRedis, 'memory.recall', 100);
    const after = Date.now();

    const trimMock = vi.mocked(mockRedis.zremrangebyscore);
    expect(trimMock).toHaveBeenCalledOnce();
    const [key, min, max] = trimMock.mock.calls[0] as [string, string, number];
    expect(key).toBe('tool:latency:hist:memory.recall');
    expect(min).toBe('-inf');
    const cutoff = Number(max);
    expect(cutoff).toBeGreaterThanOrEqual(before - 60 * 60 * 1000);
    expect(cutoff).toBeLessThanOrEqual(after - 60 * 60 * 1000);
  });

  it('sets TTL to 3660s (1h + 60s buffer)', async () => {
    await recordToolLatency(mockRedis, 'recipe.search', 300);
    expect(vi.mocked(mockRedis.expire)).toHaveBeenCalledWith(
      'tool:latency:hist:recipe.search',
      3660,
    );
  });
});
```

**Note on `as unknown as Redis`:** This is the TS-idiomatic force-cast pattern that satisfies `@typescript-eslint/no-explicit-any` (intermediate `unknown` makes the cast explicit without using banned `any`). Required here because the ioredis `Redis` class has complex constructor overloads that a plain object mock cannot satisfy structurally.

**Note on `vi.mocked()`:** Vitest's `vi.mocked()` preserves type information from `vi.fn()` mocks. Use it instead of direct cast to access `.mock.calls` with types.

### Check Script Spec

```ts
// apps/api/scripts/check-tool-manifest.ts
import { readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TOOL_MANIFEST } from '../src/agents/tools.manifest.js';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REQUIRED_FIELDS = [
  'name',
  'description',
  'inputSchema',
  'outputSchema',
  'maxLatencyMs',
  'fn',
] as const;

function extractManifestNames(mod: unknown): readonly string[] {
  if (
    typeof mod === 'object' &&
    mod !== null &&
    'MANIFESTED_TOOL_NAMES' in mod &&
    Array.isArray((mod as Record<string, unknown>).MANIFESTED_TOOL_NAMES)
  ) {
    return (mod as Record<string, readonly string[]>).MANIFESTED_TOOL_NAMES;
  }
  return [];
}

async function main(): Promise<void> {
  const toolsDir = resolve(SCRIPT_DIR, '../src/agents/tools');

  let toolFiles: string[];
  try {
    const entries = await readdir(toolsDir);
    toolFiles = entries.filter((f) => f.endsWith('.tools.ts'));
  } catch {
    console.log('ℹ️  tools/ directory not found — nothing to cross-check');
    return;
  }

  if (toolFiles.length === 0) {
    console.log('✅ No *.tools.ts files found — manifest check skipped');
    return;
  }

  let violationCount = 0;

  for (const file of toolFiles) {
    const filePath = pathToFileURL(resolve(toolsDir, file)).href;
    const mod: unknown = await import(filePath);
    const manifestedNames = extractManifestNames(mod);

    if (manifestedNames.length === 0) {
      console.warn(`⚠️  [${file}] No MANIFESTED_TOOL_NAMES export — skipping`);
      continue;
    }

    for (const name of manifestedNames) {
      if (!TOOL_MANIFEST.has(name)) {
        console.error(
          `❌ [${file}] "${name}" not in TOOL_MANIFEST — register it in tools.manifest.ts before merging`,
        );
        violationCount++;
        continue;
      }

      const spec = TOOL_MANIFEST.get(name);
      for (const field of REQUIRED_FIELDS) {
        if (!spec || spec[field as keyof typeof spec] === undefined) {
          console.error(`❌ [${file}] Tool "${name}" missing manifest field: "${field}"`);
          violationCount++;
        }
      }
    }
  }

  if (violationCount > 0) {
    console.error(
      `\n🚫 ${violationCount} manifest violation(s). Every tool in *.tools.ts must be registered in tools.manifest.ts with all 6 required fields.`,
    );
    process.exit(1);
  }

  console.log(`✅ Tool manifest check passed (${toolFiles.length} tool file(s), 0 violations)`);
}

main().catch((err: unknown) => {
  console.error(
    'check-tool-manifest: unexpected error:',
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
});
```

**Key implementation notes:**
- **Static import of `TOOL_MANIFEST`**: `import { TOOL_MANIFEST } from '../src/agents/tools.manifest.js'`. The `.js` extension is required for ESM resolution; `tsx` handles the `.ts` → `.js` rewrite at runtime. `tools.manifest.ts` only imports `zod` — no Fastify/SDK side effects — so static import is safe.
- **`import.meta.url` + `fileURLToPath`**: The only path-resolution pattern in ESM (`__dirname` banned by project invariant).
- **`pathToFileURL()`**: Required before passing a file path to dynamic `import()` — raw file paths don't work as ESM specifiers on all platforms.
- **No `any`**: `extractManifestNames` uses runtime `typeof`/`Array.isArray` narrowing. `mod: unknown` is explicit. Satisfies `@typescript-eslint/no-explicit-any: error`.
- **`scripts/` is outside `no-console`**: The rule applies to `src/**/*.ts` only. `console.log`, `console.error`, and `console.warn` are permitted in scripts.
- **Dynamic import of `*.tools.ts` files**: `tsx` (the script runner) handles TypeScript dynamic imports natively. When tools files are added in Epic 3, this will work without additional config.

### CI Spec

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  ci:
    name: Typecheck · Lint · Test · Manifest
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: '9.15.0'

      - name: Setup Node.js 22
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Typecheck
        run: pnpm typecheck

      - name: Lint
        run: pnpm lint

      - name: Test
        run: pnpm test

      - name: Tool manifest check
        run: pnpm tools:check
```

**`pnpm/action-setup@v4`**: The v4 action reads `packageManager` from root `package.json` automatically. The explicit `version: '9.15.0'` is included for determinism (matches `"packageManager": "pnpm@9.15.0"` in root `package.json`).

**`concurrency: cancel-in-progress: true`**: Cancels in-flight CI runs when a new push to the same branch arrives — prevents queue buildup on rapid pushes to feature branches.

### Package.json Scripts to Add

**`apps/api/package.json`** — add to `scripts`:
```json
"tools:check": "tsx scripts/check-tool-manifest.ts"
```

**Root `package.json`** — add to `scripts` (alongside existing `contracts:check`):
```json
"tools:check": "tsx apps/api/scripts/check-tool-manifest.ts"
```

Both `tsx` instances resolve: root-level `tsx` is in root `devDependencies`; `apps/api` `tsx` is in its own `devDependencies`. Both work. Root-level script is what CI calls.

### File Structure

**New files:**
```
.github/
└── workflows/
    └── ci.yml                              NEW — CI pipeline with tools:check gate

apps/api/
├── scripts/
│   └── check-tool-manifest.ts              NEW — CI lint: scans *.tools.ts vs TOOL_MANIFEST
└── src/
    ├── agents/
    │   └── tools.manifest.ts               NEW — ToolSpec interface + TOOL_MANIFEST Map
    └── observability/
        ├── tool-latency.histogram.ts        NEW — recordToolLatency() Redis sliding-window
        └── tool-latency.histogram.test.ts  NEW — unit tests (mocked Redis)
```

**Modified files:**
```
apps/api/package.json                       MODIFIED — add tools:check script
package.json (root)                         MODIFIED — add tools:check script
_bmad-output/implementation-artifacts/sprint-status.yaml  MODIFIED — story status
```

**Deleted files:**
```
apps/api/src/agents/.gitkeep                DELETED — replaced by tools.manifest.ts
apps/api/src/agents/tools/.gitkeep          DELETED — directory ready for Epic 3 tools
```

### Architecture Compliance Invariants

| Rule | Impact on this story |
|---|---|
| Files in `agents/` cannot import `fastify`, `routes/`, or `*.routes.ts` | `tools.manifest.ts` imports only `zod` — no Fastify dependency. ✅ |
| Files outside `plugins/` cannot value-import vendor SDKs | `tools.manifest.ts`: only `zod`. `tool-latency.histogram.ts`: `import type { Redis }` (type-only, allowed). `check-tool-manifest.ts`: in `scripts/`, not `src/`, so rule doesn't apply. ✅ |
| No `console.*` in `apps/api/src/` | `tools.manifest.ts` and `tool-latency.histogram.ts` have no console calls. Script is in `scripts/` (excluded from rule). ✅ |
| `.js` extensions on all relative imports in `apps/api/src/` | `tools.manifest.ts` has no relative imports. `tool-latency.histogram.ts` test uses `./tool-latency.histogram.js`. ✅ |
| `import.meta.url` + `fileURLToPath` — no `__dirname` | `check-tool-manifest.ts` uses `dirname(fileURLToPath(import.meta.url))`. ✅ |
| Declare `maxLatencyMs` for every new agent tool (CI lint enforces) | `_placeholder` declares `maxLatencyMs: 50`. The check script enforces this for all future tools. ✅ |
| `pnpm typecheck`, `pnpm lint`, `pnpm test` must stay green | Verification Task 7 confirms all three. ✅ |

### Previous Story Intelligence (from Stories 1.5–1.8)

**Critical patterns to carry forward:**
- **`.js` extensions on all relative imports** — TSC emits `.js`; `tsx watch` hides this but `pnpm build` fails without them. All new `src/` files must use `.js` on relative imports (e.g., `./tool-latency.histogram.js`).
- **`fp()` wraps every Fastify plugin** — `tools.manifest.ts` and `tool-latency.histogram.ts` are plain modules (NOT Fastify plugins), so `fp()` is NOT used here.
- **No `console.*` in `apps/api/src/`** — Use `fastify.log` or `request.log`. The histogram file has no logging needs; check script is in `scripts/` where console is fine.
- **`pnpm build` verification** — always run `pnpm build` at `apps/api` after implementation to catch `.js` extension issues.
- **Deliberate-violation pattern from Story 1.5/1.8** — Not needed for this story (no ESLint rule changes).
- **`as unknown as SomeType`** — TS-idiomatic force-cast for test mocks (avoids banned `as any`). Used in histogram test for `mockRedis`.
- **`import type`** for type-only imports — `@typescript-eslint/consistent-type-imports: error` enforces this. `tool-latency.histogram.ts` must use `import type { Redis } from 'ioredis'`.

**Story 1.8 debug log learnings relevant here:**
- Debug Log #1: `fp()` plugins construct dependencies at registration time — applies to plugins only; this story has no plugins.
- Debug Log #2: `Processor` type from BullMQ — not relevant to this story.
- Debug Log #3: `genReqId` test regression — example of how pre-existing failures block verification. If any existing tests fail, fix them before declaring Story 1.9 done.

### Deferred Items (out of scope for Story 1.9)

- **p95 percentile computation** — `ZRANGE key 0 -1 WITHSCORES` + percentile math. Deferred to Story 3.4 when real tools produce meaningful data.
- **Grafana Cloud alert** — `sampled p95 > maxLatencyMs × 1.5 for ≥1h` threshold. Deferred to Story 3.4.
- **`slo-counters.ts`** — `plan-gen p95`, `voice cost per HH` counters (architecture §6 file tree). Separate observability concern; not part of tool-latency skeleton.
- **Real tools (`recipe.tools.ts`, `memory.tools.ts`, etc.)** — Story 3.4 scope. Story 1.9 only scaffolds the registry shape and CI enforcement.
- **`orchestrator.ts` skeleton** — deferred until Epic 3 (Story 3.2). `tools.manifest.ts` can be extended independently.
- **`LLMProvider` interface and adapters** — deferred to Story 3.2. The manifest is a data structure with no dependency on LLM providers.
- **Turbo integration for `tools:check`** — the `tools:check` script is NOT added to `turbo.json`. It's a standalone check (like root `contracts:check`), run directly in CI rather than through Turbo's dependency graph.

### References

- Architecture §3.5 — tool-latency manifest and budget composition: `_bmad-output/planning-artifacts/architecture.md`
- Architecture §4.3 — tool call shape: `_bmad-output/planning-artifacts/architecture.md`
- Architecture §1.4 — tool naming convention: `_bmad-output/planning-artifacts/architecture.md`
- Architecture §2.2 — `agents/` layout: `_bmad-output/planning-artifacts/architecture.md`
- Story 3.4 — real tool implementations (depends on this story): `1-9` must be `done` before 3-4
- Story 5.8 — ElevenLabs webhook (depends on `tools:check` passing): `1-9` + `3-4` required
- Story 1.8 Dev Notes — established patterns: `_bmad-output/implementation-artifacts/1-8-single-row-audit-log-schema-monthly-partitions-composite-index-audit-service-write.md`
- BullMQ v5 Job Schedulers: referenced in Story 1.8 (same `fastify.bullmq` decorator used here for histogram context)
- ioredis sorted sets (ZADD/ZRANGE/ZREMRANGEBYSCORE): https://redis.io/docs/data-types/sorted-sets/

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (1M context) — bmad-dev-story skill

### Debug Log References

- **Debug #1 — Tuple cast fails under ioredis `zadd`/`zremrangebyscore` overloads (TS2352):**
  - Symptom: `pnpm typecheck` failed on `tool-latency.histogram.test.ts`:
    ```
    Conversion of type '[key: RedisKey, xx: "XX", lt: "LT", ch: "CH", incr: "INCR", ...scoreMembers: ...]'
    to type '[string, number, string]' may be a mistake because neither type sufficiently overlaps …
    Source has 5 element(s) but target allows only 3.
    ```
  - Root cause: ioredis `zadd` overloads declare a 5+ tuple for the `XX/LT/CH/INCR` variadic form. A direct `as [string, number, string]` cast is rejected because the 3-tuple is structurally narrower than any overload.
  - Fix: use the TS-idiomatic intermediate-`unknown` force-cast pattern from the Dev Notes ("`as unknown as SomeType`"). Applied to both `zaddMock.mock.calls[0] as unknown as [string, number, string]` and `trimMock.mock.calls[0] as unknown as [string, string, number]`. No runtime semantics change — only satisfies `no-explicit-any` while sidestepping ioredis overload variance.
  - Takeaway: when mocking ioredis methods whose overload space is wider than the test expectation, the 3-argument tuple shape must go through `unknown` first. Carry this forward to any future ioredis-touching tests (Story 3.4 tool-call instrumentation will hit the same pattern).

### Completion Notes List

- All 6 Acceptance Criteria satisfied; all 7 tasks (including pre-flight + verification) checked.
- `tools.manifest.ts` registers `_placeholder` with all 6 fields (`name`, `description`, `inputSchema`, `outputSchema`, `maxLatencyMs`, `fn`). `fn` uses `(input: unknown) => Promise<unknown>` to preserve Map-type assignability (function parameter contravariance) per Manifest Spec rationale.
- `tool-latency.histogram.ts` performs the ZADD → ZREMRANGEBYSCORE → EXPIRE triplet per spec. `Redis` is type-only imported (`allowTypeImports: true`) — boundary-compliant since the histogram is outside `plugins/`.
- `check-tool-manifest.ts` uses `import.meta.url` + `fileURLToPath` + `pathToFileURL` (ESM + cross-platform safe). `console.*` is permitted because the file lives in `apps/api/scripts/`, which is outside the `src/**/*.ts` `no-console` glob.
- Static import of `TOOL_MANIFEST` into the check script is safe (`tools.manifest.ts` only imports `zod` — no Fastify/DB side effects at module load).
- `pnpm tools:check` exits 0 from both root and `@hivekitchen/api` workspaces (no `*.tools.ts` files exist yet — that's the Story 1.9 baseline; Epic 3 Story 3.4 will seed real tool files).
- CI workflow pins `pnpm@9.15.0` (matches root `packageManager`) and Node 22. `concurrency: cancel-in-progress: true` prevents queue buildup on rapid pushes.
- Budget composition (architecture §3.5) and full p95 Grafana alert wiring remain deferred to Story 3.4 as planned.

### Verification Gates

- `pnpm typecheck` — 9/9 packages green
- `pnpm lint` — 0 errors workspace-wide
- `pnpm test` — 20 passed, 11 skipped (integration tests in `apps/api/test/integration/*` are skipped by design — they require live infra); new `tool-latency.histogram.test.ts` contributes 3 passing tests
- `pnpm tools:check` — exits 0
- `pnpm --filter @hivekitchen/api build` — clean (`.js` extension discipline upheld)

### File List

**New files:**
- `.github/workflows/ci.yml`
- `apps/api/scripts/check-tool-manifest.ts`
- `apps/api/src/agents/tools.manifest.ts`
- `apps/api/src/observability/tool-latency.histogram.ts`
- `apps/api/src/observability/tool-latency.histogram.test.ts`

**Modified files:**
- `apps/api/package.json` — added `tools:check` script
- `package.json` — added root-level `tools:check` script
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — Story 1-9 status `ready-for-dev` → `review`

**Deleted files:**
- `apps/api/src/agents/.gitkeep`
- `apps/api/src/agents/tools/.gitkeep`

### Review Findings

**Decision-needed (resolved → patch):**
- [x] [Review][Decision→Patch] Silent-skip vs. exit(1) on missing MANIFESTED_TOOL_NAMES export — resolved: missing export now increments `violationCount` and calls `console.error` (exit(1) path). [apps/api/scripts/check-tool-manifest.ts:52]

**Patch (3 applied, 1 dismissed):**
- [x] [Review][Patch] ~~CI runner label typo~~ — dismissed: file already contains `ubuntu-latest` (false positive from review tooling).
- [x] [Review][Patch] Redis operations not atomic — fixed: `zadd`/`zremrangebyscore`/`expire` now batched via `redis.pipeline().exec()`. [apps/api/src/observability/tool-latency.histogram.ts:16-18]
- [x] [Review][Patch] `readdir` catch swallows non-ENOENT errors — fixed: non-ENOENT errors now re-thrown; only ENOENT exits 0. [apps/api/scripts/check-tool-manifest.ts:35-37]
- [x] [Review][Patch] Missing `MANIFESTED_TOOL_NAMES` export was silent skip — fixed: now counts as a violation and calls `console.error`. [apps/api/scripts/check-tool-manifest.ts:52]

**Deferred (9):**
- [x] [Review][Defer] `toolName` unsanitized in Redis key interpolation [apps/api/src/observability/tool-latency.histogram.ts:12] — deferred, internal caller; toolName comes from `toolSpec.name` which is manifest-controlled (`<domain>.<verb>` naming convention). Re-evaluate if toolName ever becomes externally influenced.
- [x] [Review][Defer] `zadd` same-millisecond member collision silently drops a sample [apps/api/src/observability/tool-latency.histogram.ts:16] — deferred, pre-existing; loss of one sample at sub-ms granularity is irrelevant for p95 sampling. Address in Story 3.4 if precision matters.
- [x] [Review][Defer] Negative `latencyMs` values accepted without bounds check [apps/api/src/observability/tool-latency.histogram.ts] — deferred, internal caller; value derives from `Date.now() - start` which is always ≥ 0. Add validation in Story 3.4 when public orchestrator API is defined.
- [x] [Review][Defer] `spec[field] === undefined` passes `null` field values [apps/api/scripts/check-tool-manifest.ts:68] — deferred; TypeScript strict mode prevents null assignment to non-nullable ToolSpec fields. Only reachable via runtime type bypass.
- [x] [Review][Defer] `extractManifestNames` does not verify array elements are strings [apps/api/scripts/check-tool-manifest.ts:20] — deferred; TypeScript type system enforces `readonly string[]`; non-string elements require deliberate type bypass.
- [x] [Review][Defer] `mockRedis` shared at `describe` scope — future test isolation risk [apps/api/src/observability/tool-latency.histogram.test.ts:6] — deferred; current tests do not mutate mock implementations. Re-evaluate when Story 3.4 adds `mockResolvedValueOnce` patterns.
- [x] [Review][Defer] GitHub Actions pinned to major tags, not commit SHAs — supply chain risk [.github/workflows/ci.yml] — deferred, project-wide concern; SHA-pinning is a hardening pass for a dedicated DevSecOps story.
- [x] [Review][Defer] Node 22 `engines` field missing from root `package.json` — deferred, project-wide concern not introduced by this story; carry forward to a root-hygiene pass (see also 1-3 deferred log).
- [x] [Review][Defer] Redis failure paths (zadd/expire rejection) not tested [apps/api/src/observability/tool-latency.histogram.test.ts] — deferred; Story 3.4 scope when orchestrator wires live Redis calls.

## Change Log

| Date | Change | By |
|---|---|---|
| 2026-04-24 | Story created from epics.md AC + architecture §3.5/§4.3/§1.4/§2.2 + Story 1.8 learnings | Story Context Engine |
| 2026-04-24 | Story 1.9 implemented: tools.manifest.ts + _placeholder; tool-latency.histogram.ts + tests; check-tool-manifest.ts; tools:check scripts (api + root); .github/workflows/ci.yml. All gates green. Status → review. | Dev Agent (Amelia / claude-opus-4-7) |
