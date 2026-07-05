import { createHash } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import type { PlanComposeTreeOutput } from '@hivekitchen/types';
import { DomainOrchestrator } from '../orchestrator.js';
import type { OrchestratorServices, PlanWeekOptions } from '../orchestrator.js';
import { TOOL_MANIFEST } from '../tools.manifest.js';
import { PLANNER_PROMPT } from '../prompts/planner.prompt.js';
import type {
  LLMProvider,
  LLMResponse,
  LLMStreamEvent,
  LLMToolCall,
} from '../providers/llm-provider.interface.js';
import type { AuditService } from '../../audit/audit.service.js';

// ===========================================================================
// Story 3.5-s1 — Planner golden-set eval harness.
// ===========================================================================
// Deterministic, no-network driver for DomainOrchestrator.planWeek. A fake
// LLMProvider replays a fixture's pre-baked responses (the stand-in for the
// model's emissions), so the harness exercises the REAL orchestration loop,
// the REAL plan.compose tool (input/output schema validation + name
// resolution), and the REAL prompt assembly — without OpenAI, Supabase, or
// Redis over the wire. Assertions (planner-eval.assertions.ts) then verify the
// produced tree. Characterization only: this harness changes NO planner
// behavior; it pins current behavior so Epic 3.5 slices s2–s7 can prove parity.
//
// Why a fake provider and not a fake plan.compose: stubbing at the provider
// (per project-context "stubbed OpenAI responses … test the produced payload")
// keeps plan.tools.ts (PlanComposeTreeInputSchema.parse, name→id resolution,
// PlanComposeTreeOutputSchema.parse) in the path — exactly the code s2/s3
// change. Recipe/Plan service DOUBLES below make that tool runnable offline.
// ===========================================================================

// Deterministic ids — no Date.now()/Math.random() anywhere in the harness.
export const EVAL_PLAN_ID = '99999999-9999-4999-8999-999999999999';

// The recipe-service double resolves a recipe name to a stable identifier (the
// name itself), so assertions can map a composed slot back to its ingredients
// without a DB. Production resolves names to catalog UUIDs; identity here keeps
// the fixture↔assertion mapping trivial and readable.
function makeRecipeDouble(): OrchestratorServices['recipe'] {
  return {
    findIdByName: async (value: string): Promise<string> => value,
    // Story 3.5-s5 — ensureCandidateCoverage calls search() directly (not via
    // the LLM) when a slate is below the Main floor. The fixtures carry their
    // own ratified slates, so the pre-flight must surface nothing: an empty
    // result means coverage returns best-available and the composed plan is
    // unchanged. recipeAgent is null in the harness, so discover never runs.
    search: async (): Promise<{ results: [] }> => ({ results: [] }),
  } as unknown as OrchestratorServices['recipe'];
}

// The plan-service double echoes the parsed plan.compose INPUT tree back as an
// OUTPUT tree (adds the deterministic plan_id the RPC would generate). This is
// the only PlansService method plan.compose calls.
function makePlanDouble(): OrchestratorServices['plan'] {
  return {
    composeTree: async (parsed: {
      household_id: string;
      week_of: string;
      main_assignments: unknown;
      days: unknown;
      prompt_version: string;
    }): Promise<unknown> => ({
      plan_id: EVAL_PLAN_ID,
      household_id: parsed.household_id,
      week_of: parsed.week_of,
      main_assignments: parsed.main_assignments,
      days: parsed.days,
      prompt_version: parsed.prompt_version,
    }),
  } as unknown as OrchestratorServices['plan'];
}

// Services the planner's 4-tool allowlist never invokes on these fixtures.
// Present only so the constructor can build (and never-call) their tool specs.
function makeInertServices(): Omit<OrchestratorServices, 'recipe' | 'plan'> {
  const inert = {} as unknown;
  return {
    memory: inert as OrchestratorServices['memory'],
    allergyGuardrail: inert as OrchestratorServices['allergyGuardrail'],
    pantry: inert as OrchestratorServices['pantry'],
    culturalPrior: inert as OrchestratorServices['culturalPrior'],
    childPrefs: inert as OrchestratorServices['childPrefs'],
    children: inert as OrchestratorServices['children'],
  };
}

function makeLogger(): FastifyBaseLogger {
  const noop = (): undefined => undefined;
  const logger = {
    fatal: noop, error: noop, warn: noop, info: noop, debug: noop, trace: noop,
    silent: noop, level: 'silent',
    child(): FastifyBaseLogger { return logger as unknown as FastifyBaseLogger; },
  };
  return logger as unknown as FastifyBaseLogger;
}

// recordToolLatency (called by plan.compose) swallows redis errors, so a
// pipeline that resolves empty is enough — nothing reaches a real Redis.
function makeRedis(): Redis {
  const pipeline = {
    zadd() { return pipeline; },
    zremrangebyscore() { return pipeline; },
    expire() { return pipeline; },
    exec: async (): Promise<unknown[]> => [],
  };
  return { pipeline: () => pipeline } as unknown as Redis;
}

interface CapturedAudit {
  event_type: string;
  metadata?: Record<string, unknown>;
}

function makeAudit(sink: CapturedAudit[]): AuditService {
  return {
    write: async (input: CapturedAudit): Promise<void> => {
      sink.push(input);
    },
  } as unknown as AuditService;
}

// Replays a fixed queue of responses. Tracks turns + token usage actually
// consumed so the harness can assert the cost/turn budget (AC E). Throws if the
// orchestrator asks for more turns than the fixture provides — a fixture bug.
class FakeLLMProvider implements LLMProvider {
  readonly name = 'eval-fake';
  private cursor = 0;
  readonly consumed: LLMResponse[] = [];

  constructor(private readonly responses: readonly LLMResponse[]) {}

  // Fewer params than the LLMProvider interface — TS allows it; the eval never
  // inspects the prompt/tools/options, only replays the queued responses.
  async complete(): Promise<LLMResponse> {
    return this.next();
  }

  async completeWithMessages(): Promise<LLMResponse> {
    return this.next();
  }

  async *stream(): AsyncIterable<LLMStreamEvent> {
    yield { type: 'done' };
  }

  async probe(): Promise<boolean> {
    return true;
  }

  // Story 3.5-s2 — the eval exercises the forced-compose path, not the
  // non-forced fallback, so the fake reports strict-tool support.
  supportsStrictTools(): boolean {
    return true;
  }

  get turns(): number {
    return this.consumed.length;
  }

  get promptTokens(): number {
    return this.consumed.reduce((n, r) => n + r.usage.promptTokens, 0);
  }

  get completionTokens(): number {
    return this.consumed.reduce((n, r) => n + r.usage.completionTokens, 0);
  }

  get planComposeCalls(): number {
    return this.consumed.reduce(
      (n, r) => n + r.toolCalls.filter((t) => t.name === 'plan.compose').length,
      0,
    );
  }

  private next(): LLMResponse {
    const r = this.responses[this.cursor];
    if (!r) {
      throw new Error(
        `FakeLLMProvider exhausted after ${String(this.cursor)} turns — fixture provided too few responses`,
      );
    }
    this.cursor += 1;
    this.consumed.push(r);
    return r;
  }
}

// Build a plan.compose tool-call response (the model "emitting" a tree). The
// arguments ARE the PlanComposeTreeInput the real plan.compose tool parses.
export function planComposeTurn(
  treeInput: unknown,
  usage: { promptTokens: number; completionTokens: number } = {
    promptTokens: 100,
    completionTokens: 50,
  },
  id = 'call_compose',
): LLMResponse {
  return {
    content: null,
    toolCalls: [{ id, name: 'plan.compose', arguments: treeInput }],
    finishReason: 'tool_calls',
    usage: { ...usage, cachedPromptTokens: 0 },
  };
}

// Temporarily replace a wired tool's fn (e.g. recipe.search on the cold-slate
// fixture) AFTER orchestrator construction — the constructor resets the
// manifest to real specs, so this must run per-fixture, post-construction.
function wireToolStub(name: string, fn: (input: unknown) => Promise<unknown>): void {
  const existing = TOOL_MANIFEST.get(name);
  if (!existing) throw new Error(`tool not in manifest: ${name}`);
  TOOL_MANIFEST.set(name, { ...existing, fn });
}

export interface EvalFixture {
  id: string;
  options: PlanWeekOptions;
  // recipe name → effective base ingredient strings; drives the allergen check.
  recipeIngredients: Record<string, readonly string[]>;
  // The model's emissions, in order. Each becomes one completeWithMessages turn.
  stubResponses: LLMResponse[];
  expected: {
    // child_id → slot kinds that MUST be present (snack excluded; server-assigned).
    activeSlotsByChild: Record<string, ReadonlyArray<'main' | 'extra'>>;
    // child_id → effective declared allergens (household-wide ∪ child's own).
    declaredAllergensByChild: Record<string, readonly string[]>;
    // recipe names the planner must NOT place anywhere.
    bannedRecipes?: readonly string[];
  };
  budget: {
    maxTurns: number;
    maxPlanComposeCalls: number;
    maxPromptTokens: number;
    maxCompletionTokens: number;
  };
  // Optional per-fixture tool fn overrides (e.g. recipe.search for cold slate).
  toolStubs?: Record<string, (input: unknown) => Promise<unknown>>;
}

export interface RunResult {
  output: PlanComposeTreeOutput;
  turns: number;
  planComposeCalls: number;
  promptTokens: number;
  completionTokens: number;
  audits: CapturedAudit[];
  toolCalls: LLMToolCall[];
}

// Construct a fresh orchestrator + fake provider per fixture and run planWeek.
// Returns the produced tree plus the cost/turn metrics for the budget assertion.
export async function runFixture(fixture: EvalFixture): Promise<RunResult> {
  const audits: CapturedAudit[] = [];
  const provider = new FakeLLMProvider(fixture.stubResponses);
  const orchestrator = new DomainOrchestrator(
    [provider],
    { recipe: makeRecipeDouble(), plan: makePlanDouble(), ...makeInertServices() },
    makeRedis(),
    makeAudit(audits),
    makeLogger(),
  );

  if (fixture.toolStubs) {
    for (const [name, fn] of Object.entries(fixture.toolStubs)) {
      wireToolStub(name, fn);
    }
  }

  const output = await orchestrator.planWeek(fixture.options);

  const toolCalls = provider.consumed.flatMap((r) => r.toolCalls);
  return {
    output,
    turns: provider.turns,
    planComposeCalls: provider.planComposeCalls,
    promptTokens: provider.promptTokens,
    completionTokens: provider.completionTokens,
    audits,
    toolCalls,
  };
}

// Content hash binding the eval run to an exact prompt + model tier (AC9). When
// the prompt text or version changes, the hash changes — the eval result is no
// longer comparable to a prior baseline unless re-ratified.
export function recordPromptHash(tier = 'flagship'): string {
  return createHash('sha256')
    .update(`${PLANNER_PROMPT.version}\n${PLANNER_PROMPT.text}\n${tier}`)
    .digest('hex');
}