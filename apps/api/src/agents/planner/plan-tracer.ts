import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { KitchenMap } from '@hivekitchen/types';
import type {
  LLMCallOptions,
  LLMMessage,
  LLMResponse,
  LLMTier,
} from '../providers/llm-provider.interface.js';

// Per-run agentic trace for a single planWeek compose. Opt-in: only active when
// PLAN_TRACE_DIR is set. Writes ONE human-readable text file per planWeek call
// (a guardrail-retry is a separate compose → its own file), capturing the full
// input context, the exact system+user prompt the model received, the model's
// raw tool-call output, and the post-compose result. This is a debug/inspection
// aid, NOT structured telemetry — the console logs remain the machine-readable
// channel. File writes are best-effort and never affect planning.
//
// Each section is appended as the run progresses; flush() writes the file once
// at the end (success or the no-consecutive-Main failure path).

const RULE = '='.repeat(72);

export interface PlanTracerInit {
  requestId: string;
  householdId: string;
  weekOf: string;
  tier: LLMTier;
  attempt: 'initial' | 'guardrail-retry';
  /** Which agent this trace covers. 'planner' is the single forced-compose
   *  call (planWeek); 'swap' is the multi-iteration surgical-swap loop
   *  (swapBlockedItems). Defaults to 'planner'. */
  agent?: 'planner' | 'swap';
}

export class PlanTracer {
  private readonly lines: string[] = [];
  private readonly startedMs = Date.now();
  private readonly fileId = randomUUID().slice(0, 8);

  constructor(
    private readonly dir: string,
    private readonly init: PlanTracerInit,
    private readonly logger: FastifyBaseLogger,
  ) {
    this.lines.push(
      RULE,
      `PLAN COMPOSE TRACE — ${init.agent ?? 'planner'}`,
      RULE,
      `Agent        : ${init.agent ?? 'planner'}`,
      `Request ID   : ${init.requestId}`,
      `Household    : ${init.householdId}`,
      `Week of      : ${init.weekOf}`,
      `Tier         : ${init.tier}`,
      `Attempt      : ${init.attempt}`,
      `Started      : ${new Date(this.startedMs).toISOString()}`,
      '',
    );
  }

  private section(title: string): void {
    this.lines.push(RULE, title, RULE);
  }

  recordContext(params: {
    kitchenMap?: KitchenMap;
    dayScope?: string;
    plannedDays?: readonly string[];
    rejectionContext?: string;
    uncertainContext?: string;
  }): void {
    this.section('INPUT CONTEXT');
    const { kitchenMap } = params;
    if (kitchenMap) {
      const household = kitchenMap.household.declared_allergens;
      this.lines.push(
        `Kitchen map  : ${String(kitchenMap.children.length)} children; household allergens: [${household.join(', ')}]`,
      );
      for (const child of kitchenMap.children) {
        this.lines.push(
          `  ${child.id} : allergens [${child.declared_allergens.join(', ')}]`,
        );
      }
    } else {
      this.lines.push('Kitchen map  : (none pre-loaded)');
    }
    this.lines.push(
      `Day scope    : ${params.dayScope ?? '(full week)'}`,
      `Planned days : ${params.plannedDays && params.plannedDays.length > 0 ? params.plannedDays.join(', ') : '(default week)'}`,
    );
    if (params.rejectionContext && params.rejectionContext.length > 0) {
      this.lines.push('Rejection    :', indent(params.rejectionContext));
    }
    if (params.uncertainContext && params.uncertainContext.length > 0) {
      this.lines.push('Uncertain    :', indent(params.uncertainContext));
    }
    this.lines.push('');
  }

  recordCoverage(
    before: { main: number; extra: number },
    after: { main: number; extra: number },
  ): void {
    this.section('COVERAGE (ensureCandidateCoverage)');
    this.lines.push(
      `Before  : ${String(before.main)} mains, ${String(before.extra)} extras`,
      `After   : ${String(after.main)} mains, ${String(after.extra)} extras`,
      after.main === before.main && after.extra === before.extra
        ? 'Delta   : none (warm slate)'
        : `Delta   : +${String(after.main - before.main)} mains, +${String(after.extra - before.extra)} extras (acquired)`,
      '',
    );
  }

  recordPrompt(messages: readonly LLMMessage[]): void {
    this.section('SYSTEM PROMPT (full)');
    const system = messages.find((m) => m.role === 'system');
    this.lines.push(system?.content ?? '(no system message)', '');
    this.section('USER CONTEXT (full)');
    const user = messages.find((m) => m.role === 'user');
    this.lines.push(user?.content ?? '(no user message)', '');
  }

  recordLlmCall(options: LLMCallOptions, messageCount: number, iteration?: number): void {
    this.section(iteration === undefined ? 'LLM CALL' : `LLM CALL — iteration ${String(iteration)}`);
    this.lines.push(
      `Tier         : ${options.tier ?? options.model ?? '(default)'}`,
      `Temperature  : ${String(options.temperature ?? '(default)')}`,
      `Max tokens   : ${String(options.maxTokens ?? '(default)')}`,
      `Forced tool  : ${options.forcedToolName ?? '(none)'}`,
      `Metadata     : ${options.metadata ? JSON.stringify(options.metadata) : '(none)'}`,
      `Messages     : ${String(messageCount)}`,
      `Sent at      : ${new Date().toISOString()}`,
      '',
    );
  }

  recordLlmResponse(response: LLMResponse, latencyMs: number, iteration?: number): void {
    this.section(
      iteration === undefined ? 'LLM RESPONSE' : `LLM RESPONSE — iteration ${String(iteration)}`,
    );
    this.lines.push(
      `Finish       : ${response.finishReason}`,
      `Tokens       : ${String(response.usage.promptTokens)} prompt / ${String(response.usage.completionTokens)} completion / ${String(response.usage.cachedPromptTokens)} cached`,
      `Latency      : ${String(latencyMs)} ms`,
      `Tool calls   : ${String(response.toolCalls.length)}`,
      '',
    );
  }

  recordToolCall(name: string, args: unknown): void {
    this.section(`TOOL CALL — ${name} (model output, raw)`);
    this.lines.push(safeJson(args), '');
  }

  // Multi-turn loop variant (swap agent): records both the model's emitted
  // arguments and the tool's returned result, so a reader sees the full
  // request/response of each tool the agent invoked within an iteration.
  recordToolExecution(name: string, args: unknown, result: unknown): void {
    this.section(`TOOL EXECUTION — ${name}`);
    this.lines.push('Arguments (model output):', safeJson(args), '', 'Result (tool output):', safeJson(result), '');
  }

  recordPostCompose(noConsecutivePass: boolean): void {
    this.section('POST-COMPOSE');
    this.lines.push(
      'applyPlanDefaults  : applied (portion/spice/texture defaults filled)',
      `noConsecutiveMain  : ${noConsecutivePass ? 'PASS' : 'FAIL (threw)'}`,
      '',
    );
  }

  recordResult(output: unknown, planId: string, totalMs: number): void {
    this.section('RESULT (post-compose, final)');
    this.lines.push(`Plan ID  : ${planId}`, `Total    : ${String(totalMs)} ms`, '', safeJson(output), '');
  }

  recordError(err: unknown): void {
    this.section('ERROR');
    if (err instanceof Error) {
      this.lines.push(`${err.name}: ${err.message}`, err.stack ?? '(no stack)', '');
    } else {
      this.lines.push(String(err), '');
    }
  }

  async flush(): Promise<void> {
    try {
      await mkdir(this.dir, { recursive: true });
      const safeWeek = this.init.weekOf.replace(/[^0-9-]/g, '');
      const agent = this.init.agent ?? 'planner';
      const fileName = `${agent}__${safeWeek}__${this.init.householdId}__${this.init.attempt}__${this.fileId}.txt`;
      await writeFile(join(this.dir, fileName), this.lines.join('\n'), 'utf8');
      this.logger.debug({ traceFile: fileName }, 'planWeek: agentic trace written');
    } catch (err) {
      // A trace write failure must never affect planning.
      this.logger.warn({ err }, 'planWeek: agentic trace write failed');
    }
  }
}

// Returns a PlanTracer only when PLAN_TRACE_DIR is configured; otherwise
// undefined so every call site is a cheap `tracer?.record(...)` no-op.
export function createPlanTracer(
  init: PlanTracerInit,
  logger: FastifyBaseLogger,
): PlanTracer | undefined {
  const dir = process.env.PLAN_TRACE_DIR;
  if (!dir || dir.trim() === '') return undefined;
  return new PlanTracer(dir.trim(), init, logger);
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((l) => `  ${l}`)
    .join('\n');
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
