import type { FastifyBaseLogger } from 'fastify';
import { GUARDRAIL_VERSION } from '../allergy-guardrail/allergy-rules.engine.js';
import { GuardrailRejectionError, NotImplementedError } from '../../common/errors.js';
import type { AllergyGuardrailService } from '../allergy-guardrail/allergy-guardrail.service.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { PlansRepository } from './plans.repository.js';
import type {
  CommitPlanInput,
  GuardrailResult,
  PlanComposeInput,
  PlanComposeOutput,
  PlanItemForGuardrail,
} from '@hivekitchen/types';

export interface PlansServiceDeps {
  repository: PlansRepository;
  allergyGuardrail: AllergyGuardrailService;
  auditService: AuditService;
  logger: FastifyBaseLogger;
}

const MAX_GUARDRAIL_RETRIES = 3;

export class PlansService {
  private readonly repo: PlansRepository;
  private readonly allergyGuardrail: AllergyGuardrailService;
  private readonly auditService: AuditService;
  private readonly logger: FastifyBaseLogger;

  constructor(deps: PlansServiceDeps) {
    this.repo = deps.repository;
    this.allergyGuardrail = deps.allergyGuardrail;
    this.auditService = deps.auditService;
    this.logger = deps.logger;
  }

  // Stub until Story 3.7 wires the BullMQ job that calls the planner agent.
  // The plan.compose tool dispatches here and surfaces the 501 to the caller.
  async compose(_input: PlanComposeInput): Promise<PlanComposeOutput> {
    throw new NotImplementedError('plan.compose — real generation lands in Story 3.7 BullMQ job');
  }

  // Presentation-bind transaction: clear-or-reject the plan, and on clearance
  // commit the plan + items + guardrail fields atomically. On a guardrail
  // block, the caller-supplied regenerate() callback produces the next attempt
  // (Story 3.7 wires the real composer; until then callers pass a stub that
  // rethrows NotImplementedError).
  async commit(
    input: CommitPlanInput,
    requestId: string,
    regenerate: (rejections: GuardrailResult[]) => Promise<CommitPlanInput>,
  ): Promise<string> {
    // Enforce plan_id re-use: if a plan already exists for this household+week,
    // reuse its id so commit_plan's ON CONFLICT (id) upsert path is taken and
    // the (household_id, week_id) unique index is never violated.
    const existing = await this.repo.findActiveByHouseholdAndWeek({
      householdId: input.household_id,
      weekId: input.week_id,
    });
    let current: CommitPlanInput = existing ? { ...input, plan_id: existing.id } : input;
    const planId = current.plan_id;
    const rejections: GuardrailResult[] = [];
    let lastAttempt = 0;

    for (let attempt = 1; attempt <= MAX_GUARDRAIL_RETRIES; attempt++) {
      lastAttempt = attempt;
      const guardrailItems: PlanItemForGuardrail[] = current.items.map((item) => ({
        child_id: item.child_id,
        day: item.day,
        slot: item.slot,
        ingredients: item.ingredients,
      }));

      const result = await this.allergyGuardrail.clearOrReject(
        guardrailItems,
        current.household_id,
        requestId,
      );

      if (result.verdict === 'cleared') {
        const clearedAt = new Date().toISOString();
        await this.repo.commit(current, clearedAt, GUARDRAIL_VERSION);

        try {
          await this.auditService.write({
            event_type: 'plan.generated',
            household_id: current.household_id,
            request_id: requestId,
            metadata: {
              plan_id: planId,
              revision: current.revision,
              prompt_version: current.prompt_version,
            },
            stages: [
              ...rejections.map((r, i) => ({
                stage: 'guardrail_rejection',
                attempt: i + 1,
                conflicts: r.verdict === 'blocked' ? r.conflicts : [],
              })),
              {
                stage: 'guardrail_verdict',
                verdict: 'cleared',
                guardrail_version: GUARDRAIL_VERSION,
              },
            ],
          });
        } catch (err) {
          this.logger.error(
            { plan_id: planId, err },
            'audit write failed after plan commit — plan is committed',
          );
        }

        this.logger.info(
          { plan_id: planId, attempt, guardrail_version: GUARDRAIL_VERSION },
          'plan committed after guardrail clearance',
        );
        return planId;
      }

      if (result.verdict === 'uncertain') {
        // Infrastructure failure (e.g. empty_ingredients, no_rules_loaded) — not a
        // safety conflict. Regeneration cannot fix this; exit immediately.
        throw new GuardrailRejectionError(planId, attempt);
      }

      rejections.push(result);
      this.logger.warn(
        { plan_id: planId, attempt, verdict: result.verdict },
        'guardrail blocked plan — attempting regeneration',
      );

      if (attempt < MAX_GUARDRAIL_RETRIES) {
        try {
          current = await regenerate(rejections);
        } catch (err) {
          this.logger.error(
            { plan_id: planId, attempt, err },
            'regenerate callback threw during guardrail retry',
          );
          throw new GuardrailRejectionError(planId, attempt);
        }
      }
    }

    throw new GuardrailRejectionError(planId, lastAttempt);
  }
}
