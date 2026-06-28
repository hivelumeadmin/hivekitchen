import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { getOnboardingSystemPrompt } from './prompts/onboarding.prompt.js';
import { TEXT_MODEL_TIER, type OnboardingAgentUsage, type OnboardingToolCallSummary } from './onboarding.agent.js';
import type { MomentState } from '../modules/onboarding/onboarding-moment.repository.js';

// Per-turn agentic trace for a single onboarding text turn. Opt-in: only
// active when ONBOARDING_TRACE_DIR is set. Mirrors the planner's PLAN_TRACE_DIR
// / plan-tracer.ts so the two tracers are symmetric — the same tool that
// cracked the planner's strict-schema bug (memory: strict-tool-schema-nullable-
// rule). Writes ONE JSON artifact per text turn capturing the assembled system
// prompt, the three service-rendered dynamic blocks, every tool call with its
// args + result, model + token usage, and moment-state before and after the
// turn. This is a debug/inspection aid, NOT structured telemetry — the Pino
// logs remain the machine-readable channel. Writes are fire-and-forget and a
// failure never affects the turn response.

export interface OnboardingTracerInit {
  householdId: string;
  threadId: string;
  /** Number of turns already on the thread before this one — gives each
   *  artifact a stable, monotonic per-household index. */
  turnIndex: number;
}

export interface OnboardingTraceInput {
  /** The three dynamic blocks the service rendered for the prompt (reused, not
   *  recomputed). Undefined on the legacy single-shot path (no tool loop). */
  kitchenMapBlock?: string;
  momentStateBlock?: string;
  vocabularyBlock?: string;
  /** One entry per tool call (with args + result), in invocation order. Empty
   *  on the single-shot path. */
  toolCalls: readonly OnboardingToolCallSummary[];
  usage: OnboardingAgentUsage | undefined;
  momentBefore: MomentState | null;
  momentAfter: MomentState | null;
}

interface OnboardingTraceArtifact {
  household_id: string;
  thread_id: string;
  turn_index: number;
  /** The tier the conversational turn ran on, or null on a zero-LLM turn (a
   *  pure-chip turn applies chip selections deterministically with no model
   *  call) so the trace never claims a model that did not run. */
  model: string | null;
  written_at: string;
  /** The static base system prompt the text agent assembles on top of (the
   *  dynamic blocks below are appended to it inside the agent). Null on a
   *  zero-LLM (pure-chip) turn — no prompt was sent to any model. */
  system_prompt: string | null;
  dynamic_blocks: {
    kitchen_map: string | null;
    moment_state: string | null;
    vocabulary: string | null;
  };
  tool_calls: ReadonlyArray<{
    tool: string;
    error: boolean;
    args: unknown;
    result: unknown;
  }>;
  usage: OnboardingAgentUsage | null;
  moment_before: MomentState | null;
  moment_after: MomentState | null;
}

export class OnboardingTracer {
  private readonly fileId = randomUUID().slice(0, 8);

  constructor(
    private readonly dir: string,
    private readonly init: OnboardingTracerInit,
    private readonly logger: FastifyBaseLogger,
  ) {}

  /**
   * Assemble the artifact and write it off the hot path. Callers fire this
   * forget-style (`void tracer?.write(...)`) so a trace IO failure never
   * affects the turn response (AC4); the returned promise exists only so tests
   * can await the write deterministically. When ONBOARDING_TRACE_DIR is unset
   * the call site short-circuits and this argument is never constructed
   * (AC2 — assembly skipped, not discarded).
   */
  write(input: OnboardingTraceInput): Promise<void> {
    // A zero-LLM (pure-chip) turn carries no usage — it applied chip selections
    // deterministically with no model call. Record model/system_prompt as null
    // on that path so the artifact doesn't show a flagship prompt that was never
    // sent (the deterministic chip→slot path the inversion depends on).
    const calledModel = input.usage !== undefined;
    const artifact: OnboardingTraceArtifact = {
      household_id: this.init.householdId,
      thread_id: this.init.threadId,
      turn_index: this.init.turnIndex,
      // Slice 2.7-s4 — the conversational turn's tier ('flagship'); the adapter's
      // TIER_TO_MODEL resolves the concrete model. Recording the tier keeps the
      // trace honest about the (now config-driven) model selection.
      model: calledModel ? TEXT_MODEL_TIER : null,
      written_at: new Date().toISOString(),
      system_prompt: calledModel ? getOnboardingSystemPrompt('text') : null,
      dynamic_blocks: {
        kitchen_map: input.kitchenMapBlock ?? null,
        moment_state: input.momentStateBlock ?? null,
        vocabulary: input.vocabularyBlock ?? null,
      },
      tool_calls: input.toolCalls.map((tc) => ({
        tool: tc.tool,
        error: tc.error,
        args: tc.args ?? null,
        result: tc.result ?? null,
      })),
      usage: input.usage ?? null,
      moment_before: input.momentBefore,
      moment_after: input.momentAfter,
    };
    return this.flush(artifact);
  }

  private async flush(artifact: OnboardingTraceArtifact): Promise<void> {
    try {
      await mkdir(this.dir, { recursive: true });
      const fileName = `${this.init.householdId}__${String(this.init.turnIndex)}__${this.fileId}.json`;
      await writeFile(join(this.dir, fileName), safeJson(artifact), 'utf8');
      this.logger.debug({ traceFile: fileName }, 'onboarding: agentic trace written');
    } catch (err) {
      // A trace write failure must never affect the turn.
      this.logger.warn({ err }, 'onboarding: agentic trace write failed');
    }
  }
}

// Returns an OnboardingTracer only when ONBOARDING_TRACE_DIR is configured;
// otherwise undefined so the call site is a cheap `tracer?.write(...)` no-op
// whose argument is never assembled. Mirrors createPlanTracer.
export function createOnboardingTracer(
  init: OnboardingTracerInit,
  logger: FastifyBaseLogger,
): OnboardingTracer | undefined {
  const dir = process.env.ONBOARDING_TRACE_DIR;
  if (!dir || dir.trim() === '') return undefined;
  return new OnboardingTracer(dir.trim(), init, logger);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
