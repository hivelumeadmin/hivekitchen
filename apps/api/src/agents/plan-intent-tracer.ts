import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { PlanIntentResult } from '@hivekitchen/types';
import type { DispatchResult } from './dispatch-plan-intent.js';

// Epic 13-s9 / routing-spec §8 — one trace artifact per conversational
// plan-edit turn, keyed off PLAN_TRACE_DIR (the same opt-in facility as the
// planner compose trace; symmetric with OnboardingTracer). Two tags per turn:
//
//   plan_intent.routed   { intent, confidence, tier:'T1', model:'mini' }  — the classifier call
//   plan_intent.dispatch { intent, action, tier, escalated, model:null } — the deterministic execution
//
// `routed` is null on the chip-tap bypass (a pre-built intent was POSTed, no
// classifier ran) and `model` is always null on the dispatch tag, so T0 turns
// are visibly free — the trace never claims a model that did not run.
// Fire-and-forget: a trace IO failure never affects the edit response.

const PLAN_INTENT_CLASSIFIER_TIER = 'mini' as const;

export interface PlanIntentTracerInit {
  householdId: string;
  planId: string;
}

export interface PlanIntentTraceInput {
  /** null on the chip-tap bypass (no utterance was classified). */
  utterance: string | null;
  intent: PlanIntentResult;
  dispatch: DispatchResult;
  /** The executor outcome status ('applied' | 'clarify' | 'escalate' | …). */
  outcomeStatus: string;
}

interface PlanIntentTraceArtifact {
  household_id: string;
  plan_id: string;
  written_at: string;
  utterance: string | null;
  'plan_intent.routed': {
    intent: string;
    confidence: number;
    tier: 'T1';
    model: string;
  } | null;
  'plan_intent.dispatch': {
    intent: string;
    action: string;
    tier: string;
    escalated: boolean;
    model: null;
  };
  outcome_status: string;
}

export class PlanIntentTracer {
  private readonly fileId = randomUUID().slice(0, 8);

  constructor(
    private readonly dir: string,
    private readonly init: PlanIntentTracerInit,
    private readonly logger: FastifyBaseLogger,
  ) {}

  write(input: PlanIntentTraceInput): Promise<void> {
    const artifact: PlanIntentTraceArtifact = {
      household_id: this.init.householdId,
      plan_id: this.init.planId,
      written_at: new Date().toISOString(),
      utterance: input.utterance,
      'plan_intent.routed':
        input.utterance === null
          ? null // chip bypass — zero LLM calls
          : {
              intent: input.intent.intent,
              confidence: input.intent.confidence,
              tier: 'T1',
              model: PLAN_INTENT_CLASSIFIER_TIER,
            },
      'plan_intent.dispatch': {
        intent: input.intent.intent,
        action: input.dispatch.action,
        tier: input.dispatch.tier,
        escalated: input.dispatch.action === 'escalate',
        model: null, // dispatch + execution are deterministic — visibly free
      },
      outcome_status: input.outcomeStatus,
    };
    return this.flush(artifact);
  }

  private async flush(artifact: PlanIntentTraceArtifact): Promise<void> {
    try {
      await mkdir(this.dir, { recursive: true });
      const fileName = `plan-intent__${this.init.householdId}__${this.fileId}.json`;
      await writeFile(join(this.dir, fileName), JSON.stringify(artifact, null, 2), 'utf8');
      this.logger.debug({ traceFile: fileName }, 'plan-intent: routing trace written');
    } catch (err) {
      this.logger.warn({ err }, 'plan-intent: routing trace write failed');
    }
  }
}

// Returns a tracer only when PLAN_TRACE_DIR is configured; otherwise undefined
// so the call site is a cheap `tracer?.write(...)` no-op. Mirrors
// createPlanTracer / createOnboardingTracer.
export function createPlanIntentTracer(
  init: PlanIntentTracerInit,
  logger: FastifyBaseLogger,
): PlanIntentTracer | undefined {
  const dir = process.env.PLAN_TRACE_DIR;
  if (!dir || dir.trim() === '') return undefined;
  return new PlanIntentTracer(dir.trim(), init, logger);
}
